// ---------------------------------------------------------------------------
// Логика холста: дефолтный макет, кроп, обновление живых данных,
// Smart Guides / Snapping (магнитное прилипание),
// ограничение точек трансформации и поворот только на 90°
// ---------------------------------------------------------------------------
import { Canvas, Textbox, Rect, Image as FabricImage } from "fabric"
import type { FabricObject } from "fabric"
import type { Product } from "@/lib/types"
import type { LabelSizeDef } from "@/lib/niimbot"
import { getRole } from "./label-editor.types"
import { buildJewelryText, safeQrDataUrl } from "./label-editor.helpers"
import { getBodyPx } from "./label-background"
import type { BorderStyleKey } from "./label-editor-toolbar"
import { BORDER_STYLES } from "./label-editor-toolbar"

// ---------------------------------------------------------------------------
// Snap hysteresis thresholds (canvas px, unscaled)
// Snaps when distance <= SNAP_ENGAGE; releases only when distance > SNAP_RELEASE
// ---------------------------------------------------------------------------
const SNAP_ENGAGE  = 6
const SNAP_RELEASE = 10


// ---------------------------------------------------------------------------
// Текстовые блоки: нулевые отступы, перенос строк, авто-высота по контенту
// ---------------------------------------------------------------------------
/** Базовые опции ЛЮБОГО текстового объекта на холсте. */
export const TEXT_DEFAULTS = {
  padding: 0,          // границы рамки прилегают вплотную к символам
  splitByGrapheme: true, // перенос даже длинных слов без сжатия текста
  objectCaching: false,  // корректная перерисовка при auto-height
  lockScalingFlip: true,
} as const

/**
 * Приводит высоту Textbox к фактической высоте текста при текущей ширине.
 * Убирает «мёртвую» пустую зону снизу рамки.
 */
export function fitTextboxHeight(tb: Textbox): void {
  tb.set({ padding: 0, scaleY: 1 })
  // Пересчёт разбивки строк под текущую ширину
  tb.initDimensions()
  const h = tb.calcTextHeight()
  if (h > 0) tb.set({ height: h })
  tb.setCoords()
}

/** Textbox с нулевыми отступами и высотой, подогнанной под текст. */
export function createTextbox(text: string, options: Record<string, unknown>): Textbox {
  const tb = new Textbox(text, { ...TEXT_DEFAULTS, ...options })
  fitTextboxHeight(tb)
  return tb
}

/**
 * Привязывает высоту текстовых блоков к объёму текста:
 *   • тянем правую сторону  → меняется ШИРИНА, текст переносится, высота = высота текста
 *   • тянем нижний правый угол → то же (без пропорционального сжатия текста)
 *   • правим текст (вход/выход из редактирования) → высота пересчитывается
 */
export function attachTextAutoHeight(canvas: Canvas): () => void {
  const normalize = (obj?: FabricObject) => {
    if (!obj || obj.type !== "textbox") return
    const tb = obj as Textbox
    const sx = tb.scaleX ?? 1
    if (sx !== 1) {
      const newWidth = Math.max(4, (tb.width ?? 0) * sx)
      tb.set({ width: newWidth, scaleX: 1 })
    }
    fitTextboxHeight(tb)
  }

  const onScaling = (e: { target?: FabricObject }) => {
    normalize(e.target)
    canvas.requestRenderAll()
  }
  const onModified = (e: { target?: FabricObject }) => {
    normalize(e.target)
    canvas.requestRenderAll()
  }
  const onChanged = (e: { target?: FabricObject }) => {
    normalize(e.target)
    canvas.requestRenderAll()
  }
  const onAdded = (e: { target?: FabricObject }) => {
    if (e.target?.type === "textbox") {
      const tb = e.target as Textbox
      tb.set({ ...TEXT_DEFAULTS })
      fitTextboxHeight(tb)
    }
  }

  const bus = canvas as unknown as {
    on: (n: string, h: (e: { target?: FabricObject }) => void) => void
    off: (n: string, h: (e: { target?: FabricObject }) => void) => void
  }
  bus.on("object:scaling", onScaling)
  bus.on("object:modified", onModified)
  bus.on("text:changed", onChanged)
  bus.on("editing:exited", onChanged)
  bus.on("object:added", onAdded)

  canvas.getObjects().forEach((o) => { if (o.type === "textbox") { (o as Textbox).set({ ...TEXT_DEFAULTS }); fitTextboxHeight(o as Textbox) } })

  return () => {
    bus.off("object:scaling", onScaling)
    bus.off("object:modified", onModified)
    bus.off("text:changed", onChanged)
    bus.off("editing:exited", onChanged)
    bus.off("object:added", onAdded)
  }
}

// ---------------------------------------------------------------------------
// applyBgRect — патч: bg-rect всегда отправляется вниз стека (sendToBack),
// все остальные объекты остаются выше.
// ---------------------------------------------------------------------------

/**
 * После добавления любого объекта убеждаемся, что bg-rect остаётся
 * первым (самым нижним) в стеке.  Вызывается из attachSmartGuides.
 */
export function ensureBgAtBottom(canvas: Canvas): void {
  const bgObj = canvas.getObjects().find(
    (o) => (o as unknown as { data?: { role?: string } }).data?.role === "bg",
  )
  if (bgObj) canvas.sendObjectToBack(bgObj)
}

// ---------------------------------------------------------------------------
// Применить ограничения трансформации к объекту:
//   • масштаб — только нижний правый угол
//   • растяжение по X — только правая сторона
//   • растяжение по Y — только нижняя сторона
//   • вращение — только верхняя точка, шаг 90°
// ---------------------------------------------------------------------------
export function applyTransformConstraints(obj: FabricObject) {
  obj.setControlsVisibility({
    // Разрешённые
    mr: true,   // правая сторона (stretch X)
    mb: true,   // нижняя сторона (stretch Y)
    br: true,   // нижний правый угол (scale)
    mtr: true,  // вращение (сверху)
    // Запрещённые
    tl: false,
    tr: false,
    bl: false,
    ml: false,
    mt: false,
  })
}

// ---------------------------------------------------------------------------
// Добавить вращение на 90° к объекту (вместо свободного rotate)
// Вызывается в обработчике mouseup/touchend после rotate — округляет до 90°
// ---------------------------------------------------------------------------
export function snapRotationTo90(obj: FabricObject) {
  const angle = obj.angle ?? 0
  const snapped = Math.round(angle / 90) * 90
  obj.set({ angle: snapped })
  obj.setCoords()
}

// ---------------------------------------------------------------------------
// Snap state per object: tracks which axis/line is currently snapped
// ---------------------------------------------------------------------------
type SnapAxisState = { snapped: false } | { snapped: true; line: number; edge: "lo" | "cx" | "hi" }

interface ObjSnapState {
  x: SnapAxisState
  y: SnapAxisState
}

const snapStateMap = new WeakMap<FabricObject, ObjSnapState>()

function getSnapState(obj: FabricObject): ObjSnapState {
  let s = snapStateMap.get(obj)
  if (!s) { s = { x: { snapped: false }, y: { snapped: false } }; snapStateMap.set(obj, s) }
  return s
}

// ---------------------------------------------------------------------------
// Подключение Smart Guides + Snapping + Rotate-90 к Fabric-инстансу
// FIX 1: hysteresis — snap at <=SNAP_ENGAGE, release only at >SNAP_RELEASE
// FIX 2: delta positioning — shift by delta instead of recalculating from center
// ---------------------------------------------------------------------------
export function attachSmartGuides(canvas: Canvas, sizeDef: LabelSizeDef): () => void {
  const { w_px, h_px } = sizeDef
  const centerX = w_px / 2
  const centerY = h_px / 2

  const snapLinesX = [0, centerX, w_px]
  const snapLinesY = [0, centerY, h_px]

  // FIX 2: track previous position to compute delta
  const prevPos = new WeakMap<FabricObject, { left: number; top: number }>()

  const onMoving = (e: { target?: FabricObject }) => {
    const obj = e.target
    if (!obj) return

    // --- FIX 2: compute delta from last known position ----------------------
    const curLeft = obj.left ?? 0
    const curTop  = obj.top  ?? 0
    const prev = prevPos.get(obj)
    const deltaLeft = prev ? curLeft - prev.left : 0
    const deltaTop  = prev ? curTop  - prev.top  : 0

    // getBoundingRect() accounts for rotation — real screen bounds
    const br   = obj.getBoundingRect()
    const brCX = br.left + br.width  / 2
    const brCY = br.top  + br.height / 2

    // Offset from object origin to bounding-rect centre
    const ox = curLeft - brCX
    const oy = curTop  - brCY

    const state = getSnapState(obj)

    // --- FIX 1: hysteresis on X axis ----------------------------------------
    let newLeft = curLeft
    if (state.x.snapped) {
      // Already snapped — only release if object moved far enough from snap line
      const snapLine = state.x.line
      let edgePx: number
      switch (state.x.edge) {
        case "lo": edgePx = br.left;  break
        case "cx": edgePx = brCX;     break
        case "hi": edgePx = br.left + br.width; break
      }
      const dist = Math.abs(edgePx + deltaLeft - snapLine)
      if (dist <= SNAP_RELEASE) {
        // Stay snapped — reapply snap position
        switch (state.x.edge) {
          case "lo": newLeft = snapLine + ox + br.width  / 2; break
          case "cx": newLeft = snapLine + ox;                 break
          case "hi": newLeft = snapLine + ox - br.width  / 2; break
        }
      } else {
        state.x = { snapped: false }
        newLeft = curLeft
      }
    } else {
      // Not snapped — find single nearest line within engage threshold
      let bestDist = SNAP_ENGAGE + 1
      let bestLine = 0
      let bestEdge: "lo" | "cx" | "hi" = "lo"
      for (const line of snapLinesX) {
        for (const [edgePx, edge] of [[br.left, "lo"], [brCX, "cx"], [br.left + br.width, "hi"]] as [number, "lo" | "cx" | "hi"][]) {
          const d = Math.abs(edgePx - line)
          if (d <= SNAP_ENGAGE && d < bestDist) { bestDist = d; bestLine = line; bestEdge = edge }
        }
      }
      if (bestDist <= SNAP_ENGAGE) {
        state.x = { snapped: true, line: bestLine, edge: bestEdge }
        switch (bestEdge) {
          case "lo": newLeft = bestLine + ox + br.width  / 2; break
          case "cx": newLeft = bestLine + ox;                 break
          case "hi": newLeft = bestLine + ox - br.width  / 2; break
        }
      }
    }

    // --- FIX 1: hysteresis on Y axis ----------------------------------------
    let newTop = curTop
    if (state.y.snapped) {
      const snapLine = state.y.line
      let edgePy: number
      switch (state.y.edge) {
        case "lo": edgePy = br.top;  break
        case "cx": edgePy = brCY;    break
        case "hi": edgePy = br.top + br.height; break
      }
      const dist = Math.abs(edgePy + deltaTop - snapLine)
      if (dist <= SNAP_RELEASE) {
        switch (state.y.edge) {
          case "lo": newTop = snapLine + oy + br.height / 2; break
          case "cx": newTop = snapLine + oy;                 break
          case "hi": newTop = snapLine + oy - br.height / 2; break
        }
      } else {
        state.y = { snapped: false }
        newTop = curTop
      }
    } else {
      let bestDist = SNAP_ENGAGE + 1
      let bestLine = 0
      let bestEdge: "lo" | "cx" | "hi" = "lo"
      for (const line of snapLinesY) {
        for (const [edgePy, edge] of [[br.top, "lo"], [brCY, "cx"], [br.top + br.height, "hi"]] as [number, "lo" | "cx" | "hi"][]) {
          const d = Math.abs(edgePy - line)
          if (d <= SNAP_ENGAGE && d < bestDist) { bestDist = d; bestLine = line; bestEdge = edge }
        }
      }
      if (bestDist <= SNAP_ENGAGE) {
        state.y = { snapped: true, line: bestLine, edge: bestEdge }
        switch (bestEdge) {
          case "lo": newTop = bestLine + oy + br.height / 2; break
          case "cx": newTop = bestLine + oy;                 break
          case "hi": newTop = bestLine + oy - br.height / 2; break
        }
      }
    }

    // FIX 2: apply computed position and record as new previous
    obj.set({ left: newLeft, top: newTop })
    prevPos.set(obj, { left: newLeft, top: newTop })
    obj.setCoords()
  }

  // Clear snap state + prevPos when drag ends to avoid stale hysteresis
  const onModified = (e: { target?: FabricObject }) => {
    if (!e.target) return
    snapStateMap.delete(e.target)
    prevPos.delete(e.target)
  }

  // После завершения поворота — округляем до ближайшего 90°
  const onRotated = (e: { target?: FabricObject }) => {
    if (e.target) snapRotationTo90(e.target)
  }

  // Применяем ограничения ко всем уже существующим объектам
  canvas.getObjects().forEach(applyTransformConstraints)

  // Применяем к новым объектам при добавлении
  // и гарантируем, что bg-rect остаётся в самом низу стека
  const onAdded = (e: { target?: FabricObject }) => {
    if (e.target) {
      applyTransformConstraints(e.target)
      ensureBgAtBottom(canvas)
    }
  }

  const bus = canvas as unknown as {
    on: (name: string, handler: (e: { target?: FabricObject }) => void) => void
    off: (name: string, handler: (e: { target?: FabricObject }) => void) => void
  }

  bus.on("object:moving", onMoving)
  bus.on("object:modified", onModified)
  bus.on("object:rotating", onRotated)
  bus.on("object:added", onAdded)

  return () => {
    bus.off("object:moving", onMoving)
    bus.off("object:modified", onModified)
    bus.off("object:rotating", onRotated)
    bus.off("object:added", onAdded)
  }
}

// ---------------------------------------------------------------------------
// Добавление рамки выбранного стиля
// Рамка рендерится ПОВЕРХ фона (bg) и всегда кликабельна.
// ИСПРАВЛЕНО: явный stroke/strokeColor/strokeWidth, bringToFront после добавления
// ---------------------------------------------------------------------------
export function addBorderToCanvas(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  styleKey: BorderStyleKey,
) {
  const bs = BORDER_STYLES.find((s) => s.key === styleKey) ?? BORDER_STYLES[0]
  const margin = styleKey === "double" ? 6 : 4

  // ИСПРАВЛЕНО: stroke обязателен и видим; objectCaching: false — корректный рендер
  const rect = new Rect({
    left: margin,
    top: margin,
    width: sizeDef.w_px - margin * 2,
    height: sizeDef.h_px - margin * 2,
    fill: "transparent",
    stroke: "#000000",
    strokeWidth: bs.strokeWidth,
    strokeDashArray: bs.strokeDashArray ?? undefined,
    rx: bs.rx,
    ry: bs.rx,
    objectCaching: false,
    evented: true,
    selectable: true,
    data: { role: `border-${styleKey}-${Date.now()}` },
  })

  // Для двойной рамки добавляем вторую внутреннюю
  if (styleKey === "double") {
    const inner = new Rect({
      left: margin + 4,
      top: margin + 4,
      width: sizeDef.w_px - (margin + 4) * 2,
      height: sizeDef.h_px - (margin + 4) * 2,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 1,
      objectCaching: false,
      evented: true,
      selectable: true,
      data: { role: `border-double-inner-${Date.now()}` },
    })
    canvas.add(inner)
    applyTransformConstraints(inner)
    // ИСПРАВЛЕНО: явный bringObjectToFront гарантирует z-index поверх bg
    canvas.bringObjectToFront(inner)
  }

  canvas.add(rect)
  applyTransformConstraints(rect)
  // ИСПРАВЛЕНО: явный bringObjectToFront — рамка всегда поверх bg
  canvas.bringObjectToFront(rect)
  ensureBgAtBottom(canvas)
  canvas.requestRenderAll()
}

// ---------------------------------------------------------------------------
// Дефолтный макет (включая металл, характеристики, цену и QR)
// ---------------------------------------------------------------------------
export async function buildDefaultLayout(
  canvas: Canvas,
  data: Product,
  sizeDef: LabelSizeDef,
): Promise<void> {
  if (!canvas.lowerCanvasEl) return
  canvas.clear()
  canvas.backgroundColor = ""

  const body = getBodyPx(sizeDef)
  const W = body.w
  const H = body.h
  const { metalLine, weightLine, sizeLine, priceLine } = buildJewelryText(data)
  const skuValue = data.sku || "NO-SKU"

  if (W >= H) {
    await buildHorizontalLayout(canvas, data, W, H, metalLine, weightLine, sizeLine, priceLine, skuValue)
  } else {
    await buildVerticalLayout(canvas, data, W, H, metalLine, weightLine, sizeLine, priceLine, skuValue)
  }

  canvas.renderAll()
}

async function buildHorizontalLayout(
  canvas: Canvas,
  data: Product,
  W: number,
  H: number,
  metalLine: string,
  weightLine: string,
  sizeLine: string,
  priceLine: string,
  skuValue: string,
): Promise<void> {
  const colLeft = Math.round(W * 0.63)
  const qrSize = Math.min(Math.round(W * 0.32), H - 16)

  // Металл (полужирный префикс)
  const metal = createTextbox(metalLine || "—", {
    left: 8, top: Math.round(H * 0.04), width: colLeft - 12,
    fontSize: Math.max(8, Math.round(H * 0.12)), fontWeight: "bold",
    data: { role: "metal" },
  })

  // Строка «Вес + Размер»
  const specs = createTextbox(`Вес: ${weightLine}  Разм: ${sizeLine}`, {
    left: 8, top: Math.round(H * 0.22), width: colLeft - 12,
    fontSize: Math.max(7, Math.round(H * 0.11)), data: { role: "specs" },
  })

  // Подпись «Цена:»
  const priceLabel = createTextbox("Цена:", {
    left: 8, top: Math.round(H * 0.44), width: colLeft - 12,
    fontSize: Math.max(7, Math.round(H * 0.11)), data: { role: "price-label" },
  })

  // Сама цена — жирным
  const price = createTextbox(priceLine, {
    left: 8, top: Math.round(H * 0.60), width: colLeft - 12,
    fontSize: Math.max(11, Math.round(H * 0.18)), fontWeight: "bold",
    data: { role: "price" },
  })

  const qrDataUrl = await safeQrDataUrl(data)
  if (!canvas.lowerCanvasEl) return
  const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
  if (qrImg) {
    const scale = qrSize / (qrImg.width || qrSize)
    qrImg.set({
      left: colLeft + 4,
      top: Math.round((H - qrSize) / 2),
      scaleX: scale, scaleY: scale,
      data: { role: "qr" },
    })
  }

  const skuText = createTextbox(skuValue, {
    left: colLeft, top: Math.round(H * 0.84), width: W - colLeft - 4,
    fontSize: Math.max(7, Math.round(H * 0.09)), textAlign: "center",
    data: { role: "sku" },
  })

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, specs, priceLabel, price, skuText)
  if (qrImg) canvas.add(qrImg)
}

async function buildVerticalLayout(
  canvas: Canvas,
  data: Product,
  W: number,
  H: number,
  metalLine: string,
  weightLine: string,
  sizeLine: string,
  priceLine: string,
  skuValue: string,
): Promise<void> {
  const qrSize = Math.min(Math.round(W * 0.55), Math.round(H * 0.22))

  // Металл
  const metal = createTextbox(metalLine || "—", {
    left: 6, top: Math.round(H * 0.03), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.08)), fontWeight: "bold",
    data: { role: "metal" },
  })

  // Вес + Размер
  const specs = createTextbox(`Вес: ${weightLine}\nРазм: ${sizeLine}`, {
    left: 6, top: Math.round(H * 0.12), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.07)), data: { role: "specs" },
  })

  // Подпись «Цена:»
  const priceLabel = createTextbox("Цена:", {
    left: 6, top: Math.round(H * 0.30), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.07)), data: { role: "price-label" },
  })

  // Цена — жирным
  const price = createTextbox(priceLine, {
    left: 6, top: Math.round(H * 0.39), width: W - 12,
    fontSize: Math.max(10, Math.round(W * 0.11)), fontWeight: "bold",
    data: { role: "price" },
  })

  const qrDataUrl = await safeQrDataUrl(data)
  if (!canvas.lowerCanvasEl) return
  const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
  if (qrImg) {
    const scale = qrSize / (qrImg.width || qrSize)
    qrImg.set({
      left: Math.round((W - qrSize) / 2),
      top: Math.round(H * 0.52),
      scaleX: scale, scaleY: scale,
      data: { role: "qr" },
    })
  }

  const skuText = createTextbox(skuValue, {
    left: 4, top: Math.round(H * 0.76), width: W - 8,
    fontSize: Math.max(6, Math.round(W * 0.07)), textAlign: "center",
    data: { role: "sku" },
  })

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, specs, priceLabel, price, skuText)
  if (qrImg) canvas.add(qrImg)
}

// ---------------------------------------------------------------------------
// Обновление живых данных без сдвига позиций
// ---------------------------------------------------------------------------
export async function refreshLiveData(canvas: Canvas, data: Product): Promise<void> {
  const { metalLine, weightLine, sizeLine, priceLine } = buildJewelryText(data)
  const skuValue = data.sku || "NO-SKU"
  for (const obj of canvas.getObjects()) {
    const role = getRole(obj)
    if (!role || obj.type !== "textbox") continue
    const tb = obj as Textbox
    switch (role) {
      // Металл — строго только содержимое поля, без подписи «Металл:»
      case "metal": tb.set({ text: `${metalLine}` }); break
      case "specs": tb.set({ text: `Вес: ${weightLine}  Разм: ${sizeLine}` }); break
      case "price": tb.set({ text: priceLine }); break
      case "sku":   tb.set({ text: skuValue }); break
    }
    fitTextboxHeight(tb)
  }
  canvas.renderAll()
}

// ---------------------------------------------------------------------------
// Кроп печатной области из увеличенного холста
// ---------------------------------------------------------------------------
export function cropPrintArea(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  offsetX: number,
  offsetY: number,
): HTMLCanvasElement {
  const el = canvas.getElement()
  const ratio = canvas.getWidth() ? el.width / canvas.getWidth() : 1
  const out = document.createElement("canvas")
  out.width = Math.round(sizeDef.w_px * ratio)
  out.height = Math.round(sizeDef.h_px * ratio)
  const ctx = out.getContext("2d")
  if (ctx) {
    ctx.drawImage(
      el,
      Math.round(offsetX * ratio),
      Math.round(offsetY * ratio),
      out.width,
      out.height,
      0, 0,
      out.width,
      out.height,
    )
  }
  return out
}