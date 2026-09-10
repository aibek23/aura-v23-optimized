"use client"
// ---------------------------------------------------------------------------
// Инициализация Fabric Canvas + монтирование / демонтирование
// ---------------------------------------------------------------------------
import { useEffect, useRef, useCallback } from "react"
import { Canvas } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { attachTextAutoHeight } from "../canvas/text-fit"
import { attachSmartGuides } from "../canvas/snapping"

export function useFabricCanvas(
  canvasElRef: React.RefObject<HTMLCanvasElement | null>,
  sizeDef: LabelSizeDef,
  offsetX: number,
  offsetY: number,
  stageW: number,
  stageH: number,
  onReady: (canvas: Canvas) => void,
) {
  const fabricRef    = useRef<Canvas | null>(null)
  const cleanupRef   = useRef<(() => void)[]>([])

  const destroyCanvas = useCallback(() => {
    cleanupRef.current.forEach((fn) => fn())
    cleanupRef.current = []
    if (fabricRef.current) {
      try { fabricRef.current.dispose() } catch { /* ignore */ }
      fabricRef.current = null
    }
  }, [])

  useEffect(() => {
    const el = canvasElRef.current
    if (!el) return

    destroyCanvas()

    const canvas = new Canvas(el, {
      width: stageW,
      height: stageH,
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
    })

    fabricRef.current = canvas
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])

    const cleanupAutoH  = attachTextAutoHeight(canvas)
    const cleanupSnap   = attachSmartGuides(canvas, sizeDef)
    cleanupRef.current  = [cleanupAutoH, cleanupSnap]

    onReady(canvas)

    return destroyCanvas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeDef.key, stageW, stageH])

  return fabricRef
}
