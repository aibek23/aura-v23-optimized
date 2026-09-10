"use client"
// ---------------------------------------------------------------------------
// Единый rAF-планировщик перерисовки линеек + направляющих + сетки
// ---------------------------------------------------------------------------
import { useEffect, useRef, useCallback } from "react"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { RULER_SIZE } from "../constants"
import { prepareFixed, prepareStatic, createGridPattern } from "../utils/canvas-2d"
import { getRulerTheme } from "../utils/theme"
import {
  computeStageOrigin, makeTrigCache, objScreenBox, getFabricBounds,
  getFabricCorners, stageToScreen,
} from "../utils/geometry"
import { getSvgLayout } from "../components/label-background"
import {
  drawHorizontalRuler, drawVerticalRuler, computeAxisScreenPositions,
} from "../utils/ruler-draw"
import { drawGuides, buildGuideEdges } from "../utils/guides-draw"
import type { ManualGuide } from "../utils/guides-draw"
import type { PanState } from "./use-canvas-pan"

export interface TransformSnapshot {
  pan: PanState
  zoom: number
  rotation: number
  offsetX: number
  offsetY: number
  totalW: number
  totalH: number
}

interface UseCanvasRepaintParams {
  fabricRef:       React.RefObject<FabricCanvas | null>
  containerRef:    React.RefObject<HTMLDivElement | null>
  staticCanvasRef: React.RefObject<HTMLCanvasElement | null>
  rulerHRef:       React.RefObject<HTMLCanvasElement | null>
  rulerVRef:       React.RefObject<HTMLCanvasElement | null>
  guidesCanvasRef: React.RefObject<HTMLCanvasElement | null>
  transformRef:    React.RefObject<TransformSnapshot>
  sizeDef:         LabelSizeDef
  sizeKey:         string
  rotation?:       number // <-- Добавлен явный параметр поворота
  manualGuides?:   ManualGuide[]
}

export function useCanvasRepaint({
  fabricRef, containerRef, staticCanvasRef,
  rulerHRef, rulerVRef, guidesCanvasRef,
  transformRef, sizeDef, sizeKey, rotation = 0, manualGuides = [],
}: UseCanvasRepaintParams): void {
  const rafRef         = useRef<number | null>(null)
  const gridPatternRef = useRef<{ pattern: CanvasPattern; color: string } | null>(null)

  const drawStatic = useCallback(() => {
    const t   = transformRef.current
    const ctx = prepareStatic(staticCanvasRef.current, t.totalW, t.totalH)
    if (!ctx) return
    const color = getRulerTheme().gridColor
    if (!gridPatternRef.current || gridPatternRef.current.color !== color) {
      const p = createGridPattern(ctx, color)
      if (p) gridPatternRef.current = { pattern: p, color }
    }
    if (gridPatternRef.current) {
      ctx.fillStyle = gridPatternRef.current.pattern
      ctx.fillRect(0, 0, t.totalW, t.totalH)
    }
  }, [transformRef, staticCanvasRef])

  const drawRulers = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width: cW, height: cH } = container.getBoundingClientRect()
    const t       = transformRef.current
    const theme   = getRulerTheme()
    const pxPerMm = getSvgLayout(sizeDef.key, sizeDef).pxPerMm
    const so      = computeStageOrigin(cW, cH, RULER_SIZE, t.pan.x, t.pan.y, t.totalW, t.totalH, t.zoom)
    const trig    = makeTrigCache(t.rotation)
    const fabric  = fabricRef.current
    const active  = fabric?.getActiveObject() ?? null

    const stageW = t.totalW - RULER_SIZE
    const stageH = t.totalH - RULER_SIZE
    // Для каждой экранной линейки берём ось, которая ближе к ней. В отличие
    // от старой логики, проекция не меняется внутри computeAxis... на каждом
    // кадре, поэтому при повороте деления не перескакивают.
    const hAxis: "x" | "y" = Math.abs(trig.cos) >= Math.abs(trig.sin) ? "x" : "y"
    const vAxis: "x" | "y" = hAxis === "x" ? "y" : "x"

    const hPos = computeAxisScreenPositions({
      axis: hAxis, screenAxis: "x", so,
      offsetX: t.offsetX, offsetY: t.offsetY,
      stageW, stageH, zoom: t.zoom, cosR: trig.cos, sinR: trig.sin, pxPerMm,
    })
    const vPos = computeAxisScreenPositions({
      axis: vAxis, screenAxis: "y", so,
      offsetX: t.offsetX, offsetY: t.offsetY,
      stageW, stageH, zoom: t.zoom, cosR: trig.cos, sinR: trig.sin, pxPerMm,
    })
    if (!hPos || !vPos) return

    const measurable = fabric
      ? fabric.getObjects().filter((o) => {
          if (o.visible === false) return false
          const role = (o as unknown as { data?: { role?: string } }).data?.role
          return role !== "bg"
        })
      : []

    const isSameOrInside = (o: FabricObject) => {
      if (!active) return false
      if (o === active) return true
      const grp = active as unknown as { contains?: (x: FabricObject) => boolean }
      return typeof grp.contains === "function" ? Boolean(grp.contains(o)) : false
    }

    const objectBoxes = measurable.map((o) => ({
      box: objScreenBox(o, so, t.offsetX, t.offsetY, stageW, stageH, t.zoom, trig.cos, trig.sin),
      isActive: isSameOrInside(o),
    })).filter((x): x is { box: NonNullable<typeof x.box>; isActive: boolean } => x.box !== null)

    const activeBox = active
      ? objScreenBox(active, so, t.offsetX, t.offsetY, stageW, stageH, t.zoom, trig.cos, trig.sin)
      : null

    // The ruler coordinates are screen-axis coordinates. This keeps x1/x2
    // tied to the visible left/right boundaries even when the label itself is
    // rotated and the horizontal ruler is backed by the other label axis.
    const axisValueAt = (position: number, at0: number, at1: number) =>
      Math.abs(at1 - at0) < 1e-6 ? 0 : (position - at0) / (at1 - at0)
    const horizontalLabels = activeBox ? [
      { name: "x1", position: activeBox.x1, value: axisValueAt(activeBox.x1, hPos.at0, hPos.at1) },
      { name: "x2", position: activeBox.x2, value: axisValueAt(activeBox.x2, hPos.at0, hPos.at1) },
    ] : []
    const verticalLabels = activeBox ? [
      { name: "y1", position: activeBox.y1, value: axisValueAt(activeBox.y1, vPos.at0, vPos.at1) },
      { name: "y2", position: activeBox.y2, value: axisValueAt(activeBox.y2, vPos.at0, vPos.at1) },
    ] : []

    const ctxH = prepareFixed(rulerHRef.current, cW, RULER_SIZE)
    if (ctxH) {
      drawHorizontalRuler({
        ctx: ctxH, cW, hAt0: hPos.at0, hAt1: hPos.at1,
        theme, activeBox, objectBoxes, activeLabels: horizontalLabels,
      })
    }

    const ctxV = prepareFixed(rulerVRef.current, RULER_SIZE, cH)
    if (ctxV) {
      drawVerticalRuler({
        ctx: ctxV, cH, vAt0: vPos.at0, vAt1: vPos.at1,
        theme, activeBox, objectBoxes, activeLabels: verticalLabels,
      })
    }
  }, [transformRef, containerRef, fabricRef, sizeDef, rulerHRef, rulerVRef])

  const drawEdgeIndicators = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width: cW, height: cH } = container.getBoundingClientRect()
    const ctx = prepareFixed(guidesCanvasRef.current, cW, cH)
    if (!ctx) return

    const fabric    = fabricRef.current
    const activeObj = fabric?.getActiveObject() ?? null

    const t       = transformRef.current
    const trig    = makeTrigCache(t.rotation)
    const so      = computeStageOrigin(cW, cH, RULER_SIZE, t.pan.x, t.pan.y, t.totalW, t.totalH, t.zoom)
    const pxPerMm = getSvgLayout(sizeDef.key, sizeDef).pxPerMm
    const stageW = t.totalW - RULER_SIZE
    const stageH = t.totalH - RULER_SIZE
    const proj = (lx: number, ly: number) =>
      stageToScreen(t.offsetX + lx, t.offsetY + ly, so, t.zoom, trig.cos, trig.sin, stageW, stageH)
    const projectStage = (x: number, y: number) =>
      stageToScreen(x, y, so, t.zoom, trig.cos, trig.sin, stageW, stageH)

    const lc = [
      proj(0, 0), proj(sizeDef.w_px, 0),
      proj(sizeDef.w_px, sizeDef.h_px), proj(0, sizeDef.h_px),
    ]
    const labelLeft   = Math.min(...lc.map((p) => p.x))
    const labelRight  = Math.max(...lc.map((p) => p.x))
    const labelTop    = Math.min(...lc.map((p) => p.y))
    const labelBottom = Math.max(...lc.map((p) => p.y))

    const manual = manualGuides.map((g) => {
      const isHorizontal = g.axis === "x"
      const p1 = isHorizontal ? projectStage(0, g.position) : projectStage(g.position, 0)
      const p2 = isHorizontal ? projectStage(stageW, g.position) : projectStage(g.position, stageH)
      return { p1, p2, mm: g.position / pxPerMm, labelAt: p1 }
    })

    const guides = [...manual]
    if (activeObj) {
      const c = getFabricCorners(activeObj)
      const edgePts = {
        left:   { top: proj(c.tl.x, c.tl.y), bottom: proj(c.bl.x, c.bl.y) },
        right:  { top: proj(c.tr.x, c.tr.y), bottom: proj(c.br.x, c.br.y) },
        top:    { left: proj(c.tl.x, c.tl.y), right: proj(c.tr.x, c.tr.y) },
        bottom: { left: proj(c.bl.x, c.bl.y), right: proj(c.br.x, c.br.y) },
      }
      const b = getFabricBounds(activeObj)
      const generatedGuides = buildGuideEdges(edgePts, {
        left: b.left / pxPerMm, right: b.right / pxPerMm,
        top: b.top / pxPerMm, bottom: b.bottom / pxPerMm,
      }).map((guide) => ({
        ...guide,
        labelAt: guide.labelAt ?? guide.p1, // Гарантируем наличие labelAt
      }))

      guides.push(...generatedGuides)
    }

    if (guides.length) {
      drawGuides(ctx, cW, cH, labelLeft, labelRight, labelTop, labelBottom, guides)
    }
  }, [transformRef, containerRef, fabricRef, guidesCanvasRef, sizeDef, manualGuides])

  const clearGuides = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width: cW, height: cH } = container.getBoundingClientRect()
    prepareFixed(guidesCanvasRef.current, cW, cH)
  }, [containerRef, guidesCanvasRef])

  const scheduleFullRepaint = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      drawStatic(); drawRulers(); drawEdgeIndicators()
    })
  }, [drawStatic, drawRulers, drawEdgeIndicators])

  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return

    const structuralEvents = [
      "object:modified", "object:added", "object:removed",
      "selection:created", "selection:updated",
    ] as const
    const movingEvents = ["object:moving", "object:scaling", "object:rotating"] as const

    const onSelectionCleared = () => { clearGuides(); drawRulers() }

    structuralEvents.forEach((ev) => fabric.on(ev, scheduleFullRepaint))
    // Fabric emits these events continuously during drag/scale/rotate. The
    // rulers must use the same live bounds as the guide overlay, so repaint
    // both layers on every animation frame.
    movingEvents.forEach((ev)     => fabric.on(ev, scheduleFullRepaint))
    fabric.on("selection:cleared",  onSelectionCleared)

    scheduleFullRepaint()

    return () => {
      structuralEvents.forEach((ev) => fabric.off(ev, scheduleFullRepaint))
      movingEvents.forEach((ev)     => fabric.off(ev, scheduleFullRepaint))
      fabric.off("selection:cleared", onSelectionCleared)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [fabricRef, sizeKey, scheduleFullRepaint, clearGuides, drawRulers])

  useEffect(() => {
    const redrawAll = () => scheduleFullRepaint()
    const observer  = new MutationObserver(redrawAll)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    let ro: ResizeObserver | null = null
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(redrawAll)
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
  }, [containerRef, scheduleFullRepaint])

  // Реагируем на прямой проп rotation
  useEffect(() => {
    scheduleFullRepaint()
  }, [
    transformRef.current.pan.x,
    transformRef.current.pan.y,
    transformRef.current.zoom,
    rotation, // <-- Реагируем на переданный rotation
    transformRef.current.offsetX,
    transformRef.current.offsetY,
    sizeKey,
    scheduleFullRepaint,
  ])
}