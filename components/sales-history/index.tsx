"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Product, Sale, SaleReturn } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { PERIOD_PRESETS, inPeriod, periodRange, type PeriodId } from "@/lib/period"
import {
  flattenSaleUnits,
  matchesSaleUnit,
  saleUnitKey,
  type SaleUnit,
} from "@/lib/sale-search"
import { parseProductSearchQuery } from "@/lib/product-search"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { History, Search, Undo2 } from "lucide-react"
import { ReturnDialog } from "@/components/sales-return/return-dialog"
import { ReturnSearchModal } from "@/components/sales-return/return-search-modal"
import { SaleUnitCard, type HistoryRow } from "./sale-unit-card"

const PAGE = 15

function unitToRow(unit: SaleUnit): HistoryRow {
  const price = Number(unit.item.price) || 0
  const cost = Number(unit.item.cost) || 0
  return {
    unitId: `${unit.sale.id}-${unit.itemIndex}`,
    saleId: unit.sale.id,
    itemIndex: unit.itemIndex,
    position: unit.itemIndex + 1,
    createdAt: unit.sale.created_at,
    sellerId: unit.sale.seller_id,
    sellerName: unit.sale.seller_name,
    customerName: unit.sale.customer_name,
    customerPhone: unit.sale.customer_phone,
    paymentMethod: unit.sale.payment_method,
    name: unit.item.name,
    metal: unit.item.metal,
    weight: Number(unit.item.weight) || 0,
    sku: unit.sku,
    price,
    cost,
    loss: Math.max(0, cost - price),
    syncStatus: unit.sale.sync_status,
    syncError: unit.sale.sync_error,
  }
}

/**
 * История продаж с поштучной декомпозицией и возвратом товара.
 *
 * Поиск работает по тому же синтаксису, что и поиск товаров на чеке
 * (артикул, название, металл, «1,25 г», «12300 с», дата), плюс отдельный
 * модал с QR-сканером. У каждой возвращаемой позиции — кнопка
 * «Вернуть товар»; после подтверждения создаётся расходная операция кассы,
 * а товар возвращается на склад (атомарно, одной операцией в БД).
 */
export function SalesHistory({
  sales,
  returns = [],
  products = [],
  canSeeProfit,
  canReturn = false,
  sellers,
  onReturned,
  allowOffline = true,
}: {
  sales: Sale[]
  returns?: SaleReturn[]
  products?: Product[]
  canSeeProfit: boolean
  canReturn?: boolean
  sellers: { id: string; name: string }[]
  onReturned?: () => void
  allowOffline?: boolean
}) {
  const [visible, setVisible] = useState(PAGE)
  const [query, setQuery] = useState("")
  const [period, setPeriod] = useState<PeriodId>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [seller, setSeller] = useState("all")
  const [searchOpen, setSearchOpen] = useState(false)
  const [dialogUnit, setDialogUnit] = useState<SaleUnit | null>(null)
  const [justReturned, setJustReturned] = useState<SaleReturn[]>([])
  const sentinel = useRef<HTMLDivElement | null>(null)

  // Возвраты из БД + только что оформленные (до обновления серверных данных).
  const allReturns = useMemo(() => [...justReturned, ...returns], [justReturned, returns])

  const refundByUnit = useMemo(() => {
    const map = new Map<string, SaleReturn>()
    for (const r of allReturns) map.set(saleUnitKey(r.sale_id, r.item_index), r)
    return map
  }, [allReturns])

  const units = useMemo(() => flattenSaleUnits(sales, products), [sales, products])
  const returnableUnits = useMemo(
    () => units.filter((unit) => unit.sale.sync_status !== "pending" && unit.sale.sync_status !== "rejected"),
    [units],
  )
  const returnedKeys = useMemo(
    () => new Set(allReturns.map((r) => saleUnitKey(r.sale_id, r.item_index))),
    [allReturns],
  )

  const range = useMemo(() => periodRange(period, { from, to }), [period, from, to])
  const parsedQuery = useMemo(() => parseProductSearchQuery(query), [query])

  const rows = useMemo(() => {
    return units
      .filter((unit) => inPeriod(unit.sale.created_at, range))
      .filter((unit) => seller === "all" || unit.sale.seller_id === seller)
      .filter((unit) => matchesSaleUnit(unit, parsedQuery))
      .map(unitToRow)
  }, [units, range, seller, parsedQuery])

  const unitByRowId = useMemo(() => {
    const map = new Map<string, SaleUnit>()
    for (const unit of units) map.set(`${unit.sale.id}-${unit.itemIndex}`, unit)
    return map
  }, [units])

  useEffect(() => setVisible(PAGE), [query, period, from, to, seller])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible((v) => Math.min(v + PAGE, rows.length))
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rows.length])

  const confirmedRows = rows.filter((row) => row.syncStatus !== "pending" && row.syncStatus !== "rejected")
  const totalSum = confirmedRows.reduce((s, r) => s + Number(r.price), 0)
  const pendingCount = rows.filter((row) => row.syncStatus === "pending").length
  const rejectedCount = rows.filter((row) => row.syncStatus === "rejected").length
  const returnedSum = confirmedRows
    .filter((r) => refundByUnit.has(`${r.saleId}:${r.itemIndex}`))
    .reduce((s, r) => s + Number(refundByUnit.get(`${r.saleId}:${r.itemIndex}`)?.amount ?? 0), 0)

  const openReturn = (row: HistoryRow) => {
    const unit = unitByRowId.get(row.unitId)
    if (unit) setDialogUnit(unit)
  }

  const finishReturn = (created: SaleReturn) => {
    setJustReturned((prev) => [created, ...prev])
    setDialogUnit(null)
    onReturned?.()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4 text-primary" />
          История продаж
          <span className="text-xs text-muted-foreground">
            ({confirmedRows.length} подтверждено · {formatSom(totalSum)})
            {pendingCount > 0 && <span className="ml-1 text-amber-700">· {pendingCount} ожидает</span>}
            {rejectedCount > 0 && <span className="ml-1 text-destructive">· {rejectedCount} не учтено</span>}
            {returnedSum > 0 && (
              <span className="ml-1 text-destructive">· возвраты −{formatSom(returnedSum)}</span>
            )}
          </span>
        </div>
        {canReturn && returnableUnits.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-destructive/40 bg-transparent text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setSearchOpen(true)}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Возврат по QR / поиск
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск: артикул, товар, металл, клиент, телефон, продавец"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {[...PERIOD_PRESETS, { id: "custom" as PeriodId, label: "Период" }].map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
              period === p.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">От</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">До</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
        </div>
      )}

      {sellers.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ id: "all", name: "Все продавцы" }, ...sellers].map((s) => (
            <button
              key={s.id}
              onClick={() => setSeller(s.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
                seller === s.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Продаж не найдено
        </div>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, visible).map((r) => (
            <SaleUnitCard
              key={r.unitId}
              row={r}
              refund={refundByUnit.get(`${r.saleId}:${r.itemIndex}`)}
              canSeeProfit={canSeeProfit}
              canReturn={canReturn}
              onReturn={openReturn}
            />
          ))}

          {visible < rows.length && <div ref={sentinel} className="h-8" />}
        </div>
      )}

      {searchOpen && (
        <ReturnSearchModal
          units={returnableUnits}
          returnedKeys={returnedKeys}
          allowOffline={allowOffline}
          onClose={() => setSearchOpen(false)}
          onReturned={(created) => finishReturn(created)}
        />
      )}

      {dialogUnit && (
        <ReturnDialog
          unit={dialogUnit}
          onClose={() => setDialogUnit(null)}
          onReturned={finishReturn}
          allowOffline={allowOffline}
        />
      )}
    </div>
  )
}
