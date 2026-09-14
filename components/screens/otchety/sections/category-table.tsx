"use client"

// ─── CategoryTable — таблица и мобильные карточки продаж по категориям ───────

import { BarChart3, Search } from "lucide-react"
import { formatSom } from "@/lib/format"
import { Input } from "@/components/ui/input"
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Panel } from "../ui/panel"
import { Chip } from "../ui/chip"
import { MiniStat } from "../ui/mini-stat"
import { Empty } from "../ui/empty"
import { ChartTooltip } from "../ui/chart-tooltip"
import type { CategoryChartPoint, CategoryRow, SortKey } from "../types"

interface CategoryTableProps {
  visibleRows: CategoryRow[]
  revenueByCategory: CategoryChartPoint[]
  tableQuery: string
  setTableQuery: (q: string) => void
  sortKey: SortKey
  setSortKey: (k: SortKey) => void
}

/**
 * Секция «Продажи по категориям»: bar-chart сверху,
 * строка поиска + сортировка, таблица на desktop и карточки на mobile.
 */
export function CategoryTable({
  visibleRows,
  revenueByCategory,
  tableQuery,
  setTableQuery,
  sortKey,
  setSortKey,
}: CategoryTableProps) {
  return (
    <Panel
      title="Продажи по категориям"
      subtitle="Детализация и маржинальность"
      icon={BarChart3}
    >
      {/* Bar chart по категориям */}
      {revenueByCategory.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={revenueByCategory}
            margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              width={54}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="value"
              name="Выручка"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Поиск + сортировка */}
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

      {/* Данные */}
      {visibleRows.length === 0 ? (
        <div className="mt-4">
          <Empty>Нет данных за период</Empty>
        </div>
      ) : (
        <>
          {/* Mobile: карточки */}
          <div className="mt-4 space-y-2 md:hidden">
            {visibleRows.map((r) => (
              <div
                key={r.key}
                className="rounded-xl border border-border p-3"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {r.category}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Проба {r.purity} · {r.count} шт.
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold text-primary">
                    {formatSom(r.revenue)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniStat
                    label="Прибыль"
                    value={formatSom(r.profit)}
                    tone="success"
                  />
                  <MiniStat
                    label="Маржа"
                    value={`${r.margin.toFixed(1)} %`}
                  />
                  <MiniStat
                    label="Средняя цена"
                    value={formatSom(r.avgPrice)}
                  />
                  <MiniStat
                    label="Доля выручки"
                    value={`${r.share.toFixed(1)} %`}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: таблица */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Категория / Проба</th>
                  <th className="py-2 pr-3 text-right font-medium">Кол-во</th>
                  <th className="py-2 pr-3 text-right font-medium">Выручка</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    Себестоимость
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">Прибыль</th>
                  <th className="py-2 pr-3 text-right font-medium">Ср. цена</th>
                  <th className="py-2 pr-3 text-right font-medium">Маржа</th>
                  <th className="py-2 text-right font-medium">Доля</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.category}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {r.purity}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {r.count}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {formatSom(r.revenue)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                      {formatSom(r.cost)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-success">
                      {formatSom(r.profit)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {formatSom(r.avgPrice)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {r.margin.toFixed(1)} %
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {r.share.toFixed(1)} %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}
