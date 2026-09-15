import type { Product, Sale, SaleItem } from "@/lib/types"
import { parseProductSearchQuery, type ProductSearchQuery } from "@/lib/product-search"

/** Одна физическая единица товара внутри чека. */
export type SaleUnit = {
  sale: Sale
  item: SaleItem
  /** Индекс позиции внутри sales.items — по нему оформляется возврат. */
  itemIndex: number
  /** Артикул товара (если он ещё есть на складе). */
  sku: string | null
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .trim()
}

function dateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Разворачивает чеки в список отдельных позиций — так же, как их видит
 * история продаж. Каждая позиция уникальна и индексируется парой
 * (sale_id, item_index).
 */
export function flattenSaleUnits(
  sales: Sale[],
  products: Product[] = [],
  newestFirst = true,
): SaleUnit[] {
  const skuById = new Map<string, string>()
  for (const p of products) {
    if (p.sku) skuById.set(p.id, p.sku)
  }

  const sorted = newestFirst
    ? [...sales].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
    : sales

  const units: SaleUnit[] = []
  for (const sale of sorted) {
    const items = sale.items ?? []
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      units.push({
        sale,
        item,
        itemIndex: index,
        sku: item.product_id ? skuById.get(item.product_id) ?? null : null,
      })
    }
  }
  return units
}

/** Ключ позиции чека — совпадает с sale_returns (sale_id, item_index). */
export function saleUnitKey(saleId: string, itemIndex: number): string {
  return `${saleId}:${itemIndex}`
}

export function unitKey(unit: SaleUnit): string {
  return saleUnitKey(unit.sale.id, unit.itemIndex)
}

/** Тот же синтаксис запросов, что и в поиске товаров на чеке. */
export function matchesSaleUnit(unit: SaleUnit, parsed: ProductSearchQuery): boolean {
  if (parsed.kind === "empty") return true

  if (parsed.kind === "weight") {
    return Math.abs(Number(unit.item.weight) - parsed.value) < 0.005
  }
  if (parsed.kind === "price") {
    return Math.round(Number(unit.item.price)) === Math.round(parsed.value)
  }
  if (parsed.kind === "date") {
    return dateKey(unit.sale.created_at) === parsed.value
  }
  if (!parsed.value) return true

  const haystack = [
    unit.item.name,
    unit.item.metal,
    unit.sku,
    unit.sale.customer_name,
    unit.sale.customer_phone,
    unit.sale.seller_name,
    unit.sale.id,
    unit.sale.id.slice(0, 8),
  ]
    .map(normalizeText)
    .join("\u0000")

  return haystack.includes(parsed.value)
}

export function filterSaleUnits(units: SaleUnit[], raw: string): SaleUnit[] {
  if (!raw.trim()) return units
  const parsed = parseProductSearchQuery(raw)
  return units.filter((unit) => matchesSaleUnit(unit, parsed))
}

/** Причина возврата по умолчанию — используется в UI и в кассе. */
export const RETURN_REASON_PRESETS = [
  "Не подошёл размер",
  "Не подошёл по цвету",
  "Брак изделия",
  "Возврат по гарантии",
  "Покупатель передумал",
] as const
