"use client"

import { useId, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Clock, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { Area, AreaChart, Brush, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { Product, Sale, SaleReturn } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Panel } from "../ui/panel"
import type { DateRange } from "../types"
import {
  buildTimelineEvents, buildTimelinePoints, formatTimelineTime, GRAINS, HOUR_MS,
  makeTimelineWindow, recommendedGrain, shiftBucket, timelineBounds,
  type TimeGrain,
} from "../sales-timeline"

interface HeatmapSectionProps {
  sales: Sale[]
  returns: SaleReturn[]
  productById: Map<string, Product>
  range: DateRange
  categories: string[]
  heatCategory: string
  setHeatCategory: (c: string) => void
}

export function HeatmapSection({
  sales, returns, productById, range, categories, heatCategory, setHeatCategory,
}: HeatmapSectionProps) {
  const id = useId().replace(/:/g, "")
  const events = useMemo(() => buildTimelineEvents(sales, returns, productById, heatCategory, range),
    [sales, returns, productById, heatCategory, range])
  const bounds = useMemo(() => timelineBounds(events, range), [events, range])
  const [window, setWindow] = useState(() => makeTimelineWindow(
    bounds, bounds.from, bounds.to, recommendedGrain(bounds.from, bounds.to),
  ))
  const points = useMemo(() => buildTimelinePoints(events, window), [events, window])
  const windowKey = `${window.from}:${window.to}:${window.grain}`
  const [brush, setBrush] = useState({ key: "", start: 0, end: 0 })
  const start = brush.key === windowKey ? Math.min(brush.start, Math.max(0, points.length - 1)) : 0
  const end = brush.key === windowKey ? Math.max(start, Math.min(brush.end, Math.max(0, points.length - 1))) : Math.max(0, points.length - 1)
  const visible = points.slice(start, end + 1)
  const visibleFrom = Math.max(window.from, points[start]?.timestamp ?? window.from)
  const visibleTo = points.length
    ? Math.min(window.to, shiftBucket(points[end].timestamp, window.grain, 1))
    : window.to
  const totals = visible.reduce((acc, p) => ({
    revenue: acc.revenue + p.revenue, receipts: acc.receipts + p.receipts, refunds: acc.refunds + p.refunds,
  }), { revenue: 0, receipts: 0, refunds: 0 })
  const peak = visible.reduce<(typeof visible)[number] | undefined>(
    (best, p) => !best || p.revenue > best.revenue ? p : best, undefined,
  )
  const empty = events.length === 0
  const applyWindow = (next: typeof window) => {
    setBrush({ key: "", start: 0, end: 0 })
    setWindow(next)
  }
  const changeGrain = (grain: TimeGrain) =>
    applyWindow(makeTimelineWindow(bounds, visibleFrom, visibleTo, grain))
  const zoom = (factor: number) => {
    const span = Math.min(bounds.to - bounds.from, Math.max(HOUR_MS, (visibleTo - visibleFrom) * factor))
    const center = (visibleFrom + visibleTo) / 2
    const from = Math.max(bounds.from, Math.min(center - span / 2, bounds.to - span))
    applyWindow(makeTimelineWindow(bounds, from, from + span, recommendedGrain(from, from + span)))
  }
  const pan = (direction: number) => {
    const span = visibleTo - visibleFrom
    const from = Math.max(bounds.from, Math.min(bounds.to - span, visibleFrom + direction * span))
    applyWindow(makeTimelineWindow(bounds, from, from + span, window.grain))
  }
  const reset = () => applyWindow(makeTimelineWindow(bounds, bounds.from, bounds.to, recommendedGrain(bounds.from, bounds.to)))
  const full = visibleFrom <= bounds.from && visibleTo >= bounds.to

  return (
    <Panel title="Когда и что лучше продаётся" subtitle="Выручка по времени с учётом возвратов" icon={Clock}>
      <div className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <span className="text-xs text-muted-foreground">Детализация</span>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted/50 p-1" role="group" aria-label="Детализация графика продаж">
              {GRAINS.map(({ id: grain, label }) => (
                <button key={grain} type="button" aria-pressed={window.grain === grain}
                  onClick={() => changeGrain(grain)}
                  className={cn("min-h-9 min-w-0 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                    window.grain === grain ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-1.5 lg:w-56">
            <label htmlFor={`${id}-category`} className="text-xs text-muted-foreground">Категория товара</label>
            <select id={`${id}-category`} value={heatCategory} onChange={(e) => setHeatCategory(e.target.value)}
              className="h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm">
              <option value="all">Все категории</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-live="polite">
          <div className="min-w-0 rounded-xl bg-muted/35 p-3">
            <div className="text-[11px] text-muted-foreground">Выручка в окне</div>
            <div className="mt-1 break-words font-mono text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">{formatSom(totals.revenue)}</div>
          </div>
          <div className="min-w-0 rounded-xl bg-muted/35 p-3">
            <div className="text-[11px] text-muted-foreground">Чеков в окне</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{totals.receipts}</div>
          </div>
          <div className="col-span-2 min-w-0 rounded-xl bg-muted/35 p-3 sm:col-span-1">
            <div className="text-[11px] text-muted-foreground">Возвраты в окне</div>
            <div className="mt-1 break-words font-mono text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">{formatSom(totals.refunds)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2" role="group" aria-label="Масштаб и перемещение графика">
          <div className="flex gap-1">
            <Button type="button" size="icon" variant="outline" aria-label="Раньше" title="Предыдущий интервал"
              disabled={empty || visibleFrom <= bounds.from} onClick={() => pan(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" aria-label="Позже" title="Следующий интервал"
              disabled={empty || visibleTo >= bounds.to} onClick={() => pan(1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" aria-label="Приблизить график" title="Приблизить"
              disabled={empty || visibleTo - visibleFrom <= HOUR_MS} onClick={() => zoom(0.5)}><ZoomIn className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" aria-label="Отдалить график" title="Отдалить"
              disabled={empty || full} onClick={() => zoom(2)}><ZoomOut className="h-4 w-4" /></Button>
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={empty || full} onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />Весь период
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {formatTimelineTime(visibleFrom, "hour", true)} — {formatTimelineTime(Math.max(visibleFrom, visibleTo - 1), "hour", true)}
          <span className="block">Время: Бишкек (UTC+6). Шаг: {GRAINS.find((g) => g.id === window.grain)?.label.toLowerCase()}.</span>
        </p>

        {empty ? (
          <div className="grid h-60 place-items-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            За выбранный период нет продаж или возвратов в этой категории.
          </div>
        ) : (
          <div className="min-w-0" role="region" aria-label="График выручки по времени">
            <ResponsiveContainer width="100%" height={300} minWidth={0}>
              <AreaChart data={points} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} accessibilityLayer>
                <defs>
                  <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]}
                  tickFormatter={(value) => formatTimelineTime(Number(value), window.grain)}
                  minTickGap={32} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis width={48} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                  domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]}
                  tickFormatter={(value) => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as (typeof points)[number] | undefined
                    if (!active || !point) return null
                    return <div className="max-w-[min(16rem,70vw)] rounded-xl border border-border bg-card p-3 text-xs shadow-lg">
                      <p className="mb-1 font-medium">{formatTimelineTime(point.timestamp, window.grain, true)}</p>
                      <p>Выручка: {formatSom(point.revenue)}</p>
                      <p>Чеков: {point.receipts}</p>
                      <p>Возвраты: {formatSom(point.refunds)}</p>
                    </div>
                  }}
                />
                <Area type="linear" dataKey="revenue" name="Выручка, сом" stroke="var(--chart-1)" strokeWidth={2}
                  fill={`url(#${id}-fill)`} baseValue={0} dot={points.length <= 2} isAnimationActive={false} />
                {points.length > 1 && <Brush dataKey="timestamp" height={30} travellerWidth={12}
                  startIndex={start} endIndex={end} stroke="var(--chart-1)" fill="var(--card)"
                  tickFormatter={(value) => formatTimelineTime(Number(value), window.grain)}
                  onChange={(next) => {
                    if (next.startIndex !== undefined && next.endIndex !== undefined)
                      setBrush({ key: windowKey, start: next.startIndex, end: next.endIndex })
                  }} />}
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Передвигайте границы полосы под графиком или используйте кнопки масштаба.
              При выборе мелкого шага окно ограничивается 400 интервалами; стрелки открывают соседние.
            </p>
          </div>
        )}
        {peak && peak.revenue > 0 && (
          <p className="rounded-xl bg-primary/5 px-3 py-2 text-xs leading-relaxed">
            Лучший интервал в окне: <strong>{formatTimelineTime(peak.timestamp, window.grain, true)}</strong>
            {" — "}{formatSom(peak.revenue)}{heatCategory !== "all" ? ` · ${heatCategory}` : " · все категории"}.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Категории учитывают скидки и списанные бонусы пропорционально стоимости позиций.
          Возвраты вычитаются в момент их оформления. Крайние интервалы могут быть неполными.
          При смене периода или категории масштаб сбрасывается.
        </p>
      </div>
    </Panel>
  )
}
