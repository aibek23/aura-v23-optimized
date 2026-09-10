"use client"
import { useState, useRef, useCallback, useLayoutEffect } from "react"
import type { Canvas as FabricCanvas } from "fabric"
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, RULER_SIZE } from "../constants"
import type { PanState } from "./use-canvas-pan"
import type { TransformSnapshot } from "./use-canvas-repaint"

export function useCanvasTransform(
  fabricRef: React.RefObject<FabricCanvas | null>,
  pan: PanState,
  offsetX: number,
  offsetY: number,
  totalW: number,
  totalH: number,
  rotation: number,
  sizeKey: string,
) {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const zoomRef = useRef(ZOOM_DEFAULT)

  const transformRef = useRef<TransformSnapshot>({
    pan: { x: 0, y: 0 },
    zoom: ZOOM_DEFAULT,
    rotation: 0,
    offsetX, offsetY, totalW, totalH,
  })

  transformRef.current = { pan, zoom, rotation, offsetX, offsetY, totalW, totalH }

  const zoomTo = useCallback((z: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
    zoomRef.current = next
    setZoom(next)
  }, [])

  const zoomIn = useCallback(() => zoomTo(zoomRef.current * (1 + 0.15)), [zoomTo])
  const zoomOut = useCallback(() => zoomTo(zoomRef.current / (1 + 0.15)), [zoomTo])
  const zoomReset = useCallback(() => zoomTo(ZOOM_DEFAULT), [zoomTo])

  useLayoutEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const stageW = totalW - RULER_SIZE
    const stageH = totalH - RULER_SIZE

    const angle = (rotation * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Fabric получает ту же матрицу, что и линейки: вращение вокруг центра
    // рабочей области, затем масштаб и pan. Поэтому элементы, фон и guides
    // больше не живут в разных системах координат.
    const a = zoom * cos
    const b = zoom * sin
    const c = -zoom * sin
    const d = zoom * cos
    const cx = stageW / 2 + pan.x
    const cy = stageH / 2 + pan.y
    const tx = cx - a * stageW / 2 - c * stageH / 2 + a * offsetX + c * offsetY
    const ty = cy - b * stageW / 2 - d * stageH / 2 + b * offsetX + d * offsetY

    canvas.setViewportTransform([a, b, c, d, tx, ty])
    canvas.requestRenderAll()
  }, [fabricRef, pan.x, pan.y, zoom, totalW, totalH, rotation, sizeKey, offsetX, offsetY])

  return { zoom, zoomRef, zoomTo, zoomIn, zoomOut, zoomReset, transformRef }
}