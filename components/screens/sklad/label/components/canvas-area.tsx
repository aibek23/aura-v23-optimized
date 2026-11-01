"use client"
// ---------------------------------------------------------------------------
// CanvasArea — СИНХРОНИЗИРОВАННЫЙ С Fabric ВРАЩАЮЩИЙСЯ SVG-ФОН
// ---------------------------------------------------------------------------
import React, { memo, useCallback, useRef, useLayoutEffect } from "react"
import { Hand, ZoomIn, ZoomOut } from "lucide-react"
import { RULER_SIZE, ZOOM_MIN, ZOOM_MAX } from "../constants"
import { LabelBackground, getSvgLayout } from "./label-background"
import type { LabelSizeDef } from "@/lib/niimbot"

interface CanvasStageProps {
  staticCanvasRef: React.RefObject<HTMLCanvasElement | null>
  fabricCanvasRef: React.RefObject<HTMLCanvasElement | null>
  stageLayerRef:   React.RefObject<HTMLDivElement | null>
  totalW:  number
  totalH:  number
  zoom: number
  pan: { x: number; y: number }
  rotation: number
}

const CanvasStage = memo(function CanvasStage({
  staticCanvasRef, fabricCanvasRef, stageLayerRef, totalW, totalH,
  zoom, pan, rotation,
}: CanvasStageProps) {
  const vW = totalW - RULER_SIZE
  const vH = totalH - RULER_SIZE
  const staticOriginX = RULER_SIZE + vW / 2
  const staticOriginY = RULER_SIZE + vH / 2
  return (
    <div
      ref={stageLayerRef}
      style={{
        position: "absolute",
        left: RULER_SIZE, top: RULER_SIZE,
        right: 0, bottom: 0,
        overflow: "visible",
        zIndex: 2,
      }}
    >
      <canvas
        ref={staticCanvasRef}
        style={{
          position: "absolute", left: -RULER_SIZE, top: -RULER_SIZE,
          width: vW + RULER_SIZE, height: vH + RULER_SIZE,
          transformOrigin: `${staticOriginX}px ${staticOriginY}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={fabricCanvasRef}
        style={{
          position: "absolute", left: 0, top: 0,
          overflow: "visible",
        }}
      />
    </div>
  )
})

interface CanvasRulersProps {
  rulerHRef: React.RefObject<HTMLCanvasElement | null>
  rulerVRef: React.RefObject<HTMLCanvasElement | null>
  totalW:    number
  totalH:    number
  onPointerDown: (axis: "x" | "y", e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void
}

const CanvasRulers = memo(function CanvasRulers({
  rulerHRef, rulerVRef, totalW, totalH,
  onPointerDown, onPointerMove, onPointerUp,
}: CanvasRulersProps) {
  return (
    <>
      <canvas
        ref={rulerHRef}
        onPointerDown={(e) => onPointerDown("x", e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "absolute", left: 0, top: 0,
          // Размер задаёт prepareFixed() по реальному контейнеру
          height: RULER_SIZE,
          pointerEvents: "auto",
          zIndex: 10,
        }}
      />
      <canvas
        ref={rulerVRef}
        onPointerDown={(e) => onPointerDown("y", e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "absolute", left: 0, top: 0,
          width: RULER_SIZE,
          pointerEvents: "auto",
          zIndex: 10,
        }}
      />
    </>
  )
})

interface CanvasGuidesProps {
  guidesRef: React.RefObject<HTMLCanvasElement | null>
  totalW:    number
  totalH:    number
}

const CanvasGuides = memo(function CanvasGuides({
  guidesRef, totalW, totalH,
}: CanvasGuidesProps) {
  return (
    <canvas
      ref={guidesRef}
      style={{
        position: "absolute", left: 0, top: 0,
        pointerEvents: "none",
        zIndex: 12,
      }}
    />
  )
})

interface ZoomCornerProps {
  zoom:        number
  isPanMode:   boolean
  onZoomTo:    (z: number) => void
  onZoomReset: () => void
  onTogglePan: () => void
}

const ZoomCorner = memo(function ZoomCorner({
  zoom, isPanMode, onZoomTo, onZoomReset, onTogglePan,
}: ZoomCornerProps) {
  return (
    <div className="pointer-events-auto absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-xl border border-border bg-background/90 p-1 shadow-md backdrop-blur-md">
      <button type="button" onClick={onTogglePan} aria-pressed={isPanMode} title={isPanMode ? "Режим выделения" : "Рука — перемещение холста"} aria-label="Переключить перемещение холста" className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${isPanMode ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}>
        <Hand className="h-4 w-4" />
      </button>
      <button type="button" onClick={onZoomReset} title="Сбросить масштаб холста" aria-label="Сбросить масштаб холста" className="h-8 min-w-12 rounded-lg border border-border bg-background px-2 text-[11px] tabular-nums hover:bg-muted">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={() => onZoomTo(zoom / 1.15)} disabled={zoom <= ZOOM_MIN} title="Уменьшить масштаб холста" aria-label="Уменьшить масштаб холста" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-40">
        <ZoomOut className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => onZoomTo(zoom * 1.15)} disabled={zoom >= ZOOM_MAX} title="Увеличить масштаб холста" aria-label="Увеличить масштаб холста" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-40">
        <ZoomIn className="h-4 w-4" />
      </button>
    </div>
  )
})

export interface CanvasAreaProps {
  viewportRef:     React.RefObject<HTMLDivElement | null>
  stageLayerRef:   React.RefObject<HTMLDivElement | null>
  staticCanvasRef: React.RefObject<HTMLCanvasElement | null>
  fabricCanvasRef: React.RefObject<HTMLCanvasElement | null>
  rulerHRef:       React.RefObject<HTMLCanvasElement | null>
  rulerVRef:       React.RefObject<HTMLCanvasElement | null>
  guidesRef:       React.RefObject<HTMLCanvasElement | null>
  sizeDef:   LabelSizeDef
  rotation?: number
  backgroundOffsetXmm?: number
  backgroundOffsetYmm?: number
  backgroundScaleX?: number
  backgroundScaleY?: number
  zoom:      number
  pan:       { x: number; y: number }
  offsetX:   number
  offsetY:   number
  totalW:    number
  totalH:    number
  stageW:    number
  stageH:    number
  isPanMode: boolean
  onPanStart:    (clientX: number, clientY: number) => void
  onBgClick:     () => void
  showCanvasControls?: boolean
  onZoomTo?:     (z: number) => void
  onZoomReset?:  () => void
  onTogglePan?:  () => void
  onActivatePan?: () => void
  onDeactivatePan?: () => void
  onRulerPointerDown: (axis: "x" | "y", e: React.PointerEvent<HTMLCanvasElement>) => void
  onRulerPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onRulerPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void
}

export const CanvasArea = memo(function CanvasArea({
  viewportRef, stageLayerRef,
  staticCanvasRef, fabricCanvasRef,
  rulerHRef, rulerVRef, guidesRef,
  sizeDef, rotation = 0, backgroundOffsetXmm = 0, backgroundOffsetYmm = 0,
  backgroundScaleX = 1, backgroundScaleY = 1, zoom, pan, offsetX, offsetY,
  totalW, totalH, stageW, stageH,
  isPanMode, onPanStart, onBgClick,
  showCanvasControls = true,
  onZoomTo, onZoomReset, onTogglePan, onActivatePan, onDeactivatePan,
  onRulerPointerDown, onRulerPointerMove, onRulerPointerUp,
}: CanvasAreaProps) {
  const svgLayout = getSvgLayout(sizeDef.key, sizeDef)

  const lastTapRef  = useRef<number>(0)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (target?.closest?.("button, input, select, textarea, [role='button']")) return
    if (!isPanMode) return
    e.preventDefault()
    onPanStart(e.clientX, e.clientY)
  }, [isPanMode, onPanStart])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const handleTouchStartNative = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const now = Date.now()
        const delta = now - lastTapRef.current
        if (delta < 300 && delta > 0) {
          // Двойной тап отключает «Руку», если она была включена.
          if (e.cancelable) e.preventDefault()
          if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
          lastTapRef.current = 0
          // Это именно deactivation, а не toggle: повторный touchstart от
          // двух пальцев не должен снова включать руку.
          if (isPanMode) onDeactivatePan?.()
        } else {
          lastTapRef.current = now
          // сбрасываем таймер одиночного тапа
          if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
          tapTimerRef.current = setTimeout(() => { lastTapRef.current = 0 }, 350)
        }
      } else if (e.touches.length >= 2) {
        // два пальца — активируем режим руки (для pinch-zoom pan)
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
        lastTapRef.current = 0
        onActivatePan?.()
      }
    }

    el.addEventListener("touchstart", handleTouchStartNative, { passive: false })
    return () => {
      el.removeEventListener("touchstart", handleTouchStartNative)
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
    }
  }, [isPanMode, onDeactivatePan, onActivatePan, viewportRef])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (target?.closest?.("button, input, select, textarea, [role='button']")) return
    if (target?.tagName !== "CANVAS") onBgClick()
  }, [onBgClick])

  // Расчет выравнивания с учетом RULER_SIZE
  const stageCX = RULER_SIZE + stageW / 2 + pan.x
  const stageCY = RULER_SIZE + stageH / 2 + pan.y
  const angle = (rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // Центр этикетки проходит через ту же матрицу, что и Fabric и guides.
  // Якорим фон по печатной области (корпусу бирки), а не по центру всей
  // высоты SVG: у длинной бирки хвост выходит за пределы области печати.
  const svgCenterOffsetX = (svgLayout.svgW / 2 - (svgLayout.canvasX + sizeDef.w_px / 2)) * backgroundScaleX
  const svgCenterOffsetY = (svgLayout.svgH / 2 - (svgLayout.canvasY + sizeDef.h_px / 2)) * backgroundScaleY
  const backgroundOffsetX = backgroundOffsetXmm * svgLayout.pxPerMm
  const backgroundOffsetY = backgroundOffsetYmm * svgLayout.pxPerMm
  const backgroundDX = offsetX + sizeDef.w_px / 2 + svgCenterOffsetX + backgroundOffsetX - stageW / 2
  const backgroundDY = offsetY + sizeDef.h_px / 2 + svgCenterOffsetY + backgroundOffsetY - stageH / 2
  const backgroundCenterX = stageCX + (backgroundDX * cos - backgroundDY * sin) * zoom
  const backgroundCenterY = stageCY + (backgroundDX * sin + backgroundDY * cos) * zoom

  return (
    <div
      ref={viewportRef}
      className="dark:bg-zinc-700"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      style={{
        position: "relative",
        width: "100%", height: "100%",
        overflow: "hidden",
        cursor: isPanMode ? "grab" : "default",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* ── Слой 1 (z=1): SVG-подложка ── */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: backgroundCenterX,
          top: backgroundCenterY,
          // Смещаем SVG так, чтобы его трансформация вращения происходила точно вокруг центра холста Fabric
          transform: `translate(-50%, -50%) scale(${zoom})`,
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 1,
        }}
      >
        <LabelBackground sizeDef={sizeDef} rotation={rotation} scaleX={backgroundScaleX} scaleY={backgroundScaleY} />
      </div>

  {/* ── Слой 2 (z=2): Fabric canvas ── */}
      <CanvasStage
        stageLayerRef={stageLayerRef}
        staticCanvasRef={staticCanvasRef}
        fabricCanvasRef={fabricCanvasRef}
        totalW={totalW}
        totalH={totalH}
        zoom={zoom}
        pan={pan}
        rotation={rotation}
      />

      {/* ── Слой 3 (z=10): линейки ── */}
      <CanvasRulers
        rulerHRef={rulerHRef}
        rulerVRef={rulerVRef}
        totalW={totalW}
        totalH={totalH}
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
        onPointerUp={onRulerPointerUp}
      />

      {/* ── Слой 4 (z=12): направляющие ── */}
      <CanvasGuides
        guidesRef={guidesRef}
        totalW={totalW}
        totalH={totalH}
      />

      {/* ── Слой 5 (z=20): zoom/pan оверлей ── */}
      {showCanvasControls && onZoomTo && onZoomReset && onTogglePan && (
        <ZoomCorner
          zoom={zoom}
          isPanMode={isPanMode}
          onZoomTo={onZoomTo}
          onZoomReset={onZoomReset}
          onTogglePan={onTogglePan}
        />
      )}
    </div>
  )
})
