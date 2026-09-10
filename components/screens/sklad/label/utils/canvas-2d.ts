// ---------------------------------------------------------------------------
// Утилиты 2D-контекста: подготовка canvas, паттерн сетки
// Чистые функции — нет зависимостей от React или Fabric.
// ---------------------------------------------------------------------------

/**
 * Настраивает canvas фиксированного размера с учётом DPR.
 * Возвращает 2D-контекст с установленной трансформацией и очищенным полотном,
 * или null если не удалось получить контекст.
 */
export function prepareFixed(
  el: HTMLCanvasElement | null,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  if (!el) return null
  const ctx = el.getContext("2d")
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  const pw  = Math.round(w * dpr)
  const ph  = Math.round(h * dpr)
  if (el.width !== pw || el.height !== ph) {
    el.width  = pw
    el.height = ph
    el.style.width  = `${w}px`
    el.style.height = `${h}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

/**
 * Настраивает canvas статического слоя (stage) с учётом DPR.
 */
export function prepareStatic(
  el: HTMLCanvasElement | null,
  totalW: number,
  totalH: number,
): CanvasRenderingContext2D | null {
  if (!el) return null
  const ctx = el.getContext("2d")
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  const pw  = Math.round(totalW * dpr)
  const ph  = Math.round(totalH * dpr)
  if (el.width !== pw || el.height !== ph) {
    el.width  = pw
    el.height = ph
    el.style.width  = `${totalW}px`
    el.style.height = `${totalH}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, totalW, totalH)
  return ctx
}

/**
 * Создаёт паттерн сетки для `fillStyle` — один `fillRect` вместо тысяч.
 * Паттерн кешируется вызывающей стороной по ключу `${color}`.
 */
export function createGridPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  step = 20,
  dotSize = 1.5,
): CanvasPattern | null {
  const off = document.createElement("canvas")
  off.width  = step
  off.height = step
  const oc = off.getContext("2d")
  if (!oc) return null
  oc.fillStyle = color
  oc.fillRect(0, 0, dotSize, dotSize)
  return ctx.createPattern(off, "repeat")
}
