// ─── ChartTooltip — кастомный тултип для Recharts ────────────────────────────

import { formatSom } from "@/lib/format"

interface TooltipPayload {
  name?: string
  value?: number | string
  color?: string
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
  /** Единица измерения: если передана — выводим число с ней, иначе formatSom. */
  unit?: string
}

/**
 * Универсальный тултип для всех графиков Recharts на экране отчётов.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && (
        <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      )}
      {payload.map((entry, i) => {
        const numeric =
          typeof entry.value === "number"
            ? entry.value
            : Number(entry.value ?? 0)
        return (
          <p
            key={i}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="truncate">{entry.name}</span>
            <span className="ml-auto font-mono tabular-nums text-popover-foreground">
              {unit
                ? `${numeric.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${unit}`
                : formatSom(numeric)}
            </span>
          </p>
        )
      })}
    </div>
  )
}
