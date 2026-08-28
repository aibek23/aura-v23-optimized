"use client"

import { useEffect, useMemo, useState } from "react"
import type { CashOpType, CashReasonPreset, CashSource } from "@/lib/types"
import { CASH_SOURCES } from "@/lib/types"
import type { CashBalances } from "@/lib/cash"
import { formatSom } from "@/lib/format"
import { createCashOperation, deleteCashReasonPreset } from "@/app/actions/cash"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"

const TITLES: Record<CashOpType, string> = {
  income: "Внесение в кассу",
  outcome: "Изъятие из кассы",
  collection: "Инкассация (наличные → электронные)",
}

/**
 * Модалка кассовой операции. Для изъятия и инкассации выбирается источник
 * средств: наличные, электронные или оба сразу с раздельными суммами.
 */
export function CashOperationDialog({
  type,
  balances,
  presets,
  initialAmount,
  initialReason,
  onClose,
}: {
  type: CashOpType
  balances: CashBalances
  presets: CashReasonPreset[]
  initialAmount?: string
  initialReason?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [amount, setAmount] = useState(initialAmount ?? "")
  const [cashPart, setCashPart] = useState("")
  const [elePart, setElePart] = useState("")
  const [reason, setReason] = useState(initialReason ?? "")
  const [savePreset, setSavePreset] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const isCollection = type === "collection"
  // Для инкассации источник всегда наличные — сумма переводится в электронные.
  const isWithdrawal = type === "outcome"

  // Для смешанного источника общая сумма — это сумма двух полей.
  const amountNum = useMemo(() => {
    if (source === "mixed" && isWithdrawal) return (Number(cashPart) || 0) + (Number(elePart) || 0)
    return Number(amount) || 0
  }, [source, isWithdrawal, cashPart, elePart, amount])

  useEffect(() => {
    if (!isWithdrawal) setSource("cash")
  }, [isWithdrawal])

  const overCash =
    (isCollection && amountNum > balances.cash) ||
    (isWithdrawal && (source === "cash" ? amountNum : Number(cashPart) || 0) > balances.cash)
  const overEle =
    isWithdrawal && (source === "electronic" ? amountNum : Number(elePart) || 0) > balances.electronic
  const over = isCollection ? overCash : (source === "cash" && overCash) || (source === "electronic" && overEle) || (source === "mixed" && (overCash || overEle))

  const valid = amountNum > 0 && reason.trim().length > 0 && !over

  const submit = async () => {
    if (!valid) {
      toast.error(over ? "Сумма превышает доступный остаток" : "Укажите сумму и причину операции")
      return
    }
    setSubmitting(true)
    try {
      await createCashOperation({
        type,
        amount: amountNum,
        source: isWithdrawal ? source : "cash",
        amount_cash: source === "mixed" ? Number(cashPart) || 0 : undefined,
        amount_electronic: source === "mixed" ? Number(elePart) || 0 : undefined,
        reason: reason.trim(),
        savePreset,
      })
      toast.success(
        type === "income" ? "Внесение проведено" : type === "collection" ? "Инкассация проведена" : "Изъятие проведено",
      )
      onClose()
      startTransition(() => router.refresh())
    } catch (e) {
      console.error("[kassa] cash operation error:", e)
      toast.error(e instanceof Error ? e.message : "Не удалось провести операцию")
    } finally {
      setSubmitting(false)
    }
  }

  const removePreset = async (id: string) => {
    setRemoving(id)
    try {
      await deleteCashReasonPreset(id)
      toast.success("Подсказка удалена")
      startTransition(() => router.refresh())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить подсказку")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h3 className="font-semibold">{TITLES[type]}</h3>
        {isCollection && (
          <p className="mt-1 text-xs text-muted-foreground">
            Сумма переводится из наличных в электронные средства — общий баланс кассы не меняется.
            Доступно наличными: <span className="font-mono">{formatSom(balances.cash)}</span>
          </p>
        )}

        <div className="mt-4 grid gap-3">
          {isWithdrawal && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Источник средств</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {CASH_SOURCES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSource(s.value)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                      source === s.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Наличные: {formatSom(balances.cash)}</span>
                <span>Электронные: {formatSom(balances.electronic)}</span>
              </div>
            </div>
          )}

          {source === "mixed" && isWithdrawal ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">С наличных (с)</Label>
                <Input
                  type="number"
                  min={0}
                  value={cashPart}
                  onChange={(e) => setCashPart(e.target.value)}
                  className={cn("h-9", overCash && "border-destructive")}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">С электронных (с)</Label>
                <Input
                  type="number"
                  min={0}
                  value={elePart}
                  onChange={(e) => setElePart(e.target.value)}
                  className={cn("h-9", overEle && "border-destructive")}
                />
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                Итого к списанию: <span className="font-mono text-foreground">{formatSom(amountNum)}</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">
                {isCollection ? "Сумма к переводу (с)" : "Сумма (с)"}
              </Label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={cn("h-9", over && "border-destructive")}
                autoFocus
              />
            </div>
          )}
          {over && <p className="text-xs text-destructive">Сумма больше доступного остатка выбранного источника</p>}

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              Причина / цель <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Например: Инкассация в банк"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9"
            />
            {reason.trim().length === 0 && (
              <p className="text-xs text-destructive">Поле причины обязательно для заполнения</p>
            )}
          </div>

          {presets.length > 0 && (
            <div className="grid gap-1">
              <span className="text-[11px] text-muted-foreground">Подсказки (× — удалить)</span>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "group inline-flex items-center gap-1 rounded-full border border-border py-1 pl-2.5 pr-1 text-[11px] transition-colors",
                      removing === p.id && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setReason(p.text)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {p.text}
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить подсказку «${p.text}»`}
                      disabled={removing === p.id}
                      onClick={() => void removePreset(p.id)}
                      className="rounded-full p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={savePreset} onChange={(e) => setSavePreset(e.target.checked)} />
            Сохранить причину как подсказку
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" className="bg-transparent" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Сохранение..." : "Подтвердить"}
          </Button>
        </div>
      </div>
    </div>
  )
}
