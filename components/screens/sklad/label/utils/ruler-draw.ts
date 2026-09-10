// ---------------------------------------------------------------------------
// Чистые функции отрисовки линеек (исправлено положение при повороте)
// ---------------------------------------------------------------------------
import { RULER_SIZE, TICK_MAJOR, TICK_MINOR } from "../constants"
import type { RulerTheme } from "./theme"
import type { StageOrigin, ScreenBox } from "./geometry"

interface AxisRange { start: number; end: number; step: number }

export interface RulerLabel {
  position: number
  value: number
  name: string
}

function formatRulerValue(value: number): string {
  const safe = Math.abs(value) < 0.05 ? 0 : value
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1)
}

function drawHorizontalLabel(
  ctx: CanvasRenderingContext2D,
  label: RulerLabel,
  cW: number,
  theme: RulerTheme,
): void {
  const text = formatRulerValue(label.value)
  ctx.font = "7px system-ui, sans-serif"
  const width = ctx.measureText(text).width + 4
  const center = Math.max(RULER_SIZE + width / 2, Math.min(cW - width / 2, label.position))

  ctx.fillStyle = theme.markActive
  ctx.fillRect(center - width / 2, 1, width, 10)
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, center, 6)
  ctx.textBaseline = "alphabetic"
}

function drawVerticalLabel(
  ctx: CanvasRenderingContext2D,
  label: RulerLabel,
  cH: number,
  theme: RulerTheme,
): void {
  const text = formatRulerValue(label.value)
  ctx.font = "7px system-ui, sans-serif"
  const width = ctx.measureText(text).width + 4
  const center = Math.max(RULER_SIZE + width / 2, Math.min(cH - width / 2, label.position))

  ctx.save()
  ctx.translate(6, center)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = theme.markActive
  ctx.fillRect(-width / 2, -5, width, 10)
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

function axisRange(
  at0: number,
  at1: number,
  fromScreen: number,
  toScreen: number,
): AxisRange | null {
  const perMm = at1 - at0
  if (Math.abs(perMm) < 1e-6) return null
  const mmA = (fromScreen - at0) / perMm
  const mmB = (toScreen   - at0) / perMm
  const lo  = Math.min(mmA, mmB)
  const hi  = Math.max(mmA, mmB)
  return {
    start: Math.floor(lo / 5) * 5 - 5,
    end:   Math.ceil(hi   / 5) * 5 + 5,
    step:  TICK_MINOR,
  }
}

export interface RulerHParams {
  ctx: CanvasRenderingContext2D
  cW: number
  hAt0: number
  hAt1: number
  theme: RulerTheme
  activeBox: ScreenBox | null
  objectBoxes: { box: ScreenBox; isActive: boolean }[]
  activeLabels?: RulerLabel[]
}

export function drawHorizontalRuler({
  ctx, cW, hAt0, hAt1, theme, activeBox, objectBoxes, activeLabels = [],
}: RulerHParams): void {
  ctx.save()

  ctx.beginPath()
  ctx.rect(RULER_SIZE, 0, cW - RULER_SIZE, RULER_SIZE)
  ctx.clip()

  ctx.fillStyle = theme.rulerBg
  ctx.fillRect(RULER_SIZE, 0, cW - RULER_SIZE, RULER_SIZE)

  ctx.fillStyle = theme.rulerBorder
  ctx.fillRect(RULER_SIZE, RULER_SIZE - 1, cW - RULER_SIZE, 1)

  if (activeBox && activeBox.x2 > RULER_SIZE && activeBox.x1 < cW) {
    const drawX1 = Math.max(activeBox.x1, RULER_SIZE)
    const drawX2 = Math.min(activeBox.x2, cW)
    ctx.fillStyle = "rgba(99,102,241,0.15)"
    ctx.fillRect(drawX1, 0, drawX2 - drawX1, RULER_SIZE - 1)
  }

  ctx.font = "8px system-ui, sans-serif"
  ctx.textAlign = "center"

  const range = axisRange(hAt0, hAt1, RULER_SIZE, cW)
  if (range) {
    for (let mm = range.start; mm <= range.end; mm += range.step) {
      const x = hAt0 + mm * (hAt1 - hAt0)
      if (x < RULER_SIZE || x > cW) continue
      const isMajor = mm % TICK_MAJOR === 0
      const tickH   = isMajor ? 7 : 4
      ctx.fillStyle = theme.rulerFg
      ctx.fillRect(x, RULER_SIZE - tickH, 1, tickH)
      if (isMajor) {
        ctx.fillStyle = theme.rulerText
        ctx.fillText(`${mm}`, x, 8)
      }
    }
  }

  for (const { box, isActive } of objectBoxes) {
    const thick = isActive ? 3 : 2
    const tickH = isActive ? 12 : 8
    for (const x of [box.x1, box.x2]) {
      if (x < RULER_SIZE - 0.5 || x > cW) continue
      ctx.fillStyle = isActive ? theme.markActive : theme.markColor
      ctx.fillRect(x - Math.floor(thick / 2), RULER_SIZE - tickH, thick, tickH)
    }
  }

  for (const label of activeLabels) {
    if (label.position >= RULER_SIZE && label.position <= cW) {
      drawHorizontalLabel(ctx, label, cW, theme)
    }
  }

  ctx.restore()

  ctx.fillStyle = theme.rulerBg
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE)
  ctx.fillStyle = theme.rulerBorder
  ctx.fillRect(RULER_SIZE - 1, 0, 1, RULER_SIZE)
  ctx.fillRect(0, RULER_SIZE - 1, RULER_SIZE, 1)

  ctx.fillStyle = theme.rulerText
  ctx.font = "7px system-ui"
  ctx.textAlign = "center"
  ctx.fillText("мм", RULER_SIZE / 2, RULER_SIZE / 2 + 3)
}

export interface RulerVParams {
  ctx: CanvasRenderingContext2D
  cH: number
  vAt0: number
  vAt1: number
  theme: RulerTheme
  activeBox: ScreenBox | null
  objectBoxes: { box: ScreenBox; isActive: boolean }[]
  activeLabels?: RulerLabel[]
}

export function drawVerticalRuler({
  ctx, cH, vAt0, vAt1, theme, activeBox, objectBoxes, activeLabels = [],
}: RulerVParams): void {
  ctx.save()

  ctx.beginPath()
  ctx.rect(0, RULER_SIZE, RULER_SIZE, cH - RULER_SIZE)
  ctx.clip()

  ctx.fillStyle = theme.rulerBg
  ctx.fillRect(0, RULER_SIZE, RULER_SIZE, cH - RULER_SIZE)

  ctx.fillStyle = theme.rulerBorder
  ctx.fillRect(RULER_SIZE - 1, RULER_SIZE, 1, cH - RULER_SIZE)

  if (activeBox && activeBox.y2 > RULER_SIZE && activeBox.y1 < cH) {
    const drawY1 = Math.max(activeBox.y1, RULER_SIZE)
    const drawY2 = Math.min(activeBox.y2, cH)
    ctx.fillStyle = "rgba(99,102,241,0.15)"
    ctx.fillRect(0, drawY1, RULER_SIZE - 1, drawY2 - drawY1)
  }

  ctx.font = "8px system-ui, sans-serif"
  ctx.textAlign = "right"

  const range = axisRange(vAt0, vAt1, RULER_SIZE, cH)
  if (range) {
    for (let mm = range.start; mm <= range.end; mm += range.step) {
      const y = vAt0 + mm * (vAt1 - vAt0)
      if (y < RULER_SIZE || y > cH) continue
      const isMajor = mm % TICK_MAJOR === 0
      const tickW   = isMajor ? 7 : 4
      ctx.fillStyle = theme.rulerFg
      ctx.fillRect(RULER_SIZE - tickW, y, tickW, 1)
      if (isMajor) {
        ctx.save()
        ctx.translate(9, y)
        ctx.rotate(-Math.PI / 2)
        ctx.fillStyle = theme.rulerText
        ctx.fillText(`${mm}`, 0, 0)
        ctx.restore()
      }
    }
  }

  for (const { box, isActive } of objectBoxes) {
    const thick = isActive ? 3 : 2
    const tickW = isActive ? 12 : 8
    for (const y of [box.y1, box.y2]) {
      if (y < RULER_SIZE - 0.5 || y > cH) continue
      ctx.fillStyle = isActive ? theme.markActive : theme.markColor
      ctx.fillRect(RULER_SIZE - tickW, y - Math.floor(thick / 2), tickW, thick)
    }
  }

  for (const label of activeLabels) {
    if (label.position >= RULER_SIZE && label.position <= cH) {
      drawVerticalLabel(ctx, label, cH, theme)
    }
  }

  ctx.restore()
}

export function computeAxisScreenPositions(params: {
  axis: "x" | "y"
  screenAxis: "x" | "y"
  so: StageOrigin
  offsetX: number
  offsetY: number
  stageW: number
  stageH: number
  zoom: number
  cosR: number
  sinR: number
  pxPerMm: number
}): { at0: number; at1: number } | null {
  const { axis, screenAxis, so, offsetX, offsetY, stageW, stageH, zoom, cosR, sinR, pxPerMm } = params
  const cx = stageW / 2
  const cy = stageH / 2

  // Проецируем точку из локальных координат холста в экранные с учётом поворота
  const projectPoint = (lx: number, ly: number) => {
    const sx = offsetX + lx
    const sy = offsetY + ly
    const dx = sx - cx
    const dy = sy - cy
    const rx = cx + dx * cosR - dy * sinR
    const ry = cy + dx * sinR + dy * cosR
    return {
      x: so.x + rx * zoom,
      y: so.y + ry * zoom,
    }
  }

  // Для оси X берём шаг (pxPerMm, 0), для оси Y — (0, pxPerMm).
  // После поворота выбираем одну составляющую. Нельзя переключаться между
  // составляющими на каждом кадре — это даёт скачок делений возле 45°.
  const p0 = projectPoint(0, 0)
  const p1 = projectPoint(axis === "x" ? pxPerMm : 0, axis === "y" ? pxPerMm : 0)

  if (screenAxis === "x") {
    if (Math.abs(p1.x - p0.x) < 1e-5) return null
    return { at0: p0.x, at1: p1.x }
  } else {
    if (Math.abs(p1.y - p0.y) < 1e-5) return null
    return { at0: p0.y, at1: p1.y }
  }
}