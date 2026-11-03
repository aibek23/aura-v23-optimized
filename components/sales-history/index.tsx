"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { History } from "lucide-react"
import { ProductSearch } from "@/components/product-search"
import { ReturnDialog } from "@/components/sales-return/return-dialog"
import { SaleUnitCard, type HistoryRow } from "./sale-unit-card"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getSalesPage, type SalesPageCursor } from "@/app/actions/sales"

const PAGE = 15
/** Сколько чеков запрашивать с сервера за одну страницу. */
const SERVER_PAGE = 30

/** Ключи дедупликации: локальный и серверный чек одной операции совпадают по client_op_id. */
function saleKeys(sale: Sale): string[] {
  return sale.client_op_id ? [sale.id, `op:${sale.client_op_id}`] : [sale.id]
}

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
    receiptType: unit.sale.receipt_type ?? null,
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

export type SalesHistoryProps = {
  sales: Sale[]
  returns?: SaleReturn[]
  products?: Product[]
  canSeeProfit: boolean
  canReturn?: boolean
  sellers: { id: string; name: string }[]
  onReturned?: () => void
  allowOffline?: boolean
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
  sales: localSales,
  returns = [],
  products = [],
  canSeeProfit,
  canReturn = false,
  sellers,
  onReturned,
  allowOffline = true,
}: SalesHistoryProps) {
  const [visible, setVisible] = useState(PAGE)
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query)
  const [period, setPeriod] = useState<PeriodId>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [seller, setSeller] = useState("all")
  const [dialogUnit, setDialogUnit] = useState<SaleUnit | null>(null)
  const [justReturned, setJustReturned] = useState<SaleReturn[]>([])
  const sentinel = useRef<HTMLDivElement | null>(null)

  // ── Серверная история с пагинацией ────────────────────────────────────────
  // На устройстве хранятся только последние 100 чеков. При наличии сети
  // история читается с сервера страницами по SERVER_PAGE чеков; локальные
  // (ещё не отправленные) чеки показываются поверх. Без сети — локальная история.
  const [online, setOnline] = useState(true)
  const [serverSales, setServerSales] = useState<Sale[] | null>(null)
  const [serverReturns, setServerReturns] = useState<SaleReturn[]>([])
  const [nextCursor, setNextCursor] = useState<SalesPageCursor | null>(null)
  const [loadingPage, setLoadingPage] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  const serverFilter = useMemo(() => {
    const r = periodRange(period, { from, to })
    return {
      from: r.from ? r.from.toISOString() : null,
      to: r.to ? r.to.toISOString() : null,
      sellerId: seller === "all" ? null : seller,
      query: debouncedQuery,
    }
  }, [period, from, to, seller, debouncedQuery])

  const loadPage = useCallback(
    async (cursor: SalesPageCursor | null) => {
      const id = ++requestId.current
      setLoadingPage(true)
      setPageError(null)
      try {
        const page = await getSalesPage({ ...serverFilter, cursor, limit: SERVER_PAGE })
        if (id !== requestId.current) return
        setServerReturns((prev) => {
          const merged = new Map((cursor ? prev : []).map((refund) => [refund.id, refund]))
          for (const refund of page.returns) merged.set(refund.id, refund)
          return [...merged.values()]
        })
        setServerSales((prev) => {
          if (!cursor || !prev) return page.items
          const known = new Set(prev.map((sale) => sale.id))
          return [...prev, ...page.items.filter((sale) => !known.has(sale.id))]
        })
        setNextCursor(page.nextCursor)
      } catch (err) {
        if (id !== requestId.current) return
        console.warn("[sales-history] server page failed, using local history:", err)
        setPageError("Не удалось загрузить историю с сервера — показаны последние чеки на устройстве")
        if (!cursor) setServerSales(null)
      } finally {
        if (id === requestId.current) setLoadingPage(false)
      }
    },
    [serverFilter],
  )

  // Первая страница при смене фильтров и при появлении сети.
  useEffect(() => {
    if (!online) {
      requestId.current++
      setServerSales(null)
      setServerReturns([])
      setNextCursor(null)
      setLoadingPage(false)
      return
    }
    void loadPage(null)
  }, [online, loadPage])

  // Новые чеки с других устройств: обновляем «голову» списка, не сбрасывая прокрутку.
  useEffect(() => {
    if (!online) return
    let timer: number | undefined
    let cancelled = false
    const refreshHead = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        try {
          const id = requestId.current
          const page = await getSalesPage({ ...serverFilter, cursor: null, limit: SERVER_PAGE })
          if (cancelled || id !== requestId.current) return
          setServerReturns((prev) => {
            const merged = new Map(prev.map((refund) => [refund.id, refund]))
            for (const refund of page.returns) merged.set(refund.id, refund)
            return [...merged.values()]
          })
          setServerSales((prev) => {
            if (!prev) return page.items
            const fresh = new Map(page.items.map((sale) => [sale.id, sale]))
            const merged = prev.map((sale) => fresh.get(sale.id) ?? sale)
            const known = new Set(prev.map((sale) => sale.id))
            return [...page.items.filter((sale) => !known.has(sale.id)), ...merged]
          })
        } catch {}
      }, 800)
    }
    window.addEventListener("aura:data_changed", refreshHead)
    window.addEventListener("aura:sale_sync_state_changed", refreshHead)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener("aura:data_changed", refreshHead)
      window.removeEventListener("aura:sale_sync_state_changed", refreshHead)
    }
  }, [online, serverFilter])

  const hasMoreServer = serverSales !== null && nextCursor !== null

  const sales = useMemo(() => {
    if (!serverSales) return localSales
    // Локальные чеки, которых ещё нет на сервере (офлайн/ожидают отправки),
    // и свежие чеки новее загруженных страниц.
    const seen = new Set<string>()
    for (const sale of serverSales) for (const key of saleKeys(sale)) seen.add(key)
    const oldestLoaded = hasMoreServer && serverSales.length
      ? new Date(serverSales[serverSales.length - 1].created_at).getTime()
      : Number.NEGATIVE_INFINITY
    const extra = localSales.filter(
      (sale) =>
        !saleKeys(sale).some((key) => seen.has(key)) &&
        (sale.sync_status === "pending" ||
          sale.sync_status === "rejected" ||
          new Date(sale.created_at).getTime() >= oldestLoaded),
    )
    return extra.length ? [...extra, ...serverSales] : serverSales
  }, [serverSales, localSales, hasMoreServer])

  // Возвраты из БД + только что оформленные (до обновления серверных данных).
  const allReturns = useMemo(
    () => [...returns, ...serverReturns, ...justReturned].filter((refund) => !refund.deleted_at),
    [justReturned, returns, serverReturns],
  )

  const refundByUnit = useMemo(() => {
    const map = new Map<string, SaleReturn>()
    for (const r of allReturns) map.set(saleUnitKey(r.sale_id, r.item_index), r)
    return map
  }, [allReturns])

  const units = useMemo(() => flattenSaleUnits(sales, products), [sales, products])

  const range = useMemo(() => periodRange(period, { from, to }), [period, from, to])
  const parsedQuery = useMemo(() => parseProductSearchQuery(debouncedQuery), [debouncedQuery])

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

  useEffect(() => setVisible(PAGE), [debouncedQuery, period, from, to, seller])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        if (visible < rows.length) {
          setVisible((v) => Math.min(v + PAGE, rows.length))
        } else if (hasMoreServer && !loadingPage && !pageError) {
          // Локально показано всё загруженное — подгружаем следующую страницу с сервера.
          void loadPage(nextCursor)
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rows.length, visible, hasMoreServer, loadingPage, pageError, loadPage, nextCursor])

  const confirmedRows = useMemo(
    () => rows.filter((row) => row.syncStatus !== "pending" && row.syncStatus !== "rejected"),
    [rows],
  )
  const totalSum = useMemo(
    () => confirmedRows.reduce((sum, row) => sum + Number(row.price), 0),
    [confirmedRows],
  )
  const pendingCount = useMemo(
    () => rows.filter((row) => row.syncStatus === "pending").length,
    [rows],
  )
  const rejectedCount = useMemo(
    () => rows.filter((row) => row.syncStatus === "rejected").length,
    [rows],
  )
  const returnedSum = useMemo(
    () =>
      confirmedRows
        .filter((row) => refundByUnit.has(`${row.saleId}:${row.itemIndex}`))
        .reduce((sum, row) => sum + Number(refundByUnit.get(`${row.saleId}:${row.itemIndex}`)?.amount ?? 0), 0),
    [confirmedRows, refundByUnit],
  )

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
      </div>

      <div>
        <ProductSearch
          placeholder="Продажи и возврат: артикул, QR, товар, клиент, вес, цена или дата"
          value={query}
          onChange={setQuery}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {online
            ? "Поиск по всей истории магазина. Для возврата найдите товар и нажмите «Вернуть»."
            : "Нет сети — доступны только чеки, сохранённые на этом устройстве."}
        </p>
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

      {pageError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          {pageError}
        </div>
      )}

      {rows.length === 0 && loadingPage ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground" role="status">
          {debouncedQuery.trim() ? "Ищем в архиве продаж…" : "Загружаем историю продаж…"}
        </div>
      ) : rows.length === 0 && !hasMoreServer ? (
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

          {(visible < rows.length || (hasMoreServer && !pageError)) && <div ref={sentinel} className="h-8" />}

          {hasMoreServer && (
            <div className="flex justify-center pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={loadingPage}
                onClick={() => void loadPage(nextCursor)}
              >
                {loadingPage ? "Загрузка…" : "Загрузить ещё"}
              </Button>
            </div>
          )}
        </div>
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
