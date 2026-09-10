// ---------------------------------------------------------------------------
// Типы, общие для всего модуля
// ---------------------------------------------------------------------------
import type { JewelryLabelSizeKey } from "@/lib/niimbot"
import type { Product } from "@/lib/types"
import { LABEL_SIZES } from "@/lib/niimbot"

// ── Пропсы редактора ──────────────────────────────────────────────────────────
export interface LabelEditorProps {
  product:        Product
  autoPrint?:     boolean
  initialSizeKey?: JewelryLabelSizeKey
  onClose?:       () => void
}

// ── Элемент шаблона ───────────────────────────────────────────────────────────
export interface TemplateItem {
  role:        string
  kind:        "textbox" | "image" | "rect"
  left:        number
  top:         number
  width:       number
  height:      number
  angle:       number
  scaleX:      number
  scaleY:      number
  // textbox-specific
  fontSize?:   number
  fontFamily?: string
  fontWeight?: string
  textAlign?:  string
  fill?:       string
  text?:       string
  autoFit?:    boolean
  fitRatio?:   number
  // rect-specific
  stroke?:      string
  strokeWidth?: number
}

// ── Шаблон этикетки ───────────────────────────────────────────────────────────
export interface LabelTemplate {
  v:       string
  sizeKey: string
  bg:      string | null
  items:   TemplateItem[]
}

// ── Вспомогательный тип: объект с data.role ──────────────────────────────────
export type WithRole = { data?: { role?: string } }

/** Округление до N знаков (по умолчанию 2). */
export const r2 = (v: unknown, fallback = 0, digits = 2): number => {
  const n = typeof v === "number" && isFinite(v) ? v : fallback
  return Math.round(n * 10 ** digits) / 10 ** digits
}

/** Безопасное чтение data.role у Fabric-объекта. */
export const getRole = (o: unknown): string | undefined =>
  (o as WithRole)?.data?.role

// ── Список ключей форматов для Select ────────────────────────────────────────
export const SIZE_OPTIONS = Object.keys(LABEL_SIZES) as JewelryLabelSizeKey[]
