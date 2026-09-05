"use client"

// ---------------------------------------------------------------------------
// Рабочая область редактора этикеток — Многослойный холст
// ---------------------------------------------------------------------------
import { useEffect, useRef, useCallback, useState, type RefObject } from "react"
import { ZoomIn, ZoomOut, Crosshair, Hand } from "lucide-react"
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

// ИСПРАВЛЕНО: getBoundingRect() учитывает угол поворота объекта
function objBounds(o: FabricObject) {
  try {
    const br = o.getBoundingRect()
    return {
      left: br.left,
      top: br.top,
      right: br.left + br.width,
      bottom: br.top + br.height,
    }
  } catch {
    const left = o.left ?? 0
    const top = o.top ?? 0
    const w = o.getScaledWidth?.() ?? o.width ?? 0
    const h = o.getScaledHeight?.() ?? o.height ?? 0
    return { left, top, right: left + w, bottom: top + h }
  }
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
  rotation?: number
  onZoom: (delta: number) => void
  /** Прямая установка масштаба (жест «щипок» двумя пальцами) */
  onZoomTo?: (zoom: number) => void
}

// Матрица поворота вокруг центра (cx, cy) на angle градусов
function makeRotationMatrix(angleDeg: number, cx: number, cy: number): [number, number, number, number, number, number] {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Аффинная матрица: сдвиг в центр → поворот → сдвиг обратно
  const tx = cx - cos * cx + sin * cy
  const ty = cy - sin * cx - cos * cy
  return [cos, sin, -sin, cos, tx, ty]
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
  rotation = 0,
  onZoom,
  onZoomTo,
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

  // Режим инструмента «Рука»: все касания двигают холст, объекты не выделяются
  const [isPanMode, setIsPanMode] = useState(false)
  const isPanModeRef = useRef(false)
  isPanModeRef.current = isPanMode

  const totalW = stageW
  const totalH = stageH


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

  // ── Преобразование координат этикетки (px в системе Fabric/этикетки)
  //    в экранные координаты контейнера С УЧЁТОМ поворота холста ──────────────
  // Порядок: точка этикетки → координаты stage (+offset) → поворот вокруг
  // центра stage на `rotation` → масштаб zoom → смещение начала stage на экране.
  const labelPxToScreen = useCallback(
    (x: number, y: number): { x: number; y: number } | null => {
      const so = getStageOrigin()
      if (!so) return null
      const sx = offsetX + x
      const sy = offsetY + y
      const cx = totalW / 2
      const cy = totalH / 2
      const rad = (rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = sx - cx
      const dy = sy - cy
      const rx = cx + dx * cos - dy * sin
      const ry = cy + dx * sin + dy * cos
      return { x: so.x + rx * zoom, y: so.y + ry * zoom }
    },
    [getStageOrigin, offsetX, offsetY, totalW, totalH, rotation, zoom],
  )

  // Нормализованный угол 0..359
  const rotNorm = ((rotation % 360) + 360) % 360

  // Какая ось этикетки идёт вдоль экранной горизонтали/вертикали
  const horizontalAxis: "x" | "y" = rotNorm % 180 === 0 ? "x" : "y"
  const verticalAxis: "x" | "y" = rotNorm % 180 === 0 ? "y" : "x"

  // Экранный габарит объекта с учётом поворота холста
  const objScreenBox = useCallback(
    (o: FabricObject) => {
      const b = objBounds(o)
      const pts = [
        labelPxToScreen(b.left, b.top),
        labelPxToScreen(b.right, b.top),
        labelPxToScreen(b.right, b.bottom),
        labelPxToScreen(b.left, b.bottom),
      ].filter(Boolean) as { x: number; y: number }[]
      if (pts.length < 4) return null
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      return {
        x1: Math.min(...xs),
        x2: Math.max(...xs),
        y1: Math.min(...ys),
        y2: Math.max(...ys),
      }
    },
    [labelPxToScreen],
  )

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

    const pxPerMm = getPxPerMm(sizeDef)
    const stageOrigin = getStageOrigin()
    const fabric = fabricRef.current
    const active = fabric?.getActiveObject() ?? null

    const isSameOrInside = (o: FabricObject) => {
      if (!active) return false
      if (o === active) return true
      const grp = active as unknown as { contains?: (x: FabricObject) => boolean }
      return typeof grp.contains === "function" ? Boolean(grp.contains(o)) : false
    }

    // Точка этикетки для значения мм вдоль выбранной оси
    const axisPoint = (axis: "x" | "y", mm: number) =>
      axis === "x" ? { x: mm * pxPerMm, y: 0 } : { x: 0, y: mm * pxPerMm }

    // Экранная координата (screenAxis) для значения мм вдоль оси этикетки
    const axisScreen = (axis: "x" | "y", screenAxis: "x" | "y", mm: number) => {
      const p = axisPoint(axis, mm)
      const s = labelPxToScreen(p.x, p.y)
      return s ? s[screenAxis] : null
    }

    // Диапазон мм, попадающий на видимую часть линейки
    const axisRange = (
      axis: "x" | "y",
      screenAxis: "x" | "y",
      from: number,
      to: number,
    ): { start: number; end: number; step: number } | null => {
      const at0 = axisScreen(axis, screenAxis, 0)
      const at1 = axisScreen(axis, screenAxis, 1)
      if (at0 === null || at1 === null) return null
      const perMm = at1 - at0
      if (Math.abs(perMm) < 1e-6) return null
      const mmA = (from - at0) / perMm
      const mmB = (to - at0) / perMm
      const lo = Math.min(mmA, mmB)
      const hi = Math.max(mmA, mmB)
      return {
        start: Math.floor(lo / 5) * 5 - 5,
        end: Math.ceil(hi / 5) * 5 + 5,
        step: TICK_MINOR,
      }
    }

    // ── Горизонтальная линейка (сверху) ──────────────────────────────────────
    const ctxH = prepareFixed(rulerHRef.current, cW, RULER_SIZE)
    if (ctxH && stageOrigin) {
      ctxH.fillStyle = rulerBg
      ctxH.fillRect(0, 0, cW, RULER_SIZE)

      ctxH.fillStyle = rulerBg
      ctxH.fillRect(0, 0, RULER_SIZE, RULER_SIZE)

      ctxH.fillStyle = rulerBorder
      ctxH.fillRect(0, RULER_SIZE - 1, cW, 1)

      ctxH.font = "8px system-ui, sans-serif"
      ctxH.textAlign = "center"

      const range = axisRange(horizontalAxis, "x", RULER_SIZE, cW)
      if (range) {
        for (let mm = range.start; mm <= range.end; mm += range.step) {
          const x = axisScreen(horizontalAxis, "x", mm)
          if (x === null || x < RULER_SIZE || x > cW) continue
          const isMajor = mm % TICK_MAJOR === 0
          const tickH = isMajor ? 7 : 4
          ctxH.fillStyle = rulerFg
          ctxH.fillRect(x, RULER_SIZE - tickH, 1, tickH)
          if (isMajor) {
            ctxH.fillStyle = rulerText
            ctxH.fillText(`${mm}`, x, 8)
          }
        }
      }

      // 1. Подсветка активного объекта (экранный габарит с учётом поворота)
      if (active) {
        const box = objScreenBox(active)
        if (box && box.x2 > RULER_SIZE && box.x1 < cW) {
          const drawX1 = Math.max(box.x1, RULER_SIZE)
          const drawX2 = Math.min(box.x2, cW)
          ctxH.fillStyle = "rgba(99,102,241,0.15)"
          ctxH.fillRect(drawX1, 0, drawX2 - drawX1, RULER_SIZE - 1)
        }
      }

      // 2. Засечки всех объектов на линейке
      for (const o of measurableObjects(fabric)) {
        const isActive = isSameOrInside(o)
        const box = objScreenBox(o)
        if (!box) continue
        const thick = isActive ? 2 : 1
        for (const x of [box.x1, box.x2]) {
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
    if (ctxV && stageOrigin) {
      ctxV.fillStyle = rulerBg
      ctxV.fillRect(0, 0, RULER_SIZE, cH)

      ctxV.fillStyle = rulerBorder
      ctxV.fillRect(RULER_SIZE - 1, 0, 1, cH)

      ctxV.font = "8px system-ui, sans-serif"
      ctxV.textAlign = "right"

      const range = axisRange(verticalAxis, "y", RULER_SIZE, cH)
      if (range) {
        for (let mm = range.start; mm <= range.end; mm += range.step) {
          const y = axisScreen(verticalAxis, "y", mm)
          if (y === null || y < RULER_SIZE || y > cH) continue
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
      }

      // 1. Подсветка активного объекта
      if (active) {
        const box = objScreenBox(active)
        if (box && box.y2 > RULER_SIZE && box.y1 < cH) {
          const drawY1 = Math.max(box.y1, RULER_SIZE)
          const drawY2 = Math.min(box.y2, cH)
          ctxV.fillStyle = "rgba(99,102,241,0.15)"
          ctxV.fillRect(0, drawY1, RULER_SIZE - 1, drawY2 - drawY1)
        }
      }

      // 2. Засечки всех объектов на линейке
      for (const o of measurableObjects(fabric)) {
        const isActive = isSameOrInside(o)
        const box = objScreenBox(o)
        if (!box) continue
        const thick = isActive ? 2 : 1
        for (const y of [box.y1, box.y2]) {
          if (y < RULER_SIZE - 0.5 || y > cH) continue
          ctxV.fillStyle = isActive ? markActive : markColor
          ctxV.fillRect(RULER_SIZE - (isActive ? 10 : 7), y - (thick - 1) / 2, isActive ? 10 : 7, thick)
        }
      }
    }
  }, [
    prepareFixed,
    sizeDef,
    fabricRef,
    getStageOrigin,
    labelPxToScreen,
    objScreenBox,
    horizontalAxis,
    verticalAxis,
  ])

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

    // getBoundingRect() — реальные края объекта в координатах этикетки
    const b = objBounds(activeObj)
    const accent = "rgba(99,102,241,0.95)"
    const accentSoft = "rgba(99,102,241,0.45)"
    const pxPerMm = getPxPerMm(sizeDef)

    // Габариты самой этикетки на экране (с учётом поворота) —
    // ограничивают длину направляющих линий
    const labelCorners = [
      labelPxToScreen(0, 0),
      labelPxToScreen(sizeDef.w_px, 0),
      labelPxToScreen(sizeDef.w_px, sizeDef.h_px),
      labelPxToScreen(0, sizeDef.h_px),
    ].filter(Boolean) as { x: number; y: number }[]
    if (labelCorners.length < 4) return
    const labelLeft   = Math.min(...labelCorners.map((p) => p.x))
    const labelRight  = Math.max(...labelCorners.map((p) => p.x))
    const labelTop    = Math.min(...labelCorners.map((p) => p.y))
    const labelBottom = Math.max(...labelCorners.map((p) => p.y))

    // Каждое ребро габарита объекта переводим в экран целиком:
    // после поворота на 90/270° «левое» ребро этикетки может стать
    // горизонтальной линией на экране — учитываем это.
    type Guide = { orientation: "v" | "h"; pos: number; mm: number }
    const guides: Guide[] = []

    const pushEdge = (
      p1: { x: number; y: number } | null,
      p2: { x: number; y: number } | null,
      mm: number,
    ) => {
      if (!p1 || !p2) return
      const dx = Math.abs(p1.x - p2.x)
      const dy = Math.abs(p1.y - p2.y)
      if (dx <= dy) guides.push({ orientation: "v", pos: (p1.x + p2.x) / 2, mm })
      else guides.push({ orientation: "h", pos: (p1.y + p2.y) / 2, mm })
    }

    // Вертикальные рёбра этикетки (x = left/right)
    for (const px of [b.left, b.right]) {
      pushEdge(labelPxToScreen(px, b.top), labelPxToScreen(px, b.bottom), px / pxPerMm)
    }
    // Горизонтальные рёбра этикетки (y = top/bottom)
    for (const py of [b.top, b.bottom]) {
      pushEdge(labelPxToScreen(b.left, py), labelPxToScreen(b.right, py), py / pxPerMm)
    }

    ctx.save()
    ctx.font = "8px system-ui, sans-serif"
    ctx.textAlign = "center"

    for (const g of guides) {
      const labelStr = g.mm.toFixed(1)

      if (g.orientation === "v") {
        const x = g.pos
        if (x < RULER_SIZE || x > cW) continue
        const tw = ctx.measureText(labelStr).width + 6

        ctx.strokeStyle = accentSoft
        ctx.lineWidth = 0.75
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(x, Math.max(RULER_SIZE, Math.min(labelTop, cH)))
        ctx.lineTo(x, Math.min(labelBottom, cH))
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = accent
        ctx.fillRect(x - tw / 2, 2, tw, 11)
        ctx.fillStyle = "#ffffff"
        ctx.fillText(labelStr, x, 10)
      } else {
        const y = g.pos
        if (y < RULER_SIZE || y > cH) continue

        ctx.strokeStyle = accentSoft
        ctx.lineWidth = 0.75
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(Math.max(RULER_SIZE, Math.min(labelLeft, cW)), y)
        ctx.lineTo(Math.min(labelRight, cW), y)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = accent
        ctx.fillRect(1, y - 5.5, RULER_SIZE - 2, 11)
        ctx.fillStyle = "#ffffff"
        ctx.textAlign = "center"
        ctx.fillText(labelStr, RULER_SIZE / 2, y + 3)
      }
    }

    ctx.restore()
  }, [prepareFixed, sizeDef, fabricRef, labelPxToScreen])


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
  }, [pan, zoom, rotation, offsetX, offsetY, sizeKey, drawRulers, drawEdgeIndicators])

  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return

    // ИСПРАВЛЕНО: явно снимаем clipPath и включаем preserveObjectStacking
    // чтобы элементы за пределами этикетки оставались видимы и кликабельны
    fabric.clipPath = undefined
    fabric.preserveObjectStacking = true
    // ИСПРАВЛЕНО: отключаем встроенный clip у нижнего canvas-элемента
    const lce = fabric.lowerCanvasEl as HTMLCanvasElement | undefined
    if (lce) { lce.style.overflow = "visible"; lce.style.clipPath = "none" }
    const uce = (fabric as unknown as { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl
    if (uce) { uce.style.overflow = "visible"; uce.style.clipPath = "none" }

    // FIX 4: rulers re-render only on structural/selection events, not every move frame.
    // Edge-indicator guides update on move but are throttled to one RAF per frame.
    const redrawFull = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        drawRulers()
        drawEdgeIndicators()
      })
    }
    // During active drag: only refresh the guide overlay (cheap), not the full ruler ticks
    const redrawGuidesOnly = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
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
    // Structural/selection events → full redraw (rulers + guides)
    const structuralEvents = [
      "object:modified", "object:added", "object:removed",
      "selection:created", "selection:updated",
    ] as const
    // Per-frame transform events → guides overlay only (no ruler tick redraw)
    const movingEvents = [
      "object:moving", "object:scaling", "object:rotating",
    ] as const
    structuralEvents.forEach((ev) => fabric.on(ev, redrawFull))
    movingEvents.forEach((ev) => fabric.on(ev, redrawGuidesOnly))
    fabric.on("selection:cleared", clearGuides)
    redrawFull()
    return () => {
      structuralEvents.forEach((ev) => fabric.off(ev, redrawFull))
      movingEvents.forEach((ev) => fabric.off(ev, redrawGuidesOnly))
      fabric.off("selection:cleared", clearGuides)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [fabricRef, drawRulers, drawEdgeIndicators, prepareFixed, sizeKey])

  // Применяем поворот к Fabric canvas через viewportTransform (не CSS),
  // чтобы холст оставался полностью интерактивным при любом угле.
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    const cx = stageW / 2
    const cy = stageH / 2
    // ВАЖНО: базовое смещение всегда offsetX/offsetY (а не текущее значение из
    // viewportTransform) — иначе повторные повороты накапливают сдвиг и
    // координаты линеек расходятся с реальным положением объектов.
    const [a, b, c, d, e, f] = makeRotationMatrix(rotation, cx, cy)
    const tx = offsetX
    const ty = offsetY
    if (rotation % 360 === 0) {
      fabric.setViewportTransform([1, 0, 0, 1, tx, ty])
    } else {
      // Поворот вокруг центра stage поверх базового смещения:
      // p → R(p + t) вокруг (cx, cy)
      fabric.setViewportTransform([
        a, b, c, d,
        e + a * tx + c * ty,
        f + b * tx + d * ty,
      ])
    }

    fabric.requestRenderAll()
    // Разрешаем выделение/взаимодействие при любом угле
    fabric.selection = true
    fabric.getObjects().forEach((o) => { o.selectable = true; o.evented = true })
  }, [rotation, fabricRef, stageW, stageH, offsetX, offsetY, sizeKey])

  // Панорамирование через глобальные слушатели окна.
  // Fabric может перехватывать pointer-события внутри своего слоя (pointer capture),
  // поэтому move/up слушаем на window — перетаскивание не «теряется».
  const isPanningRef = useRef(false)
  // Отслеживаем, тянет ли Fabric объект в данный момент
  const isTransformingRef = useRef(false)
  const panRef = useRef(pan)
  panRef.current = pan

  const startPan = useCallback((clientX: number, clientY: number) => {
    if (isTransformingRef.current) return
    isPanningRef.current = true
    panStartRef.current = { x: panRef.current.x, y: panRef.current.y, px: clientX, py: clientY }
    if (viewportRef.current) viewportRef.current.style.cursor = "grabbing"
  }, [])

  // Глобальные слушатели перемещения/отпускания
  useEffect(() => {
    const onMove = (ev: PointerEvent | MouseEvent) => {
      if (!isPanningRef.current) return
      const start = panStartRef.current
      if (!start) return
      ev.preventDefault?.()
      setPan({ x: start.x + (ev.clientX - start.px), y: start.y + (ev.clientY - start.py) })
    }
    const onUp = () => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      panStartRef.current = null
      if (viewportRef.current) {
        viewportRef.current.style.cursor = isPanModeRef.current ? "grab" : "default"
      }
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    window.addEventListener("mousemove", onMove as EventListener)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove as EventListener)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      window.removeEventListener("mousemove", onMove as EventListener)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  // Когда меняется режим Pan — обновляем состояние Fabric (selection on/off)
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    if (isPanMode) {
      // Режим «Рука»: Fabric не выделяет объекты, все касания — панорамирование
      fabric.selection = false
      fabric.getObjects().forEach((o) => { o.selectable = false; o.evented = false })
      if (viewportRef.current) viewportRef.current.style.cursor = "grab"
    } else {
      // Режим редактирования: восстанавливаем интерактивность
      fabric.selection = true
      fabric.getObjects().forEach((o) => {
        const role = (o as unknown as { data?: { role?: string } }).data?.role
        o.selectable = role !== "bg"
        o.evented = role !== "bg"
      })
      if (viewportRef.current) viewportRef.current.style.cursor = "default"
    }
    fabric.requestRenderAll()
  }, [isPanMode, fabricRef, sizeKey])

  // Клик по рабочей области
  const onPanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isTransformingRef.current && !isPanModeRef.current) return

    // В режиме «Рука» — ВСЕГДА панорамируем, Fabric заблокирован
    if (isPanModeRef.current) {
      startPan(e.clientX, e.clientY)
      return
    }

    // Стандартный режим: средняя кнопка мыши / Alt.
    // На сенсорных устройствах холст передвигается ТОЛЬКО через Pan Tool (режим «Рука»)
    if (e.pointerType === "touch") return
    const forcePan = e.button === 1 || e.altKey
    if (!forcePan) {
      if (e.button !== 0) return
      const fabric = fabricRef.current
      const overFabric = (e.target as HTMLElement)?.tagName === "CANVAS" &&
        !!(e.target as HTMLElement).closest("[data-fabric-layer]")
      if (overFabric && fabric) {
        try {
          if (fabric.findTarget(e.nativeEvent as unknown as MouseEvent)) return
        } catch {
          /* hit-test недоступен — панорамируем */
        }
      }
    }
    startPan(e.clientX, e.clientY)
  }, [fabricRef, startPan])

  // Отслеживаем старт/конец трансформации объекта в Fabric
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    const onTransformStart = () => { isTransformingRef.current = true }
    const onTransformEnd   = () => { isTransformingRef.current = false }
    const transformEvents = ["object:moving", "object:scaling", "object:rotating"] as const
    transformEvents.forEach((ev) => fabric.on(ev, onTransformStart))
    fabric.on("object:modified", onTransformEnd)
    fabric.on("mouse:up", onTransformEnd)
    fabric.on("touch:end" as never, onTransformEnd)
    return () => {
      transformEvents.forEach((ev) => fabric.off(ev, onTransformStart))
      fabric.off("object:modified", onTransformEnd)
      fabric.off("mouse:up", onTransformEnd)
      fabric.off("touch:end" as never, onTransformEnd)
    }
  }, [fabricRef])

  // Клик по пустой области холста через Fabric-события (запасной путь)
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    const onFabricDown = (opt: { target?: unknown; e: MouseEvent | TouchEvent | PointerEvent }) => {
      // В режиме «Рука» pan уже запускается через onPanPointerDown — не дублируем
      if (isPanModeRef.current) return
      // На сенсорных устройствах pan вне режима «Рука» запрещён
      const rawEv = opt.e as PointerEvent
      const isTouch = rawEv.pointerType === "touch" ||
        (typeof TouchEvent !== "undefined" && opt.e instanceof TouchEvent)
      if (isTouch) return
      if (opt.target) {
        isTransformingRef.current = true
        return
      }
      const ev = opt.e as PointerEvent
      const cx = ev.clientX ?? (ev as unknown as TouchEvent).touches?.[0]?.clientX
      const cy = ev.clientY ?? (ev as unknown as TouchEvent).touches?.[0]?.clientY
      if (typeof cx !== "number" || typeof cy !== "number") return
      startPan(cx, cy)
    }
    fabric.on("mouse:down", onFabricDown as never)
    return () => { fabric.off("mouse:down", onFabricDown as never) }
  }, [fabricRef, startPan])

  // ─────────────────────────────────────────────────────────────────────────
  // Масштабирование двумя пальцами (pinch-to-zoom) + перенос холста жестом.
  // Слушатели вешаем в фазе capture, чтобы Fabric не перехватывал касания.
  // ─────────────────────────────────────────────────────────────────────────
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const onZoomToRef = useRef(onZoomTo)
  onZoomToRef.current = onZoomTo

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: {
      dist: number
      zoom: number
      pan: { x: number; y: number }
      mid: { x: number; y: number }
    } | null = null

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)

    const two = () => [...pointers.values()].slice(0, 2)

    const setFabricInteractive = (on: boolean) => {
      const fabric = fabricRef.current
      if (!fabric) return
      const f = fabric as unknown as { skipTargetFind: boolean; _currentTransform: unknown }
      f.skipTargetFind = !on
      if (!on) {
        f._currentTransform = null
        fabric.discardActiveObject()
        fabric.requestRenderAll()
      }
    }

    const startPinch = () => {
      const [p1, p2] = two()
      if (!p1 || !p2) return
      // Прерываем обычное панорамирование и трансформацию объекта
      isPanningRef.current = false
      panStartRef.current = null
      isTransformingRef.current = false
      setFabricInteractive(false)
      pinch = {
        dist: Math.max(1, dist(p1, p2)),
        zoom: zoomRef.current,
        pan: { ...panRef.current },
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      }
    }

    const endPinch = () => {
      if (!pinch) return
      pinch = null
      setFabricInteractive(true)
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) startPinch()
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (!pinch || pointers.size < 2) return

      e.preventDefault()
      e.stopPropagation()

      const [p1, p2] = two()
      if (!p1 || !p2) return

      const rect = el.getBoundingClientRect()
      // Центр области просмотра (относительно контейнера)
      const cX = RULER_SIZE + (rect.width - RULER_SIZE) / 2
      const cY = RULER_SIZE + (rect.height - RULER_SIZE) / 2

      const newDist = Math.max(1, dist(p1, p2))
      const nextZoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, pinch.zoom * (newDist / pinch.dist)),
      )

      // Точка холста под центром жеста остаётся на месте
      const midStartX = pinch.mid.x - rect.left
      const midStartY = pinch.mid.y - rect.top
      const vx = (midStartX - cX - pinch.pan.x) / pinch.zoom
      const vy = (midStartY - cY - pinch.pan.y) / pinch.zoom

      const midX = (p1.x + p2.x) / 2 - rect.left
      const midY = (p1.y + p2.y) / 2 - rect.top

      setPan({ x: midX - cX - vx * nextZoom, y: midY - cY - vy * nextZoom })
      onZoomToRef.current?.(nextZoom)
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      pointers.delete(e.pointerId)
      if (pointers.size < 2) endPinch()
    }

    // Ctrl + колесо / трекпад-щипок на десктопе
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, zoomRef.current * Math.exp(-dy * 0.002)),
      )
      onZoomToRef.current?.(next)
    }

    el.addEventListener("pointerdown", onDown, { capture: true })
    el.addEventListener("pointermove", onMove, { capture: true, passive: false })
    el.addEventListener("pointerup", onUp, { capture: true })
    el.addEventListener("pointercancel", onUp, { capture: true })
    el.addEventListener("wheel", onWheel, { passive: false })

    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true } as EventListenerOptions)
      el.removeEventListener("pointermove", onMove, { capture: true } as EventListenerOptions)
      el.removeEventListener("pointerup", onUp, { capture: true } as EventListenerOptions)
      el.removeEventListener("pointercancel", onUp, { capture: true } as EventListenerOptions)
      el.removeEventListener("wheel", onWheel)
      endPinch()
    }
  }, [fabricRef])

  const resetView = useCallback(() => setPan({ x: 0, y: 0 }), [])
  const togglePanMode = useCallback(() => setIsPanMode((v) => !v), [])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: "linear-gradient(135deg, #a1a1aa 0%, #d4d4d8 50%, #e4e4e7 100%)" }}
    >
      {/* Viewport: принимает pointer-события для pan.
          В режиме «Рука» cursor:grab, иначе cursor:default.
          Fabric-слой обрабатывает клики по объектам самостоятельно. */}
      <div
        ref={viewportRef}
        className="absolute"
        style={{
          inset: 0,
          top: RULER_SIZE,
          left: RULER_SIZE,
          touchAction: "none",
          cursor: isPanMode ? "grab" : "default",
          userSelect: "none",
        }}
        onPointerDown={onPanPointerDown}
      >
        {/* Поворот холста реализован через Fabric viewportTransform — НЕ через CSS rotate.
            CSS transform содержит только pan + scale, без rotate.
            Это гарантирует полную интерактивность Fabric при любом угле поворота. */}
        <div
          ref={stageLayerRef}
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0) scale(${zoom})`,
            transformOrigin: "center center",
            width: totalW,
            height: totalH,
            overflow: "visible",
          }}
        >
          <canvas ref={staticCanvasRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 1 }} />

          {/* SVG-подложка этикетки: поворачивается через CSS (только визуал, не интерактивна) */}
          <div
            ref={labelLayerRef}
            className="absolute pointer-events-none"
            style={{
              top: offsetY - 24,
              left: offsetX - 24,
              zIndex: 2,
              overflow: "visible",
              transformOrigin: `${totalW / 2 - (offsetX - 24)}px ${totalH / 2 - (offsetY - 24)}px`,
              transform: rotation % 360 !== 0 ? `rotate(${rotation}deg)` : undefined,
            }}
          >
            <LabelBackground sizeDef={sizeDef} style={{ position: "absolute", top: 0, left: 0 }} />
          </div>

          {/* Fabric-слой покрывает весь stage, overflow:visible.
              pointer-events:auto — Fabric сам обрабатывает клики по объектам.
              В режиме «Рука» pointer-events:none — все касания идут в onPanPointerDown. */}
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
              pointerEvents: isPanMode ? "none" : "auto",
            }}
          >
            <canvas ref={canvasRef} style={{ display: "block", overflow: "visible" }} />
          </div>
        </div>
      </div>

      <canvas ref={rulerHRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 22, width: "100%", height: RULER_SIZE }} />
      <canvas ref={rulerVRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 21, width: RULER_SIZE, height: "100%" }} />
      <canvas ref={guidesCanvasRef} className="absolute top-0 left-0 pointer-events-none" style={{ zIndex: 23 }} />

      {/* Панель зума + кнопка Pan Tool (Рука) */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-1">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/20 bg-black/35 px-1 py-0.5 backdrop-blur-md shadow-lg">
          <button
            type="button"
            onClick={() => onZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            title="Уменьшить"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-9 select-none text-center font-mono text-[10px] text-white/95">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            title="Увеличить"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          {/* Кнопка «Рука» / Pan Tool: тап включает режим панорамирования холста.
              Активный режим подсвечивается белым фоном. */}
          <button
            type="button"
            onClick={togglePanMode}
            title={isPanMode ? "Выключить режим перемещения" : "Режим перемещения холста (Рука)"}
            className={[
              "rounded-full p-1.5 transition-colors",
              isPanMode
                ? "bg-white/25 text-white ring-1 ring-white/50"
                : "text-white/80 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <Hand className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={resetView}
            title="Сбросить позицию"
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
