"use client"
// ---------------------------------------------------------------------------
// Pinch-to-zoom (два пальца) + Ctrl+колесо
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react"
import { ZOOM_MIN, ZOOM_MAX, RULER_SIZE } from "../constants"
import type { PanState } from "./use-canvas-pan"

export function usePinchZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  fabricRef: React.RefObject<import("fabric").Canvas | null>,
  zoomRef: React.RefObject<number>,
  panRef: React.RefObject<PanState>,
  isPanningRef: React.RefObject<boolean>,
  isTransformingRef: React.RefObject<boolean>,
  onZoomTo: ((z: number) => void) | undefined,
  setPan: React.Dispatch<React.SetStateAction<PanState>>,
): void {
  const onZoomToRef = useRef(onZoomTo)
  onZoomToRef.current = onZoomTo

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: {
      dist: number; zoom: number
      pan: PanState; mid: { x: number; y: number }
    } | null = null

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    const two = () => [...pointers.values()].slice(0, 2)

    const setFabricInteractive = (on: boolean) => {
      const fabric = fabricRef.current
      if (!fabric) return
      const f = fabric as unknown as { skipTargetFind: boolean; _currentTransform: unknown }
      f.skipTargetFind = !on
      if (!on) { f._currentTransform = null; fabric.discardActiveObject(); fabric.requestRenderAll() }
    }

    const startPinch = () => {
      const [p1, p2] = two()
      if (!p1 || !p2) return
      isPanningRef.current      = false
      isTransformingRef.current = false
      setFabricInteractive(false)
      pinch = {
        dist: Math.max(1, dist(p1, p2)),
        zoom: zoomRef.current,
        pan:  { ...panRef.current },
        mid:  { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      }
    }

    const endPinch = () => { if (!pinch) return; pinch = null; setFabricInteractive(true) }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) startPinch()
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (!pinch || pointers.size < 2) return
      e.preventDefault(); e.stopPropagation()

      const [p1, p2] = two()
      if (!p1 || !p2) return

      const rect     = el.getBoundingClientRect()
      const cX       = RULER_SIZE + (rect.width  - RULER_SIZE) / 2
      const cY       = RULER_SIZE + (rect.height - RULER_SIZE) / 2
      const newDist  = Math.max(1, dist(p1, p2))
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.zoom * (newDist / pinch.dist)))

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

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const dy   = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRef.current * Math.exp(-dy * 0.002)))
      onZoomToRef.current?.(next)
    }

    el.addEventListener("pointerdown",   onDown,  { capture: true })
    el.addEventListener("pointermove",   onMove,  { capture: true, passive: false })
    el.addEventListener("pointerup",     onUp,    { capture: true })
    el.addEventListener("pointercancel", onUp,    { capture: true })
    el.addEventListener("wheel",         onWheel, { passive: false })

    return () => {
      el.removeEventListener("pointerdown",   onDown,  { capture: true } as EventListenerOptions)
      el.removeEventListener("pointermove",   onMove,  { capture: true } as EventListenerOptions)
      el.removeEventListener("pointerup",     onUp,    { capture: true } as EventListenerOptions)
      el.removeEventListener("pointercancel", onUp,    { capture: true } as EventListenerOptions)
      el.removeEventListener("wheel",         onWheel)
      endPinch()
    }
  }, [containerRef, fabricRef, zoomRef, panRef, isPanningRef, isTransformingRef, setPan])
}
