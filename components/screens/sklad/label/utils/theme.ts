// ---------------------------------------------------------------------------
// Палитра линеек — light / dark
// ---------------------------------------------------------------------------

export interface RulerTheme {
  rulerBg:     string
  rulerBorder: string
  rulerFg:     string
  rulerText:   string
  markColor:   string
  markActive:  string
  gridColor:   string
}

const LIGHT: RulerTheme = {
  rulerBg:     "#f4f4f5",
  rulerBorder: "#d4d4d8",
  rulerFg:     "#a1a1aa",
  rulerText:   "#52525b",
  markColor:   "rgba(24,24,27,0.75)",
  markActive:  "rgba(99,102,241,0.95)",
  gridColor:   "rgba(0,0,0,0.06)",
}

const DARK: RulerTheme = {
  rulerBg:     "#1e1e1e",
  rulerBorder: "#3f3f46",
  rulerFg:     "#71717a",
  rulerText:   "#a1a1aa",
  markColor:   "rgba(244,244,245,0.85)",
  markActive:  "rgba(99,102,241,0.95)",
  gridColor:   "rgba(255,255,255,0.05)",
}

/** Возвращает палитру по текущей теме документа. */
export function getRulerTheme(): RulerTheme {
  return document.documentElement.classList.contains("dark") ? DARK : LIGHT
}
