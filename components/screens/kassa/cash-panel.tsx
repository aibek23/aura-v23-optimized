"use client"

import { useEffect, useMemo, useState } from "react"
import type { CashOperation, CashOpType, CashReasonPreset, Sale } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { PERIOD_PRESETS, periodRange, inPeriod, type PeriodId } from "@/lib/period"
import { computeBalances } from "@/lib/cash"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { ArrowDownLeft, ArrowUpRight, Banknote, CreditCard, ShieldCheck, Wallet } from "lucide-react"
import { CashHistory } from "./cash-history"
import { CashOperationDialog } from "./cash-operation-dialog"

/** Событие, которым другие блоки кассы просят открыть окно внесения. */
export const OPEN_CASH_INCOME_EVENT = "aura:open-cash-income"

/**
 * Сводные показатели кассы, инкассация и операции внесения/изъятия.
 * Инкассация выводит средства из кассы, поэтому уменьшает выбранный источник.
 */
export function CashPanel({
  sales,
  operations,
  presets,
  isAdmin,
}: {
  sales: Sale[]
  operations: CashOperation[]
  presets: CashReasonPreset[]
  isAdmin: boolean
}) {
  const [period, setPeriod] = useState<PeriodId>("today")
  const [dialog, setDialog] = useState<{ type: CashOpType; amount?: string; reason?: string } | null>(null)

  const range = useMemo(() => periodRange(period), [period])

  const stats = useMemo(() => {
    const rows = sales.filter((s) => inPeriod(s.created_at, range))
    const b = computeBalances(sales, operations, (d) => inPeriod(d, range))
    return { ...b, count: rows.length }
  }, [sales, operations, range])

  // Балансы за всё время — именно из них ведутся списания.
  const balances = useMemo(() => computeBalances(sales, operations), [sales, operations])

  const authors = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of operations) if (o.created_by) map.set(o.created_by, o.author_name ?? "—")
    return [...map].map(([id, name]) => ({ id, name }))
  }, [operations])

  // Приём лома может потребовать пополнения кассы — открываем «Внесение».
  useEffect(() => {
    const handler = () => setDialog({ type: "income", reason: "Пополнение кассы" })
    window.addEventListener(OPEN_CASH_INCOME_EVENT, handler)
    return () => window.removeEventListener(OPEN_CASH_INCOME_EVENT, handler)
  }, [])

  const handleCollection = () => {
    if (balances.cash <= 0) {
      toast.error("В кассе нет наличных для инкассации")
      return
    }
    setDialog({
      type: "collection",
      amount: String(Math.round(balances.cash)),
      reason: "Инкассация в банк",
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <div className="text-xs text-muted-foreground">Кассовый баланс</div>
            {/* Продавец видит только наличные; администратор видит полный баланс */}
            {isAdmin ? (
              <>
                <div className="font-mono text-2xl font-semibold text-primary">{formatSom(balances.total)}</div>
                <div className="text-[11px] text-muted-foreground">
                  наличные: <span className="font-mono">{formatSom(balances.cash)}</span> · электронные:{" "}
                  <span className="font-mono">{formatSom(balances.electronic)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-2xl font-semibold text-primary">{formatSom(balances.cash)}</div>
                <div className="text-[11px] text-muted-foreground">наличные в кассе</div>
              </>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-[#E5AC4C]/50 bg-transparent text-[#E5AC4C] hover:bg-[#E5AC4C]/10"
              onClick={handleCollection}
              title="Инкассация: перевод наличных в электронные средства"
            >
              <ShieldCheck className="mr-1 h-4 w-4" />
              Инкассация
            </Button>
            <Button variant="outline" className="bg-transparent" onClick={() => setDialog({ type: "outcome" })}>
              <ArrowUpRight className="mr-1 h-4 w-4" />
              Изъять
            </Button>
            <Button onClick={() => setDialog({ type: "income" })}>
              <ArrowDownLeft className="mr-1 h-4 w-4" />
              Внести
            </Button>
          </div>
        )}
      </div>

      {isAdmin && (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric icon={<Banknote className="h-4 w-4" />} label="Наличные" value={stats.cash} />
            <Metric icon={<CreditCard className="h-4 w-4" />} label="Электронные" value={stats.electronic} />
            <Metric
              icon={<Wallet className="h-4 w-4" />}
              label={`Оборот · ${stats.count} чек.`}
              value={stats.total}
              accent
            />
          </div>

          {operations.length > 0 && (
            <CashHistory operations={operations} period={period} authors={authors} />
          )}
        </>
      )}

      {dialog && (
        <CashOperationDialog
          type={dialog.type}
          balances={balances}
          presets={presets}
          initialAmount={dialog.amount}
          initialReason={dialog.reason}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}

function Metric({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 font-mono text-lg font-semibold", accent ? "text-primary" : "text-foreground")}>
        {formatSom(value)}
      </div>
    </div>
  )
}
