import type { Product } from "@/lib/types"
import { purityFromMetal } from "@/lib/purity"

/**
 * Первая буква артикула — тип изделия (по категории карточки).
 * Только латиница A-Z для компактных QR-кодов.
 */
export const TYPE_CODES: Record<string, string> = {
  "Кольца":   "R",  // Ring
  "Серьги":   "E",  // Earring
  "Цепи":     "C",  // Chain
  "Браслеты": "B",  // Bracelet
  "Подвески": "P",  // Pendant
  "Часы":     "W",  // Watch
  "Прочее":   "I",  // Item
}

/**
 * Вторая буква артикула — металл/цвет металла.
 * Только латиница A-Z для компактных QR-кодов.
 */
export const METAL_CODES: Record<string, string> = {
  "Желтое золото":  "Y",  // Yellow
  "Красное золото": "R",  // Red
  "Белое золото":   "W",  // White
  "Розовое золото": "K",  // rosé/K
  "Комбинированный": "Y",
  "Палладий":       "D",  // pallaD
  "Платина":        "T",  // plaTinum
  "Серебро":        "S",  // Silver
}

/**
 * Собирает двухбуквенный ASCII-префикс из выбранных в модалке значений.
 * metalColor важнее строки металла: «Золото 585» + «Белое золото» → «WW».
 */
export function articlePrefix(category: string, metal: string, metalColor?: string | null): string | null {
  const type = TYPE_CODES[category]
  if (!type) return null

  let metalCode = metalColor ? METAL_CODES[metalColor] : undefined
  if (!metalCode) {
    if (/серебр/i.test(metal))           metalCode = "S"
    else if (/платин|палладий/i.test(metal)) metalCode = "T"
    else if (/бел/i.test(metal))         metalCode = "W"
    else if (/красн/i.test(metal))       metalCode = "R"
    else if (/розов/i.test(metal))       metalCode = "K"
    else if (/золот/i.test(metal))       metalCode = "Y"
  }
  if (!metalCode) return null
  return `${type}${metalCode}`
}

export type GeneratedArticle = {
  article: string
  prefix: string
  seq: number
  reused: boolean
}

/** Артикул: ровно 2 латинских буквы + 5 цифр, например RY00123. */
export const ARTICLE_RE = /^[A-Z]{2}\d{5}$/

export function isArticle(value: string): boolean {
  return ARTICLE_RE.test(value.trim().toUpperCase())
}

/** Данные этикетки для Niimbot B1 — печать сразу после сохранения товара. */
export type LabelPayload = {
  article: string
  name: string
  weight: string
  price: string
  purity: string
  /** Content для Code128 / QR на этикетке — тот же артикул, его читает сканер кассы. */
  barcode: string
  /** B1: 50×30 мм при 203 dpi. */
  widthMm: number
  heightMm: number
  dpi: number
}

export function buildLabelPayload(p: {
  sku?: string | null
  name: string
  weight: number
  sale_price: number
  metal?: string | null
}): LabelPayload {
  const article = (p.sku ?? "").trim().toUpperCase()
  return {
    article,
    name: p.name.trim(),
    weight: `${Number(p.weight || 0).toFixed(2)} г`,
    price: `${Math.round(Number(p.sale_price || 0)).toLocaleString("ru-RU")} с`,
    purity: purityFromMetal(p.metal),
    barcode: article,
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
  }
}

export function labelFromProduct(product: Product): LabelPayload {
  return buildLabelPayload(product)
}