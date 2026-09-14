"use client"

// ─── KpiSection — сетка карточек KPI ────────────────────────────────────────

import { Coins, Gem, Percent, Receipt, TrendingUp, Wallet } from "lucide-react"
import { formatSom } from "@/lib/format"
import { KpiCard } from "../ui/kpi-card"
import { delta } from "../utils"
import type { KpiSummary } from "../types"

interface KpiSectionProps {
  kpi: KpiSummary
  prevKpi: KpiSummary
  stockCount: number
}

/**
 * Сетка из 6 KPI-карточек: прибыль, выручка, себестоимость,
 * маржа, средний чек и количество изделий в витрине.
 */
export function KpiSection({ kpi, prevKpi, stockCount }: KpiSectionProps) {
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <KpiCard
        icon={Wallet}
        label="Чистая прибыль"
        value={formatSom(kpi.profit)}
        delta={delta(kpi.profit, prevKpi.profit)}
        accent
      />
      <KpiCard
        icon={Coins}
        label="Выручка"
        value={formatSom(kpi.revenue)}
        delta={delta(kpi.revenue, prevKpi.revenue)}
      />
      <KpiCard
        icon={Receipt}
        label="Себестоимость"
        value={formatSom(kpi.cost)}
        delta={delta(kpi.cost, prevKpi.cost)}
        invert
      />
      <KpiCard
        icon={Percent}
        label="Средняя маржа"
        value={`${kpi.margin.toFixed(1)} %`}
        delta={delta(kpi.margin, prevKpi.margin)}
      />
      <KpiCard
        icon={TrendingUp}
        label="Средний чек"
        value={formatSom(kpi.avgCheck)}
        delta={delta(kpi.avgCheck, prevKpi.avgCheck)}
      />
      <KpiCard
        icon={Gem}
        label="Изделий в витрине"
        value={`${stockCount} шт.`}
      />
    </section>
  )
}
