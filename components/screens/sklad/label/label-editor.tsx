"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Canvas, Textbox } from "fabric"
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

import {
  FONTS,
  ZOOM_MIN,
  ZOOM_MAX,
  type LabelEditorProps,
} from "./label-editor.types"
import { applyBgRect, applyTemplate, parseTemplate, serializeLayout } from "./label-editor.template"
import { buildDefaultLayout, cropPrintArea, refreshLiveData, attachSmartGuides, addBorderToCanvas, attachTextAutoHeight, createTextbox, fitTextboxHeight } from "./label-editor.canvas"
import type { BorderStyleKey } from "./label-editor-toolbar"
import { LabelEditorToolbar } from "./label-editor-toolbar"
import { LabelEditorCanvasArea } from "./label-editor-canvas-area"

// ---------------------------------------------------------------------------
// LabelEditor — оркестратор: Mobile-First Layout
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
  const [sizeKey, setSizeKey] = useState<JewelryLabelSizeKey>(initialSizeKey)
  const [zoom, setZoom] = useState(1)
  const [collapsed, setCollapsed] = useState(false)

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
      clipPath: undefined,
      controlsAboveOverlay: true,
    })
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    fabricRef.current = canvas
    setReady(true)

    const detachGuides = attachSmartGuides(canvas, sizeDef)
    const detachAutoHeight = attachTextAutoHeight(canvas)

    ;(async () => {
      try {
        const saved = parseTemplate(getLabelTemplate(category, sizeKey))
        if (!canvas.lowerCanvasEl) return
        await buildDefaultLayout(canvas, product, sizeDef)
        if (!canvas.lowerCanvasEl) return
        if (saved) {
          applyTemplate(canvas, saved)
          await refreshLiveData(canvas, product)
          applyBgRect(canvas, sizeDef, saved.bg ?? null)
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
      detachGuides()
      detachAutoHeight()
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

  // ---- Поворот всей печатной области (этикетки + всех объектов) на 90° ----
  const handleRotateCanvas = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    // Текущие размеры печатной зоны
    const oldW = sizeDef.w_px
    const oldH = sizeDef.h_px
    // После поворота ширина и высота меняются местами
    const newW = oldH
    const newH = oldW

    // Центр старой печатной зоны (система координат холста Fabric)
    const cx = oldW / 2
    const cy = oldH / 2

    // Поворачиваем все объекты относительно центра этикетки на +90°
    // Формула поворота: x' = cy - y,  y' = x - cx
    canvas.getObjects().forEach((obj) => {
      const w = obj.getScaledWidth?.() ?? obj.width ?? 0
      const h = obj.getScaledHeight?.() ?? obj.height ?? 0
      // Центр объекта в системе координат холста
      const ocx = (obj.left ?? 0) + w / 2
      const ocy = (obj.top ?? 0) + h / 2
      // Центр объекта после поворота (координаты в новой системе с центром newW/2, newH/2)
      const ncx = cy - ocy + newW / 2
      const ncy = ocx - cx  + newH / 2
      const newAngle = ((obj.angle ?? 0) + 90) % 360
      obj.set({
        left:   ncx - w / 2,
        top:    ncy - h / 2,
        angle: newAngle,
      })
      obj.setCoords()
    })

    // Новые размеры холста Fabric (v6+ API)
    canvas.setDimensions({ width: stageW, height: stageH })

    // Сдвигаем viewport под новый offsetX/offsetY (пересчитывается через sizeKey)
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    canvas.renderAll()
    toast.success("Печатная область повёрнута на 90°")
  }, [sizeDef, stageW, stageH, offsetX, offsetY])

  // ---- Изменение зума ----------------------------------------------------
  const handleZoom = useCallback((delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, parseFloat((z + delta).toFixed(2)))))
  }, [])

  // ---- Инструменты редактирования -----------------------------------------
  const applyToSelection = (patch: Record<string, unknown>) => {
    const canvas = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) { toast.info("Выделите элемент на холсте"); return }
    objects.forEach((o) => {
      o.set(patch)
      if (o.type === "textbox") fitTextboxHeight(o as Textbox)
    })
    canvas.renderAll()
  }

  const addText = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const t = createTextbox("Текст", {
      left: 20, top: 20, width: Math.round(sizeDef.w_px * 0.5),
      fontSize, fontFamily: font, fill: "#000000",
      data: { role: `custom-t-${Date.now()}` },
    })
    canvas.add(t)
    canvas.setActiveObject(t)
    canvas.renderAll()
  }

  const addBorder = (styleKey: BorderStyleKey) => {
    const canvas = fabricRef.current
    if (!canvas) return
    addBorderToCanvas(canvas, sizeDef, styleKey)
  }

  const removeSelected = () => {
    const canvas = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) return
    objects.forEach((o) => canvas.remove(o))
    canvas.discardActiveObject()
    canvas.renderAll()
  }

  // ---- Сохранение / сброс -------------------------------------------------
  const handleSaveTemplate = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      const tpl = serializeLayout(canvas, sizeKey, null)
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
    await buildDefaultLayout(canvas, product, sizeDef)
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    canvas.renderAll()
    toast.success("Возвращён стандартный эскиз")
  }

  // ---- Рендер: Flex-структура -----------------------------------------------
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">

      {/* ── Лоадер во время печати ── */}
      {isPrinting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <span className="absolute h-11 w-11 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin" />
            <span className="rotate-45 rounded-sm bg-primary/20 border border-primary/40 h-4 w-4" />
          </div>
          {status && <p className="text-xs text-muted-foreground animate-pulse">{status}</p>}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          ВЕРХНЯЯ ПАНЕЛЬ
      ═══════════════════════════════════════════════════════════════ */}
      {!collapsed && (
        <div className="z-20 border-b bg-background/90 backdrop-blur-md shrink-0">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold truncate max-w-[70vw] leading-tight">
              Этикетка · <span className="text-primary">{sizeDef.label}</span>
            </span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 hover:bg-muted transition-colors shrink-0"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <LabelEditorToolbar
            zone="header"
            sizeKey={sizeKey}
            sizeDef={sizeDef}
            font={font}
            fontSize={fontSize}
            isPrinting={isPrinting}
            status={status}
            onSizeChange={setSizeKey}
            onAddText={addText}
            onAddBorder={addBorder}
            onRemoveSelected={removeSelected}
            onRotateCanvas={handleRotateCanvas}
            onSaveTemplate={handleSaveTemplate}
            onResetTemplate={() => void handleResetTemplate()}
            onFontChange={(f) => { setFont(f); applyToSelection({ fontFamily: f }) }}
            onFontSizeChange={(s) => { setFontSize(s); applyToSelection({ fontSize: s }) }}
            onPrint={() => void handlePrint()}
          />
        </div>
      )}

      {/* Кнопка закрытия в свёрнутом режиме */}
      {collapsed && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-30 rounded-full border border-white/20 bg-black/35 p-1.5 text-white/90 backdrop-blur-md transition-colors hover:bg-black/50"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          ОБЛАСТЬ ХОЛСТА И ЛИНЕЕК (Занимает всё свободное пространство)
      ═══════════════════════════════════════════════════════════════ */}
      <div className="relative flex-1 w-full overflow-hidden z-0">
        <LabelEditorCanvasArea
          canvasRef={canvasRef}
          fabricRef={fabricRef}
          sizeDef={sizeDef}
          stageW={stageW}
          stageH={stageH}
          offsetX={offsetX}
          offsetY={offsetY}
          zoom={zoom}
          sizeKey={sizeKey}
          onZoom={handleZoom}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          НИЖНЯЯ ПАНЕЛЬ — overflow: visible чтобы выпадающее меню «Рамка»
          отображалось поверх холста, а не обрезалось контейнером
      ═══════════════════════════════════════════════════════════════ */}
      <div className="shrink-0" style={{ zIndex: 9990, position: "relative" }}>
        <LabelEditorToolbar
          zone="bottom"
          sizeKey={sizeKey}
          sizeDef={sizeDef}
          font={font}
          fontSize={fontSize}
          isPrinting={isPrinting}
          status={status}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          onSizeChange={setSizeKey}
          onAddText={addText}
          onAddBorder={addBorder}
          onRemoveSelected={removeSelected}
          onRotateCanvas={handleRotateCanvas}
          onSaveTemplate={handleSaveTemplate}
          onResetTemplate={() => void handleResetTemplate()}
          onFontChange={(f) => { setFont(f); applyToSelection({ fontFamily: f }) }}
          onFontSizeChange={(s) => { setFontSize(s); applyToSelection({ fontSize: s }) }}
          onPrint={() => void handlePrint()}
        />
      </div>
    </div>
  )
}