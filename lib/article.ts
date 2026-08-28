import type { Product } from "@/lib/types"

/** Первая буква артикула — тип изделия (по категории карточки). */
export const TYPE_CODES: Record<string, string> = {
  Кольца: "К",
  Серьги: "С",
  Цепи: "Ц",
  Браслеты: "Б",
  Подвески: "П",
  Часы: "Ч",
  Прочее: "И",
}

/** Вторая буква артикула — металл/цвет металла. */
export const METAL_CODES: Record<string, string> = {
  "Жёлтое золото": "Ж",
  "Желтое золото": "Ж",
  "Красное золото": "К",
  "Белое золото": "Б",
  "Розовое золото": "Р",
  Комбинированный: "Ж",
  Палладий: "П",
  Платина: "П",
  Серебро: "С",
}

/**
 * Собирает двухбуквенный префикс из выбранных в модалке значений.
 * metalColor важнее строки металла: «Золото 585» + «Белое золото» → «КБ».
 */
export function articlePrefix(category: string, metal: string, metalColor?: string | null): string | null {
  const type = TYPE_CODES[category]
  if (!type) return null

  let metalCode = metalColor ? METAL_CODES[metalColor] : undefined
  if (!metalCode) {
    if (/серебр/i.test(metal)) metalCode = "С"
    else if (/платин|палладий/i.test(metal)) metalCode = "П"
    else if (/бел/i.test(metal)) metalCode = "Б"
    else if (/красн/i.test(metal)) metalCode = "К"
    else if (/розов/i.test(metal)) metalCode = "Р"
    else if (/золот/i.test(metal)) metalCode = "Ж"
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

export const ARTICLE_RE = /^[А-ЯЁ]{2}\d{5}$/

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
  purity?: string | null
}): LabelPayload {
  const article = (p.sku ?? "").trim().toUpperCase()
  return {
    article,
    name: p.name.trim(),
    weight: `${Number(p.weight || 0).toFixed(2)} г`,
    price: `${Math.round(Number(p.sale_price || 0)).toLocaleString("ru-RU")} с`,
    purity: p.purity ?? "",
    barcode: article,
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
  }
}

export function labelFromProduct(product: Product): LabelPayload {
  return buildLabelPayload(product)
}
