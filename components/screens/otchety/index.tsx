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
import { Lock, Undo2 } from "lucide-react"
import type { Product, Profile, Role, Sale, SaleReturn } from "@/lib/types"
import { formatSom } from "@/lib/format"
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
  returns = [],
  viewRole,
  profile,
}: {
  sales: Sale[]
  products: Product[]
  /** Возвраты товара — уменьшают выручку, себестоимость и прибыль. */
  returns?: SaleReturn[]
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

  // Возвраты учитываются в том периоде, когда деньги вернулись покупателю.
  const returnsInRange = useMemo(
    () =>
      returns.filter((r) => {
        const t = new Date(r.created_at).getTime()
        return t >= range.from.getTime() && t < range.to.getTime()
      }),
    [returns, range],
  )

  const returnsInPrevRange = useMemo(
    () =>
      returns.filter((r) => {
        const t = new Date(r.created_at).getTime()
        return t >= prev.from.getTime() && t < prev.to.getTime()
      }),
    [returns, prev],
  )

  const kpi = useMemo(() => summarise(inRange, returnsInRange), [inRange, returnsInRange])
  const prevKpi = useMemo(
    () => summarise(inPrevRange, returnsInPrevRange),
    [inPrevRange, returnsInPrevRange],
  )

  const returnsTotal = useMemo(
    () => returnsInRange.reduce((sum, r) => sum + Number(r.amount), 0),
    [returnsInRange],
  )

  const stockCount = useMemo(
    () => products.filter((p) => p.status === "in_stock").length,
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
    () => buildHeatGrid(inRange, heatCategory, productById, returnsInRange),
    [inRange, heatCategory, productById, returnsInRange],
  )

  const peakHints = useMemo(
    () => buildPeakHints(inRange, productById),
    [inRange, productById],
  )

  const series = useMemo(() => buildSeries(inRange, returnsInRange), [inRange, returnsInRange])

  const categoryRows = useMemo(
    () => buildCategoryRows(inRange, productById, returnsInRange),
    [inRange, productById, returnsInRange],
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

      {returnsInRange.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          <Undo2 className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">
            Возвратов за период: {returnsInRange.length} на {formatSom(returnsTotal)}
          </span>
          <span className="text-muted-foreground">
            выручка и прибыль в отчёте уже пересчитаны с их учётом
          </span>
        </div>
      )}

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
