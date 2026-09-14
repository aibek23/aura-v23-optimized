// ─── KpiCard — карточка показателя (KPI) ─────────────────────────────────────

import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: string
  delta?: number | null
  accent?: boolean
  /** Для метрик-расходов рост — плохо, инвертируем цвет стрелки. */
  invert?: boolean
}

/**
 * Карточка одного KPI-показателя с динамикой относительно предыдущего периода.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  delta: change,
  accent,
  invert,
}: KpiCardProps) {
  const up = (change ?? 0) >= 0
  const good = invert ? !up : up

  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        accent ? "border-primary/40 bg-primary/5" : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1.5 truncate font-mono text-lg font-semibold tabular-nums">
        {value}
      </p>
      {change != null && (
        <p
          className={cn(
            "mt-0.5 flex items-center gap-0.5 text-[11px]",
            good ? "text-success" : "text-destructive",
          )}
        >
          {up ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
          {Math.abs(change).toFixed(1)} %
        </p>
      )}
    </div>
  )
}
