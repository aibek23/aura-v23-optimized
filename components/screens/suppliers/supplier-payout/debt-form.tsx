"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { adjustSupplierDebt } from "@/app/actions/suppliers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface DebtFormProps {
  supplierName: string
  supplierPhone: string | null
  onSuccess: () => void
  onCancel: () => void
}

/**
 * Форма изменения / добавления долга поставщику.
 */
export function DebtForm({
  supplierName,
  supplierPhone,
  onSuccess,
  onCancel,
}: DebtFormProps) {
  const [adjustment, setAdjustment] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [pending, startTransition] = useTransition()

  const canSave = Number(adjustment) > 0 && adjustmentReason.trim().length > 0

  const submit = () => {
    if (!canSave) return
    startTransition(async () => {
      try {
        await adjustSupplierDebt({
          supplierName,
          supplierPhone,
          amount: Number(adjustment),
          reason: adjustmentReason,
        })
        toast.success("Изменение долга записано")
        onSuccess()
        window.location.reload()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось изменить долг",
        )
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
      {/* Сумма */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Сумма</Label>
        <Input
          type="number"
          min={1}
          value={adjustment}
          onChange={(e) => setAdjustment(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      {/* Причина изменения */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Причина</Label>
        <Input
          placeholder="Рост цены золота"
          value={adjustmentReason}
          onChange={(e) => setAdjustmentReason(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      {/* Кнопки действий */}
      <div className="flex gap-2 pt-1">
        <Button
          disabled={!canSave || pending}
          onClick={submit}
          className="flex-1"
          size="sm"
        >
          {pending ? "Сохранение..." : "Сохранить"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="px-3">
          Отмена
        </Button>
      </div>
    </div>
  )
}
