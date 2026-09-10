"use client"
import React, {
  useRef, useState, useMemo, useCallback, useEffect,
} from "react"
import { X } from "lucide-react"
import { getLabelSizeDef, DEFAULT_SIZE_KEY, LABEL_SIZES } from "@/lib/niimbot"
import type { JewelryLabelSizeKey } from "@/lib/niimbot"
import type { LabelEditorProps } from "./types"
import { RULER_SIZE, ZOOM_DEFAULT } from "./constants"
import type { BorderStyleKey } from "./constants"
import { getSvgLayout } from "./components/label-background"
import { computeStageOrigin, makeTrigCache, screenToLabelPx } from "./utils/geometry"
import type { ManualGuide } from "./utils/guides-draw"

import { useFabricCanvas }    from "./hooks/use-fabric-canvas"
import { useCanvasPan }       from "./hooks/use-canvas-pan"
import { useCanvasTransform } from "./hooks/use-canvas-transform"
import { usePinchZoom }       from "./hooks/use-pinch-zoom"
import { usePanMode }         from "./hooks/use-pan-mode"
import { useCanvasRepaint }   from "./hooks/use-canvas-repaint"
import { useSelectionSync }   from "./hooks/use-selection-sync"
import { useLabelActions }    from "./hooks/use-label-actions"
import { useLabelPrint }      from "./hooks/use-label-print"

import { CanvasArea }         from "./components/canvas-area"
import { LabelEditorToolbar } from "./components/toolbar"

const STAGE_PAD    = 240
const SIZE_STORAGE = "sklad:label-size"

function getStoredSizeKey(fallback: JewelryLabelSizeKey): JewelryLabelSizeKey {
  try {
    const v = localStorage.getItem(SIZE_STORAGE)
    if (v && v in LABEL_SIZES) return v as JewelryLabelSizeKey
  } catch { /* ignore */ }
  return fallback
}

export function LabelEditor({
  product, autoPrint, initialSizeKey, onClose,
}: LabelEditorProps) {
  const [sizeKey, setSizeKey] = useState<JewelryLabelSizeKey>(
    () => getStoredSizeKey(initialSizeKey ?? DEFAULT_SIZE_KEY),
  )
  
  // rotation хранит накопленный поворот в градусах (0 | 90 | 180 | 270)
  const [rotation, setRotation] = useState(0)
  const category = product.category ?? "Прочее"

  useEffect(() => {
    try { localStorage.setItem(SIZE_STORAGE, sizeKey) } catch { /* ignore */ }
  }, [sizeKey])

  const sizeDef = useMemo(() => getLabelSizeDef(sizeKey), [sizeKey])

  const { stageW, stageH, offsetX, offsetY } = useMemo(() => {
    // Единый расчёт размеров сцены независимо от поворота
    const svgLayout = getSvgLayout(sizeKey, sizeDef)
    const sW = Math.max(svgLayout.svgW, svgLayout.canvasX * 2 + sizeDef.w_px) + STAGE_PAD * 2
    const sH = Math.max(svgLayout.svgH, svgLayout.canvasY * 2 + sizeDef.h_px) + STAGE_PAD * 2
    return {
      stageW:  sW,
      stageH:  sH,
      offsetX: svgLayout.canvasX + STAGE_PAD,
      offsetY: svgLayout.canvasY + STAGE_PAD,
    }
  }, [sizeKey, sizeDef])

  const totalW = stageW + RULER_SIZE
  const totalH = stageH + RULER_SIZE

  // ── Рефы ──────────────────────────────────────────────────────────────────
  const containerRef    = useRef<HTMLDivElement>(null)
  const viewportRef     = useRef<HTMLDivElement>(null)
  const stageLayerRef   = useRef<HTMLDivElement>(null)
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null)
  const staticCanvasRef = useRef<HTMLCanvasElement>(null)
  const rulerHRef       = useRef<HTMLCanvasElement>(null)
  const rulerVRef       = useRef<HTMLCanvasElement>(null)
  const guidesRef       = useRef<HTMLCanvasElement>(null)
  const rulerDragRef    = useRef<{ axis: "x" | "y"; index: number; pointerId: number } | null>(null)
  const [manualGuides, setManualGuides] = useState<ManualGuide[]>([])

  // ── UI-состояние ──────────────────────────────────────────────────────────
  const [font,        setFont]        = useState("Arial")
  const [fontSize,    setFontSize]    = useState(16)
  const [autoFit,     setAutoFit]     = useState(true)
  const [fitRatio,    setFitRatio]    = useState(1)
  const [isPrinting,  setIsPrinting]  = useState(false)
  const [printStatus, setPrintStatus] = useState("")
  const [loaded,      setLoaded]      = useState(false)
  const [collapsed,   setCollapsed]   = useState(false)

  const isTransformingRef = useRef(false)
  const isPanModeForPan   = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionsRef = useRef<any>(null)

  // ── Pan ───────────────────────────────────────────────────────────────────
  const zoomRefProxy = useRef(ZOOM_DEFAULT)
  const { pan, panRef, setPan, isPanningRef } = useCanvasPan(
    containerRef, isPanModeForPan, zoomRefProxy,
  )

  // ── Fabric canvas ─────────────────────────────────────────────────────────
  const fabricRef = useFabricCanvas(
    fabricCanvasRef,
    sizeDef,
    offsetX,
    offsetY,
    stageW,
    stageH,
    useCallback(async (canvas: import("fabric").Canvas) => {
      type Bus = { on: (n: string, h: () => void) => void; off: (n: string, h: () => void) => void }
      const bus  = canvas as unknown as Bus
      const onTS = () => { isTransformingRef.current = true }
      const onTE = () => { isTransformingRef.current = false }
      bus.on("object:scaling",  onTS)
      bus.on("object:rotating", onTS)
      bus.on("object:modified", onTE)
      bus.on("selection:cleared", onTE)
      setLoaded(false)
      await actionsRef.current.loadTemplate(canvas)
      setLoaded(true)
      return () => {
        bus.off("object:scaling",  onTS)
        bus.off("object:rotating", onTS)
        bus.off("object:modified", onTE)
        bus.off("selection:cleared", onTE)
        setLoaded(false)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sizeKey]),
  )

  // ── Pan Mode ──────────────────────────────────────────────────────────────
  const {
    isPanMode, isPanModeRef,
    activatePanMode, deactivatePanMode,
  } = usePanMode(
    fabricRef, viewportRef, sizeKey,
  )
  useEffect(() => { isPanModeForPan.current = isPanModeRef.current }, [isPanMode, isPanModeRef])

  const handleTogglePan = useCallback(() => {
    // Explicitly choose the next tool instead of relying on a state toggle.
    // This also guarantees that clicking the active Hand button returns to
    // Select even when the canvas is currently intercepting pointer events.
    if (isPanMode) deactivatePanMode()
    else activatePanMode()
  }, [isPanMode, activatePanMode, deactivatePanMode])

  // ── Zoom + transform ──────────────────────────────────────────────────────
  const { zoom, zoomRef, zoomTo, zoomReset, transformRef } = useCanvasTransform(
    fabricRef, pan, offsetX, offsetY, totalW, totalH, rotation, sizeKey,
  )
  useEffect(() => { zoomRefProxy.current = zoomRef.current }, [zoom, zoomRef])

  const getGuidePosition = useCallback((axis: "x" | "y", clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    const t = transformRef.current
    const stageW = t.totalW - RULER_SIZE
    const stageH = t.totalH - RULER_SIZE
    const so = computeStageOrigin(
      rect.width, rect.height, RULER_SIZE,
      t.pan.x, t.pan.y, t.totalW, t.totalH, t.zoom,
    )
    const trig = makeTrigCache(t.rotation)
    const p = screenToLabelPx(
      clientX - rect.left, clientY - rect.top, so,
      t.offsetX, t.offsetY, stageW, stageH, t.zoom, trig.cos, trig.sin,
    )
    const max = axis === "x" ? sizeDef.h_px : sizeDef.w_px
    return Math.max(0, Math.min(max, axis === "x" ? p.y : p.x))
  }, [containerRef, sizeDef, transformRef])

  const handleRulerPointerDown = useCallback((
    axis: "x" | "y",
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top
    if ((axis === "x" && (localX < RULER_SIZE || localY > RULER_SIZE)) ||
        (axis === "y" && (localY < RULER_SIZE || localX > RULER_SIZE))) return
    const position = getGuidePosition(axis, e.clientX, e.clientY)
    if (position === null) return
    e.preventDefault()
    e.stopPropagation()
    const index = manualGuides.length
    setManualGuides((prev) => [...prev, { axis, position }])
    rulerDragRef.current = { axis, index, pointerId: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [getGuidePosition, manualGuides.length])

  const handleRulerPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = rulerDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const position = getGuidePosition(drag.axis, e.clientX, e.clientY)
    if (position === null) return
    setManualGuides((prev) => prev.map((g, i) => i === drag.index ? { ...g, position } : g))
  }, [getGuidePosition])

  const handleRulerPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (rulerDragRef.current?.pointerId === e.pointerId) rulerDragRef.current = null
  }, [])

  // ── Pinch Zoom ────────────────────────────────────────────────────────────
  usePinchZoom(
    containerRef, fabricRef, zoomRef, panRef,
    isPanningRef, isTransformingRef, zoomTo, setPan,
  )

  // ── Перерисовка линеек / направляющих ────────────────────────────────────
  useCanvasRepaint({
    fabricRef, containerRef, staticCanvasRef,
    rulerHRef, rulerVRef, guidesCanvasRef: guidesRef,
    transformRef, sizeDef, sizeKey,
    rotation,
    manualGuides,
  })

  // ── Действия ──────────────────────────────────────────────────────────────
  const actions = useLabelActions(
    fabricRef, sizeDef, sizeKey,
    offsetX, offsetY, product, category,
    font, fontSize, autoFit, fitRatio,
  )
  actionsRef.current = actions

  // ── Синхронизация выделения ───────────────────────────────────────────────
  useSelectionSync(fabricRef, loaded, sizeKey, {
    setFont, setFontSize,
    setAutoFitState: setAutoFit,
    setFitRatioState: setFitRatio,
  })

  // ── Печать ────────────────────────────────────────────────────────────────
  const { handlePrint } = useLabelPrint(
    fabricRef, sizeDef, loaded, autoPrint ?? false,
    setIsPrinting, setPrintStatus,
  )

  useEffect(() => {
    if (!isPrinting && loaded && autoPrint) onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrinting])

  // ── ЕДИНАЯ ЛОГИКА ПОВОРОТА (без подмены sizeKey) ─────────────────────────
  const handleRotateCanvas = useCallback(() => {
    // Вращаем только состояние rotation, не трогая sizeKey
    setRotation((r) => (r + 90) % 360)
  }, [])

  // ── Изменение размера пользователем вручную ──────────────────────────────
  const handleSizeChange = useCallback((newKey: JewelryLabelSizeKey) => {
    setSizeKey(newKey)
    setRotation(0) // Сбрасываем поворот при явной смене этикетки
    setManualGuides([])
  }, [])

  // ── Масштаб элементов ─────────────────────────────────────────────────────
  const ELEM_SCALE_STEP = 0.1

  const handleScaleUp = useCallback(() => {
    const canvas  = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) return
    objects.forEach((o) => {
      o.set({
        scaleX: (o.scaleX ?? 1) * (1 + ELEM_SCALE_STEP),
        scaleY: (o.scaleY ?? 1) * (1 + ELEM_SCALE_STEP),
      })
      o.setCoords()
    })
    canvas.requestRenderAll()
  }, [fabricRef])

  const handleScaleDown = useCallback(() => {
    const canvas  = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) return
    objects.forEach((o) => {
      o.set({
        scaleX: Math.max(0.05, (o.scaleX ?? 1) * (1 - ELEM_SCALE_STEP)),
        scaleY: Math.max(0.05, (o.scaleY ?? 1) * (1 - ELEM_SCALE_STEP)),
      })
      o.setCoords()
    })
    canvas.requestRenderAll()
  }, [fabricRef])

  // ── Misc обработчики ──────────────────────────────────────────────────────
  const handleBgClick = useCallback(() => {
    fabricRef.current?.discardActiveObject()
    fabricRef.current?.requestRenderAll()
  }, [fabricRef])

  const handleFitRatioChange = useCallback((v: number) => {
    const r = actions.handleFitRatioChange(v)
    if (typeof r === "number") setFitRatio(r)
  }, [actions])

  const handleZoomReset = useCallback(() => {
    zoomReset()
    setPan({ x: 0, y: 0 })
  }, [zoomReset, setPan])

  const handlePanStart = useCallback((_cx: number, _cy: number) => {}, [])

  // ── Пропсы тулбара ────────────────────────────────────────────────────────
  const toolbarCommon = {
    sizeKey, sizeDef, font, fontSize, isPrinting, status: printStatus,
    autoFit, fitRatio, zoom, isPanMode,
    onSizeChange:     handleSizeChange,
    onAddText:        () => { deactivatePanMode(); actions.addText() },
    onAddBorder:      (k: BorderStyleKey) => { deactivatePanMode(); actions.addBorder(k) },
    onRemoveSelected: () => { deactivatePanMode(); actions.removeSelected() },
    onSaveTemplate:   actions.handleSaveTemplate,
    onResetTemplate:  actions.handleResetTemplate,
    onFontChange:     (f: string) => { setFont(f); actions.handleFontChange(f) },
    onFontSizeChange: (s: number) => { setFontSize(s); actions.handleFontSizeChange(s) },
    onAutoFitChange:  (v: boolean) => { setAutoFit(v); actions.handleAutoFitChange(v) },
    onFitRatioChange: handleFitRatioChange,
    onZoomTo:         zoomTo,
    onZoomReset:      handleZoomReset,
    onTogglePanMode:  handleTogglePan,
    onRotateCanvas:   handleRotateCanvas,
    onPrint:          handlePrint,
    onScaleUp:        handleScaleUp,
    onScaleDown:      handleScaleDown,
    onLoadSvgFrame:   actions.loadSvgFrame,
    onSaveToFile:     actions.saveToFile,
  }

  // ── Рендер ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col overflow-hidden bg-background select-none"
    >
      {/* Лоадер во время печати */}
      {isPrinting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <span className="absolute h-11 w-11 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin" />
            <span className="rotate-45 rounded-sm bg-primary/20 border border-primary/40 h-4 w-4" />
          </div>
          {printStatus && (
            <p className="text-xs text-muted-foreground animate-pulse">{printStatus}</p>
          )}
        </div>
      )}

      {/* ── ВЕРХНЯЯ ПАНЕЛЬ ── */}
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
          <LabelEditorToolbar zone="header" {...toolbarCommon} />
        </div>
      )}

      {collapsed && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-30 rounded-full border border-white/20 bg-black/35 p-1.5 text-white/90 backdrop-blur-md hover:bg-black/50 transition-colors"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* ── ОБЛАСТЬ ХОЛСТА ── */}
      <div className="relative flex-1 w-full overflow-hidden z-0">
        <CanvasArea
          viewportRef={viewportRef}
          stageLayerRef={stageLayerRef}
          staticCanvasRef={staticCanvasRef}
          fabricCanvasRef={fabricCanvasRef}
          rulerHRef={rulerHRef}
          rulerVRef={rulerVRef}
          guidesRef={guidesRef}
          sizeDef={sizeDef}
          rotation={rotation}
          zoom={zoom}
          pan={pan}
          offsetX={offsetX}
          offsetY={offsetY}
          totalW={totalW}
          totalH={totalH}
          stageW={stageW}
          stageH={stageH}
          isPanMode={isPanMode}
          onPanStart={handlePanStart}
          onBgClick={handleBgClick}
          onZoomTo={zoomTo}
          onZoomReset={handleZoomReset}
          onTogglePan={handleTogglePan}
          onActivatePan={activatePanMode}
          onDeactivatePan={deactivatePanMode}
          onRulerPointerDown={handleRulerPointerDown}
          onRulerPointerMove={handleRulerPointerMove}
          onRulerPointerUp={handleRulerPointerUp}
        />
      </div>

      {/* ── НИЖНЯЯ ПАНЕЛЬ ── */}
      <div className="shrink-0" style={{ zIndex: 9990, position: "relative" }}>
        <LabelEditorToolbar
          zone="bottom"
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          {...toolbarCommon}
        />
      </div>
    </div>
  )
}