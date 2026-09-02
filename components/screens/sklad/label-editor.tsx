"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Canvas, Textbox, Rect, Image as FabricImage, type FabricObject } from "fabric"
import QRCode from "qrcode"
import type { Product } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Printer, Save, RefreshCw, Trash2, Type, Square, ZoomIn, ZoomOut, X } from "lucide-react"
import { toast } from "sonner"
import {
  LABEL_SIZES,
  DEFAULT_SIZE_KEY,
  type LabelSizeDef,
  type JewelryLabelSizeKey,
  printCanvas,
} from "@/lib/niimbot"
import { deleteLabelTemplate, getLabelTemplate, saveLabelTemplate } from "@/app/actions/labels"
import { LabelBackground, getSvgLayout } from "./label-background"

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------
const FONTS = ["Arial", "Helvetica", "Times New Roman", "Courier New", "Georgia", "Verdana"]

const SIZE_OPTIONS: JewelryLabelSizeKey[] = [
  "T25x30_45",
  "T30x25_50",
  "T50x30_rect",
]

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3.0

/** Версия компактного формата шаблона (в БД хранится только геометрия). */
const TEMPLATE_VERSION = 3

/** Роли, которые создаёт стандартный макет. */
const LIVE_ROLES = ["metal", "specs", "price", "sku", "qr"] as const

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------
export interface LabelEditorProps {
  product: Product
  autoPrint?: boolean
  initialSizeKey?: JewelryLabelSizeKey
  onClose?: () => void
}

/** Один элемент компактного шаблона — только позиция и оформление. */
interface TemplateItem {
  role: string
  kind: "textbox" | "rect" | "image"
  left: number
  top: number
  angle?: number
  scaleX?: number
  scaleY?: number
  width?: number
  height?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  textAlign?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  /** Текст сохраняется только для пользовательских надписей (роль custom-*). */
  text?: string
}

interface LabelTemplate {
  v: number
  sizeKey: string
  bg: string | null
  items: TemplateItem[]
}

type WithRole = FabricObject & { data?: { role?: string } }

const r2 = (n: number | undefined, fallback = 0) =>
  Math.round((typeof n === "number" && Number.isFinite(n) ? n : fallback) * 100) / 100

const getRole = (obj: FabricObject): string | undefined => (obj as WithRole).data?.role

// ---------------------------------------------------------------------------
// Хелперы данных
// ---------------------------------------------------------------------------
function buildJewelryText(data: Product) {
  const metalLine = [data.metal, data.purity].filter(Boolean).join(" • ") || "—"
  const weightLine = data.weight ? `${data.weight} г` : "—"
  const sizeLine = data.size || "—"
  const priceLine = `${data.sale_price.toLocaleString("ru")} сом`
  return { metalLine, weightLine, sizeLine, priceLine }
}

/**
 * Строит короткий QR-URL вида /q/{shopSeqId}/{sku} (только ASCII — QR-код
 * остаётся компактным и легко читается сканерами).
 * Если seq_id ещё не проставлен (старая запись) — падаем обратно на UUID.
 */
function buildQrUrl(data: Product): string {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://aura-gold.kg").replace(/\/$/, "")
  const skuValue = (data.sku || "").trim().toUpperCase()
  // Короткий числовой ID магазина, иначе — UUID магазина (обратная совместимость)
  const shopKey = String(data.shop_seq_id ?? data.shop_id ?? "").trim()
  // ID самого изделия: попадает в QR как параметр, чтобы сканер всегда получал
  // однозначный идентификатор записи, даже если артикул позже изменится.
  const productId = String(data.id ?? "").trim()
  const hasRealId = Boolean(productId) && productId !== "draft"

  if (!shopKey || !skuValue || !hasRealId) {
    // Явно сигнализируем о неполных данных вместо тихой генерации битой ссылки
    throw new Error(
      "Недостаточно данных для QR-кода: сначала сохраните товар (нужны ID изделия, артикул и магазин).",
    )
  }

  return `${baseUrl}/q/${shopKey}/${encodeURIComponent(skuValue)}?id=${productId}`
}


/**
 * Безопасно генерирует QR-картинку. Если данных не хватает (товар ещё не
 * сохранён) — возвращает null и показывает понятную ошибку вместо битого QR.
 */
async function safeQrDataUrl(data: Product): Promise<string | null> {
  try {
    return await QRCode.toDataURL(buildQrUrl(data), { margin: 0 })
  } catch (e) {
    console.error("[label] QR build error:", e)
    toast.error(e instanceof Error ? e.message : "Не удалось сформировать QR-код")
    return null
  }
}

// ---------------------------------------------------------------------------
// Компактная сериализация шаблона
// ---------------------------------------------------------------------------
/**
 * Сохраняем ТОЛЬКО координаты и стиль элементов.
 * Изображение QR (base64) в шаблон не попадает — именно оно раздувало
 * payload server action до нескольких мегабайт («слишком большие данные»).
 */
function serializeLayout(canvas: Canvas, sizeKey: string, bg: string | null): LabelTemplate {
  const items: TemplateItem[] = []

  canvas.getObjects().forEach((obj, index) => {
    const role = getRole(obj) ?? `custom-${index}`
    if (role === "bg") return

    const kind: TemplateItem["kind"] =
      obj.type === "textbox" ? "textbox" : obj.type === "image" ? "image" : "rect"

    const item: TemplateItem = {
      role,
      kind,
      left: r2(obj.left),
      top: r2(obj.top),
      angle: r2(obj.angle),
      scaleX: r2(obj.scaleX, 1),
      scaleY: r2(obj.scaleY, 1),
      width: r2(obj.width),
      height: r2(obj.height),
    }

    if (kind === "textbox") {
      const tb = obj as Textbox
      item.fontSize = r2(tb.fontSize, 12)
      item.fontFamily = String(tb.fontFamily ?? "Arial")
      item.fontWeight = (tb.fontWeight as string) ?? "normal"
      item.textAlign = String(tb.textAlign ?? "left")
      item.fill = typeof tb.fill === "string" ? tb.fill : "#000000"
      if (role.startsWith("custom-")) item.text = String(tb.text ?? "").slice(0, 200)
    }

    if (kind === "rect") {
      item.fill = typeof obj.fill === "string" ? obj.fill : "transparent"
      item.stroke = typeof obj.stroke === "string" ? obj.stroke : "#000000"
      item.strokeWidth = r2(obj.strokeWidth, 1)
    }

    items.push(item)
  })

  return { v: TEMPLATE_VERSION, sizeKey, bg, items }
}

function parseTemplate(raw: string | null | undefined): LabelTemplate | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<LabelTemplate>
    if (parsed?.v !== TEMPLATE_VERSION || !Array.isArray(parsed.items)) return null
    return {
      v: TEMPLATE_VERSION,
      sizeKey: String(parsed.sizeKey ?? ""),
      bg: parsed.bg ?? null,
      items: parsed.items as TemplateItem[],
    }
  } catch {
    return null
  }
}

/**
 * Накладываем сохранённые координаты на уже построенный стандартный макет.
 * Живые данные (текст/QR) остаются актуальными, двигается только геометрия.
 */
function applyTemplate(canvas: Canvas, tpl: LabelTemplate): void {
  const byRole = new Map(tpl.items.map((i) => [i.role, i]))
  const savedRoles = new Set(tpl.items.map((i) => i.role))

  // Удаляем стандартные элементы, которых нет в сохранённом шаблоне
  for (const obj of [...canvas.getObjects()]) {
    const role = getRole(obj)
    if (role && LIVE_ROLES.includes(role as (typeof LIVE_ROLES)[number]) && !savedRoles.has(role)) {
      canvas.remove(obj)
    }
  }

  // Позиционируем существующие
  for (const obj of canvas.getObjects()) {
    const role = getRole(obj)
    if (!role) continue
    const item = byRole.get(role)
    if (!item) continue
    applyItemToObject(obj, item)
    byRole.delete(role)
  }

  // Пересоздаём пользовательские элементы
  for (const item of byRole.values()) {
    if (item.kind === "textbox") {
      const tb = new Textbox(item.text ?? "Текст", {
        left: item.left,
        top: item.top,
        width: item.width || 80,
        fontSize: item.fontSize ?? 12,
        fontFamily: item.fontFamily ?? "Arial",
        fontWeight: item.fontWeight ?? "normal",
        textAlign: (item.textAlign as Textbox["textAlign"]) ?? "left",
        fill: item.fill ?? "#000000",
        angle: item.angle ?? 0,
        scaleX: item.scaleX ?? 1,
        scaleY: item.scaleY ?? 1,
        data: { role: item.role },
      })
      canvas.add(tb)
    } else if (item.kind === "rect") {
      const rect = new Rect({
        left: item.left,
        top: item.top,
        width: item.width || 40,
        height: item.height || 20,
        fill: item.fill ?? "transparent",
        stroke: item.stroke ?? "#000000",
        strokeWidth: item.strokeWidth ?? 1,
        angle: item.angle ?? 0,
        scaleX: item.scaleX ?? 1,
        scaleY: item.scaleY ?? 1,
        data: { role: item.role },
      })
      canvas.add(rect)
    }
  }

  canvas.renderAll()
}

function applyItemToObject(obj: FabricObject, item: TemplateItem): void {
  obj.set({
    left: item.left,
    top: item.top,
    angle: item.angle ?? 0,
    scaleX: item.scaleX ?? 1,
    scaleY: item.scaleY ?? 1,
  })

  if (obj.type === "textbox") {
    const tb = obj as Textbox
    tb.set({
      width: item.width || tb.width,
      fontSize: item.fontSize ?? tb.fontSize,
      fontFamily: item.fontFamily ?? tb.fontFamily,
      fontWeight: item.fontWeight ?? tb.fontWeight,
      textAlign: (item.textAlign as Textbox["textAlign"]) ?? tb.textAlign,
      fill: item.fill ?? tb.fill,
    })
  }

  if (obj.type === "rect") {
    obj.set({
      width: item.width || obj.width,
      height: item.height || obj.height,
      fill: item.fill ?? obj.fill,
      stroke: item.stroke ?? obj.stroke,
      strokeWidth: item.strokeWidth ?? obj.strokeWidth,
    })
  }

  obj.setCoords()
}

// ---------------------------------------------------------------------------
// Фон печатной области (прямоугольник вместо canvas.backgroundColor:
// холст теперь больше бирки, заливать его целиком нельзя)
// ---------------------------------------------------------------------------
function applyBgRect(canvas: Canvas, sizeDef: LabelSizeDef, color: string | null): void {
  const existing = canvas.getObjects().find((o) => getRole(o) === "bg")
  if (existing) canvas.remove(existing)
  if (!color) {
    canvas.renderAll()
    return
  }
  const rect = new Rect({
    left: 0,
    top: 0,
    width: sizeDef.w_px,
    height: sizeDef.h_px,
    fill: color,
    selectable: false,
    evented: false,
    data: { role: "bg" },
  })
  canvas.add(rect)
  canvas.sendObjectToBack(rect)
  canvas.renderAll()
}

// ---------------------------------------------------------------------------
// Обновление живых данных без сдвига позиций
// ---------------------------------------------------------------------------
async function refreshLiveData(canvas: Canvas, data: Product): Promise<void> {
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
// Дефолтный макет (без названия изделия)
// ---------------------------------------------------------------------------
async function buildDefaultLayout(canvas: Canvas, data: Product, sizeDef: LabelSizeDef): Promise<void> {
  if (!canvas.lowerCanvasEl) return
  canvas.clear()
  // Прозрачный фон по умолчанию — видно бумажную SVG-подложку
  canvas.backgroundColor = ""

  const W = sizeDef.w_px
  const H = sizeDef.h_px
  const { metalLine, weightLine, sizeLine, priceLine } = buildJewelryText(data)
  const skuValue = data.sku || "NO-SKU"

  if (W >= H) {
    // Горизонтальный макет (T50*30)
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
      fontSize: Math.max(12, Math.round(H * 0.20)), fontWeight: "bold", data: { role: "price" },
    })

    const qrDataUrl = await safeQrDataUrl(data)
    if (!canvas.lowerCanvasEl) return
    const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
    if (qrImg) {
      const scale = qrSize / (qrImg.width || qrSize)
      qrImg.set({ left: colLeft + 4, top: Math.round((H - qrSize) / 2), scaleX: scale, scaleY: scale, data: { role: "qr" } })
    }

    const skuText = new Textbox(skuValue, {
      left: colLeft, top: Math.round(H * 0.84), width: W - colLeft - 4,
      fontSize: Math.max(7, Math.round(H * 0.09)), textAlign: "center", data: { role: "sku" },
    })

    if (!canvas.lowerCanvasEl) return
    canvas.add(metal, specs, price, skuText)
    if (qrImg) canvas.add(qrImg)
  } else {
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
      fontSize: Math.max(10, Math.round(W * 0.12)), fontWeight: "bold", data: { role: "price" },
    })

    const qrDataUrl = await safeQrDataUrl(data)
    if (!canvas.lowerCanvasEl) return
    const qrImg = qrDataUrl ? await FabricImage.fromURL(qrDataUrl) : null
    if (qrImg) {
      const scale = qrSize / (qrImg.width || qrSize)
      qrImg.set({
        left: Math.round((W - qrSize) / 2), top: Math.round(H * 0.52),
        scaleX: scale, scaleY: scale, data: { role: "qr" },
      })
    }

    const skuText = new Textbox(skuValue, {
      left: 4, top: Math.round(H * 0.76), width: W - 8,
      fontSize: Math.max(6, Math.round(W * 0.07)), textAlign: "center", data: { role: "sku" },
    })

    if (!canvas.lowerCanvasEl) return
    canvas.add(metal, specs, price, skuText)
    if (qrImg) canvas.add(qrImg)
  }

  canvas.renderAll()
}

// ---------------------------------------------------------------------------
// Кроп печатной области из увеличенного холста
// ---------------------------------------------------------------------------
function cropPrintArea(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  offsetX: number,
  offsetY: number
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
      0,
      0,
      out.width,
      out.height
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Компонент LabelEditor
// ---------------------------------------------------------------------------
export function LabelEditor({
  product,
  autoPrint = false,
  initialSizeKey = DEFAULT_SIZE_KEY,
  onClose,
}: LabelEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const autoPrintedRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [status, setStatus] = useState("")
  const [font, setFont] = useState(FONTS[0])
  const [fontSize, setFontSize] = useState(16)
  const [textColor, setTextColor] = useState("#000000")
  const [bgColor, setBgColor] = useState("#ffffff")
  const [bgTransparent, setBgTransparent] = useState(true)
  const [sizeKey, setSizeKey] = useState<JewelryLabelSizeKey>(initialSizeKey)
  const [zoom, setZoom] = useState(1)

  const sizeDef = LABEL_SIZES[sizeKey]
  const category = product.category || "Прочее"

  // SVG-layout для позиционирования холста поверх бумажной формы
  const svgLayout = getSvgLayout(sizeKey, sizeDef)

  // Холст рисуется на всю бумагу, печатная область смещена на canvasX/canvasY.
  // Благодаря этому элементы видно и за пределами печатной области.
  const stageW = svgLayout.svgW
  const stageH = svgLayout.svgH
  const offsetX = svgLayout.canvasX
  const offsetY = svgLayout.canvasY

  // ---- Инициализация холста -----------------------------------------------
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new Canvas(canvasRef.current, {
      width: stageW,
      height: stageH,
      backgroundColor: "",
    })
    // Координаты объектов остаются относительно печатной области
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    fabricRef.current = canvas
    setReady(true)

    ;(async () => {
      try {
        // getLabelTemplate синхронный (localStorage), ключ включает sizeKey
        const saved = parseTemplate(getLabelTemplate(category, sizeKey))
        if (!canvas.lowerCanvasEl) return
        await buildDefaultLayout(canvas, product, sizeDef)
        if (!canvas.lowerCanvasEl) return
        if (saved) {
          applyTemplate(canvas, saved)
          await refreshLiveData(canvas, product)
          setBgTransparent(!saved.bg)
          if (saved.bg) setBgColor(saved.bg)
          applyBgRect(canvas, sizeDef, saved.bg)
        }
        canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
        canvas.renderAll()
      } catch {
        if (canvas.lowerCanvasEl) {
          await buildDefaultLayout(canvas, product, sizeDef)
          canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
          canvas.renderAll()
        }
      }
    })()

    return () => {
      fabricRef.current = null
      setReady(false)
      canvas.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKey, product.id, category])

  // ---- Печать -------------------------------------------------------------
  const handlePrint = useCallback(async () => {
    const canvas = fabricRef.current
    if (!canvas) return
    setIsPrinting(true)
    setStatus("")
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      // Печатаем только печатную область, всё что за её пределами — обрезается
      const printEl = cropPrintArea(canvas, sizeDef, offsetX, offsetY)
      await printCanvas(printEl, sizeDef, { onProgress: setStatus })
      toast.success("Этикетка отправлена на печать")
    } catch (err) {
      const e = err as Error & { name?: string }
      console.error("[Niimbot Print Error]:", e)
      const isCancelled =
        e.name === "NotFoundError" || e.name === "AbortError" ||
        e.message?.toLowerCase().includes("user cancelled") ||
        e.message?.toLowerCase().includes("no device selected")
      if (isCancelled) {
        toast.info("Выбор Bluetooth-устройства отменён. Нажмите «Печать» ещё раз.")
      } else {
        toast.error(e.message || "Ошибка печати по Bluetooth")
      }
    } finally {
      setStatus("")
      setIsPrinting(false)
    }
  }, [sizeDef, offsetX, offsetY])

  useEffect(() => {
    if (!autoPrint || !ready || autoPrintedRef.current) return
    autoPrintedRef.current = true
    void handlePrint()
  }, [autoPrint, ready, handlePrint])

  // ---- Зум ----------------------------------------------------------------
  const handleZoom = useCallback((delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, parseFloat((z + delta).toFixed(2)))))
  }, [])

  // ---- Инструменты редактирования -----------------------------------------
  const applyToSelection = (patch: Record<string, unknown>) => {
    const canvas = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) { toast.info("Выделите элемент на холсте"); return }
    objects.forEach((o) => o.set(patch))
    canvas.renderAll()
  }

  const addText = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const t = new Textbox("Текст", {
      left: 20, top: 20, width: Math.round(sizeDef.w_px * 0.5),
      fontSize, fontFamily: font, fill: textColor,
      data: { role: `custom-t-${Date.now()}` },
    })
    canvas.add(t)
    canvas.setActiveObject(t)
    canvas.renderAll()
  }

  const addBorder = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.add(new Rect({
      left: 4, top: 4, width: sizeDef.w_px - 10, height: sizeDef.h_px - 10,
      fill: "transparent", stroke: textColor, strokeWidth: 2,
      data: { role: `custom-r-${Date.now()}` },
    }))
    canvas.renderAll()
  }

  const removeSelected = () => {
    const canvas = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) return
    objects.forEach((o) => canvas.remove(o))
    canvas.discardActiveObject()
    canvas.renderAll()
  }

  const applyBg = (color: string, transparent: boolean) => {
    const canvas = fabricRef.current
    if (!canvas) return
    applyBgRect(canvas, sizeDef, transparent ? null : color)
  }

  const changeBg = (color: string) => {
    setBgColor(color)
    setBgTransparent(false)
    applyBg(color, false)
  }

  const toggleBgTransparent = (transparent: boolean) => {
    setBgTransparent(transparent)
    applyBg(bgColor, transparent)
  }

  // ---- Сохранение / сброс -------------------------------------------------
  const handleSaveTemplate = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      const tpl = serializeLayout(canvas, sizeKey, bgTransparent ? null : bgColor)
      const payload = JSON.stringify(tpl)
      saveLabelTemplate(category, payload, sizeKey)
      toast.success(`Расположение сохранено для «${category}» / ${sizeKey}`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleResetTemplate = async () => {
    const canvas = fabricRef.current
    if (!canvas) return
    deleteLabelTemplate(category, sizeKey)
    setBgColor("#ffffff")
    setBgTransparent(true)
    await buildDefaultLayout(canvas, product, sizeDef)
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    canvas.renderAll()
    toast.success("Возвращён стандартный эскиз")
  }

  // ---- Рендер -------------------------------------------------------------
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Лоадер во время печати */}
      {isPrinting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm rounded-2xl">
          <div className="relative flex items-center justify-center">
            <span className="absolute h-11 w-11 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin" />
            <span className="rotate-45 rounded-sm bg-primary/20 border border-primary/40 h-4 w-4" />
          </div>
          {status && <p className="text-xs text-muted-foreground">{status}</p>}
        </div>
      )}
      {/* Шапка (full-screen на мобильных) */}
      {onClose && (
        <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
          <span className="text-sm font-semibold truncate max-w-[70vw]">
            Этикетка · {sizeDef.label}
          </span>
          <button type="button" onClick={onClose}
            className="rounded-full p-1.5 hover:bg-muted transition-colors" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Скроллируемое тело */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-3 p-3">

          {/* Выбор формата */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">Формат бирки</Label>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_OPTIONS.map((key) => (
                <button key={key} type="button" onClick={() => setSizeKey(key)}
                  className={[
                    "rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors",
                    key === sizeKey
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  ].join(" ")}>
                  {LABEL_SIZES[key].label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Печатная область: {sizeDef.w_px}×{sizeDef.h_px} px
            </p>
          </div>

          {/* Панель инструментов */}
          <div className="flex flex-wrap items-center gap-1 border-b pb-2">
            <Button variant="outline" size="sm" onClick={addText}>
              <Type className="mr-1 h-3.5 w-3.5" />Текст
            </Button>
            <Button variant="outline" size="sm" onClick={addBorder}>
              <Square className="mr-1 h-3.5 w-3.5" />Рамка
            </Button>
            <Button variant="outline" size="sm" onClick={removeSelected}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Удалить
            </Button>
            <Button variant="outline" size="sm" onClick={handleSaveTemplate}>
              <Save className="mr-1 h-3.5 w-3.5" />Сохранить
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetTemplate}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />Сброс
            </Button>
          </div>

          {/* Настройки стиля */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Шрифт</Label>
              <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={font}
                onChange={(e) => { setFont(e.target.value); applyToSelection({ fontFamily: e.target.value }) }}>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Размер</Label>
              <input type="number" min={8} max={64}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={fontSize}
                onChange={(e) => { const v = Number(e.target.value) || 16; setFontSize(v); applyToSelection({ fontSize: v }) }} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Цвет текста</Label>
              <input type="color" className="h-8 w-full rounded-md border border-input bg-background"
                value={textColor}
                onChange={(e) => { setTextColor(e.target.value); applyToSelection({ fill: e.target.value }) }} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Фон</Label>
              <div className="flex items-center gap-2">
                <input type="color" disabled={bgTransparent}
                  className="h-8 w-full rounded-md border border-input bg-background disabled:opacity-40"
                  value={bgColor} onChange={(e) => changeBg(e.target.value)} />
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={bgTransparent}
                    onChange={(e) => toggleBgTransparent(e.target.checked)} />
                  прозр.
                </label>
              </div>
            </div>
          </div>

          {/* Легенда SVG-линий */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Линии (только экран):</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-blue-500" />
              область печати
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-green-600" />
              сгиб
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-red-500" />
              обрез
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5 border-t border-dashed border-gray-400" />
              перфорация
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded-sm bg-white/70 ring-1 ring-border" />
              за печатной областью (не печатается)
            </span>
          </div>

          {/* ── Рабочий стол с SVG-подложкой ─────────────────────────────── */}
          <div
            className="relative w-full overflow-auto rounded-xl"
            style={{
              background: "linear-gradient(135deg, #a1a1aa 0%, #d4d4d8 50%, #e4e4e7 100%)",
            }}
          >
            {/* Паттерн точек */}
            <div
              className="pointer-events-none absolute inset-0 rounded-xl opacity-20"
              style={{
                backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />

            {/* Скроллируемая область масштабированного контента */}
            <div
              className="relative overflow-auto"
              style={{ minHeight: stageH * zoom + 48 }}
            >
              <div className="relative flex items-start justify-center p-6">
                <div
                  style={{
                    position: "relative",
                    width: stageW,
                    height: stageH,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    marginBottom: stageH * (zoom - 1),
                    marginRight: stageW * (zoom - 1),
                  }}
                >
                  {/* SVG реалистичная форма бумаги */}
                  <LabelBackground sizeDef={sizeDef} showPrintArea={false} className="absolute top-0 left-0" />

                  {/* Fabric-холст на всю бумагу: элементы видно и за печатной областью */}
                  <div className="absolute left-0 top-0">
                    <canvas ref={canvasRef} />
                  </div>

                  {/* Затемнение (осветление) зоны вне печатной области.
                      Элементы там остаются видимыми, но тускнеют. */}
                  <div className="pointer-events-none absolute inset-0">
                    {/* сверху */}
                    <div
                      className="absolute bg-white/65"
                      style={{ left: 0, top: 0, width: stageW, height: offsetY }}
                    />
                    {/* снизу */}
                    <div
                      className="absolute bg-white/65"
                      style={{
                        left: 0,
                        top: offsetY + sizeDef.h_px,
                        width: stageW,
                        height: Math.max(0, stageH - offsetY - sizeDef.h_px),
                      }}
                    />
                    {/* слева */}
                    <div
                      className="absolute bg-white/65"
                      style={{ left: 0, top: offsetY, width: offsetX, height: sizeDef.h_px }}
                    />
                    {/* справа */}
                    <div
                      className="absolute bg-white/65"
                      style={{
                        left: offsetX + sizeDef.w_px,
                        top: offsetY,
                        width: Math.max(0, stageW - offsetX - sizeDef.w_px),
                        height: sizeDef.h_px,
                      }}
                    />
                    {/* контур печатной области */}
                    <div
                      className="absolute border border-dashed border-blue-500/70"
                      style={{
                        left: offsetX,
                        top: offsetY,
                        width: sizeDef.w_px,
                        height: sizeDef.h_px,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Управление зумом — правый нижний угол */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-2 py-1 backdrop-blur-sm">
              <button type="button" onClick={() => handleZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
                className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30" aria-label="Уменьшить">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-9 text-center text-[11px] font-mono text-white/80">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" onClick={() => handleZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
                className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30" aria-label="Увеличить">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="text-center text-[10px] text-muted-foreground">
            Перетаскивайте элементы мышкой. Позиции сохраняются кнопкой «Сохранить» и
            применяются при следующем открытии. Всё, что вне синей рамки, показано тускло и не печатается.
          </p>
        </div>
      </div>

      {/* Кнопка печати — фиксированная снизу */}
      <div className="shrink-0 border-t bg-background px-3 pb-[env(safe-area-inset-bottom,0px)] pt-2">
        {status && <p className="mb-1 animate-pulse text-xs font-medium text-blue-600">{status}</p>}
        <Button onClick={handlePrint} disabled={isPrinting} className="w-full gap-2">
          <Printer className="h-4 w-4" />
          {isPrinting ? "Печать..." : `Печать на Niimbot B1 · ${sizeDef.label}`}
        </Button>
      </div>
    </div>
  )
}
