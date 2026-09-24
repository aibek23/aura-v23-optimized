"use client"
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
  onReady: (canvas: Canvas) => void | (() => void) | Promise<void | (() => void)>,
) {
  const fabricRef  = useRef<Canvas | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])

  const destroyCanvas = useCallback(() => {
    cleanupRef.current.forEach((fn) => {
      try { fn() } catch { /* ignore */ }
    })
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

    let isCurrent = true
    const canvas = new Canvas(el, {
      width: stageW,
      height: stageH,
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
    })

    fabricRef.current = canvas
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])

    const cleanupAutoH = attachTextAutoHeight(canvas)
    const cleanupSnap  = attachSmartGuides(canvas, sizeDef)
    cleanupRef.current = [cleanupAutoH, cleanupSnap]

    try {
      const maybePromise = onReady(canvas)

      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        (maybePromise as Promise<void | (() => void)>)
          .then((cleanup) => {
            if (typeof cleanup !== "function") return
            // Если холст уже сменился или размонтирован — чистим сразу,
            // а не "переливаем" очистку старого холста в новый эффект.
            if (!isCurrent || fabricRef.current !== canvas) {
              try { cleanup() } catch { /* ignore */ }
              return
            }
            cleanupRef.current.push(cleanup)
          })
          .catch((err) => {
            console.error("[useFabricCanvas] onReady failed:", err)
          })
      }
    } catch (err) {
      console.error("[useFabricCanvas] onReady sync error:", err)
    }

    return () => {
      isCurrent = false
      destroyCanvas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeDef.key, stageW, stageH])

  return fabricRef
}