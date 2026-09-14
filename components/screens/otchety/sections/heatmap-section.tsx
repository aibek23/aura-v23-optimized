"use client"

// ─── HeatmapSection — «Когда и что лучше продаётся» ─────────────────────────

import { Clock } from "lucide-react"
import { formatSom } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Panel } from "../ui/panel"
import { Chip } from "../ui/chip"
import { WEEKDAYS, TIME_SLOTS } from "../utils"
import type { HeatGrid, PeakHint } from "../types"

interface HeatmapSectionProps {
  heat: HeatGrid
  peakHints: PeakHint[]
  categories: string[]
  heatCategory: string
  setHeatCategory: (c: string) => void
}

/**
 * Секция тепловой карты продаж: сетка день-недели × временной слот
 * с фильтром по категории и текстовыми подсказками пиков.
 */
export function HeatmapSection({
  heat,
  peakHints,
  categories,
  heatCategory,
  setHeatCategory,
}: HeatmapSectionProps) {
  return (
    <Panel
      title="Когда и что лучше продаётся"
      subtitle="Выручка по дням недели и часам"
      icon={Clock}
    >
      {/* Фильтр категорий */}
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
        <Chip
          active={heatCategory === "all"}
          onClick={() => setHeatCategory("all")}
        >
          Все
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c}
            active={heatCategory === c}
            onClick={() => setHeatCategory(c)}
          >
            {c}
          </Chip>
        ))}
      </div>

      {/* Тепловая карта */}
      <div className="overflow-x-auto">
        <div className="min-w-[320px]">
          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1">
            {/* Заголовки дней */}
            <div />
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-[11px] text-muted-foreground"
              >
                {d}
              </div>
            ))}

            {/* Строки временных слотов */}
            {TIME_SLOTS.map((slot, sl) => (
  <div key={slot.id ?? sl}>
    <div
      className="flex items-center text-[11px] text-muted-foreground"
    >
      {slot.label}
    </div>
    {WEEKDAYS.map((d, wd) => {
      const value = heat.grid[wd][sl]
      const intensity = value / heat.max
      return (
        <div
          key={`${d}-${slot.id ?? sl}`}
          title={`${d}, ${slot.label} — ${formatSom(value)}`}
          className={cn(
            "aspect-square rounded-md transition-colors",
            intensity === 0
              ? "bg-muted/40"
              : "bg-primary",
          )}
          style={{ opacity: intensity === 0 ? 1 : 0.15 + intensity * 0.85 }}
        />
      )
    })}
  </div>
))}
          </div>
        </div>
      </div>

      {/* Текстовые подсказки пиков */}
      {peakHints.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {peakHints.map((hint) => (
            <div
              key={hint.category}
              className="rounded-lg bg-muted/30 px-3 py-2 text-xs"
            >
              <span className="font-medium">{hint.category}</span>
              <span className="text-muted-foreground">
                {" "}
                — лучше всего в{" "}
                <strong>
                  {WEEKDAYS[hint.wd]}, {TIME_SLOTS[hint.sl].label}
                </strong>{" "}
                ({formatSom(hint.value)})
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
