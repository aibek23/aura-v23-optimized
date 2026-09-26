"use client"

import type { SaleReturn } from "@/lib/types"
import { formatDateTime, formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RotateCcw, Undo2 } from "lucide-react"

/** Позиция чека, подготовленная для отображения в истории продаж. */
export type HistoryRow = {
  /** Уникальный ID позиции: saleId + индекс позиции в чеке. */
  unitId: string
  saleId: string
  /** Индекс позиции внутри sales.items — ключ возврата. */
  itemIndex: number
  /** Порядковый номер позиции в чеке (для человека — с 1). */
  position: number
  createdAt: string
  sellerId: string
  sellerName: string | null
  customerName: string | null
  customerPhone: string | null
  paymentMethod: string
  name: string
  metal: string | null
  weight: number
  sku: string | null
  price: number
  cost: number
  /** Убыток позиции (продана ниже себестоимости). */
  loss: number
  syncStatus?: "pending" | "confirmed" | "rejected"
  syncError?: string
}

/** Карточка одной проданной позиции: цена, прибыль и кнопка возврата. */
export function SaleUnitCard({
  row,
  refund,
  canSeeProfit,
  canReturn,
  onReturn,
}: {
  row: HistoryRow
  /** Запись возврата, если позиция уже возвращена. */
  refund?: SaleReturn
  canSeeProfit: boolean
  canReturn: boolean
  onReturn: (row: HistoryRow) => void
}) {
  const isReturned = Boolean(refund)
  const isLoss = row.loss > 0
  const profit = row.price - row.cost

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        isReturned
          ? "border-border bg-muted/50"
          : isLoss
            ? "border-destructive/50 bg-destructive/10"
            : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", isReturned && "text-muted-foreground line-through")}>
              {row.name}
            </span>
            {isReturned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                <RotateCcw className="h-3 w-3" />
                Возвращено
              </span>
            )}
            {row.syncStatus === "pending" && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Ожидает подтверждения
              </span>
            )}
            {row.syncStatus === "rejected" && (
              <span
                className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive"
                title={row.syncError || "Товар был продан на другом устройстве"}
              >
                Не учтено · конфликт
              </span>
            )}
            {!isReturned && isLoss && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Убыток {formatSom(row.loss)}
              </span>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {row.metal ?? "—"} · {formatWeight(row.weight)} · 1 шт.
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateTime(row.createdAt)} · продавец: {row.sellerName ?? "—"}
            {row.customerName ? ` · клиент: ${row.customerName}` : ""}
            {row.customerPhone ? ` (${row.customerPhone})` : ""}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground/80">
            ID: {row.unitId} · чек: {row.saleId.slice(0, 8)} · позиция #{row.position}
          </div>

          {isReturned && refund && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Возврат {formatDateTime(refund.created_at)} · {refund.author_name ?? "—"}
              {refund.reason ? ` · ${refund.reason}` : ""}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right">
            <div
              className={cn(
                "font-mono text-base font-semibold",
                isReturned ? "text-muted-foreground" : "text-primary",
              )}
            >
              {formatSom(row.price)}
            </div>
            {isReturned && refund ? (
              <div className="font-mono text-xs text-destructive">−{formatSom(Number(refund.amount))}</div>
            ) : (
              canSeeProfit &&
              !isLoss && <div className="font-mono text-xs text-success">+{formatSom(profit)}</div>
            )}
          </div>

          {canReturn && !isReturned && row.syncStatus !== "pending" && row.syncStatus !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-destructive/40 bg-transparent px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Вернуть товар"
              onClick={() => onReturn(row)}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Вернуть товар
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
