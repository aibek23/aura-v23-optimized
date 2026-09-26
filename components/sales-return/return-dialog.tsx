"use client"

import { useState } from "react"
import type { SaleReturn } from "@/lib/types"
import { computeRefund } from "@/lib/return-refund"
import { formatDateTime, formatSom, formatWeight } from "@/lib/format"
import { PAYMENT_LABELS } from "@/lib/types"
import { RETURN_REASON_PRESETS, type SaleUnit } from "@/lib/sale-search"
import { returnSaleItem } from "@/app/actions/returns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ArrowDownLeft, Loader2, PackageCheck, X } from "lucide-react"
import { toast } from "sonner"

/**
 * Подтверждение возврата позиции чека.
 *
 * Показывает сумму возврата, рассчитанную по фактически оплаченной цене,
 * и после подтверждения выполняет атомарную операцию в БД: расходная
 * операция в кассе + запись возврата + товар снова на складе.
 */
export function ReturnDialog({
  unit,
  onClose,
  onReturned,
  allowOffline = true,
}: {
  unit: SaleUnit
  onClose: () => void
  onReturned: (created: SaleReturn) => void
  allowOffline?: boolean
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  const breakdown = computeRefund(unit.sale, unit.item)
  const isScrap = unit.item.kind === "scrap"
  const isLoss = breakdown.profitDelta < 0

  const submit = async () => {
    setSaving(true)
    try {
      let created: SaleReturn
      try {
        if (!navigator.onLine) throw new Error("Offline")
        created = await returnSaleItem({
          saleId: unit.sale.id,
          itemIndex: unit.itemIndex,
          reason,
        })
      } catch (actionErr) {
        if (!allowOffline) throw actionErr
        // Offline return fallback: record locally and enqueue outbox
        const { bulkPut } = await import("@/lib/local-db/db")
        const { enqueueOutbox } = await import("@/lib/local-db/outbox")
        const clientOpId = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).substring(2)
        const returnId = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).substring(2)
        const nowIso = new Date().toISOString()
        const refundAmt = Number(breakdown.amount || 0)

        created = {
          id: returnId,
          shop_id: unit.sale.shop_id,
          sale_id: unit.sale.id,
          item_index: unit.itemIndex,
          product_id: unit.item.product_id,
          item_name: unit.item.name || "Товар",
          product_name: unit.item.name || "Товар",
          item_metal: unit.item.metal || null,
          item_weight: unit.item.weight || 0,
          cost: unit.item.cost || 0,
          amount: refundAmt,
          reason: reason || "Возврат клиентом (офлайн)",
          created_at: nowIso,
          client_op_id: clientOpId,
        } as unknown as SaleReturn

        await bulkPut("sale_returns", [created])
        await enqueueOutbox({
          client_op_id: clientOpId,
          shop_id: unit.sale.shop_id,
          entity: "sale_returns",
          op_type: "atomic_return",
          payload: {
            ...created,
            product_id: unit.item.product_id,
          },
        })
      }

      toast.success(`Возврат оформлен: ${formatSom(Number(created.amount || breakdown.amount))}`, {
        description: isScrap
          ? "Деньги изъяты из кассы"
          : "Деньги изъяты из кассы, товар снова на складе",
      })
      onReturned(created)
    } catch (e) {
      console.error("[return] error:", e)
      toast.error(e instanceof Error ? e.message : "Не удалось оформить возврат")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Возврат товара</h2>
            <p className="text-xs text-muted-foreground">
              Чек {unit.sale.id.slice(0, 8)} · позиция #{unit.itemIndex + 1}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Закрыть"
            disabled={saving}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* Позиция */}
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-sm font-medium">{unit.item.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {unit.item.metal ?? "—"} · {formatWeight(Number(unit.item.weight))}
              {unit.sku ? ` · арт. ${unit.sku}` : ""}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Продано {formatDateTime(unit.sale.created_at)} ·{" "}
              {PAYMENT_LABELS[unit.sale.payment_method] ?? unit.sale.payment_method}
              {unit.sale.customer_name ? ` · ${unit.sale.customer_name}` : ""}
            </div>
          </div>

          {/* Сумма возврата */}
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Сумма возврата (по фактически оплаченной цене)
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-destructive">
              −{formatSom(breakdown.amount)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Цена в чеке: {formatSom(Number(unit.item.price))}
              {breakdown.cash > 0 && breakdown.electronic > 0
                ? ` · из кассы: ${formatSom(breakdown.cash)} нал. + ${formatSom(breakdown.electronic)} безнал`
                : breakdown.electronic > 0
                  ? ` · из электронных средств`
                  : ` · из наличных`}
            </div>
          </div>

          {/* Эффект на склад/прибыль */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-border bg-card p-2.5">
              <div className="flex items-center gap-1 text-muted-foreground">
                <PackageCheck className="h-3.5 w-3.5" />
                Склад
              </div>
              <div className="mt-0.5 font-medium">
                {isScrap ? "Лом — склада нет" : "Товар снова в наличии"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                себестоимость {formatSom(breakdown.cost)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-2.5">
              <div className="text-muted-foreground">Прибыль чека</div>
              <div
                className={cn(
                  "mt-0.5 font-mono font-medium",
                  isLoss ? "text-destructive" : "text-success",
                )}
              >
                {breakdown.profitDelta >= 0 ? "−" : "+"}
                {formatSom(Math.abs(breakdown.profitDelta))}
              </div>
              <div className="text-[11px] text-muted-foreground">пересчитается в отчётах</div>
            </div>
          </div>

          {/* Причина */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="return-reason">
              Причина возврата (необязательно)
            </label>
            <Input
              id="return-reason"
              value={reason}
              maxLength={300}
              placeholder="Например: не подошёл размер"
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {RETURN_REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    reason === preset
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" className="flex-1 bg-transparent" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="destructive" className="flex-1" disabled={saving} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Вернуть {formatSom(breakdown.amount)}
          </Button>
        </div>
      </div>
    </div>
  )
}
