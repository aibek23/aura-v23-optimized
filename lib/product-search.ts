import type { Product } from "@/lib/types"

export type ProductSearchQuery =
  | { kind: "text"; value: string }
  | { kind: "weight"; value: number }
  | { kind: "price"; value: number }
  | { kind: "date"; value: string }
  | { kind: "empty"; value: "" }

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .trim()
}

function numericValue(value: string): number | null {
  const parsed = Number(value.replace(",", ".").replace(/\s+/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Распознаёт специальные запросы поиска.
 *
 * Единицы намеренно обязательны: ввод «1» не запускает дорогой по смыслу
 * поиск по всем числовым полям, а «1,25г», «1.25 г» и «12300с» — запускает
 * локальную фильтрацию сразу после ввода последнего символа.
 */
export function parseProductSearchQuery(raw: string): ProductSearchQuery {
  const value = raw.trim()
  if (!value) return { kind: "empty", value: "" }

  const date = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (date) {
    const day = date[1].padStart(2, "0")
    const month = date[2].padStart(2, "0")
    return { kind: "date", value: `${date[3]}-${month}-${day}` }
  }

  const weight = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм(?:а|ов)?)$/i)
  if (weight) {
    const parsed = numericValue(weight[1])
    if (parsed !== null) return { kind: "weight", value: parsed }
  }

  const price = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:с|сом(?:а|ов)?)$/i)
  if (price) {
    const parsed = numericValue(price[1])
    if (parsed !== null) return { kind: "price", value: parsed }
  }

  return { kind: "text", value: normalizeText(value) }
}

export function isSearchReady(raw: string, minTextLength = 3): boolean {
  const parsed = parseProductSearchQuery(raw)
  return parsed.kind !== "empty" && (parsed.kind !== "text" || parsed.value.length >= minTextLength)
}

function dateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Общий предикат для всех экранов CRM. Работает только в памяти клиента:
 * подключённые экраны не создают запросов в Supabase при изменении строки.
 */
export function matchesProduct(product: Product, raw: string): boolean {
  const parsed = parseProductSearchQuery(raw)
  if (parsed.kind === "empty") return true

  if (parsed.kind === "weight") {
    return Math.abs(Number(product.weight) - parsed.value) < 0.005
  }
  if (parsed.kind === "price") {
    return Math.round(Number(product.sale_price)) === Math.round(parsed.value)
  }
  if (parsed.kind === "date") {
    return dateKey(product.created_at) === parsed.value
  }
  if (!parsed.value) return true

  const searchable = [
    product.name,
    product.sku,
    product.category,
    product.metal,
    product.supplier_name,
    product.supplier_phone,
    product.size,
  ]
    .map(normalizeText)
    .join("\u0000")

  return searchable.includes(parsed.value)
}

export function filterProducts(products: Product[], raw: string): Product[] {
  if (!raw.trim()) return products
  return products.filter((product) => matchesProduct(product, raw))
}

export function matchesSupplier(
  name: string,
  phone: string | null,
  products: Product[],
  raw: string,
): boolean {
  const parsed = parseProductSearchQuery(raw)
  if (parsed.kind === "empty") return true
  const supplierText = [name, phone].map(normalizeText).join("\u0000")
  if (parsed.kind === "text" && supplierText.includes(parsed.value)) return true
  return products.some((product) => matchesProduct(product, raw))
}
