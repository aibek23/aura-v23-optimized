"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { paySupplierDebt } from "@/app/actions/suppliers"
import type { CashSource } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface PayFormProps {
  supplierName: string
  supplierPhone: string | null
  balance: number
  onSuccess: () => void
  onCancel: () => void
}

/**
 * Форма проведения выплаты поставщику.
 * Поддерживает наличные, электронные и смешанный способ оплаты.
 */
export function PayForm({
  supplierName,
  supplierPhone,
  balance,
  onSuccess,
  onCancel,
}: PayFormProps) {
  const [amount, setAmount] = useState(String(Math.round(balance)))
  const [source, setSource] = useState<CashSource>("cash")
  const [cashPart, setCashPart] = useState("")
  const [electronicPart, setElectronicPart] = useState("")
  const [showComment, setShowComment] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  const paymentAmount = Number(amount) || 0
  const splitTotal = (Number(cashPart) || 0) + (Number(electronicPart) || 0)
  const canPay =
    paymentAmount > 0 &&
    paymentAmount <= balance + 0.01 &&
    (source !== "mixed" || Math.abs(splitTotal - paymentAmount) < 0.01)

  const submit = () => {
    if (!canPay) return
    startTransition(async () => {
      try {
        await paySupplierDebt({
          supplierName,
          supplierPhone,
          amount: paymentAmount,
          source,
          amountCash: source === "mixed" ? Number(cashPart) || 0 : undefined,
          amountElectronic:
            source === "mixed" ? Number(electronicPart) || 0 : undefined,
          reason: reason || "Выплата поставщику",
        })
        toast.success("Выплата проведена")
        onSuccess()
        window.location.reload()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось провести выплату",
        )
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
      <div className="text-xs text-muted-foreground">
        Доступно к выплате:{" "}
        <span className="font-mono font-semibold text-foreground">
          {formatSom(balance)}
        </span>
      </div>

      {/* Сумма */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Сумма</Label>
        <Input
          type="number"
          min={1}
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      {/* Источник оплаты */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Источник оплаты</Label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as CashSource)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="cash">Наличные</option>
          <option value="electronic">Электронные</option>
          <option value="mixed">Смешанный</option>
        </select>
      </div>

      {/* Разбивка при смешанном способе */}
      {source === "mixed" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Наличные</Label>
            <Input
              type="number"
              min={0}
              value={cashPart}
              onChange={(e) => setCashPart(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Электронные</Label>
            <Input
              type="number"
              min={0}
              value={electronicPart}
              onChange={(e) => setElectronicPart(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>
      )}

      {/* Комментарий (опционально) */}
      {!showComment ? (
        <button
          type="button"
          onClick={() => setShowComment(true)}
          className="text-xs text-primary hover:underline"
        >
          + Добавить комментарий
        </button>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs">Комментарий</Label>
          <Input
            placeholder="Например: частичная выплата"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      )}

      {/* Кнопки действий */}
      <div className="flex gap-2 pt-1">
        <Button
          disabled={!canPay || pending}
          onClick={submit}
          className="flex-1 font-semibold"
          size="sm"
        >
          {pending
            ? "Проведение..."
            : `Оплатить ${paymentAmount > 0 ? formatSom(paymentAmount) : ""}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="px-3">
          Отмена
        </Button>
      </div>
    </div>
  )
}
