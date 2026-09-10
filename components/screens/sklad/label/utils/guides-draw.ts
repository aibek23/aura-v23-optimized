// ---------------------------------------------------------------------------
// Чистые функции отрисовки направляющих активного объекта
// ---------------------------------------------------------------------------
import { RULER_SIZE } from "../constants"

const ACCENT      = "rgba(37,99,235,0.96)"
const ACCENT_SOFT = "rgba(37,99,235,0.88)"

// Толщина вспомогательных линий: на мобильных экранах (узкий вьюпорт /
// touch-указатель / высокий DPR) 2.25px выглядит жирной полосой, поэтому
// сводим её к «волосяной» линии, кратной физическому пикселю.
function getGuideMetrics(): { lineWidth: number; dash: [number, number] } {
  if (typeof window === "undefined") return { lineWidth: 2.25, dash: [8, 5] }
  const dpr     = window.devicePixelRatio || 1
  const coarse  = window.matchMedia?.("(pointer: coarse)").matches ?? false
  const narrow  = window.innerWidth <= 768
  if (coarse || narrow) {
    return { lineWidth: Math.max(0.75, 1 / dpr), dash: [6, 4] }
  }
  return { lineWidth: dpr >= 2 ? 1.25 : 2.25, dash: [8, 5] }
}

export interface GuideLine {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
  mm: number
  labelAt?: { x: number; y: number }
  showLabel?: boolean
}

export interface ManualGuide {
  axis: "x" | "y"
  position: number
}

export function drawGuides(
  ctx: CanvasRenderingContext2D,
  cW: number,
  cH: number,
  _labelLeft: number,
  _labelRight: number,
  _labelTop: number,
  _labelBottom: number,
  guides: GuideLine[],
): void {
  ctx.save()
  const { lineWidth, dash } = getGuideMetrics()
  ctx.font = "8px system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.beginPath()
  ctx.rect(RULER_SIZE, RULER_SIZE, cW - RULER_SIZE, cH - RULER_SIZE)
  ctx.clip()

  for (const g of guides) {
    ctx.strokeStyle = ACCENT_SOFT
    ctx.lineWidth   = lineWidth
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(g.p1.x, g.p1.y)
    ctx.lineTo(g.p2.x, g.p2.y)
    ctx.stroke()
    ctx.setLineDash([])

    if (g.showLabel !== false) {
      const labelStr = g.mm.toFixed(1)
      const at = g.labelAt ?? {
        x: (g.p1.x + g.p2.x) / 2,
        y: (g.p1.y + g.p2.y) / 2,
      }
      const tw = ctx.measureText(labelStr).width + 8
      ctx.fillStyle = ACCENT
      ctx.fillRect(at.x - tw / 2, at.y - 8, tw, 13)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(labelStr, at.x, at.y + 2)
    }
  }

  ctx.restore()
}

export function buildGuideEdges(
  objEdgeScreenPts: {
    left:   { top: { x: number; y: number }; bottom: { x: number; y: number } } | null
    right:  { top: { x: number; y: number }; bottom: { x: number; y: number } } | null
    top:    { left: { x: number; y: number }; right: { x: number; y: number } } | null
    bottom: { left: { x: number; y: number }; right: { x: number; y: number } } | null
  },
  objEdgeMm: {
    left: number; right: number; top: number; bottom: number
  },
): GuideLine[] {
  const guides: GuideLine[] = []

  const push = (
    p1: { x: number; y: number } | null,
    p2: { x: number; y: number } | null,
    mm: number,
  ) => {
    if (!p1 || !p2) return
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) return
    const ux = dx / length
    const uy = dy / length
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    // Продлеваем грань за пределы объекта. Canvas clip в drawGuides
    // оставит только видимую часть, сохраняя точный угол повернутой грани.
    guides.push({
      p1: { x: cx - ux * 10000, y: cy - uy * 10000 },
      p2: { x: cx + ux * 10000, y: cy + uy * 10000 },
      mm,
      labelAt: { x: cx, y: cy },
      showLabel: false,
    })
  }

  push(objEdgeScreenPts.left?.top    ?? null, objEdgeScreenPts.left?.bottom ?? null, objEdgeMm.left)
  push(objEdgeScreenPts.right?.top   ?? null, objEdgeScreenPts.right?.bottom ?? null, objEdgeMm.right)
  push(objEdgeScreenPts.top?.left    ?? null, objEdgeScreenPts.top?.right    ?? null, objEdgeMm.top)
  push(objEdgeScreenPts.bottom?.left ?? null, objEdgeScreenPts.bottom?.right ?? null, objEdgeMm.bottom)

  return guides
}
