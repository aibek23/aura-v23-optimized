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
// Порог магнитного прилипания (px на холсте без масштаба)
// ---------------------------------------------------------------------------
const SNAP_THRESHOLD = 6


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
// Подключение Smart Guides + Snapping + Rotate-90 к Fabric-инстансу
// ---------------------------------------------------------------------------
export function attachSmartGuides(canvas: Canvas, sizeDef: LabelSizeDef): () => void {
  const { w_px, h_px } = sizeDef
  const centerX = w_px / 2
  const centerY = h_px / 2

  const snapPointsX = [0, centerX, w_px]
  const snapPointsY = [0, centerY, h_px]

  const onMoving = (e: { target?: FabricObject }) => {
    const obj = e.target
    if (!obj) return

    const objW = obj.getScaledWidth?.() ?? obj.width ?? 0
    const objH = obj.getScaledHeight?.() ?? obj.height ?? 0
    const objCX = (obj.left ?? 0) + objW / 2
    const objCY = (obj.top ?? 0) + objH / 2
    const objR = (obj.left ?? 0) + objW
    const objB = (obj.top ?? 0) + objH

    for (const snapX of snapPointsX) {
      if (Math.abs((obj.left ?? 0) - snapX) < SNAP_THRESHOLD) { obj.set({ left: snapX }); break }
      if (Math.abs(objCX - snapX) < SNAP_THRESHOLD) { obj.set({ left: snapX - objW / 2 }); break }
      if (Math.abs(objR - snapX) < SNAP_THRESHOLD) { obj.set({ left: snapX - objW }); break }
    }
    for (const snapY of snapPointsY) {
      if (Math.abs((obj.top ?? 0) - snapY) < SNAP_THRESHOLD) { obj.set({ top: snapY }); break }
      if (Math.abs(objCY - snapY) < SNAP_THRESHOLD) { obj.set({ top: snapY - objH / 2 }); break }
      if (Math.abs(objB - snapY) < SNAP_THRESHOLD) { obj.set({ top: snapY - objH }); break }
    }
    obj.setCoords()
  }

  // После завершения поворота — округляем до ближайшего 90°
  const onRotated = (e: { target?: FabricObject }) => {
    if (e.target) snapRotationTo90(e.target)
  }

  // Применяем ограничения ко всем уже существующим объектам
  canvas.getObjects().forEach(applyTransformConstraints)

  // Применяем к новым объектам при добавлении
  const onAdded = (e: { target?: FabricObject }) => {
    if (e.target) applyTransformConstraints(e.target)
  }

  // Fabric v7 использует строго типизированные сигнатуры событий — приводим
  // холст к безопасному минимальному интерфейсу подписки/отписки.
  const bus = canvas as unknown as {
    on: (name: string, handler: (e: { target?: FabricObject }) => void) => void
    off: (name: string, handler: (e: { target?: FabricObject }) => void) => void
  }

  bus.on("object:moving", onMoving)
  bus.on("object:rotating", onRotated)
  bus.on("object:added", onAdded)

  return () => {
    bus.off("object:moving", onMoving)
    bus.off("object:rotating", onRotated)
    bus.off("object:added", onAdded)
  }
}

// ---------------------------------------------------------------------------
// Добавление рамки выбранного стиля
// Рамка НЕ перекрывает объекты внутри: evented=false, selectable=false
// при клике фокус сразу идёт на внутренний элемент
// ---------------------------------------------------------------------------
export function addBorderToCanvas(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  styleKey: BorderStyleKey,
) {
  const bs = BORDER_STYLES.find((s) => s.key === styleKey) ?? BORDER_STYLES[0]
  const margin = styleKey === "double" ? 6 : 4
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
    // Рамка НЕ блокирует клики на объекты внутри
    evented: false,
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
      evented: false,
      data: { role: `border-double-inner-${Date.now()}` },
    })
    canvas.add(inner)
    applyTransformConstraints(inner)
  }

  canvas.add(rect)
  applyTransformConstraints(rect)
  canvas.renderAll()
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