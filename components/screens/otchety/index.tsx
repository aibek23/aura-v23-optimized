"use client"

import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  Coins,
  Gem,
  Lock,
  Percent,
  Receipt,
  Search,
  TrendingUp,
  Wallet,
} from "lucide-react"
import type { Product, Profile, Role, Sale, SaleItem } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Period helpers                                                      */
/* ------------------------------------------------------------------ */

type PeriodId = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom"

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "month", label: "Текущий месяц" },
  { id: "all", label: "За все время" },
]

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function toInputDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** Resolves a period id (or custom inputs) into an inclusive [from, to) range. */
function resolveRange(period: PeriodId, customFrom: string, customTo: string): { from: Date; to: Date } {
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
function previousRange(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from) }
}

/* ------------------------------------------------------------------ */
/* Purity / scrap helpers                                              */
/* ------------------------------------------------------------------ */

/** Normalises free-text metal/purity fields into a purity bucket ("585", "925"…). */
function purityOf(p: Pick<Product, "metal">): string {
  const raw = `${p.metal ?? ""}`
  const match = raw.match(/\b(375|500|585|750|900|916|925|958|999)\b/)
  if (match) return match[1]
  if (/платин/i.test(raw)) return "950"
  return "Прочее"
}

const DEFAULT_SCRAP_PRICES: Record<string, number> = {
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

/* ------------------------------------------------------------------ */
/* Time-of-day buckets                                                 */
/* ------------------------------------------------------------------ */

const TIME_SLOTS = [
  { id: "morning", label: "10–14", from: 0, to: 14 },
  { id: "day", label: "14–18", from: 14, to: 18 },
  { id: "evening", label: "18–21", from: 18, to: 24 },
] as const

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

/** JS getDay() is Sunday-first; the UI is Monday-first. */
function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

function slotIndex(d: Date): number {
  const h = d.getHours()
  return TIME_SLOTS.findIndex((s) => h >= s.from && h < s.to)
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function OtchetyScreen({
  sales,
  products,
  viewRole,
  profile,
}: {
  sales: Sale[]
  products: Product[]
  viewRole: Role
  profile: Profile
}) {
  const [period, setPeriod] = useState<PeriodId>("today")
  const [customFrom, setCustomFrom] = useState(toInputDate(addDays(new Date(), -29)))
  const [customTo, setCustomTo] = useState(toInputDate(new Date()))
  const [markup, setMarkup] = useState(35)
  const [scrapPrices, setScrapPrices] = useState<Record<string, number>>(DEFAULT_SCRAP_PRICES)
  const [heatCategory, setHeatCategory] = useState("all")
  const [tableQuery, setTableQuery] = useState("")
  const [sortKey, setSortKey] = useState<"revenue" | "profit" | "count" | "margin">("revenue")

  // Reports expose purchase prices and profit, so they stay admin-only.
  const allowed = viewRole === "admin" || viewRole === "super_admin"

  const range = useMemo(() => resolveRange(period, customFrom, customTo), [period, customFrom, customTo])
  const prev = useMemo(() => previousRange(range), [range])

  // product_id -> category, so sale items can be grouped by category.
  const productById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  const inRange = useMemo(
    () =>
      sales.filter((s) => {
        const t = new Date(s.created_at).getTime()
        return t >= range.from.getTime() && t < range.to.getTime()
      }),
    [sales, range],
  )

  const inPrevRange = useMemo(
    () =>
      sales.filter((s) => {
        const t = new Date(s.created_at).getTime()
        return t >= prev.from.getTime() && t < prev.to.getTime()
      }),
    [sales, prev],
  )

  const kpi = useMemo(() => summarise(inRange), [inRange])
  const prevKpi = useMemo(() => summarise(inPrevRange), [inPrevRange])

  const stockCount = useMemo(
    () => products.reduce((sum, p) => sum + Math.max(0, p.quantity), 0),
    [products],
  )

  /* ---------------- purity breakdown of current stock ---------------- */

  const purityRows = useMemo(() => {
    const buckets = new Map<string, { purity: string; weight: number; cost: number; items: number }>()
    for (const p of products) {
      if (p.quantity <= 0) continue
      const key = purityOf(p)
      const row = buckets.get(key) ?? { purity: key, weight: 0, cost: 0, items: 0 }
      row.weight += (p.weight || 0) * p.quantity
      row.cost += (p.purchase_price || 0) * p.quantity
      row.items += p.quantity
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
          potentialMargin: potentialRevenue > 0 ? ((potentialRevenue - r.cost) / potentialRevenue) * 100 : 0,
        }
      })
      .sort((a, b) => b.weight - a.weight)
  }, [products, scrapPrices, markup])

  const purityTotals = useMemo(
    () =>
      purityRows.reduce(
        (acc, r) => ({
          weight: acc.weight + r.weight,
          cost: acc.cost + r.cost,
          scrapValue: acc.scrapValue + r.scrapValue,
          potentialRevenue: acc.potentialRevenue + r.potentialRevenue,
          potentialProfit: acc.potentialProfit + r.potentialProfit,
        }),
        { weight: 0, cost: 0, scrapValue: 0, potentialRevenue: 0, potentialProfit: 0 },
      ),
    [purityRows],
  )

  /* ---------------- categories present in the data ---------------- */

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of inRange) {
      for (const item of s.items ?? []) set.add(categoryOf(item, productById))
    }
    return [...set].sort()
  }, [inRange, productById])

  /* ---------------- heatmap: weekday x time slot ---------------- */

  const heat = useMemo(() => {
    const grid: number[][] = WEEKDAYS.map(() => TIME_SLOTS.map(() => 0))
    for (const s of inRange) {
      const d = new Date(s.created_at)
      const wd = weekdayIndex(d)
      const sl = slotIndex(d)
      if (sl < 0) continue
      for (const item of s.items ?? []) {
        if (heatCategory !== "all" && categoryOf(item, productById) !== heatCategory) continue
        grid[wd][sl] += item.price * item.quantity
      }
    }
    const max = Math.max(1, ...grid.flat())
    return { grid, max }
  }, [inRange, heatCategory, productById])

  /** Best weekday+slot per category, used for the plain-language hints. */
  const peakHints = useMemo(() => {
    const byCategory = new Map<string, number[][]>()
    for (const s of inRange) {
      const d = new Date(s.created_at)
      const wd = weekdayIndex(d)
      const sl = slotIndex(d)
      if (sl < 0) continue
      for (const item of s.items ?? []) {
        const cat = categoryOf(item, productById)
        const grid = byCategory.get(cat) ?? WEEKDAYS.map(() => TIME_SLOTS.map(() => 0))
        grid[wd][sl] += item.price * item.quantity
        byCategory.set(cat, grid)
      }
    }
    return [...byCategory.entries()]
      .map(([category, grid]) => {
        let best = { wd: 0, sl: 0, value: 0 }
        grid.forEach((row, wd) =>
          row.forEach((value, sl) => {
            if (value > best.value) best = { wd, sl, value }
          }),
        )
        return { category, ...best }
      })
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
  }, [inRange, productById])

  /* ---------------- time series ---------------- */

  const series = useMemo(() => {
    const byDay = new Map<string, { key: string; label: string; revenue: number; cost: number; profit: number }>()
    for (const s of inRange) {
      const d = new Date(s.created_at)
      const key = toInputDate(d)
      const row =
        byDay.get(key) ??
        {
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
    return [...byDay.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({ ...r, margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0 }))
  }, [inRange])

  /* ---------------- category breakdown table ---------------- */

  const categoryRows = useMemo(() => {
    const rows = new Map<
      string,
      { key: string; category: string; purity: string; count: number; revenue: number; cost: number }
    >()
    for (const s of inRange) {
      for (const item of s.items ?? []) {
        const product = productById.get(item.product_id ?? "")
        const category = categoryOf(item, productById)
        const purity = purityOf({ metal: item.metal ?? product?.metal ?? null })
        const key = `${category}|${purity}`
        const row = rows.get(key) ?? { key, category, purity, count: 0, revenue: 0, cost: 0 }
        row.count += item.quantity
        row.revenue += item.price * item.quantity
        row.cost += item.cost * item.quantity
        rows.set(key, row)
      }
    }
    const totalRevenue = [...rows.values()].reduce((sum, r) => sum + r.revenue, 0)
    return [...rows.values()].map((r) => ({
      ...r,
      profit: r.revenue - r.cost,
      avgPrice: r.count > 0 ? r.revenue / r.count : 0,
      margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
      share: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
    }))
  }, [inRange, productById])

  const visibleRows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase()
    return categoryRows
      .filter((r) => !q || r.category.toLowerCase().includes(q) || r.purity.toLowerCase().includes(q))
      .sort((a, b) => b[sortKey] - a[sortKey])
  }, [categoryRows, tableQuery, sortKey])

  const revenueByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of categoryRows) map.set(r.category, (map.get(r.category) ?? 0) + r.revenue)
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [categoryRows])

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-20 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Раздел доступен только администраторам</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {profile.full_name ?? "Пользователь"}, обратитесь к владельцу магазина за доступом.
        </p>
      </div>
    )
  }

  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

  return (
    <div className="space-y-6 pb-8">
      {/* ---------- header + period filters ---------- */}
      <header className="space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-serif text-2xl">Отчёты</h1>
            <p className="truncate text-sm text-muted-foreground">Аналитика продаж и остатков</p>
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
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="sm:w-44" />
            <span className="hidden text-xs text-muted-foreground sm:inline">—</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="sm:w-44" />
          </div>
        )}
      </header>

      {/* ---------- KPI cards ---------- */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi
          icon={Wallet}
          label="Чистая прибыль"
          value={formatSom(kpi.profit)}
          delta={delta(kpi.profit, prevKpi.profit)}
          accent
        />
        <Kpi icon={Coins} label="Выручка" value={formatSom(kpi.revenue)} delta={delta(kpi.revenue, prevKpi.revenue)} />
        <Kpi icon={Receipt} label="Себестоимость" value={formatSom(kpi.cost)} delta={delta(kpi.cost, prevKpi.cost)} invert />
        <Kpi icon={Percent} label="Средняя маржа" value={`${kpi.margin.toFixed(1)} %`} delta={delta(kpi.margin, prevKpi.margin)} />
        <Kpi icon={TrendingUp} label="Средний чек" value={formatSom(kpi.avgCheck)} delta={delta(kpi.avgCheck, prevKpi.avgCheck)} />
        <Kpi icon={Gem} label="Изделий в витрине" value={`${stockCount} шт.`} />
      </section>

      {/* ---------- purity / scrap analysis ---------- */}
      <Panel
        title="Лом, пробы и потенциальная маржа"
        subtitle="Оценка текущего остатка витрины"
        icon={Gem}
      >
        <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <label htmlFor="markup" className="min-w-0 text-xs font-medium text-muted-foreground">
              Наценка на закуп
            </label>
            <span className="shrink-0 font-mono text-sm font-semibold text-primary">{markup} %</span>
          </div>
          <input
            id="markup"
            type="range"
            min={0}
            max={200}
            step={1}
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value))}
            className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Потенц. выручка" value={formatSom(purityTotals.potentialRevenue)} />
            <MiniStat label="Потенц. прибыль" value={formatSom(purityTotals.potentialProfit)} tone="success" />
            <MiniStat
              label="Потенц. маржа"
              value={`${
                purityTotals.potentialRevenue > 0
                  ? ((purityTotals.potentialProfit / purityTotals.potentialRevenue) * 100).toFixed(1)
                  : "0.0"
              } %`}
            />
          </div>
        </div>

        {purityRows.length === 0 ? (
          <Empty>Нет товаров в остатке</Empty>
        ) : (
          <div className="space-y-2">
            {purityRows.map((r) => (
              <div key={r.purity} className="rounded-xl border border-border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">Проба {r.purity}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatWeight(r.weight)} · {r.items} шт.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      value={r.scrapPrice}
                      onChange={(e) =>
                        setScrapPrices((prevPrices) => ({ ...prevPrices, [r.purity]: Number(e.target.value) }))
                      }
                      className="h-8 w-24 text-right font-mono text-xs"
                      aria-label={`Цена лома за грамм, проба ${r.purity}`}
                    />
                    <span className="text-[11px] text-muted-foreground">с/г</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Закуплено на" value={formatSom(r.cost)} />
                  <MiniStat label="Оценка за лом" value={formatSom(r.scrapValue)} />
                  <MiniStat label="Потенц. выручка" value={formatSom(r.potentialRevenue)} />
                  <MiniStat label="Потенц. маржа" value={`${r.potentialMargin.toFixed(1)} %`} tone="success" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ---------- heatmap: when things sell ---------- */}
      <Panel title="Когда и что лучше продаётся" subtitle="Выручка по дням недели и часам" icon={Clock}>
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
          <Chip active={heatCategory === "all"} onClick={() => setHeatCategory("all")}>
            Все
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={heatCategory === c} onClick={() => setHeatCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1">
              <div />
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-[11px] text-muted-foreground">
                  {d}
                </div>
              ))}
              {TIME_SLOTS.map((slot, sl) => (
                <FragmentRow key={slot.id} label={slot.label}>
                  {WEEKDAYS.map((d, wd) => {
                    const value = heat.grid[wd][sl]
                    const intensity = value / heat.max
                    return (
                      <div
                        key={`${d}-${slot.id}`}
                        title={`${d}, ${slot.label} — ${formatSom(value)}`}
                        className="flex h-10 items-center justify-center rounded-md border border-border/60 text-[10px] font-medium tabular-nums"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(intensity * 85)}%, transparent)`,
                        }}
                      >
                        {value > 0 ? Math.round(value / 1000) + "к" : ""}
                      </div>
                    )
                  })}
                </FragmentRow>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {peakHints.length === 0 ? (
            <Empty>Недостаточно данных за период</Empty>
          ) : (
            peakHints.map((h) => (
              <div key={h.category} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="font-semibold">{h.category}</span> чаще всего покупают в{" "}
                <span className="font-semibold text-primary">{WEEKDAYS[h.wd]}</span> с{" "}
                <span className="font-semibold text-primary">{TIME_SLOTS[h.sl].label}</span> — {formatSom(h.value)}
              </div>
            ))
          )}
        </div>
      </Panel>

      {/* ---------- charts ---------- */}
      <Panel title="Динамика финансов" subtitle="Выручка, себестоимость и прибыль" icon={BarChart3}>
        {series.length === 0 ? (
          <Empty>Нет продаж за период</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Выручка" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cost" name="Себестоимость" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              <Line dataKey="profit" name="Прибыль" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Масса по пробам" subtitle="Доля веса витрины" icon={Gem}>
          {purityRows.length === 0 ? (
            <Empty>Нет остатков</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={purityRows.map((r) => ({ name: `Проба ${r.purity}`, value: Number(r.weight.toFixed(2)) }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                >
                  {purityRows.map((r, i) => (
                    <Cell key={r.purity} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip unit="г" />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Структура выручки" subtitle="Доля категорий в продажах" icon={Coins}>
          {revenueByCategory.length === 0 ? (
            <Empty>Нет продаж за период</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={revenueByCategory} dataKey="value" nameKey="name" outerRadius="80%" paddingAngle={2}>
                  {revenueByCategory.map((r, i) => (
                    <Cell key={r.name} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <Panel title="Тренд средней маржи" subtitle="Рентабельность во времени" icon={Percent}>
        {series.length === 0 ? (
          <Empty>Нет продаж за период</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="marginFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={44} unit="%" />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <Area
                dataKey="margin"
                name="Маржа"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="url(#marginFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="Продажи по категориям" subtitle="Детализация и маржинальность" icon={BarChart3}>
        {revenueByCategory.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueByCategory} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" name="Выручка" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Категория или проба..."
              value={tableQuery}
              onChange={(e) => setTableQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {(
              [
                ["revenue", "Выручка"],
                ["profit", "Прибыль"],
                ["count", "Кол-во"],
                ["margin", "Маржа"],
              ] as const
            ).map(([key, label]) => (
              <Chip key={key} active={sortKey === key} onClick={() => setSortKey(key)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <div className="mt-4">
            <Empty>Нет данных за период</Empty>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="mt-4 space-y-2 md:hidden">
              {visibleRows.map((r) => (
                <div key={r.key} className="rounded-xl border border-border p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.category}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Проба {r.purity} · {r.count} шт.
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold text-primary">
                      {formatSom(r.revenue)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <MiniStat label="Прибыль" value={formatSom(r.profit)} tone="success" />
                    <MiniStat label="Маржа" value={`${r.margin.toFixed(1)} %`} />
                    <MiniStat label="Средняя цена" value={formatSom(r.avgPrice)} />
                    <MiniStat label="Доля выручки" value={`${r.share.toFixed(1)} %`} />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Категория / Проба</th>
                    <th className="py-2 pr-3 text-right font-medium">Кол-во</th>
                    <th className="py-2 pr-3 text-right font-medium">Выручка</th>
                    <th className="py-2 pr-3 text-right font-medium">Себестоимость</th>
                    <th className="py-2 pr-3 text-right font-medium">Прибыль</th>
                    <th className="py-2 pr-3 text-right font-medium">Ср. цена</th>
                    <th className="py-2 pr-3 text-right font-medium">Маржа</th>
                    <th className="py-2 text-right font-medium">Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{r.category}</span>
                        <span className="text-muted-foreground"> · {r.purity}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.count}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatSom(r.revenue)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {formatSom(r.cost)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-success">
                        {formatSom(r.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatSom(r.avgPrice)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.margin.toFixed(1)} %</td>
                      <td className="py-2 text-right font-mono tabular-nums">{r.share.toFixed(1)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Aggregation helpers                                                 */
/* ------------------------------------------------------------------ */

function summarise(sales: Sale[]) {
  const revenue = sales.reduce((sum, s) => sum + s.total, 0)
  const cost = sales.reduce((sum, s) => sum + s.cost_total, 0)
  const profit = sales.reduce((sum, s) => sum + s.profit, 0)
  return {
    revenue,
    cost,
    profit,
    count: sales.length,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    avgCheck: sales.length > 0 ? revenue / sales.length : 0,
  }
}

function categoryOf(item: SaleItem, productById: Map<string, Product>): string {
  return productById.get(item.product_id ?? "")?.category ?? "Прочее"
}

function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function rangeLabel(period: PeriodId, range: { from: Date; to: Date }): string {
  if (period === "all") return "За все время"
  const to = addDays(range.to, -1)
  const fmt = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })
  return range.from.toDateString() === to.toDateString() ? fmt(to) : `${fmt(range.from)} — ${fmt(to)}`
}

/* ------------------------------------------------------------------ */
/* Presentational bits                                                 */
/* ------------------------------------------------------------------ */

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string
  subtitle?: string
  icon: typeof Gem
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta: change,
  accent,
  invert,
}: {
  icon: typeof Gem
  label: string
  value: string
  delta?: number | null
  accent?: boolean
  /** For cost-like metrics, growth is bad — flip the colour. */
  invert?: boolean
}) {
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
      <p className="mt-1.5 truncate font-mono text-lg font-semibold tabular-nums">{value}</p>
      {change != null && (
        <p className={cn("mt-0.5 flex items-center gap-0.5 text-[11px]", good ? "text-success" : "text-destructive")}>
          {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(change).toFixed(1)} %
        </p>
      )}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("truncate font-mono text-xs font-semibold tabular-nums", tone === "success" && "text-success")}>
        {value}
      </p>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function FragmentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center text-[11px] text-muted-foreground">{label}</div>
      {children}
    </>
  )
}

type TooltipPayload = { name?: string; value?: number | string; color?: string }

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
  unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <p className="mb-1 font-medium text-popover-foreground">{label}</p>}
      {payload.map((entry, i) => {
        const numeric = typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0)
        return (
          <p key={i} className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="truncate">{entry.name}</span>
            <span className="ml-auto font-mono tabular-nums text-popover-foreground">
              {unit ? `${numeric.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${unit}` : formatSom(numeric)}
            </span>
          </p>
        )
      })}
    </div>
  )
}
