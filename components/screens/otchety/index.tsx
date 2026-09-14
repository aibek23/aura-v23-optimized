"use client"

// ─── OtchetyScreen — главный оркестратор экрана «Отчёты» ───────────────────
// Вся реализация разбита на модули:
//   types.ts                       — типы и интерфейсы
//   utils.ts                       — вспомогательные функции и агрегации
//   ui/chip.tsx                    — переключатель периодов/категорий
//   ui/panel.tsx                   — обёртка секции
//   ui/kpi-card.tsx                — карточка KPI
//   ui/mini-stat.tsx               — компактная статистика
//   ui/empty.tsx                   — заглушка пустого состояния
//   ui/chart-tooltip.tsx           — тултип для Recharts
//   sections/period-selector.tsx   — фильтр дат
//   sections/kpi-section.tsx       — сетка KPI
//   sections/scrap-analysis.tsx    — анализ лома и проб
//   sections/heatmap-section.tsx   — тепловая карта
//   sections/charts-section.tsx    — графики
//   sections/category-table.tsx    — таблица по категориям

import { useMemo, useState } from "react"
import { Lock } from "lucide-react"
import type { Product, Profile, Role, Sale } from "@/lib/types"
import {
  DEFAULT_SCRAP_PRICES,
  addDays,
  buildCategoryRows,
  buildHeatGrid,
  buildPeakHints,
  buildPurityRows,
  buildSeries,
  categoryOf,
  resolveRange,
  previousRange,
  summarise,
  toInputDate,
} from "./utils"
import { PeriodSelector } from "./sections/period-selector"
import { KpiSection } from "./sections/kpi-section"
import { ScrapAnalysis } from "./sections/scrap-analysis"
import { HeatmapSection } from "./sections/heatmap-section"
import { ChartsSection } from "./sections/charts-section"
import { CategoryTable } from "./sections/category-table"
import type { PeriodId, SortKey } from "./types"

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
  const [customFrom, setCustomFrom] = useState(
    toInputDate(addDays(new Date(), -29)),
  )
  const [customTo, setCustomTo] = useState(toInputDate(new Date()))
  const [markup, setMarkup] = useState(35)
  const [scrapPrices, setScrapPrices] = useState<Record<string, number>>(
    DEFAULT_SCRAP_PRICES,
  )
  const [heatCategory, setHeatCategory] = useState("all")
  const [tableQuery, setTableQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("revenue")

  // Отчёты доступны только администраторам
  const allowed = viewRole === "admin" || viewRole === "super_admin"

  const range = useMemo(
    () => resolveRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )
  const prev = useMemo(() => previousRange(range), [range])

  // Карта id → продукт для группировки позиций продаж
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

  const purityRows = useMemo(
    () => buildPurityRows(products, scrapPrices, markup),
    [products, scrapPrices, markup],
  )

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
        {
          weight: 0,
          cost: 0,
          scrapValue: 0,
          potentialRevenue: 0,
          potentialProfit: 0,
        },
      ),
    [purityRows],
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of inRange)
      for (const item of s.items ?? [])
        set.add(categoryOf(item, productById))
    return [...set].sort()
  }, [inRange, productById])

  const heat = useMemo(
    () => buildHeatGrid(inRange, heatCategory, productById),
    [inRange, heatCategory, productById],
  )

  const peakHints = useMemo(
    () => buildPeakHints(inRange, productById),
    [inRange, productById],
  )

  const series = useMemo(() => buildSeries(inRange), [inRange])

  const categoryRows = useMemo(
    () => buildCategoryRows(inRange, productById),
    [inRange, productById],
  )

  const visibleRows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase()
    return categoryRows
      .filter(
        (r) =>
          !q ||
          r.category.toLowerCase().includes(q) ||
          r.purity.toLowerCase().includes(q),
      )
      .sort((a, b) => b[sortKey] - a[sortKey])
  }, [categoryRows, tableQuery, sortKey])

  const revenueByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of categoryRows)
      map.set(r.category, (map.get(r.category) ?? 0) + r.revenue)
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [categoryRows])

  // Доступ запрещён — показываем заглушку
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-20 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">
          Раздел доступен только администраторам
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {profile.full_name ?? "Пользователь"}, обратитесь к владельцу
          магазина за доступом.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      <PeriodSelector
        period={period}
        setPeriod={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        setCustomFrom={setCustomFrom}
        setCustomTo={setCustomTo}
        range={range}
      />

      <KpiSection kpi={kpi} prevKpi={prevKpi} stockCount={stockCount} />

      <ScrapAnalysis
        markup={markup}
        setMarkup={setMarkup}
        purityRows={purityRows}
        purityTotals={purityTotals}
        setScrapPrice={(purity, price) =>
          setScrapPrices((prev) => ({ ...prev, [purity]: price }))
        }
      />

      <HeatmapSection
        heat={heat}
        peakHints={peakHints}
        categories={categories}
        heatCategory={heatCategory}
        setHeatCategory={setHeatCategory}
      />

      <ChartsSection series={series} revenueByCategory={revenueByCategory} />

      <CategoryTable
        visibleRows={visibleRows}
        revenueByCategory={revenueByCategory}
        tableQuery={tableQuery}
        setTableQuery={setTableQuery}
        sortKey={sortKey}
        setSortKey={setSortKey}
      />
    </div>
  )
}
