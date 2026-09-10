// ---------------------------------------------------------------------------
// Константы модуля — полный набор из Aura
// ---------------------------------------------------------------------------

// ── Шрифты ───────────────────────────────────────────────────────────────────
export const FONTS = [
  "Arial", "Times New Roman", "Courier New",
  "Georgia", "Verdana", "Trebuchet MS",
  "Impact", "Comic Sans MS",
] as const

// ── Масштаб ───────────────────────────────────────────────────────────────────
export const ZOOM_MIN     = 0.15
export const ZOOM_MAX     = 5
export const ZOOM_DEFAULT = 1
export const ZOOM_STEP    = 0.1

// ── Линейки ───────────────────────────────────────────────────────────────────
export const RULER_SIZE = 18   // px
export const TICK_MAJOR = 10   // мм
export const TICK_MINOR = 5    // мм

// ── Стили рамок ───────────────────────────────────────────────────────────────
export type BorderStyleKey = "thin" | "thick" | "dashed" | "dotted" | "double" | "rounded"

export const BORDER_STYLES: {
  key:            BorderStyleKey
  label:          string
  strokeWidth:    number
  strokeDashArray: number[] | null
  rx:             number
}[] = [
  { key: "thin",     label: "Тонкая",      strokeWidth: 1,   strokeDashArray: null,    rx: 0  },
  { key: "thick",    label: "Жирная",      strokeWidth: 3,   strokeDashArray: null,    rx: 0  },
  { key: "dashed",   label: "Пунктир",     strokeWidth: 1.5, strokeDashArray: [8, 4],  rx: 0  },
  { key: "dotted",   label: "Точки",       strokeWidth: 1.5, strokeDashArray: [2, 4],  rx: 0  },
  { key: "double",   label: "Двойная",     strokeWidth: 2,   strokeDashArray: null,    rx: 0  },
  { key: "rounded",  label: "Скруглённая", strokeWidth: 1.5, strokeDashArray: null,    rx: 10 },
]

// ── AutoFit ───────────────────────────────────────────────────────────────────
export const AUTOFIT_MIN_FONT  = 4
export const AUTOFIT_MAX_FONT  = 200
export const FIT_RATIO_MIN     = 0.3
export const FIT_RATIO_MAX     = 1.5
export const FIT_RATIO_DEFAULT = 1.0

// ── Печать ────────────────────────────────────────────────────────────────────
export const PRINT_SCALE = 2

// ── Шаблон ───────────────────────────────────────────────────────────────────
export const TEMPLATE_VERSION = "1"

// ── Живые роли (обновляются при loadTemplate) ────────────────────────────────
export const LIVE_ROLES = [
  "metal", "weight", "size", "price-label", "price", "sku", "qr",
] as const
