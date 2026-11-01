import type { Product } from "../../../../../lib/types"

export const PRICE_SOURCES = [
  { key: "sale_price", label: "Цена продажи (цена на этикетку)", perGram: false, purchase: false },
  { key: "price_per_gram_sale", label: "Цена за грамм", perGram: true, purchase: false },
  { key: "purchase_price_visible", label: "Цена закупки для продавца", perGram: false, purchase: true },
  { key: "price_per_gram_purchase_visible", label: "Цена закупки для продавца за грамм", perGram: true, purchase: true },
] as const

/** Валюты СНГ и основные мировые. SOM — базовая (цены в базе в сомах). */
export const CURRENCIES = [
  { code: "SOM", label: "Сом", symbol: "" },
  { code: "USD", label: "Доллар", symbol: "$" },
  { code: "EUR", label: "Евро", symbol: "€" },
  { code: "RUB", label: "Рубль", symbol: "₽" },
  { code: "KZT", label: "Тенге", symbol: "₸" },
  { code: "UZS", label: "Сум", symbol: "сўм" },
  { code: "TJS", label: "Сомони", symbol: "SM" },
  { code: "AMD", label: "Драм", symbol: "֏" },
  { code: "AZN", label: "Манат", symbol: "₼" },
  { code: "BYN", label: "Бел. рубль", symbol: "Br" },
  { code: "TRY", label: "Лира", symbol: "₺" },
  { code: "CNY", label: "Юань", symbol: "¥" },
  { code: "AED", label: "Дирхам", symbol: "AED" },
] as const
export type CurrencyCode = (typeof CURRENCIES)[number]["code"]

export type PriceSource = (typeof PRICE_SOURCES)[number]["key"]
export type PriceValues = Partial<Record<PriceSource, number | null>>
export interface PriceOptions {
  priceSource?: PriceSource
  currency?: CurrencyCode
  /** Курс: сколько сом за 1 единицу выбранной валюты (имя поля сохранено для старых шаблонов) */
  somPerUsd?: number
  /** Разделитель и единица для цен за грамм (по умолчанию «/» и «г») */
  perGramSeparator?: string
  perGramUnit?: string
}

export function getPriceValues(product: Product): PriceValues {
  return Object.fromEntries(PRICE_SOURCES.map(({ key }) => [key, product[key]]))
}

export function selectedPrice(values: PriceValues, options: PriceOptions = {}): number | null {
  const amount = values[options.priceSource ?? "sale_price"]
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null
  if (!options.currency || options.currency === "SOM") return amount
  const rate = options.somPerUsd
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? amount / rate : null
}

export function formatPrice(values: PriceValues, options: PriceOptions = {}): string {
  const amount = selectedPrice(values, options)
  if (amount === null) return "—"
  const source = PRICE_SOURCES.find(({ key }) => key === (options.priceSource ?? "sale_price"))
  const number = amount.toLocaleString("ru", { maximumFractionDigits: 2 })
  return `${number}${currencyTail(options.currency)}${source?.perGram ? perGramTail(source.key, options) : ""}`
}

function perGramTail(_key: PriceSource, options: PriceOptions): string {
  const sep = options.perGramSeparator ?? "/"
  const unit = options.perGramUnit ?? "г"
  return [" ", sep, sep && unit ? " " : "", unit].join("").replace(/\s+$/, "")
}

function currencyTail(code?: CurrencyCode): string {
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol
  return symbol ? ` ${symbol}` : ""
}
