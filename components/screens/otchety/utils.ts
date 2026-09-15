// ─── Вспомогательные функции: даты, лом, агрегации ─────────────────────────

import type { DateRange, KpiSummary, PeakHint, PeriodId, PurityRow } from "./types"
import type { Product, Sale, SaleItem, SaleReturn } from "@/lib/types"

/* ─── Константы ─────────────────────────────────────────────────────────── */

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "month", label: "Текущий месяц" },
  { id: "all", label: "За все время" },
]

export const TIME_SLOTS = [
  { id: "morning", label: "10–14", from: 0, to: 14 },
  { id: "day", label: "14–18", from: 14, to: 18 },
  { id: "evening", label: "18–21", from: 18, to: 24 },
] as const

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

export const DEFAULT_SCRAP_PRICES: Record<string, number> = {
  "375": 3480,
  "500": 4640,
  "585": 5420,
  "750": 6950,
  "900": 8340,
  "916": 8490,
  "925": 82,
  "950": 7600,
  "958": 88,
  "999": 9260,
  Прочее: 0,
}

/* ─── Вспомогательные функции дат ───────────────────────────────────────── */

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function toInputDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** Resolves a period id (or custom inputs) into an inclusive [from, to) range. */
export function resolveRange(
  period: PeriodId,
  customFrom: string,
  customTo: string,
): DateRange {
  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)

  switch (period) {
    case "today":
      return { from: today, to: tomorrow }
    case "yesterday":
      return { from: addDays(today, -1), to: today }
    case "7d":
      return { from: addDays(today, -6), to: tomorrow }
    case "30d":
      return { from: addDays(today, -29), to: tomorrow }
    case "month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow }
    case "custom": {
      const from = customFrom ? startOfDay(new Date(customFrom)) : addDays(today, -29)
      const to = customTo ? addDays(startOfDay(new Date(customTo)), 1) : tomorrow
      return { from, to: to > from ? to : addDays(from, 1) }
    }
    case "all":
    default:
      return { from: new Date(0), to: tomorrow }
  }
}

/** Same-length window immediately before the current one, for dynamics. */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime()
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from),
  }
}

/** Human-readable label for a range. */
export function rangeLabel(period: PeriodId, range: DateRange): string {
  if (period === "all") return "За все время"
  const to = addDays(range.to, -1)
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })
  return range.from.toDateString() === to.toDateString()
    ? fmt(to)
    : `${fmt(range.from)} — ${fmt(to)}`
}

/* ─── Тепловая карта: дни недели / временные слоты ─────────────────────── */

/** JS getDay() is Sunday-first; the UI is Monday-first. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

export function slotIndex(d: Date): number {
  const h = d.getHours()
  return TIME_SLOTS.findIndex((s) => h >= s.from && h < s.to)
}

/* ─── Пробы / лом ───────────────────────────────────────────────────────── */

/** Normalises free-text metal/purity fields into a purity bucket ("585", "925"…). */
export function purityOf(p: Pick<Product, "metal">): string {
  const raw = `${p.metal ?? ""}`
  const match = raw.match(/\b(375|500|585|750|900|916|925|958|999)\b/)
  if (match) return match[1]
  if (/платин/i.test(raw)) return "950"
  return "Прочее"
}

/* ─── Агрегации ─────────────────────────────────────────────────────────── */

/**
 * Итоги периода. Возвраты уменьшают выручку и себестоимость: проданный товар
 * вернулся на склад, а деньги ушли из кассы, поэтому и прибыль пересчитывается.
 */
export function summarise(sales: Sale[], returns: SaleReturn[] = []): KpiSummary {
  const returnedAmount = returns.reduce((sum, r) => sum + Number(r.amount), 0)
  const returnedCost = returns.reduce((sum, r) => sum + Number(r.cost), 0)

  const revenue = sales.reduce((sum, s) => sum + s.total, 0) - returnedAmount
  const cost = sales.reduce((sum, s) => sum + s.cost_total, 0) - returnedCost
  const profit = revenue - cost

  return {
    revenue,
    cost,
    profit,
    count: sales.length,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    avgCheck: sales.length > 0 ? revenue / sales.length : 0,
  }
}

export function categoryOf(
  item: SaleItem,
  productById: Map<string, Product>,
): string {
  return productById.get(item.product_id ?? "")?.category ?? "Прочее"
}

export function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Категория возвращённой позиции: по товару на складе, иначе «Прочее». */
export function returnCategoryOf(
  r: SaleReturn,
  productById: Map<string, Product>,
): string {
  return productById.get(r.product_id ?? "")?.category ?? "Прочее"
}

/** Проба возвращённой позиции: по металлу из чека, иначе по товару. */
export function returnPurityOf(
  r: SaleReturn,
  productById: Map<string, Product>,
): string {
  const product = productById.get(r.product_id ?? "")
  return purityOf({ metal: r.item_metal ?? product?.metal ?? null })
}

/* ─── Строки разбивки по пробам ────────────────────────────────────────── */

export function buildPurityRows(
  products: Product[],
  scrapPrices: Record<string, number>,
  markup: number,
): PurityRow[] {
  const buckets = new Map<
    string,
    { purity: string; weight: number; cost: number; items: number }
  >()
  for (const p of products) {
    if (p.status !== "in_stock") continue
    const key = purityOf(p)
    const row = buckets.get(key) ?? { purity: key, weight: 0, cost: 0, items: 0 }
    row.weight += p.weight || 0
    row.cost += p.purchase_price || 0
    row.items += 1
    buckets.set(key, row)
  }
  return [...buckets.values()]
    .map((r) => {
      const scrapPrice = scrapPrices[r.purity] ?? 0
      const scrapValue = r.weight * scrapPrice
      const potentialRevenue = r.cost * (1 + markup / 100)
      return {
        ...r,
        scrapPrice,
        scrapValue,
        potentialRevenue,
        potentialProfit: potentialRevenue - r.cost,
        potentialMargin:
          potentialRevenue > 0
            ? ((potentialRevenue - r.cost) / potentialRevenue) * 100
            : 0,
      }
    })
    .sort((a, b) => b.weight - a.weight)
}

/* ─── Тепловая карта ────────────────────────────────────────────────────── */

export function buildHeatGrid(
  sales: Sale[],
  heatCategory: string,
  productById: Map<string, Product>,
  returns: SaleReturn[] = [],
): { grid: number[][]; max: number } {
  const grid: number[][] = WEEKDAYS.map(() => TIME_SLOTS.map(() => 0))
  for (const s of sales) {
    const d = new Date(s.created_at)
    const wd = weekdayIndex(d)
    const sl = slotIndex(d)
    if (sl < 0) continue
    for (const item of s.items ?? []) {
      if (
        heatCategory !== "all" &&
        categoryOf(item, productById) !== heatCategory
      )
        continue
      grid[wd][sl] += item.price * item.quantity
    }
  }
  // Возвраты вычитаются из той же ячейки, в которой они оформлены.
  for (const r of returns) {
    const d = new Date(r.created_at)
    const wd = weekdayIndex(d)
    const sl = slotIndex(d)
    if (sl < 0) continue
    if (heatCategory !== "all" && returnCategoryOf(r, productById) !== heatCategory) continue
    grid[wd][sl] -= Number(r.amount)
  }
  const max = Math.max(1, ...grid.flat())
  return { grid, max }
}

export function buildPeakHints(
  sales: Sale[],
  productById: Map<string, Product>,
): PeakHint[] {
  const byCategory = new Map<string, number[][]>()
  for (const s of sales) {
    const d = new Date(s.created_at)
    const wd = weekdayIndex(d)
    const sl = slotIndex(d)
    if (sl < 0) continue
    for (const item of s.items ?? []) {
      const cat = categoryOf(item, productById)
      const g =
        byCategory.get(cat) ?? WEEKDAYS.map(() => TIME_SLOTS.map(() => 0))
      g[wd][sl] += item.price * item.quantity
      byCategory.set(cat, g)
    }
  }
  return [...byCategory.entries()]
    .map(([category, g]) => {
      let best = { wd: 0, sl: 0, value: 0 }
      g.forEach((row, wd) =>
        row.forEach((value, sl) => {
          if (value > best.value) best = { wd, sl, value }
        }),
      )
      return { category, ...best }
    })
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
}

/* ─── Временной ряд ─────────────────────────────────────────────────────── */

export function buildSeries(sales: Sale[], returns: SaleReturn[] = []) {
  const byDay = new Map<
    string,
    {
      key: string
      label: string
      revenue: number
      cost: number
      profit: number
    }
  >()
  for (const s of sales) {
    const d = new Date(s.created_at)
    const key = toInputDate(d)
    const row = byDay.get(key) ?? {
      key,
      label: d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
      revenue: 0,
      cost: 0,
      profit: 0,
    }
    row.revenue += s.total
    row.cost += s.cost_total
    row.profit += s.profit
    byDay.set(key, row)
  }
  // Возвраты попадают в день оформления возврата — это и есть кассовый поток.
  for (const r of returns) {
    const d = new Date(r.created_at)
    const key = toInputDate(d)
    const amount = Number(r.amount)
    const cost = Number(r.cost)
    const row = byDay.get(key) ?? {
      key,
      label: d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
      revenue: 0,
      cost: 0,
      profit: 0,
    }
    row.revenue -= amount
    row.cost -= cost
    row.profit -= amount - cost
    byDay.set(key, row)
  }
  return [...byDay.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => ({
      ...r,
      margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0,
    }))
}

/* ─── Разбивка по категориям ────────────────────────────────────────────── */

export function buildCategoryRows(
  sales: Sale[],
  productById: Map<string, Product>,
  returns: SaleReturn[] = [],
) {
  const rows = new Map<
    string,
    {
      key: string
      category: string
      purity: string
      count: number
      revenue: number
      cost: number
    }
  >()
  for (const s of sales) {
    for (const item of s.items ?? []) {
      const product = productById.get(item.product_id ?? "")
      const category = categoryOf(item, productById)
      const purity = purityOf({ metal: item.metal ?? product?.metal ?? null })
      const key = `${category}|${purity}`
      const row = rows.get(key) ?? {
        key,
        category,
        purity,
        count: 0,
        revenue: 0,
        cost: 0,
      }
      row.count += item.quantity
      row.revenue += item.price * item.quantity
      row.cost += item.cost * item.quantity
      rows.set(key, row)
    }
  }
  // Возвраты снимают выручку и себестоимость из своей категории/пробы.
  for (const r of returns) {
    const category = returnCategoryOf(r, productById)
    const purity = returnPurityOf(r, productById)
    const key = `${category}|${purity}`
    const row = rows.get(key) ?? {
      key,
      category,
      purity,
      count: 0,
      revenue: 0,
      cost: 0,
    }
    row.count -= 1
    row.revenue -= Number(r.amount)
    row.cost -= Number(r.cost)
    rows.set(key, row)
  }
  const totalRevenue = [...rows.values()].reduce((sum, r) => sum + r.revenue, 0)
  return [...rows.values()]
    .filter((r) => r.count !== 0 || r.revenue !== 0 || r.cost !== 0)
    .map((r) => ({
      ...r,
      count: Math.max(0, r.count),
      profit: r.revenue - r.cost,
      avgPrice: r.count > 0 ? r.revenue / r.count : 0,
      margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
      share: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
    }))
}
