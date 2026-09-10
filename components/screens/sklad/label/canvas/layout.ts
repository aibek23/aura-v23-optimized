// ---------------------------------------------------------------------------
// Дефолтный макет этикетки + обновление живых данных
// ---------------------------------------------------------------------------
import { Canvas, Image as FabricImage } from "fabric"
import type { Product } from "@/lib/types"
import type { LabelSizeDef } from "@/lib/niimbot"
import { getRole } from "../types"
import { getBodyPx } from "../components/label-background"
import { createTextbox, refitTextbox } from "./text-fit"
import { buildJewelryText } from "../data/jewelry-text"
import { safeQrDataUrl } from "../data/qr"

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
  const qrSize  = Math.min(Math.round(W * 0.32), H - 16)

  const metal = createTextbox(metalLine || "—", {
    left: 8, top: Math.round(H * 0.04), width: colLeft - 12,
    fontSize: Math.max(8, Math.round(H * 0.12)), fontWeight: "bold",
    data: { role: "metal" },
  })
  const weightText = createTextbox(`Вес: ${weightLine}`, {
    left: 8, top: Math.round(H * 0.22), width: colLeft - 12,
    fontSize: Math.max(7, Math.round(H * 0.11)), data: { role: "weight" },
  })
  const sizeText = createTextbox(`Разм: ${sizeLine}`, {
    left: 8, top: Math.round(H * 0.33), width: colLeft - 12,
    fontSize: Math.max(7, Math.round(H * 0.11)), data: { role: "size" },
  })
  const priceLabel = createTextbox("Цена:", {
    left: 8, top: Math.round(H * 0.44), width: colLeft - 12,
    fontSize: Math.max(7, Math.round(H * 0.11)), data: { role: "price-label" },
  })
  const price = createTextbox(priceLine, {
    left: 8, top: Math.round(H * 0.60), width: colLeft - 12,
    fontSize: Math.max(11, Math.round(H * 0.18)), fontWeight: "bold",
    data: { role: "price" },
  })
  const skuText = createTextbox(skuValue, {
    left: colLeft, top: Math.round(H * 0.84), width: W - colLeft - 4,
    fontSize: Math.max(7, Math.round(H * 0.09)), textAlign: "center",
    data: { role: "sku" },
  })

  const qrDataUrl = await safeQrDataUrl(data)
  if (!canvas.lowerCanvasEl) return
  const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
  if (qrImg) {
    const scale = qrSize / (qrImg.width || qrSize)
    qrImg.set({
      left: colLeft + 4, top: Math.round((H - qrSize) / 2),
      scaleX: scale, scaleY: scale,
      data: { role: "qr" },
    })
  }

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, weightText, sizeText, priceLabel, price, skuText)
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

  const metal = createTextbox(metalLine || "—", {
    left: 6, top: Math.round(H * 0.03), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.08)), fontWeight: "bold",
    data: { role: "metal" },
  })
  const weightText = createTextbox(`Вес: ${weightLine}`, {
    left: 6, top: Math.round(H * 0.12), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.07)), data: { role: "weight" },
  })
  const sizeText = createTextbox(`Разм: ${sizeLine}`, {
    left: 6, top: Math.round(H * 0.20), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.07)), data: { role: "size" },
  })
  const priceLabel = createTextbox("Цена:", {
    left: 6, top: Math.round(H * 0.30), width: W - 12,
    fontSize: Math.max(7, Math.round(W * 0.07)), data: { role: "price-label" },
  })
  const price = createTextbox(priceLine, {
    left: 6, top: Math.round(H * 0.39), width: W - 12,
    fontSize: Math.max(10, Math.round(W * 0.11)), fontWeight: "bold",
    data: { role: "price" },
  })
  const skuText = createTextbox(skuValue, {
    left: 4, top: Math.round(H * 0.76), width: W - 8,
    fontSize: Math.max(6, Math.round(W * 0.07)), textAlign: "center",
    data: { role: "sku" },
  })

  const qrDataUrl = await safeQrDataUrl(data)
  if (!canvas.lowerCanvasEl) return
  const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
  if (qrImg) {
    const scale = qrSize / (qrImg.width || qrSize)
    qrImg.set({
      left: Math.round((W - qrSize) / 2), top: Math.round(H * 0.52),
      scaleX: scale, scaleY: scale,
      data: { role: "qr" },
    })
  }

  if (!canvas.lowerCanvasEl) return
  canvas.add(metal, weightText, sizeText, priceLabel, price, skuText)
  if (qrImg) canvas.add(qrImg)
}

export async function buildDefaultLayout(
  canvas: Canvas,
  data: Product,
  sizeDef: LabelSizeDef,
): Promise<void> {
  if (!canvas.lowerCanvasEl) return
  canvas.clear()
  canvas.backgroundColor = ""

  const body       = getBodyPx(sizeDef)
  const { metalLine, weightLine, sizeLine, priceLine } = buildJewelryText(data)
  const skuValue   = data.sku || "NO-SKU"

  if (body.w >= body.h) {
    await buildHorizontalLayout(canvas, data, body.w, body.h, metalLine, weightLine, sizeLine, priceLine, skuValue)
  } else {
    await buildVerticalLayout(canvas, data, body.w, body.h, metalLine, weightLine, sizeLine, priceLine, skuValue)
  }
  canvas.renderAll()
}

export async function refreshLiveData(canvas: Canvas, data: Product): Promise<void> {
  const { metalLine, weightLine, sizeLine, priceLine } = buildJewelryText(data)
  const skuValue = data.sku || "NO-SKU"
  const { Textbox } = await import("fabric")
  for (const obj of canvas.getObjects()) {
    const role = getRole(obj)
    if (!role || obj.type !== "textbox") continue
    const tb = obj as InstanceType<typeof Textbox>
    switch (role) {
      case "metal":       tb.set({ text: metalLine }); break
      case "weight":      tb.set({ text: `Вес: ${weightLine}` }); break
      case "size":        tb.set({ text: `Разм: ${sizeLine}` }); break
      case "price-label": tb.set({ text: "Цена:" }); break
      case "price":       tb.set({ text: priceLine }); break
      case "sku":         tb.set({ text: skuValue }); break
    }
    refitTextbox(tb)
  }
  canvas.renderAll()
}
