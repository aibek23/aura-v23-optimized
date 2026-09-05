// ---------------------------------------------------------------------------
// Константы и типы редактора этикеток
// ---------------------------------------------------------------------------
import type { FabricObject } from "fabric"
import type { JewelryLabelSizeKey } from "@/lib/niimbot"

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------
export const FONTS = [
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Courier New",
  "Georgia",
  "Verdana",
]

export const SIZE_OPTIONS: JewelryLabelSizeKey[] = [
  "T25x30_45",
  "T30x25_45",
  "T30x25_50",
  "T50x30_rect",
]

export const ZOOM_STEP = 0.15
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3.0

/** Версия компактного формата шаблона (в БД хранится только геометрия). */
export const TEMPLATE_VERSION = 3

/** Роли, которые создаёт стандартный макет. */
export const LIVE_ROLES = ["metal", "specs", "price", "sku", "qr"] as const

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------
export interface LabelEditorProps {
  product: import("@/lib/types").Product
  autoPrint?: boolean
  initialSizeKey?: JewelryLabelSizeKey
  onClose?: () => void
}

/** Один элемент компактного шаблона — только позиция и оформление. */
export interface TemplateItem {
  role: string
  kind: "textbox" | "rect" | "image"
  left: number
  top: number
  angle?: number
  scaleX?: number
  scaleY?: number
  width?: number
  height?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  textAlign?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  /** Текст сохраняется только для пользовательских надписей (роль custom-*). */
  text?: string
  /** Автомасштабирование шрифта под габариты блока. */
  autoFit?: boolean
  /** Коэффициент заполнения блока текстом (0.3…1.5). */
  fitRatio?: number
}

export interface LabelTemplate {
  v: number
  sizeKey: string
  bg: string | null
  items: TemplateItem[]
}

export type WithRole = FabricObject & { data?: { role?: string } }

// ---------------------------------------------------------------------------
// Утилиты уровня типов
// ---------------------------------------------------------------------------
export const r2 = (n: number | undefined, fallback = 0): number =>
  Math.round(
    (typeof n === "number" && Number.isFinite(n) ? n : fallback) * 100,
  ) / 100

export const getRole = (obj: FabricObject): string | undefined =>
  (obj as WithRole).data?.role
