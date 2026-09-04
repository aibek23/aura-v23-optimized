"use client"

// ---------------------------------------------------------------------------
// Рабочая область редактора этикеток — Многослойный холст
// ---------------------------------------------------------------------------
import { useEffect, useRef, useCallback, useState, type RefObject } from "react"
import { ZoomIn, ZoomOut, Crosshair } from "lucide-react"
import { LabelBackground } from "./label-background"
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./label-editor.types"
import type { LabelSizeDef } from "@/lib/niimbot"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"

const RULER_SIZE = 18 
const TICK_MAJOR = 10 
const TICK_MINOR = 5 

function getPxPerMm(sizeDef: LabelSizeDef): number {
  const m = /T(\d+)x(\d+)(?:_(\d+))?/.exec(sizeDef.key)
  if (m) {
    const wmm = Number(m[1])
    if (wmm > 0) return sizeDef.w_px / wmm
  }
  return 8
}

function objBounds(o: FabricObject) {
  const left = o.left ?? 0
  const top = o.top ?? 0
  const w = o.getScaledWidth?.() ?? o.width ?? 0
  const h = o.getScaledHeight?.() ?? o.height ?? 0
  return { left, top, right: left + w, bottom: top + h }
}

function measurableObjects(canvas: FabricCanvas | null): FabricObject[] {
  if (!canvas) return []
  return canvas.getObjects().filter((o) => {
    if (o.visible === false) return false
    const role = (o as unknown as { data?: { role?: string } }).data?.role
    return role !== "bg"
  })
}

interface LabelEditorCanvasAreaProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  fabricRef: RefObject<FabricCanvas | null>
  sizeDef: LabelSizeDef
  stageW: number
  stageH: number
  offsetX: number
  offsetY: number
  zoom: number
  sizeKey: string
  onZoom: (delta: number) => void
}

export function LabelEditorCanvasArea({
  canvasRef,
  fabricRef,
  sizeDef,
  stageW,
  stageH,
  offsetX,
  offsetY,
  zoom,
  sizeKey,
  onZoom,
}: LabelEditorCanvasAreaProps) {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null)
  const rulerHRef = useRef<HTMLCanvasElement>(null)
  const rulerVRef = useRef<HTMLCanvasElement>(null)
  const guidesCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const stageLayerRef = useRef<HTMLDivElement>(null)
  const labelLayerRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const totalW = stageW
  const totalH = stageH

  // Начало координат самой этикетки на экране (строго 0,0 мм = левый верхний угол белой этикетки)
  // Вычисляется через pan, zoom, offsetX/offsetY — не через getBoundingClientRect,
  // чтобы значение было синхронным и не отставало от RAF.
  const getContainerLabelOrigin = useCallback((): { x: number; y: number } | null => {
    const el = containerRef.current
    if (!el) return null
    const { width: cW, height: cH } = el.getBoundingClientRect()
    // Viewport начинается после линейки
    const vW = cW - RULER_SIZE
    const vH = cH - RULER_SIZE
    // Центр stage в экранных координатах (с учётом pan)
    const stageCX = RULER_SIZE + vW / 2 + pan.x
    const stageCY = RULER_SIZE + vH / 2 + pan.y
    // Левый верхний угол stage (stage позиционируется через translate(-50%,-50%) + scale)
    const stageLeft = stageCX - (totalW / 2) * zoom
    const stageTop  = stageCY - (totalH / 2) * zoom
    // Левый верхний угол белой этикетки = stage + offsetX/offsetY (масштабированные)
    return {
      x: stageLeft + offsetX * zoom,
      y: stageTop  + offsetY * zoom,
    }
  }, [pan, zoom, totalW, totalH, offsetX, offsetY])

  // Начало координат всей подложки (stage) — левый верхний угол серого фона
  const getStageOrigin = useCallback((): { x: number; y: number } | null => {
    const el = containerRef.current
    if (!el) return null
    const { width: cW, height: cH } = el.getBoundingClientRect()
    const vW = cW - RULER_SIZE
    const vH = cH - RULER_SIZE
    const stageCX = RULER_SIZE + vW / 2 + pan.x
    const stageCY = RULER_SIZE + vH / 2 + pan.y
    return {
      x: stageCX - (totalW / 2) * zoom,
      y: stageCY - (totalH / 2) * zoom,
    }
  }, [pan, zoom, totalW, totalH])

  const prepareFixed = useCallback(
    (el: HTMLCanvasElement | null, w: number, h: number) => {
      if (!el) return null
      const ctx = el.getContext("2d")
      if (!ctx) return null
      const dpr = window.devicePixelRatio || 1
      const pw = Math.round(w * dpr)
      const ph = Math.round(h * dpr)
      if (el.width !== pw || el.height !== ph) {
        el.width = pw
        el.height = ph
        el.style.width = `${w}px`
        el.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      return ctx
    },
    [],
  )

  const prepareStatic = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (!el) return null
      const ctx = el.getContext("2d")
      if (!ctx) return null
      const dpr = window.devicePixelRatio || 1
      if (el.width !== totalW * dpr || el.height !== totalH * dpr) {
        el.width = totalW * dpr
        el.height = totalH * dpr
        el.style.width = `${totalW}px`
        el.style.height = `${totalH}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, totalW, totalH)
      return ctx
    },
    [totalW, totalH],
  )

  const drawStatic = useCallback(() => {
    const ctx = prepareStatic(staticCanvasRef.current)
    if (!ctx) return

    const isDark = document.documentElement.classList.contains("dark")
    const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"

    ctx.fillStyle = gridColor
    for (let gx = 0; gx < stageW; gx += 20) {
      for (let gy = 0; gy < stageH; gy += 20) {
        ctx.fillRect(gx, gy, 1.5, 1.5)
      }
    }
  }, [prepareStatic, stageW, stageH])

  const drawRulers = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width: cW, height: cH } = container.getBoundingClientRect()

    const isDark = document.documentElement.classList.contains("dark")
    const rulerBg     = isDark ? "#1e1e1e" : "#f4f4f5"
    const rulerBorder = isDark ? "#3f3f46" : "#d4d4d8"
    const rulerFg     = isDark ? "#71717a" : "#a1a1aa"
    const rulerText   = isDark ? "#a1a1aa" : "#52525b"
    const markColor   = isDark ? "rgba(244,244,245,0.85)" : "rgba(24,24,27,0.75)"
    const markActive  = "rgba(99,102,241,0.95)"

    const pxPerMm = getPxPerMm(sizeDef) * zoom
    const origin = getContainerLabelOrigin()
    const stageOrigin = getStageOrigin()
    const fabric = fabricRef.current
    const active = fabric?.getActiveObject() ?? null

    const isSameOrInside = (o: FabricObject) => {
      if (!active) return false
      if (o === active) return true
      const grp = active as unknown as { contains?: (x: FabricObject) => boolean }
      return typeof grp.contains === "function" ? Boolean(grp.contains(o)) : false
    }

    // ── Горизонтальная линейка (сверху) ──────────────────────────────────────
    const ctxH = prepareFixed(rulerHRef.current, cW, RULER_SIZE)
    if (ctxH && origin && stageOrigin) {
      ctxH.fillStyle = rulerBg
      ctxH.fillRect(0, 0, cW, RULER_SIZE)
      
      ctxH.fillStyle = rulerBg
      ctxH.fillRect(0, 0, RULER_SIZE, RULER_SIZE)

      ctxH.fillStyle = rulerBorder
      ctxH.fillRect(0, RULER_SIZE - 1, cW, 1)

      ctxH.font = "8px system-ui, sans-serif"
      ctxH.textAlign = "center"
      const startMm = Math.floor(-origin.x / pxPerMm / 5) * 5 - 5
      const endMm   = Math.ceil((cW - origin.x) / pxPerMm / 5) * 5 + 5

      for (let mm = startMm; mm <= endMm; mm += TICK_MINOR) {
        const x = origin.x + mm * pxPerMm
        if (x < RULER_SIZE || x > cW) continue
        const isMajor = mm % TICK_MAJOR === 0
        const tickH = isMajor ? 7 : 4
        ctxH.fillStyle = rulerFg
        ctxH.fillRect(x, RULER_SIZE - tickH, 1, tickH)
        if (isMajor) {
          ctxH.fillStyle = rulerText
          ctxH.fillText(`${mm}`, x, 8)
        }
      }

      // 1. Подсветка активного объекта
      if (active) {
        const b = objBounds(active)
        const x1 = origin.x + b.left * zoom
        const x2 = origin.x + b.right * zoom
        if (x2 > RULER_SIZE && x1 < cW) {
          const drawX1 = Math.max(x1, RULER_SIZE)
          const drawX2 = Math.min(x2, cW)
          ctxH.fillStyle = "rgba(99,102,241,0.15)"
          ctxH.fillRect(drawX1, 0, drawX2 - drawX1, RULER_SIZE - 1)
        }
      }

      // 2. Засечки всех объектов на линейке
      for (const o of measurableObjects(fabric)) {
        const isActive = isSameOrInside(o)
        const b = objBounds(o)
        const thick = isActive ? 2 : 1
        for (const px of [b.left, b.right]) {
          const x = origin.x + px * zoom
          if (x < RULER_SIZE - 0.5 || x > cW) continue
          ctxH.fillStyle = isActive ? markActive : markColor
          ctxH.fillRect(x - (thick - 1) / 2, RULER_SIZE - (isActive ? 10 : 7), thick, isActive ? 10 : 7)
        }
      }

      ctxH.fillStyle = rulerText
      ctxH.font = "7px system-ui"
      ctxH.textAlign = "center"
      ctxH.fillText("мм", RULER_SIZE / 2, RULER_SIZE / 2 + 3)
    }

    // ── Вертикальная линейка (слева) ──────────────────────────────────────────
    const ctxV = prepareFixed(rulerVRef.current, RULER_SIZE, cH)
    if (ctxV && origin && stageOrigin) {
      ctxV.fillStyle = rulerBg
      ctxV.fillRect(0, 0, RULER_SIZE, cH)

      ctxV.fillStyle = rulerBorder
      ctxV.fillRect(RULER_SIZE - 1, 0, 1, cH)

      ctxV.font = "8px system-ui, sans-serif"
      ctxV.textAlign = "right"
      const startMm = Math.floor(-origin.y / pxPerMm / 5) * 5 - 5
      const endMm   = Math.ceil((cH - origin.y) / pxPerMm / 5) * 5 + 5

      for (let mm = startMm; mm <= endMm; mm += TICK_MINOR) {
        const y = origin.y + mm * pxPerMm
        if (y < RULER_SIZE || y > cH) continue
        const isMajor = mm % TICK_MAJOR === 0
        const tickW = isMajor ? 7 : 4
        ctxV.fillStyle = rulerFg
        ctxV.fillRect(RULER_SIZE - tickW, y, tickW, 1)
        if (isMajor) {
          ctxV.save()
          ctxV.translate(9, y)
          ctxV.rotate(-Math.PI / 2)
          ctxV.fillStyle = rulerText
          ctxV.fillText(`${mm}`, 0, 0)
          ctxV.restore()
        }
      }

      // 1. Подсветка активного объекта
      if (active) {
        const b = objBounds(active)
        const y1 = origin.y + b.top * zoom
        const y2 = origin.y + b.bottom * zoom
        if (y2 > RULER_SIZE && y1 < cH) {
          const drawY1 = Math.max(y1, RULER_SIZE)
          const drawY2 = Math.min(y2, cH)
          ctxV.fillStyle = "rgba(99,102,241,0.15)"
          ctxV.fillRect(0, drawY1, RULER_SIZE - 1, drawY2 - drawY1)
        }
      }

      // 2. Засечки всех объектов на линейке
      for (const o of measurableObjects(fabric)) {
        const isActive = isSameOrInside(o)
        const b = objBounds(o)
        const thick = isActive ? 2 : 1
        for (const py of [b.top, b.bottom]) {
          const y = origin.y + py * zoom
          if (y < RULER_SIZE - 0.5 || y > cH) continue
          ctxV.fillStyle = isActive ? markActive : markColor
          ctxV.fillRect(RULER_SIZE - (isActive ? 10 : 7), y - (thick - 1) / 2, isActive ? 10 : 7, thick)
        }
      }
    }
  }, [prepareFixed, sizeDef, zoom, fabricRef, getContainerLabelOrigin, getStageOrigin])

  const drawEdgeIndicators = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width: cW, height: cH } = container.getBoundingClientRect()

    const el = guidesCanvasRef.current
    if (!el) return
    const ctx = prepareFixed(el, cW, cH)
    if (!ctx) return

    const fabric = fabricRef.current
    const activeObj = fabric?.getActiveObject()
    if (!activeObj) return

    const origin = getContainerLabelOrigin()
    if (!origin) return

    const b = objBounds(activeObj)
    const accent = "rgba(99,102,241,0.95)"
    const accentSoft = "rgba(99,102,241,0.45)"
    const pxPerMm = getPxPerMm(sizeDef)

    const leftMm = b.left / pxPerMm
    const rightMm = b.right / pxPerMm
    const topMm = b.top / pxPerMm
    const bottomMm = b.bottom / pxPerMm

    const labelRight = origin.x + sizeDef.w_px * zoom
    const labelBottom = origin.y + sizeDef.h_px * zoom

    ctx.save()
    ctx.font = "8px system-ui, sans-serif"
    ctx.textAlign = "center"

    // ── Вертикальные направляющие ──
    for (const mm of [leftMm, rightMm]) {
      const x = origin.x + mm * pxPerMm * zoom
      if (x < RULER_SIZE || x > cW) continue
      const labelStr = mm.toFixed(1)
      const tw = ctx.measureText(labelStr).width + 6

      ctx.strokeStyle = accentSoft
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, RULER_SIZE)
      ctx.lineTo(x, Math.min(labelBottom, cH))
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = accent
      ctx.fillRect(x - tw / 2, 2, tw, 11)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(labelStr, x, 10)
    }

    // ── Горизонтальные направляющие ──
    for (const mm of [topMm, bottomMm]) {
      const y = origin.y + mm * pxPerMm * zoom
      if (y < RULER_SIZE || y > cH) continue
      const labelStr = mm.toFixed(1)

      ctx.strokeStyle = accentSoft
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(RULER_SIZE, y)
      ctx.lineTo(Math.min(labelRight, cW), y)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = accent
      ctx.fillRect(1, y - 5.5, RULER_SIZE - 2, 11)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(labelStr, RULER_SIZE / 2, y + 3)
    }

    ctx.restore()
  }, [prepareFixed, sizeDef, zoom, fabricRef, getContainerLabelOrigin])

  useEffect(() => {
    drawStatic()
    drawRulers()
    const redrawAll = () => { drawStatic(); drawRulers() }
    const observer = new MutationObserver(redrawAll)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    let ro: ResizeObserver | null = null
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => { drawStatic(); drawRulers(); drawEdgeIndicators() })
      ro.observe(containerRef.current)
    }
    window.addEventListener("resize", redrawAll)
    const t1 = window.setTimeout(redrawAll, 60)
    const t2 = window.setTimeout(redrawAll, 300)

    return () => {
      observer.disconnect()
      ro?.disconnect()
      window.removeEventListener("resize", redrawAll)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [drawStatic, drawRulers, drawEdgeIndicators])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      drawRulers()
      drawEdgeIndicators()
    })
    return () => cancelAnimationFrame(id)
  }, [pan, zoom, offsetX, offsetY, sizeKey, drawRulers, drawEdgeIndicators])

  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return

    // Убираем clipPath — элементы за пределами этикетки остаются видимы
    fabric.clipPath = undefined
    fabric.preserveObjectStacking = true

    const redraw = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        drawRulers()
        drawEdgeIndicators()
      })
    }
    const clearGuides = () => {
      const container = containerRef.current
      if (container) {
        const { width: cW, height: cH } = container.getBoundingClientRect()
        prepareFixed(guidesCanvasRef.current, cW, cH)
      }
      drawRulers()
    }
    const events = [
      "object:moving", "object:scaling", "object:rotating", "object:modified",
      "object:added", "object:removed",
      "selection:created", "selection:updated",
    ] as const
    events.forEach((ev) => fabric.on(ev, redraw))
    fabric.on("selection:cleared", clearGuides)
    redraw()
    return () => {
      events.forEach((ev) => fabric.off(ev, redraw))
      fabric.off("selection:cleared", clearGuides)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [fabricRef, drawRulers, drawEdgeIndicators, prepareFixed, sizeKey])

  const onPanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest("[data-fabric-layer]")) return
    panStartRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [pan.x, pan.y])

  const onPanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (!start) return
    setPan({ x: start.x + (e.clientX - start.px), y: start.y + (e.clientY - start.py) })
  }, [])

  const onPanPointerUp = useCallback(() => { panStartRef.current = null }, [])
  const resetView = useCallback(() => setPan({ x: 0, y: 0 }), [])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: "linear-gradient(135deg, #a1a1aa 0%, #d4d4d8 50%, #e4e4e7 100%)" }}
    >
      <div
        ref={viewportRef}
        className="absolute cursor-grab active:cursor-grabbing"
        style={{ inset: 0, top: RULER_SIZE, left: RULER_SIZE, touchAction: "none" }}
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        onPointerCancel={onPanPointerUp}
      >
        <div
          ref={stageLayerRef}
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0) scale(${zoom})`,
            transformOrigin: "center center",
            width: totalW,
            height: totalH,
            // Критично: снимаем обрезание на stageLayer,
            // чтобы элементы холста, выходящие за границы этикетки,
            // оставались видимыми и доступными для взаимодействия.
            overflow: "visible",
          }}
        >
          <canvas ref={staticCanvasRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 1 }} />
          {/* Белая этикетка — ref=labelLayerRef, именно отсюда берём origin (0,0) мм */}
          <div
            ref={labelLayerRef}
            className="absolute pointer-events-none"
            style={{ top: offsetY, left: offsetX, zIndex: 2, overflow: "visible" }}
          >
            <LabelBackground sizeDef={sizeDef} style={{ position: "absolute", top: 0, left: 0 }} />
          </div>

          {/* Слой Fabric.js покрывает ВЕСЬ stage (stageW × stageH),
              начиная от (0,0) stage, чтобы рамки выделения элементов
              не обрезались по границам этикетки */}
          <div
            data-fabric-layer
            className="absolute"
            style={{
              top: 0,
              left: 0,
              width: stageW,
              height: stageH,
              zIndex: 3,
              touchAction: "none",
              overflow: "visible",
            }}
          >
            <canvas ref={canvasRef} style={{ display: "block", overflow: "visible" }} />
          </div>
        </div>
      </div>

      <canvas ref={rulerHRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 22, width: "100%", height: RULER_SIZE }} />
      <canvas ref={rulerVRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 21, width: RULER_SIZE, height: "100%" }} />
      <canvas ref={guidesCanvasRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 23 }} />

      <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-1">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/20 bg-black/35 px-1 py-0.5 backdrop-blur-md shadow-lg">
          <button type="button" onClick={() => onZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-9 select-none text-center font-mono text-[10px] text-white/95">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => onZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30">
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <button type="button" onClick={resetView} className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white">
            <Crosshair className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}