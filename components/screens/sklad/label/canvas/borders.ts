// ---------------------------------------------------------------------------
// Добавление рамок на холст
// ---------------------------------------------------------------------------
import { Rect } from "fabric"
import type { Canvas } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import type { BorderStyleKey } from "../constants"
import { BORDER_STYLES } from "../constants"
import { applyTransformConstraints, ensureBgAtBottom } from "./snapping"

export function addBorderToCanvas(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  styleKey: BorderStyleKey,
): void {
  const bs     = BORDER_STYLES.find((s) => s.key === styleKey) ?? BORDER_STYLES[0]
  const margin = styleKey === "double" ? 6 : 4

  const makeRect = (l: number, t: number, w: number, h: number, role: string, sw: number) =>
    new Rect({
      left: l, top: t, width: w, height: h,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: sw,
      strokeDashArray: bs.strokeDashArray ?? undefined,
      rx: bs.rx, ry: bs.rx,
      objectCaching: false,
      evented: true, selectable: true,
      data: { role },
    })

  const outer = makeRect(
    margin, margin,
    sizeDef.w_px - margin * 2,
    sizeDef.h_px - margin * 2,
    `border-${styleKey}-${Date.now()}`,
    bs.strokeWidth,
  )

  if (styleKey === "double") {
    const inner = makeRect(
      margin + 4, margin + 4,
      sizeDef.w_px - (margin + 4) * 2,
      sizeDef.h_px - (margin + 4) * 2,
      `border-double-inner-${Date.now()}`,
      1,
    )
    canvas.add(inner)
    applyTransformConstraints(inner)
    canvas.bringObjectToFront(inner)
  }

  canvas.add(outer)
  applyTransformConstraints(outer)
  canvas.bringObjectToFront(outer)
  ensureBgAtBottom(canvas)
  canvas.requestRenderAll()
}
