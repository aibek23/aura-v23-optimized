"use client"

import { useMemo } from "react"
import type { Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"

interface SkladStatsProps {
  products: Product[]
  canSeePurchasePrice: boolean
  isAdmin: boolean
}

export function SkladStats({ products, canSeePurchasePrice, isAdmin }: SkladStatsProps) {
  const stats = useMemo(() => {
    let count = 0
    let weight = 0
    let retail = 0
    let cost = 0

    // Словари для группировки
    const byCategory: Record<string, { count: number; weight: number }> = {}
    const byMetal: Record<string, number> = {}

    for (const p of products) {
      const q = p.quantity
      const w = p.weight * q

      count += q
      weight += w
      retail += (p.purchase_price_visible ?? 0) * q
      cost += p.purchase_price * q

      // Группировка по категориям (шт и вес)
      const cat = p.category || "Без категории"
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, weight: 0 }
      }
      byCategory[cat].count += q
      byCategory[cat].weight += w

      // Группировка по металлу (вес)
      const metal = p.metal || "Без металла"
      if (!byMetal[metal]) {
        byMetal[metal] = 0
      }
      byMetal[metal] += w
    }

    return { count, weight, retail, cost, byCategory, byMetal }
  }, [products])

  // Расчет маржи (ожидаемой прибыли)
  const margin = stats.retail - stats.cost

  return (
    <div className="mb-5 space-y-4">
      {/* Главные карточки показателей */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Позиций" value={String(stats.count)} />
        
        {/* Показываем ожидаемую прибыль (маржу) вместо общего веса */}
        {canSeePurchasePrice && (
          <StatCard label="Ожидаемая прибыль" value={formatSom(margin)} />
        )}

        {/* Розничную стоимость видят и админ, и продавец */}
        <StatCard label="Розн. стоимость" value={formatSom(stats.retail)} />

        {/* Закупочную стоимость видит тот, у кого есть права */}
        {canSeePurchasePrice && (
          <StatCard label="Оптовая. стоимость" value={formatSom(stats.cost)} />
        )}
      </div>

      {/* Детализация по категориям и металлам */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* По категориям (шт и вес) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            По категориям
          </div>
          <div className="space-y-1.5 text-sm">
            {Object.entries(stats.byCategory).map(([cat, data]) => (
              <div key={cat} className="flex justify-between items-center border-b border-border/40 pb-1 last:border-0 last:pb-0">
                <span className="font-medium text-foreground">{cat}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {data.count} шт · {formatWeight(data.weight)}
                </span>
              </div>
            ))}
            {Object.keys(stats.byCategory).length === 0 && (
              <div className="text-xs text-muted-foreground">Нет данных</div>
            )}
          </div>
        </div>

        {/* По металлам (вес) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Вес по металлам
          </div>
          <div className="space-y-1.5 text-sm">
            {Object.entries(stats.byMetal).map(([metal, w]) => (
              <div key={metal} className="flex justify-between items-center border-b border-border/40 pb-1 last:border-0 last:pb-0">
                <span className="font-medium text-foreground">{metal}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatWeight(w)}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center border-b border-border/40 pb-1 last:border-0 last:pb-0"> 
                <span className="font-medium text-foreground">Общий вес</span>
                  <span className="font-mono text-xs text-muted-foreground">
                  {formatWeight(stats.weight)}
                </span></div>
            {Object.keys(stats.byMetal).length === 0 && (
              <div className="text-xs text-muted-foreground">Нет данных</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  )
}