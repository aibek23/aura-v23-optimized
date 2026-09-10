// ---------------------------------------------------------------------------
// Автомасштабирование шрифта и авто-высота Textbox
// ---------------------------------------------------------------------------
import { Textbox } from "fabric"
import type { Canvas, FabricObject } from "fabric"
import {
  AUTOFIT_MIN_FONT, AUTOFIT_MAX_FONT,
  FIT_RATIO_MIN, FIT_RATIO_MAX, FIT_RATIO_DEFAULT,
} from "../constants"

export const TEXT_DEFAULTS = {
  padding: 0,
  splitByGrapheme: true,
  objectCaching: false,
  lockScalingFlip: true,
} as const

type TextMeta = { role?: string; autoFit?: boolean; fitRatio?: number; boxH?: number }

const meta = (tb: Textbox): TextMeta => {
  const o = tb as unknown as { data?: TextMeta }
  if (!o.data) o.data = {}
  return o.data
}

export const clampRatio = (r: number): number =>
  Math.min(FIT_RATIO_MAX, Math.max(FIT_RATIO_MIN, Number.isFinite(r) ? r : FIT_RATIO_DEFAULT))

export const isAutoFit   = (tb: Textbox): boolean => meta(tb).autoFit !== false
export const getFitRatio = (tb: Textbox): number  => clampRatio(meta(tb).fitRatio ?? FIT_RATIO_DEFAULT)

export const getBoxHeight = (tb: Textbox): number => {
  const stored = meta(tb).boxH
  if (typeof stored === "number" && stored > 2) return stored
  const h = (tb.height ?? 0) * (tb.scaleY ?? 1)
  return h > 2 ? h : 20
}

export const setBoxHeight = (tb: Textbox, h: number): void => {
  meta(tb).boxH = Math.max(4, h)
}

export function setAutoFit(tb: Textbox, on: boolean): void {
  meta(tb).autoFit = on
  if (on) fitFontToBox(tb)
  else fitTextboxHeight(tb)
}

export function setFitRatio(tb: Textbox, ratio: number): void {
  meta(tb).fitRatio = clampRatio(ratio)
  if (isAutoFit(tb)) fitFontToBox(tb)
}

function maxLineWidth(tb: Textbox): number {
  try {
    const lines = (tb as unknown as { textLines?: string[] }).textLines ?? []
    let max = 0
    for (let i = 0; i < lines.length; i++) {
      const w = (tb as unknown as { getLineWidth: (i: number) => number }).getLineWidth(i)
      if (Number.isFinite(w) && w > max) max = w
    }
    return max
  } catch { return 0 }
}

export function fitFontToBox(tb: Textbox, boxW?: number, boxH?: number): void {
  const w     = Math.max(4, boxW ?? (tb.width ?? 4))
  const h     = Math.max(4, boxH ?? getBoxHeight(tb))
  const ratio = getFitRatio(tb)

  tb.set({ padding: 0, scaleX: 1, scaleY: 1, width: w })

  const fits = (size: number): boolean => {
    tb.set({ fontSize: size })
    tb.initDimensions()
    return tb.calcTextHeight() <= h + 0.5 && maxLineWidth(tb) <= w + 0.5
  }

  let lo = AUTOFIT_MIN_FONT, hi = AUTOFIT_MAX_FONT, best = AUTOFIT_MIN_FONT
  for (let i = 0; i < 22 && hi - lo > 0.25; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) { best = mid; lo = mid } else { hi = mid }
  }

  const finalSize = Math.min(AUTOFIT_MAX_FONT, Math.max(AUTOFIT_MIN_FONT, Math.round(best * ratio * 100) / 100))
  tb.set({ fontSize: finalSize })
  tb.initDimensions()
  tb.set({ height: h, scaleX: 1, scaleY: 1 })
  setBoxHeight(tb, h)
  tb.setCoords()
}

export function fitTextboxHeight(tb: Textbox): void {
  tb.set({ padding: 0, scaleY: 1 })
  tb.initDimensions()
  const h = tb.calcTextHeight()
  if (h > 0) tb.set({ height: h })
  setBoxHeight(tb, tb.height ?? h)
  tb.setCoords()
}

export function refitTextbox(tb: Textbox): void {
  if (isAutoFit(tb)) fitFontToBox(tb)
  else fitTextboxHeight(tb)
}

export function createTextbox(text: string, options: Record<string, unknown>): Textbox {
  const opts = { ...TEXT_DEFAULTS, ...options } as Record<string, unknown>
  const data = { autoFit: true, fitRatio: FIT_RATIO_DEFAULT, ...(opts.data as object ?? {}) }
  opts.data  = data
  const tb   = new Textbox(text, opts)
  fitTextboxHeight(tb)
  if (isAutoFit(tb)) fitFontToBox(tb)
  return tb
}

export function attachTextAutoHeight(canvas: Canvas): () => void {
  const normalize = (obj?: FabricObject) => {
    if (!obj || obj.type !== "textbox") return
    const tb    = obj as Textbox
    const sx    = tb.scaleX ?? 1
    const sy    = tb.scaleY ?? 1
    const newW  = Math.max(4, (tb.width  ?? 0) * sx)
    if (isAutoFit(tb)) {
      fitFontToBox(tb, newW, Math.max(4, (tb.height ?? 0) * sy))
      return
    }
    if (sx !== 1) tb.set({ width: newW, scaleX: 1 })
    fitTextboxHeight(tb)
  }

  const repaint = (e: { target?: FabricObject }) => { normalize(e.target); canvas.requestRenderAll() }
  const onAdded = (e: { target?: FabricObject }) => {
    if (e.target?.type === "textbox") {
      const tb = e.target as Textbox
      tb.set({ ...TEXT_DEFAULTS })
      refitTextbox(tb)
    }
  }

  type Bus = { on: (n: string, h: (e: { target?: FabricObject }) => void) => void; off: (n: string, h: (e: { target?: FabricObject }) => void) => void }
  const bus = canvas as unknown as Bus
  bus.on("object:scaling",  repaint)
  bus.on("object:modified", repaint)
  bus.on("text:changed",    repaint)
  bus.on("editing:exited",  repaint)
  bus.on("object:added",    onAdded)

  canvas.getObjects().forEach((o) => {
    if (o.type === "textbox") { (o as Textbox).set({ ...TEXT_DEFAULTS }); refitTextbox(o as Textbox) }
  })

  return () => {
    bus.off("object:scaling",  repaint)
    bus.off("object:modified", repaint)
    bus.off("text:changed",    repaint)
    bus.off("editing:exited",  repaint)
    bus.off("object:added",    onAdded)
  }
}
