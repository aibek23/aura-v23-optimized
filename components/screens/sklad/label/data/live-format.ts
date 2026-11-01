// ---------------------------------------------------------------------------
// Форматирование «живых» данных товара на этикетке
//   • replace — строки «что = на что» (например «золото 585 = Gold 14k»)
//   • prefix / suffix — текст до/после значения (например « сом»)
// Исходное значение хранится в data.raw, формат — в data.format,
// поэтому данные товара в базе не меняются.
// ---------------------------------------------------------------------------
import type { Textbox } from "fabric"
import { formatPrice, type PriceOptions, type PriceValues } from "./price"

export interface LiveFormat extends PriceOptions {
  replace?: string
  prefix?:  string
  suffix?:  string
}

export const FORMATTABLE_ROLES = ["metal", "weight", "size", "price-label", "price"] as const

type TbData = { role?: string; raw?: string; prices?: PriceValues; format?: LiveFormat; [k: string]: unknown }

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function applyLiveFormat(raw: string, fmt?: LiveFormat | null): string {
  if (!fmt) return raw
  let out = raw
  for (const line of (fmt.replace ?? "").split("\n")) {
    const idx = line.indexOf("=")
    if (idx < 0) continue
    const from = line.slice(0, idx).trim()
    const to   = line.slice(idx + 1).trim()
    if (!from) continue
    out = out.replace(new RegExp(escapeRe(from), "gi"), to)
  }
  return `${fmt.prefix ?? ""}${out}${fmt.suffix ?? ""}`
}

export function isFormattable(tb: unknown): tb is Textbox {
  const role = (tb as { data?: TbData })?.data?.role
  return !!role && (FORMATTABLE_ROLES as readonly string[]).includes(role)
}

export function getTbData(tb: Textbox): TbData {
  const holder = tb as unknown as { data?: TbData }
  if (!holder.data) holder.data = {}
  return holder.data
}

/** Записывает исходное значение и выводит его с учётом формата. */
export function setLiveText(tb: Textbox, raw: string): void {
  const data = getTbData(tb)
  data.raw = raw
  tb.set({ text: isFormattable(tb) ? applyLiveFormat(raw, data.format) : raw })
}

export function setLivePrice(tb: Textbox, prices: PriceValues): void {
  getTbData(tb).prices = prices
  reapplyLiveFormat(tb)
}

/** Повторно применяет формат к уже имеющемуся тексту. */
export function reapplyLiveFormat(tb: Textbox): void {
  if (!isFormattable(tb)) return
  const data = getTbData(tb)
  if (data.role === "price" && data.prices) {
    data.raw = formatPrice(data.prices, data.format)
    tb.set({ text: applyLiveFormat(data.raw, { prefix: data.format?.prefix, suffix: data.format?.suffix }) })
    return
  }
  if (typeof data.raw !== "string") data.raw = String(tb.text ?? "")
  tb.set({ text: applyLiveFormat(data.raw, data.format) })
}

export function hasFormat(fmt?: LiveFormat | null): boolean {
  return !!fmt && !!(fmt.replace?.trim() || fmt.prefix || fmt.suffix || fmt.priceSource || fmt.currency || fmt.somPerUsd || fmt.perGramSeparator !== undefined || fmt.perGramUnit !== undefined)
}
