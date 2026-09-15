// ─── Типы и интерфейсы экрана «Отчёты» ─────────────────────────────────────

import type { Product, Sale, SaleItem, SaleReturn } from "@/lib/types"

// Идентификатор периода фильтрации
export type PeriodId = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom"

// Ключ сортировки таблицы категорий
export type SortKey = "revenue" | "profit" | "count" | "margin"

// Описание периода для кнопок-переключателей
export interface PeriodOption {
  id: PeriodId
  label: string
}

// Диапазон дат [from, to)
export interface DateRange {
  from: Date
  to: Date
}

// Сводные KPI по набору продаж
export interface KpiSummary {
  revenue: number
  cost: number
  profit: number
  count: number
  margin: number
  avgCheck: number
}

// Строка разбивки по пробам (для анализа лома)
export interface PurityRow {
  purity: string
  weight: number
  cost: number
  items: number
  scrapPrice: number
  scrapValue: number
  potentialRevenue: number
  potentialProfit: number
  potentialMargin: number
}

// Суммарные итоги по всем пробам
export interface PurityTotals {
  weight: number
  cost: number
  scrapValue: number
  potentialRevenue: number
  potentialProfit: number
}

// Строка таблицы продаж по категориям
export interface CategoryRow {
  key: string
  category: string
  purity: string
  count: number
  revenue: number
  cost: number
  profit: number
  avgPrice: number
  margin: number
  share: number
}

// Точка данных для пирчарта / bar chart по категориям
export interface CategoryChartPoint {
  name: string
  value: number
}

// Точка временного ряда (по дням)
export interface SeriesPoint {
  key: string
  label: string
  revenue: number
  cost: number
  profit: number
  margin: number
}

// Ячейка тепловой карты
export interface HeatGrid {
  grid: number[][]
  max: number
}

// Подсказка о пике продаж по категории
export interface PeakHint {
  category: string
  wd: number
  sl: number
  value: number
}

// Пропсы главного компонента OtchetyScreen
export interface OtchetyScreenProps {
  sales: Sale[]
  products: Product[]
  /** Возвраты товара — уменьшают выручку, себестоимость и прибыль. */
  returns?: SaleReturn[]
  viewRole: string
  profile: { full_name?: string | null }
}

// Реэкспорт для удобства
export type { Product, Sale, SaleItem, SaleReturn }
