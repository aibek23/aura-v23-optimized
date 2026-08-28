"use client"

import { useCallback, useMemo } from "react"

/** Безопасно приводит ввод пользователя к числу. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const n = Number(String(value ?? "").replace(",", ".").trim())
  return Number.isFinite(n) ? n : 0
}

export function round(value: number, digits = 0): number {
  const k = 10 ** digits
  return Math.round((value + Number.EPSILON) * k) / k
}

/**
 * Хук расчёта стоимости изделия/лома на стороне клиента.
 * Вся арифметика «цена за грамм × вес» и обратная «цена ÷ вес» живёт здесь,
 * чтобы компоненты оставались декларативными.
 */
export function useCalculator() {
  /** Итоговая цена = вес × цена за грамм. */
  const totalFromGram = useCallback(
    (weight: unknown, pricePerGram: unknown) => round(toNumber(weight) * toNumber(pricePerGram)),
    [],
  )

  /** Цена за грамм = итоговая цена ÷ вес. */
  const gramFromTotal = useCallback((weight: unknown, total: unknown) => {
    const w = toNumber(weight)
    if (w <= 0) return 0
    return round(toNumber(total) / w, 2)
  }, [])

  /** Стоимость лома по рыночному курсу металла. */
  const scrapTotal = useCallback(
    (weight: unknown, ratePerGram: unknown) => round(toNumber(weight) * toNumber(ratePerGram)),
    [],
  )

  /** Цена после скидки (в сомах или процентах). */
  const withDiscount = useCallback(
    (price: unknown, { som, percent }: { som?: unknown; percent?: unknown } = {}) => {
      const base = toNumber(price)
      const discount = som !== undefined && toNumber(som) > 0 ? toNumber(som) : (base * toNumber(percent)) / 100
      return Math.max(0, round(base - discount))
    },
    [],
  )

  const margin = useCallback(
    (sale: unknown, cost: unknown) => round(toNumber(sale) - toNumber(cost)),
    [],
  )

  const marginPercent = useCallback((sale: unknown, cost: unknown) => {
    const s = toNumber(sale)
    if (s <= 0) return 0
    return round(((s - toNumber(cost)) / s) * 100, 1)
  }, [])

  return useMemo(
    () => ({ totalFromGram, gramFromTotal, scrapTotal, withDiscount, margin, marginPercent, toNumber, round }),
    [totalFromGram, gramFromTotal, scrapTotal, withDiscount, margin, marginPercent],
  )
}
