"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Sale, SaleItem } from "@/lib/types"
import { formatDateTime, formatSom, formatWeight } from "@/lib/format"
import { PERIOD_PRESETS, periodRange, inPeriod, type PeriodId } from "@/lib/period"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { AlertTriangle, History, Search } from "lucide-react"

const PAGE = 15

type UnitRow = {
  unitId: string
  saleId: string
  index: number
  createdAt: string
  sellerId: string
  sellerName: string | null
  customerName: string | null
  customerPhone: string | null
  paymentMethod: string
  item: SaleItem
  loss: number
}

/**
 * История продаж с поштучной декомпозицией: каждая единица товара — отдельная
 * строка с собственным ID, связанная с ID чека. Поиск, период, фильтр по продавцу.
 */
export function SalesHistory({
  sales,
  canSeeProfit,
  sellers,
}: {
  sales: Sale[]
  canSeeProfit: boolean
  sellers: { id: string; name: string }[]
}) {
  const [visible, setVisible] = useState(PAGE)
  const [query, setQuery] = useState("")
  const [period, setPeriod] = useState<PeriodId>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [seller, setSeller] = useState("all")
  const sentinel = useRef<HTMLDivElement | null>(null)

  // Поштучная развёртка чеков.
  const units = useMemo<UnitRow[]>(() => {
    const out: UnitRow[] = []
    const sorted = [...sales].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    for (const s of sorted) {
      let n = 0
      for (const [idx, item] of (s.items ?? []).entries()) {
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
        for (let u = 0; u < qty; u++) {
          n += 1
          out.push({
            unitId: `${s.id}-${idx}-${u}`,
            saleId: s.id,
            index: n,
            createdAt: s.created_at,
            sellerId: s.seller_id,
            sellerName: s.seller_name,
            customerName: s.customer_name,
            customerPhone: s.customer_phone,
            paymentMethod: s.payment_method,
            item: { ...item, quantity: 1 },
            loss: Math.max(0, Number(item.cost) - Number(item.price)),
          })
        }
      }
    }
    return out
  }, [sales])

  const range = useMemo(
    () => periodRange(period, { from, to }),
    [period, from, to],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return units.filter((r) => {
      if (!inPeriod(r.createdAt, range)) return false
      if (seller !== "all" && r.sellerId !== seller) return false
      if (!q) return true
      const hay = [
        r.item.name,
        r.item.metal ?? "",
        (r.item as SaleItem & { sku?: string }).sku ?? "",
        r.customerName ?? "",
        r.customerPhone ?? "",
        r.sellerName ?? "",
        r.saleId,
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [units, range, seller, query])

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

  const totalSum = rows.reduce((s, r) => s + Number(r.item.price), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4 text-primary" />
        История продаж
        <span className="text-xs text-muted-foreground">
          ({rows.length} шт. · {formatSom(totalSum)})
        </span>
      </div>

      {/* Поиск */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск: артикул, товар, металл, клиент, телефон, продавец"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Пресеты периода */}
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

      {/* Фильтр по продавцу */}
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
          {rows.slice(0, visible).map((r) => {
            const loss = r.loss > 0
            const profit = Number(r.item.price) - Number(r.item.cost)
            return (
              <div
                key={r.unitId}
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  loss ? "border-destructive/50 bg-destructive/10" : "border-border bg-card",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.item.name}
                      {loss && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Убыток {formatSom(r.loss)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.item.metal ?? "—"} · {formatWeight(Number(r.item.weight))} · 1 шт.
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)} · продавец: {r.sellerName ?? "—"}
                      {r.customerName ? ` · клиент: ${r.customerName}` : ""}
                      {r.customerPhone ? ` (${r.customerPhone})` : ""}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                      ID: {r.unitId} · чек: {r.saleId.slice(0, 8)} · позиция #{r.index}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-base font-semibold text-primary">
                      {formatSom(Number(r.item.price))}
                    </div>
                    {canSeeProfit && !loss && (
                      <div className="font-mono text-xs text-success">+{formatSom(profit)}</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {visible < rows.length && <div ref={sentinel} className="h-8" />}
        </div>
      )}
    </div>
  )
}
