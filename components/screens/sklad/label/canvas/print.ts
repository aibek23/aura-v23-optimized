// ---------------------------------------------------------------------------
// Кроп печатной области из Fabric-холста
// ---------------------------------------------------------------------------
import type { Canvas } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { PRINT_SCALE } from "../constants"

export function cropPrintArea(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  outputDpi = 203,
): HTMLCanvasElement {
  // Сохраняем 2× supersampling для сглаживания и дополнительно увеличиваем
  // буфер до нативной плотности печатающей головки выбранной модели.
  const scale = PRINT_SCALE * outputDpi / 203
  const origVT = canvas.viewportTransform
    ? ([...canvas.viewportTransform] as [number, number, number, number, number, number])
    : ([1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number])

  canvas.discardActiveObject()
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
  canvas.renderAll()

  const source = canvas.toCanvasElement(scale, {
    left: 0, top: 0,
    width:  sizeDef.w_px,
    height: sizeDef.h_px,
  })

  canvas.setViewportTransform(origVT)
  canvas.requestRenderAll()

  const out    = document.createElement("canvas")
  out.width    = Math.round(sizeDef.w_px * scale)
  out.height   = Math.round(sizeDef.h_px * scale)
  const ctx    = out.getContext("2d")
  if (ctx) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(source, 0, 0, out.width, out.height)
  }
  return out
}
