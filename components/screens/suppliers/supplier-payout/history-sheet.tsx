"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
import type { SupplierDebtData } from "@/app/actions/suppliers"
import { formatSom } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { operationLabel } from "./types"

interface HistorySheetProps {
  open: boolean
  onClose: () => void
  supplierName: string
  supplierPhone: string | null
  operations: SupplierDebtData["operations"]
}

/**
 * Модальное окно / bottom-sheet истории операций поставщика.
 * На мобильных — нижний sheet, на desktop — центрированный диалог.
 */
export function HistorySheet({
  open,
  onClose,
  supplierName,
  supplierPhone,
  operations,
}: HistorySheetProps) {
  // Закрытие по Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const filtered = operations.filter(
    (op) =>
      op.supplier_name === supplierName &&
      (op.supplier_phone ?? null) === supplierPhone,
  )

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet — снизу на mobile, по центру на desktop */}
      <div
        role="dialog"
        aria-modal
        aria-label="История транзакций"
        className={cn(
          "fixed z-50 flex flex-col bg-background shadow-xl",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl",
          // desktop: centered modal
          "lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
          "lg:w-[480px] lg:max-h-[70vh] lg:rounded-2xl",
        )}
      >
        {/* Drag handle (только mobile) */}
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden" />

        {/* Заголовок */}
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <div>
            <h3 className="font-semibold">История транзакций</h3>
            <p className="text-xs text-muted-foreground">{supplierName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divider h-px bg-border" />

        {/* Список операций */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Нет операций</p>
          ) : (
            filtered.map((op) => (
              <div
                key={op.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{operationLabel(op.operation_type)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(op.created_at).toLocaleString("ru-RU")} · {op.author_name ?? "—"}
                  </div>
                  {op.reason && (
                    <div className="text-[11px] text-muted-foreground truncate">{op.reason}</div>
                  )}
                </div>
                <div className="shrink-0 text-right font-mono text-sm">
                  <div
                    className={cn(
                      "font-semibold",
                      op.operation_type === "payment"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-primary",
                    )}
                  >
                    {op.operation_type === "payment" ? "−" : "+"}{formatSom(op.amount)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatSom(op.balance_after)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </>
  )
}
