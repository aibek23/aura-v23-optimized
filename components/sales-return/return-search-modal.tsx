"use client"

import { useMemo, useState } from "react"
import type { SaleReturn } from "@/lib/types"
import { formatDateTime, formatSom, formatWeight } from "@/lib/format"
import { filterSaleUnits, unitKey, type SaleUnit } from "@/lib/sale-search"
import { ProductSearch } from "@/components/product-search"
import { ReturnDialog } from "@/components/sales-return/return-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CornerDownLeft, PackageSearch, Undo2, X } from "lucide-react"

const PAGE = 20

/**
 * Модальный поиск позиции чека для возврата — тот же синтаксис запроса и
 * тот же сканер, что и в поиске товаров на чеке (product-search):
 * артикул, название, металл, «1,25 г», «12300 с», «11.09.2026», QR-код.
 */
export function ReturnSearchModal({
  units,
  returnedKeys,
  onClose,
  onReturned,
}: {
  units: SaleUnit[]
  returnedKeys: Set<string>
  onClose: () => void
  onReturned: (created: SaleReturn, unit: SaleUnit) => void
}) {
  const [query, setQuery] = useState("")
  const [visible, setVisible] = useState(PAGE)
  const [selected, setSelected] = useState<SaleUnit | null>(null)

  const matches = useMemo(
    () => filterSaleUnits(units, query).filter((unit) => !returnedKeys.has(unitKey(unit))),
    [units, query, returnedKeys],
  )

  const shown = matches.slice(0, visible)
  const trimmed = query.trim()

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[92svh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl sm:h-[80vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Undo2 className="h-4 w-4 text-primary" />
              Возврат товара
            </h2>
            <p className="text-xs text-muted-foreground">
              Найдите проданную позицию: артикул, название, металл, вес, цену, дату или QR-код
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Закрыть" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <ProductSearch
            value={query}
            onChange={(value) => {
              setQuery(value)
              setVisible(PAGE)
            }}
            placeholder="Артикул, название, 1,25 г, 12300 с, 11.09.2026..."
            inputClassName="h-11 rounded-xl bg-card text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-14 text-center">
              <PackageSearch className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {trimmed ? "Проданных позиций не найдено" : "Все проданные позиции уже возвращены"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map((unit) => (
                <button
                  key={unitKey(unit)}
                  type="button"
                  onClick={() => setSelected(unit)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left",
                    "transition-colors hover:border-primary/60 hover:bg-primary/5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {unit.sku && (
                        <span className="font-mono text-xs font-bold text-primary">{unit.sku}</span>
                      )}
                      <span className="truncate text-sm font-medium">{unit.item.name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {unit.item.metal ?? "—"} · {formatWeight(Number(unit.item.weight))} ·{" "}
                      {formatDateTime(unit.sale.created_at)}
                      {unit.sale.customer_name ? ` · ${unit.sale.customer_name}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">
                      чек {unit.sale.id.slice(0, 8)} · позиция #{unit.itemIndex + 1}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-semibold text-primary">
                      {formatSom(Number(unit.item.price))}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                      Вернуть
                      <CornerDownLeft className="h-3 w-3" />
                    </div>
                  </div>
                </button>
              ))}

              {visible < matches.length && (
                <Button
                  variant="ghost"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setVisible((v) => v + PAGE)}
                >
                  Показать ещё ({matches.length - visible})
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Продано позиций для возврата: {matches.length}
        </div>
      </div>

      {selected && (
        <ReturnDialog
          unit={selected}
          onClose={() => setSelected(null)}
          onReturned={(created) => {
            setSelected(null)
            onReturned(created, selected)
          }}
        />
      )}
    </div>
  )
}
