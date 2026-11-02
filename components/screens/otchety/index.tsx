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

import { useEffect, useMemo, useState } from "react"
import { Lock, Undo2 } from "lucide-react"
import type { Product, Profile, Role, Sale, SaleReturn } from "@/lib/types"
import { formatSom } from "@/lib/format"
import {
  DEFAULT_SCRAP_PRICES,
  addDays,
  buildCategoryRows,
  buildPurityRows,
  buildSeries,
  categoryOf,
   returnCategoryOf,
  resolveRange,
  previousRange,
  summarise,
  toInputDate,
} from "./utils"
import { useServerSalesRange } from "@/hooks/use-server-sales"
import { useServerDailySummary } from "@/hooks/use-server-daily-summary"
import { PeriodSelector } from "./sections/period-selector"
import { KpiSection } from "./sections/kpi-section"
import { ScrapAnalysis } from "./sections/scrap-analysis"
import { HeatmapSection } from "./sections/heatmap-section"
import { ChartsSection } from "./sections/charts-section"
import { CategoryTable } from "./sections/category-table"
import { ExportButtons } from "./sections/export-buttons"
import type { KpiSummary, PeriodId, SeriesPoint, SortKey } from "./types"

export function OtchetyScreen({
  sales: localSales,
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
  const [selectedSummaryMonth, setSelectedSummaryMonth] = useState("")
  const [reportDevice, setReportDevice] = useState({
    detailedDays: 30,
    ready: false,
  })

  useEffect(() => {
    const isMobile = window.matchMedia("(pointer: coarse)").matches
    const capabilities = navigator as Navigator & { deviceMemory?: number }
    // Be conservative when the browser hides hardware details: use the
    // lighter summary path unless both RAM and CPU indicate a capable phone.
    const isCapableMobile =
      isMobile &&
      Number(capabilities.deviceMemory) >= 6 &&
      navigator.hardwareConcurrency >= 6
    setReportDevice({ detailedDays: isCapableMobile ? 90 : 30, ready: true })
  }, [])

  useEffect(() => {
    if (period !== "all") setSelectedSummaryMonth("")
  }, [period])

  // Отчёты доступны только администраторам
  const allowed = viewRole === "admin" || viewRole === "super_admin"

  const range = useMemo(
    () => resolveRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )
  const allTime = period === "all"
  const prev = useMemo(() => previousRange(range), [range])
  const rangeDays = allTime
    ? Number.POSITIVE_INFINITY
    : (range.to.getTime() - range.from.getTime()) / 86_400_000
  // Long ranges use compact SQL aggregates instead of transferring every receipt.
  const dailySummaryMode = allTime || rangeDays > reportDevice.detailedDays
  const canCompareSummary = !allTime && rangeDays <= 900
  const summaryFrom = allTime
    ? null
    : dailySummaryMode && canCompareSummary
      ? Math.min(prev.from.getTime(), range.from.getTime())
      : range.from.getTime()

  // На устройстве только последние 100 чеков — отчёт за период читаем с сервера
  // (текущий и предыдущий период одним запросом). Офлайн — локальная история.
  const server = useServerSalesRange({
    from: Math.min(prev.from.getTime(), range.from.getTime()),
    to: range.to,
    localSales,
    enabled: allowed && reportDevice.ready && !dailySummaryMode,
    withProducts: true,
  })
  const sales = server.sales
  const dailySummary = useServerDailySummary({
    from: summaryFrom,
    to: range.to,
    allTime,
    enabled: allowed && reportDevice.ready && dailySummaryMode,
  })

  // Карта id → продукт для группировки позиций продаж. Проданных товаров нет
  // в локальном каталоге, их категорию/металл присылает сервер.
  const productById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const p of server.products) map.set(p.id, p as unknown as Product)
    for (const p of products) map.set(p.id, p)
    return map
  }, [products, server.products])

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
    for (const s of inRange.filter((sale) => !sale.deleted_at && sale.sync_status !== "pending" && sale.sync_status !== "rejected"))
      for (const item of s.items ?? [])
        set.add(categoryOf(item, productById))
    for (const r of returnsInRange.filter((refund) => !refund.deleted_at))
      set.add(returnCategoryOf(r, productById))
    return [...set].sort()
  }, [inRange, returnsInRange, productById])

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

  if (dailySummaryMode) {
    const dayTimestamp = (day: string) => Date.parse(`${day}T00:00:00+06:00`)
    const currentRows = allTime
      ? dailySummary.rows
      : dailySummary.rows.filter((row) => {
          const time = dayTimestamp(row.report_day)
          return time >= range.from.getTime() && time < range.to.getTime()
        })
    const selectedMonth = allTime ? selectedSummaryMonth : ""
    const displayRows = selectedMonth
      ? currentRows.filter((row) => row.report_day.startsWith(selectedMonth))
      : currentRows
    const monthlyOverview = rangeDays > 900 && !selectedMonth
    const monthOptions = allTime
      ? Array.from(new Set(currentRows.map((row) => row.report_day.slice(0, 7))))
          .sort((a, b) => b.localeCompare(a))
      : []
    const previousRows = canCompareSummary
      ? dailySummary.rows.filter((row) => {
          const time = dayTimestamp(row.report_day)
          return time >= prev.from.getTime() && time < prev.to.getTime()
        })
      : []
    const toKpi = (rows: typeof dailySummary.rows): KpiSummary => {
      const totals = rows.reduce(
        (sum, row) => ({
          revenue: sum.revenue + Number(row.revenue || 0),
          cost: sum.cost + Number(row.cost || 0),
          profit: sum.profit + Number(row.profit || 0),
          count: sum.count + Number(row.receipt_count || 0),
        }),
        { revenue: 0, cost: 0, profit: 0, count: 0 },
      )
      return {
        ...totals,
        margin: totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0,
        avgCheck: totals.count > 0 ? totals.revenue / totals.count : 0,
      }
    }
    // Keep all-time reports light on mobile: exact KPI totals still use every
    // daily row, while the chart combines long ranges into monthly points.
    const chartRows = monthlyOverview
      ? Array.from(
          displayRows.reduce((months, row) => {
            const month = row.report_day.slice(0, 7)
            const total = months.get(month) ?? {
              report_day: `${month}-01`,
              revenue: 0,
              cost: 0,
              profit: 0,
            }
            total.revenue += Number(row.revenue || 0)
            total.cost += Number(row.cost || 0)
            total.profit += Number(row.profit || 0)
            months.set(month, total)
            return months
          }, new Map<string, { report_day: string; revenue: number; cost: number; profit: number }>()),
        ).map(([, row]) => row)
      : displayRows
    const summarySeries: SeriesPoint[] = chartRows.map((row) => {
      const date = new Date(dayTimestamp(row.report_day))
      const revenue = Number(row.revenue || 0)
      const cost = Number(row.cost || 0)
      const profit = Number(row.profit || 0)
      return {
        key: row.report_day,
        label: date.toLocaleDateString("ru-RU", {
          timeZone: "Asia/Bishkek",
          ...(monthlyOverview
            ? { month: "short" as const, year: "numeric" as const }
            : { day: "2-digit" as const, month: "short" as const }),
        }),
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      }
    })
    const returnsCount = displayRows.reduce((sum, row) => sum + Number(row.return_count || 0), 0)
    const returnsTotal = displayRows.reduce((sum, row) => sum + Number(row.refund_amount || 0), 0)

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
        <ExportButtons range={range} allTime={allTime} products={products} scrapPrices={scrapPrices} />
        {allTime && (
          <label className="flex flex-col gap-1.5 text-sm sm:max-w-xs">
            <span className="text-muted-foreground">Детализация за всё время</span>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedSummaryMonth(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-foreground"
            >
              <option value="">Обзор по месяцам</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {new Date(`${month}-01T12:00:00+06:00`).toLocaleDateString("ru-RU", {
                    timeZone: "Asia/Bishkek",
                    month: "long",
                    year: "numeric",
                  })}
                </option>
              ))}
            </select>
          </label>
        )}
        {!reportDevice.ready && (
          <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
            Подбираем детализацию отчёта для этого устройства…
          </p>
        )}
        {dailySummary.loading && (
          <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
            Формируем дневную сводку на сервере…
          </p>
        )}
        {dailySummary.error && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Не удалось загрузить дневную сводку: {dailySummary.error}
          </p>
        )}
        {dailySummary.fromServer && (
          <>
            <KpiSection
              kpi={toKpi(displayRows)}
              prevKpi={canCompareSummary ? toKpi(previousRows) : toKpi([])}
              stockCount={stockCount}
            />
            {returnsCount > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Возвратов за период: {returnsCount} на {formatSom(returnsTotal)}; сумма уже вычтена из выручки и прибыли.
              </div>
            )}
            <p className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              {selectedMonth
                ? "Показаны дневные итоги за выбранный месяц; чеки не загружаются на устройство."
                : "Показаны полные итоги по дням за выбранный период. Чеки не загружаются на устройство."}
              {" "}Подробные графики по категориям и времени доступны до {reportDevice.detailedDays} дней на этом устройстве.
              {monthlyOverview ? " Длинный график сгруппирован по месяцам; выберите месяц выше для дневной разбивки." : ""}
              {canCompareSummary ? "" : " Сравнение с предыдущим периодом отключено для диапазонов больше 2,5 лет."}
            </p>
            <ChartsSection series={summarySeries} revenueByCategory={[]} />
          </>
        )}
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

      <ExportButtons range={range} allTime={allTime} products={products} scrapPrices={scrapPrices} />

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
        key={`${range.from.getTime()}:${range.to.getTime()}:${heatCategory}`}
        sales={inRange}
        returns={returnsInRange}
        productById={productById}
        range={range}
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
