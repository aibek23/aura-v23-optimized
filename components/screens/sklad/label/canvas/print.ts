// ---------------------------------------------------------------------------
// Кроп печатной области из Fabric-холста
// ---------------------------------------------------------------------------
import type { Canvas } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { PRINT_SCALE } from "../constants"

export function cropPrintArea(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
): HTMLCanvasElement {
  const origVT = canvas.viewportTransform
    ? ([...canvas.viewportTransform] as [number, number, number, number, number, number])
    : ([1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number])

  canvas.discardActiveObject()
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
  canvas.renderAll()

  const source = canvas.toCanvasElement(PRINT_SCALE, {
    left: 0, top: 0,
    width:  sizeDef.w_px,
    height: sizeDef.h_px,
  })

  canvas.setViewportTransform(origVT)
  canvas.requestRenderAll()

  const out    = document.createElement("canvas")
  out.width    = Math.round(sizeDef.w_px * PRINT_SCALE)
  out.height   = Math.round(sizeDef.h_px * PRINT_SCALE)
  const ctx    = out.getContext("2d")
  if (ctx) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(source, 0, 0, out.width, out.height)
  }
  return out
}
