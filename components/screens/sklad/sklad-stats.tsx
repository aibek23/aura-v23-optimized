"use client"

import { useMemo } from "react"
import type { Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { purityFromMetal } from "@/lib/purity"

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

    const byCategory: Record<string, { category: string; metal: string; count: number; weight: number }> = {}
    const byMetal: Record<string, number> = {} // Группировка общего веса по металлу

    for (const p of products) {
      const q = p.status === "in_stock" ? 1 : 0
      const w = p.weight * q

      count += q
      weight += w
      retail += (p.purchase_price_visible ?? 0) * q
      cost += p.purchase_price * q

      const category = p.category || "Без категории"
      const metal = p.metal || "Без металла"
      const purity = purityFromMetal(p.metal)
      const metalLabel = purity && !metal.endsWith(purity) ? `${metal} ${purity}` : metal
      
      // Агрегация по категориям
      const key = `${category}\u0000${metalLabel}`
      if (!byCategory[key]) {
        byCategory[key] = { category, metal: metalLabel, count: 0, weight: 0 }
      }
      byCategory[key].count += q
      byCategory[key].weight += w

      // Агрегация веса строго по металлу
      byMetal[metalLabel] = (byMetal[metalLabel] || 0) + w
    }

    return { count, weight, retail, cost, byCategory, byMetal }
  }, [products])

  const margin = stats.retail - stats.cost

  return (
    <div className="mb-5 space-y-4">
      {/* Главные карточки показателей */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Позиций" value={String(stats.count)} />
        
        {canSeePurchasePrice && (
          <StatCard label="Ожидаемая прибыль" value={formatSom(margin)} />
        )}

        <StatCard label="Розн. стоимость" value={formatSom(stats.retail)} />

        {canSeePurchasePrice && (
          <StatCard label="Оптовая. стоимость" value={formatSom(stats.cost)} />
        )}
      </div>

      {/* Детализация по категориям и металлам */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            По категориям и металлам
          </div>
          <div className="space-y-1.5 text-sm">
            {Object.entries(stats.byCategory).map(([key, data]) => (
              <div key={key} className="flex items-center justify-between gap-3 border-b border-border/40 pb-1 last:border-0 last:pb-0">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {data.category} <span className="font-normal text-muted-foreground">— {data.metal}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {data.count} шт · {formatWeight(data.weight)}
                </span>
              </div>
            ))}
            {Object.keys(stats.byCategory).length === 0 && (
              <div className="text-xs text-muted-foreground">Нет данных</div>
            )}

            {/* Итоговый блок веса с разбиением по металлам */}
            <div className="mt-3 border-t border-border pt-2 text-xs">
              <div className="flex justify-between font-medium text-foreground">
                <span>Общий вес</span>
                <span className="font-mono">{formatWeight(stats.weight)}</span>
              </div>
              
              {Object.keys(stats.byMetal).length > 0 && (
                <div className="mt-1.5 space-y-1 text-muted-foreground">
                  {Object.entries(stats.byMetal).map(([metal, w]) => (
                    <div key={metal} className="flex justify-between pl-2">
                      <span>• {metal}</span>
                      <span className="font-mono">{formatWeight(w)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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