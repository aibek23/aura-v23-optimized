// ─── MiniStat — компактная статистика ────────────────────────────────────────

import { cn } from "@/lib/utils"

interface MiniStatProps {
  label: string
  value: string
  tone?: "success"
}

/**
 * Маленький блок «метка + значение» для сеток внутри карточек.
 */
export function MiniStat({ label, value, tone }: MiniStatProps) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "truncate font-mono text-xs font-semibold tabular-nums",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  )
}
