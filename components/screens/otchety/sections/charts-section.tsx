"use client"

// ─── ChartsSection — графики динамики, массы, структуры и маржи ─────────────

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
import { BarChart3, TrendingUp } from "lucide-react"
import { Panel } from "../ui/panel"
import { ChartTooltip } from "../ui/chart-tooltip"
import type { CategoryChartPoint, SeriesPoint } from "../types"

interface ChartsSectionProps {
  series: SeriesPoint[]
  revenueByCategory: CategoryChartPoint[]
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

/**
 * Четыре графика: Динамика выручки/прибыли, Динамика маржи,
 * Структура выручки (pie) и Продажи по категориям (bar).
 */
export function ChartsSection({ series, revenueByCategory }: ChartsSectionProps) {
  return (
    <>
      {/* Динамика выручки и прибыли */}
      <Panel
        title="Динамика выручки и прибыли"
        subtitle="По дням за выбранный период"
        icon={TrendingUp}
      >
        {series.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={series}
              margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                width={54}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                iconType="circle"
                iconSize={8}
              />
              <Area
                dataKey="revenue"
                name="Выручка"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#revFill)"
              />
              <Line
                dataKey="profit"
                name="Прибыль"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Нет данных за период
          </p>
        )}
      </Panel>

      {/* Структура выручки по категориям (pie) */}
      {revenueByCategory.length > 0 && (
        <Panel
          title="Структура выручки"
          subtitle="Доля категорий за период"
          icon={BarChart3}
        >
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={revenueByCategory}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {revenueByCategory.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* Динамика маржи */}
      <Panel
        title="Динамика маржи"
        subtitle="Маржинальность продаж по дням"
        icon={TrendingUp}
      >
        {series.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart
              data={series}
              margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient id="marginFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--chart-3)"
                    stopOpacity={0.5}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--chart-3)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                width={44}
                unit="%"
              />
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
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Нет данных за период
          </p>
        )}
      </Panel>
    </>
  )
}
