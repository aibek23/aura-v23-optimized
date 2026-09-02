"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Canvas, Textbox, Rect } from "fabric"
import { X } from "lucide-react"
import { toast } from "sonner"
import {
  LABEL_SIZES,
  DEFAULT_SIZE_KEY,
  type JewelryLabelSizeKey,
  printCanvas,
} from "@/lib/niimbot"
import { deleteLabelTemplate, getLabelTemplate, saveLabelTemplate } from "@/app/actions/labels"
import { getSvgLayout } from "./label-background"

// Модули рефакторинга
import {
  FONTS,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  type LabelEditorProps,
} from "./label-editor.types"
import { applyBgRect, applyTemplate, parseTemplate, serializeLayout } from "./label-editor.template"
import { buildDefaultLayout, cropPrintArea, refreshLiveData } from "./label-editor.canvas"
import { LabelEditorToolbar } from "./label-editor-toolbar"
import { LabelEditorCanvasArea } from "./label-editor-canvas-area"



// ---------------------------------------------------------------------------
// Компонент LabelEditor — оркестратор (только состояние + логика)
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

  const svgLayout = getSvgLayout(sizeKey, sizeDef)
  const stageW = Math.max(svgLayout.svgW, svgLayout.canvasX * 2 + sizeDef.w_px)
  const stageH = Math.max(svgLayout.svgH, svgLayout.canvasY * 2 + sizeDef.h_px)
  const offsetX = svgLayout.canvasX
  const offsetY = svgLayout.canvasY

  // ---- Инициализация холста -----------------------------------------------
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new Canvas(canvasRef.current, {
      width: stageW, height: stageH, backgroundColor: "",
    })
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    fabricRef.current = canvas
    setReady(true)

    ;(async () => {
      try {
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

  const changeBg = (color: string) => {
    setBgColor(color)
    setBgTransparent(false)
    const canvas = fabricRef.current
    if (canvas) applyBgRect(canvas, sizeDef, color)
  }

  const toggleBgTransparent = (transparent: boolean) => {
    setBgTransparent(transparent)
    const canvas = fabricRef.current
    if (canvas) applyBgRect(canvas, sizeDef, transparent ? null : bgColor)
  }

  // ---- Сохранение / сброс -------------------------------------------------
  const handleSaveTemplate = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      const tpl = serializeLayout(canvas, sizeKey, bgTransparent ? null : bgColor)
      saveLabelTemplate(category, JSON.stringify(tpl), sizeKey)
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

      {/* Шапка */}
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
          <LabelEditorToolbar
            sizeKey={sizeKey}
            sizeDef={sizeDef}
            font={font}
            fontSize={fontSize}
            textColor={textColor}
            bgColor={bgColor}
            bgTransparent={bgTransparent}
            isPrinting={isPrinting}
            status={status}
            onSizeChange={setSizeKey}
            onAddText={addText}
            onAddBorder={addBorder}
            onRemoveSelected={removeSelected}
            onSaveTemplate={handleSaveTemplate}
            onResetTemplate={() => void handleResetTemplate()}
            onFontChange={(f) => { setFont(f); applyToSelection({ fontFamily: f }) }}
            onFontSizeChange={(s) => { setFontSize(s); applyToSelection({ fontSize: s }) }}
            onTextColorChange={(c) => { setTextColor(c); applyToSelection({ fill: c }) }}
            onBgColorChange={changeBg}
            onBgTransparentChange={toggleBgTransparent}
            onPrint={() => void handlePrint()}
          />

          <LabelEditorCanvasArea
            canvasRef={canvasRef}
            sizeDef={sizeDef}
            stageW={stageW}
            stageH={stageH}
            offsetX={offsetX}
            offsetY={offsetY}
            zoom={zoom}
            sizeKey={sizeKey}
            onZoom={handleZoom}
          />

          <p className="text-center text-[10px] text-muted-foreground">
            Перетаскивайте элементы мышкой. Позиции сохраняются кнопкой «Сохранить» и
            применяются при следующем открытии. Всё, что вне синей рамки, показано тускло и не печатается.
          </p>
        </div>
      </div>
    </div>
  )
}
