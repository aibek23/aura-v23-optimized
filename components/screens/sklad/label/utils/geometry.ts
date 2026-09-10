// ---------------------------------------------------------------------------
// Геометрические утилиты: проекция координат, матрицы, границы объектов
// Чистые функции — нет зависимостей от React или Fabric.
// ---------------------------------------------------------------------------
import type { FabricObject } from "fabric"

// ── Матрица аффинного поворота ────────────────────────────────────────────────
/** Аффинная матрица поворота вокруг центра (cx, cy) на angleDeg градусов. */
export function makeRotationMatrix(
  angleDeg: number,
  cx: number,
  cy: number,
): [number, number, number, number, number, number] {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const tx  = cx - cos * cx + sin * cy
  const ty  = cy - sin * cx - cos * cy
  return [cos, sin, -sin, cos, tx, ty]
}

// ── Проекция точки этикетки в экранные координаты ────────────────────────────
export interface StageOrigin { x: number; y: number }

/**
 * Проецирует точку (x, y) в системе координат этикетки в экранные координаты
 * с учётом поворота `rotationDeg` вокруг центра stage.
 */
export function labelPxToScreen(
  x: number,
  y: number,
  so: StageOrigin,
  offsetX: number,
  offsetY: number,
  stageW: number,
  stageH: number,
  rotationDeg: number,
  zoom: number,
  cosR: number,
  sinR: number,
): { x: number; y: number } {
  const sx  = offsetX + x
  const sy  = offsetY + y
  const cx  = stageW / 2
  const cy  = stageH / 2
  const dx  = sx - cx
  const dy  = sy - cy
  const rx  = cx + dx * cosR - dy * sinR
  const ry  = cy + dx * sinR + dy * cosR
  return { x: so.x + rx * zoom, y: so.y + ry * zoom }
}

/** Прямое преобразование координат рабочей области в экранные. */
export function stageToScreen(
  x: number,
  y: number,
  so: StageOrigin,
  zoom: number,
  cosR: number,
  sinR: number,
  stageW: number,
  stageH: number,
): { x: number; y: number } {
  const cx = stageW / 2
  const cy = stageH / 2
  const dx = x - cx
  const dy = y - cy
  return {
    x: so.x + (cx + dx * cosR - dy * sinR) * zoom,
    y: so.y + (cy + dx * sinR + dy * cosR) * zoom,
  }
}

/** Обратное преобразование экранной точки в координаты рабочей области. */
export function screenToStage(
  x: number,
  y: number,
  so: StageOrigin,
  zoom: number,
  cosR: number,
  sinR: number,
  stageW: number,
  stageH: number,
): { x: number; y: number } {
  const cx = stageW / 2
  const cy = stageH / 2
  const dx = (x - so.x) / Math.max(zoom, 1e-6) - cx
  const dy = (y - so.y) / Math.max(zoom, 1e-6) - cy
  return {
    x: cx + dx * cosR + dy * sinR,
    y: cy - dx * sinR + dy * cosR,
  }
}

/** Экранная точка в локальные координаты объекта/этикетки. */
export function screenToLabelPx(
  x: number,
  y: number,
  so: StageOrigin,
  offsetX: number,
  offsetY: number,
  stageW: number,
  stageH: number,
  zoom: number,
  cosR: number,
  sinR: number,
): { x: number; y: number } {
  const p = screenToStage(x, y, so, zoom, cosR, sinR, stageW, stageH)
  return { x: p.x - offsetX, y: p.y - offsetY }
}

// ── Кеш тригонометрии ─────────────────────────────────────────────────────────
export interface TrigCache {
  cos: number
  sin: number
  deg: number
}

export function makeTrigCache(rotationDeg: number): TrigCache {
  const rad = (rotationDeg * Math.PI) / 180
  return { cos: Math.cos(rad), sin: Math.sin(rad), deg: rotationDeg }
}

// ── Габариты объекта Fabric ───────────────────────────────────────────────────
export interface ObjBounds {
  left:   number
  top:    number
  right:  number
  bottom: number
}

export function getFabricBounds(o: FabricObject): ObjBounds {
  try {
    const br = o.getBoundingRect()
    return {
      left:   br.left,
      top:    br.top,
      right:  br.left + br.width,
      bottom: br.top  + br.height,
    }
  } catch {
    const left = o.left  ?? 0
    const top  = o.top   ?? 0
    const w    = (o as unknown as { getScaledWidth?: () => number }).getScaledWidth?.() ?? o.width  ?? 0
    const h    = (o as unknown as { getScaledHeight?: () => number }).getScaledHeight?.() ?? o.height ?? 0
    return { left, top, right: left + w, bottom: top + h }
  }
}

export interface FabricCornerPoints {
  tl: { x: number; y: number }
  tr: { x: number; y: number }
  br: { x: number; y: number }
  bl: { x: number; y: number }
}

/** Реальные углы объекта, а не AABB — это важно для повернутых элементов. */
export function getFabricCorners(o: FabricObject): FabricCornerPoints {
  const coords = (o as unknown as { aCoords?: FabricCornerPoints }).aCoords
  if (coords?.tl && coords.tr && coords.br && coords.bl) return coords

  const b = getFabricBounds(o)
  return {
    tl: { x: b.left, y: b.top },
    tr: { x: b.right, y: b.top },
    br: { x: b.right, y: b.bottom },
    bl: { x: b.left, y: b.bottom },
  }
}

// ── Экранный AABB объекта с учётом поворота холста ──────────────────────────
export interface ScreenBox {
  x1: number; x2: number
  y1: number; y2: number
}

export function objScreenBox(
  o: FabricObject,
  so: StageOrigin,
  offsetX: number,
  offsetY: number,
  stageW: number,
  stageH: number,
  zoom: number,
  cosR: number,
  sinR: number,
): ScreenBox | null {
  const corners = getFabricCorners(o)
  // Собираем массив углов явно или через Object.values:
  const ptsList = [corners.tl, corners.tr, corners.br, corners.bl]
  const pts = ptsList.map((p) => [offsetX + p.x, offsetY + p.y] as [number, number])

  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity
  for (let i = 0; i < 4; i++) {
    const p = stageToScreen(pts[i][0], pts[i][1], so, zoom, cosR, sinR, stageW, stageH)
    const sx = p.x
    const sy = p.y
    if (sx < x1) x1 = sx
    if (sx > x2) x2 = sx
    if (sy < y1) y1 = sy
    if (sy > y2) y2 = sy
  }
  if (!isFinite(x1)) return null
  return { x1, x2, y1, y2 }
}

// ── Начало координат stage ────────────────────────────────────────────────────
// Исправлено: stageCX / stageCY теперь учитывают RULER_SIZE-смещение,
// соответствуя логике useCanvasTransform (tx = stageCX - totalW/2 * zoom).
// so.x = tx = stageCX - totalW/2 * zoom
export function computeStageOrigin(
  containerW: number,
  containerH: number,
  rulerSize: number,
  panX: number,
  panY: number,
  totalW: number,
  totalH: number,
  zoom: number,
): StageOrigin {
  // Размеры stage передаются вместе с полосой линеек. Сам Fabric canvas уже
  // расположен после неё, поэтому экранное начало stage включает rulerSize
  // ровно один раз и не зависит от размеров внешнего контейнера.
  const stageW = totalW - rulerSize
  const stageH = totalH - rulerSize
  const stageCX = rulerSize + stageW / 2 + panX
  const stageCY = rulerSize + stageH / 2 + panY
  return {
    x: stageCX - (stageW / 2) * zoom,
    y: stageCY - (stageH / 2) * zoom,
  }
}

// ── Пикселей на мм ────────────────────────────────────────────────────────────
export function getPxPerMm(key: string, w_px: number): number {
  const m = /T(\d+)x(\d+)(?:_(\d+))?/.exec(key)
  if (m) {
    const wmm = Number(m[1])
    if (wmm > 0) return w_px / wmm
  }
  return 8
}
