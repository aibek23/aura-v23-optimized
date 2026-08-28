export type PeriodId = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom"

export const PERIOD_PRESETS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "month", label: "Текущий месяц" },
  { id: "all", label: "За всё время" },
]

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Границы периода: [from, to). Для custom используются переданные даты. */
export function periodRange(
  period: PeriodId,
  custom?: { from?: string; to?: string },
): { from: Date | null; to: Date | null } {
  const now = new Date()
  const today = startOfDay(now)

  switch (period) {
    case "today":
      return { from: today, to: null }
    case "yesterday": {
      const from = new Date(today)
      from.setDate(from.getDate() - 1)
      return { from, to: today }
    }
    case "7d": {
      const from = new Date(today)
      from.setDate(from.getDate() - 6)
      return { from, to: null }
    }
    case "30d": {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      return { from, to: null }
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null }
    case "custom": {
      const from = custom?.from ? startOfDay(new Date(custom.from)) : null
      let to: Date | null = null
      if (custom?.to) {
        to = startOfDay(new Date(custom.to))
        to.setDate(to.getDate() + 1)
      }
      return { from, to }
    }
    default:
      return { from: null, to: null }
  }
}

export function inPeriod(dateIso: string, range: { from: Date | null; to: Date | null }) {
  const t = new Date(dateIso).getTime()
  if (range.from && t < range.from.getTime()) return false
  if (range.to && t >= range.to.getTime()) return false
  return true
}
