"use client"

// ─── PeriodSelector — фильтр дат и периодов ─────────────────────────────────

import { Input } from "@/components/ui/input"
import { Chip } from "../ui/chip"
import { PERIODS, rangeLabel } from "../utils"
import type { DateRange, PeriodId } from "../types"

interface PeriodSelectorProps {
  period: PeriodId
  setPeriod: (p: PeriodId) => void
  customFrom: string
  customTo: string
  setCustomFrom: (v: string) => void
  setCustomTo: (v: string) => void
  range: DateRange
}

/**
 * Шапка «Отчёты» с горизонтальной прокруткой кнопок периодов
 * и полями ввода кастомного диапазона.
 */
export function PeriodSelector({
  period,
  setPeriod,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
  range,
}: PeriodSelectorProps) {
  return (
    <header className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl">Отчёты</h1>
          <p className="truncate text-sm text-muted-foreground">
            Аналитика продаж и остатков
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">
          {rangeLabel(period, range)}
        </span>
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {PERIODS.map((p) => (
          <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Chip>
        ))}
        <Chip active={period === "custom"} onClick={() => setPeriod("custom")}>
          Период
        </Chip>
      </div>

      {period === "custom" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="sm:w-44"
          />
          <span className="hidden text-xs text-muted-foreground sm:inline">—</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="sm:w-44"
          />
        </div>
      )}
    </header>
  )
}
