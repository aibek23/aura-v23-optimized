// ---------------------------------------------------------------------------
// Логика холста: дефолтный макет, кроп, обновление живых данных
// ---------------------------------------------------------------------------
import { Canvas, Textbox, Image as FabricImage } from "fabric"
import type { Product } from "@/lib/types"
import type { LabelSizeDef } from "@/lib/niimbot"
import { getRole } from "./label-editor.types"
import { buildJewelryText, safeQrDataUrl } from "./label-editor.helpers"
import { getBodyPx } from "./label-background"

// ---------------------------------------------------------------------------
// Дефолтный макет (без названия изделия)
// ---------------------------------------------------------------------------
export async function buildDefaultLayout(
  canvas: Canvas,
  data: Product,
  sizeDef: LabelSizeDef,
): Promise<void> {
  if (!canvas.lowerCanvasEl) return
  canvas.clear()
  // Прозрачный фон по умолчанию — видно бумажную SVG-подложку
  canvas.backgroundColor = ""

  // Рисуем макет строго внутри тела бирки (без хвостика) — иначе текст
  // попадает на узкий хвостик и обрезается при печати.
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
  // Горизонтальный макет (T50×30)
  const colLeft = Math.round(W * 0.63)
  const qrSize = Math.min(Math.round(W * 0.32), H - 16)

  const metal = new Textbox(`Металл: ${metalLine}`, {
    left: 8, top: Math.round(H * 0.06), width: colLeft - 12,
    fontSize: Math.max(8, Math.round(H * 0.12)), data: { role: "metal" },
  })
  const specs = new Textbox(`Вес: ${weightLine}  Разм: ${sizeLine}`, {
    left: 8, top: Math.round(H * 0.34), width: colLeft - 12,
    fontSize: Math.max(8, Math.round(H * 0.12)), data: { role: "specs" },
  })
  const price = new Textbox(priceLine, {
    left: 8, top: Math.round(H * 0.60), width: colLeft - 12,
    fontSize: Math.max(12, Math.round(H * 0.20)), fontWeight: "bold",
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

  const skuText = new Textbox(skuValue, {
    left: colLeft, top: Math.round(H * 0.84), width: W - colLeft - 4,
    fontSize: Math.max(7, Math.round(H * 0.09)), textAlign: "center",
    data: { role: "sku" },
  })

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, specs, price, skuText)
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
  // Вертикальный макет (бирки с хвостиком)
  const qrSize = Math.min(Math.round(W * 0.55), Math.round(H * 0.22))

  const metal = new Textbox(`Металл: ${metalLine}`, {
    left: 6, top: Math.round(H * 0.06), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.08)), data: { role: "metal" },
  })
  const specs = new Textbox(`Вес: ${weightLine}\nРазм: ${sizeLine}`, {
    left: 6, top: Math.round(H * 0.20), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.08)), data: { role: "specs" },
  })
  const price = new Textbox(priceLine, {
    left: 6, top: Math.round(H * 0.37), width: W - 12,
    fontSize: Math.max(10, Math.round(W * 0.12)), fontWeight: "bold",
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

  const skuText = new Textbox(skuValue, {
    left: 4, top: Math.round(H * 0.76), width: W - 8,
    fontSize: Math.max(6, Math.round(W * 0.07)), textAlign: "center",
    data: { role: "sku" },
  })

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, specs, price, skuText)
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
      case "metal": tb.set({ text: `Металл: ${metalLine}` }); break
      case "specs": tb.set({ text: `Вес: ${weightLine}  Разм: ${sizeLine}` }); break
      case "price": tb.set({ text: priceLine }); break
      case "sku":   tb.set({ text: skuValue }); break
    }
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
