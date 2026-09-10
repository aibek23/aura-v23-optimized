// ---------------------------------------------------------------------------
// Ограничения трансформации и порядок слоёв.
//
// Автовыравнивание применяется только к углу объекта. Координаты left/top
// не меняются, поэтому вращение не конфликтует с перемещением и направляющими.
// ---------------------------------------------------------------------------
import type { Canvas, FabricObject } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"

export function applyTransformConstraints(obj: FabricObject): void {
  obj.setControlsVisibility({
    mr: true, mb: true, br: true, mtr: true,
    tl: false, tr: false, bl: false, ml: false, mt: false,
  })
}

export const ROTATION_SNAP_STEP = 90
export const ROTATION_SNAP_THRESHOLD = 5

/**
 * Возвращает точный ключевой угол, если текущий угол достаточно близок к
 * горизонтальной/вертикальной оси. В остальных случаях возвращает исходное
 * значение без изменений.
 */
export function snapRotationAngle(
  angle: number,
  threshold = ROTATION_SNAP_THRESHOLD,
): number {
  if (!Number.isFinite(angle)) return angle

  const nearest = Math.round(angle / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP
  if (Math.abs(angle - nearest) > threshold) return angle

  // Fabric допускает отрицательные и накопленные углы, но для интерфейса
  // лучше хранить один из канонических углов 0/90/180/270.
  return ((nearest % 360) + 360) % 360
}

export function ensureBgAtBottom(canvas: Canvas): void {
  const bgObj = canvas.getObjects().find(
    (o) => (o as unknown as { data?: { role?: string } }).data?.role === "bg",
  )
  if (bgObj) canvas.sendObjectToBack(bgObj)
}

export function attachSmartGuides(canvas: Canvas, _sizeDef: LabelSizeDef): () => void {
  canvas.getObjects().forEach(applyTransformConstraints)

  const onAdded = (e: { target?: FabricObject }) => {
    if (e.target) {
      applyTransformConstraints(e.target)
      ensureBgAtBottom(canvas)
    }
  }

  const onRotating = (e: { target?: FabricObject }) => {
    const target = e.target
    if (!target) return
    const role = (target as unknown as { data?: { role?: string } }).data?.role
    if (role === "bg") return

    const current = target.angle ?? 0
    const snapped = snapRotationAngle(current)
    if (snapped === current) return

    target.set({ angle: snapped })
    target.setCoords()
  }

  type Bus = { on: (n: string, h: unknown) => void; off: (n: string, h: unknown) => void }
  const bus = canvas as unknown as Bus
  bus.on("object:added", onAdded)
  bus.on("object:rotating", onRotating)

  return () => {
    bus.off("object:added", onAdded)
    bus.off("object:rotating", onRotating)
  }
}