import type { Product, Sale, SaleReturn } from "@/lib/types"
import type { DateRange } from "./types"

export type TimeGrain = "hour" | "day" | "week" | "month"
export type TimelineEvent = { timestamp: number; revenue: number; receipts: number; refunds: number }
export type TimelinePoint = TimelineEvent
export type TimelineWindow = { from: number; to: number; grain: TimeGrain }
export const HOUR_MS = 3_600_000
export const MAX_TIMELINE_POINTS = 400
export const GRAINS: { id: TimeGrain; label: string }[] = [
  { id: "hour", label: "Час" }, { id: "day", label: "День" },
  { id: "week", label: "Неделя" }, { id: "month", label: "Месяц" },
]
// Asia/Bishkek is UTC+06 without seasonal clock changes for the CRM's dates.
const BISHKEK_OFFSET = 6 * HOUR_MS
const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const categoryOf = (id: string | null, products: Map<string, Product>) =>
  products.get(id ?? "")?.category ?? "Прочее"

/** Allocate the receipt's final total, not pre-discount item prices. */
export function buildTimelineEvents(
  sales: Sale[], returns: SaleReturn[], products: Map<string, Product>,
  category: string, range: DateRange,
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const from = range.from.getTime(), to = range.to.getTime()
  for (const sale of sales) {
    const timestamp = Date.parse(sale.created_at)
    if (!Number.isFinite(timestamp) || timestamp < from || timestamp >= to ||
      sale.deleted_at || sale.sync_status === "pending" || sale.sync_status === "rejected") continue
    let share = 1
    if (category !== "all") {
      const items = sale.items ?? []
      const gross = items.reduce((sum, item) => sum + Math.max(0, amount(item.price) * amount(item.quantity)), 0)
      if (gross > 0) {
        share = items.reduce((sum, item) => sum + (categoryOf(item.product_id, products) === category
          ? Math.max(0, amount(item.price) * amount(item.quantity)) : 0), 0) / gross
      } else if (items.length > 0) {
        share = items.filter((item) => categoryOf(item.product_id, products) === category).length / items.length
      } else {
        share = category === "Прочее" ? 1 : 0
      }
    }
    if (share > 0) events.push({ timestamp, revenue: amount(sale.total) * share, receipts: 1, refunds: 0 })
  }
  for (const refund of returns) {
    const timestamp = Date.parse(refund.created_at)
    if (!Number.isFinite(timestamp) || timestamp < from || timestamp >= to || refund.deleted_at) continue
    if (category !== "all" && categoryOf(refund.product_id ?? null, products) !== category) continue
    const refunds = amount(refund.amount ?? refund.return_amount)
    events.push({ timestamp, revenue: -refunds, receipts: 0, refunds })
  }
  return events.sort((a, b) => a.timestamp - b.timestamp)
}

export function bucketStart(timestamp: number, grain: TimeGrain): number {
  const d = new Date(timestamp + BISHKEK_OFFSET)
  d.setUTCMinutes(0, 0, 0)
  if (grain !== "hour") d.setUTCHours(0)
  if (grain === "week") d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7)
  if (grain === "month") d.setUTCDate(1)
  return d.getTime() - BISHKEK_OFFSET
}

export function shiftBucket(timestamp: number, grain: TimeGrain, steps: number): number {
  const d = new Date(bucketStart(timestamp, grain) + BISHKEK_OFFSET)
  if (grain === "hour") d.setUTCHours(d.getUTCHours() + steps)
  else if (grain === "day") d.setUTCDate(d.getUTCDate() + steps)
  else if (grain === "week") d.setUTCDate(d.getUTCDate() + steps * 7)
  else d.setUTCMonth(d.getUTCMonth() + steps)
  return d.getTime() - BISHKEK_OFFSET
}

function fits(from: number, to: number, grain: TimeGrain, limit: number) {
  return shiftBucket(bucketStart(from, grain), grain, limit) >= to
}

export function recommendedGrain(from: number, to: number): TimeGrain {
  return GRAINS.find(({ id }) => fits(from, to, id, 120))?.id ?? "month"
}

/** "All time" starts at the first actual event instead of allocating hours since 1970. */
export function timelineBounds(events: TimelineEvent[], range: DateRange) {
  const from = range.from.getTime() === 0
    ? (events[0]?.timestamp ?? range.to.getTime() - 24 * HOUR_MS)
    : range.from.getTime()
  return { from, to: Math.max(from + 1, range.to.getTime()) }
}

/** Manual resolution is exact. If needed, narrow to the last 400 buckets explicitly. */
export function makeTimelineWindow(
  bounds: { from: number; to: number }, from: number, to: number, grain: TimeGrain,
): TimelineWindow {
  const end = Math.min(bounds.to, Math.max(bounds.from + 1, to))
  let start = Math.max(bounds.from, Math.min(from, end - 1))
  if (!fits(start, end, grain, MAX_TIMELINE_POINTS)) {
    start = Math.max(bounds.from, shiftBucket(end - 1, grain, -(MAX_TIMELINE_POINTS - 1)))
  }
  return { from: start, to: end, grain }
}

/** Dense, zero-filled buckets keep quiet intervals visible. Never silently sample. */
export function buildTimelinePoints(events: TimelineEvent[], window: TimelineWindow): TimelinePoint[] {
  if (!events.length) return []
  const byTime = new Map<number, TimelinePoint>()
  for (let t = bucketStart(window.from, window.grain); t < window.to; t = shiftBucket(t, window.grain, 1)) {
    if (byTime.size >= MAX_TIMELINE_POINTS) throw new Error("Timeline window exceeds point limit")
    byTime.set(t, { timestamp: t, revenue: 0, receipts: 0, refunds: 0 })
  }
  for (const event of events) {
    if (event.timestamp < window.from || event.timestamp >= window.to) continue
    const row = byTime.get(bucketStart(event.timestamp, window.grain))
    if (row) {
      row.revenue += event.revenue
      row.receipts += event.receipts
      row.refunds += event.refunds
    }
  }
  return [...byTime.values()]
}

export function formatTimelineTime(timestamp: number, grain: TimeGrain, full = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    ...(grain === "hour" ? { hour: "2-digit", minute: "2-digit" } : {}),
    ...(full || grain !== "hour" ? { day: "2-digit", month: "short" } : {}),
    ...(full || grain === "month" ? { year: "numeric" } : {}),
  }).format(new Date(timestamp))
}
