import type { MetalRate } from "@/lib/types"

/**
 * Базовые рыночные курсы (сом за грамм). Используются, пока администратор
 * не задал собственные курсы в таблице metal_rates.
 */
export const DEFAULT_RATES: Record<string, { sale: number; scrap: number }> = {
  "Золото 375": { sale: 3600, scrap: 3150 },
  "Золото 585": { sale: 5420, scrap: 4800 },
  "Золото 750": { sale: 6950, scrap: 6200 },
  "Золото 999": { sale: 9100, scrap: 8300 },
  "Белое золото": { sale: 5600, scrap: 4900 },
  "Серебро 925": { sale: 82, scrap: 62 },
  Платина: { sale: 3400, scrap: 2900 },
  "Вторичное золото 375": { sale: 3300, scrap: 3000 },
  "Вторичное золото 585": { sale: 5000, scrap: 4600 },
  "Вторичное золото 750": { sale: 6500, scrap: 6000 },
  "Вторичное золото 999": { sale: 8700, scrap: 8100 },
  "Вторичное серебро 925": { sale: 70, scrap: 55 },
}

export type RateMap = Record<string, { sale: number; scrap: number; updatedAt?: string }>

/** Курсы из БД поверх дефолтных значений. */
export function buildRateMap(rows: MetalRate[] | undefined | null): RateMap {
  const map: RateMap = {}
  for (const [metal, v] of Object.entries(DEFAULT_RATES)) map[metal] = { ...v }
  for (const r of rows ?? []) {
    map[r.metal] = {
      sale: Number(r.price_per_gram) || map[r.metal]?.sale || 0,
      scrap: Number(r.scrap_price_per_gram) || map[r.metal]?.scrap || 0,
      updatedAt: r.updated_at,
    }
  }
  return map
}

export function scrapRateOf(rates: RateMap, metal: string): number {
  return rates[metal]?.scrap ?? 0
}

export function saleRateOf(rates: RateMap, metal: string): number {
  return rates[metal]?.sale ?? 0
}
