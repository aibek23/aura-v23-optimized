"use client"
import { useEffect, useRef, useCallback } from "react"
import { Canvas } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { attachTextAutoHeight } from "../canvas/text-fit"
import { attachSmartGuides } from "../canvas/snapping"

// Give Fabric enough drawing surface beyond the label to cover the visible
// editor while panning. The print/export crop still uses label coordinates.
export function getCanvasOverscan() {
  return { x: 256, y: 256 }
}

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

    let isCurrent = true
    const overscan = getCanvasOverscan()
    const maxWidth = Math.max(window.innerWidth, stageW)
    const maxHeight = Math.max(window.innerHeight, stageH)
    const canvas = new Canvas(el, {
      width: maxWidth + overscan.x * 2,
      height: maxHeight + overscan.y * 2,
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
    })

    fabricRef.current = canvas
    // Fabric wraps the original canvas. Move that wrapper, not just the
    // lower canvas, so its hit-testing surface stays aligned with the image.
    const wrapper = canvas.lowerCanvasEl.parentElement
    if (wrapper) {
      wrapper.style.position = "absolute"
      wrapper.style.left = `${-overscan.x}px`
      wrapper.style.top = `${-overscan.y}px`
    }
    canvas.setViewportTransform([1, 0, 0, 1, offsetX + overscan.x, offsetY + overscan.y])

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