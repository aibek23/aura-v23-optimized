"use client"
// ---------------------------------------------------------------------------
// CanvasArea — СИНХРОНИЗИРОВАННЫЙ С Fabric ВРАЩАЮЩИЙСЯ SVG-ФОН
// ---------------------------------------------------------------------------
import React, { memo, useCallback, useRef, useLayoutEffect } from "react"
import { Hand } from "lucide-react"
import { RULER_SIZE } from "../constants"
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
          width: totalW, height: RULER_SIZE,
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
          width: RULER_SIZE, height: totalH,
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
        width: totalW, height: totalH,
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
  zoom, isPanMode, onZoomReset, onTogglePan,
}: ZoomCornerProps) {
  return (
    <div
      style={{
        position: "absolute", right: 8, bottom: 8, zIndex: 20,
        display: "flex", gap: 4,
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        title={isPanMode ? "Режим выделения (Alt отпускает руку)" : "Рука (удерживайте Alt)"}
        onClick={onTogglePan}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 8,
          border: "1px solid",
          borderColor: isPanMode ? "rgb(99,102,241)" : "rgba(0,0,0,0.15)",
          background: isPanMode ? "rgb(99,102,241)" : "rgba(255,255,255,0.85)",
          color: isPanMode ? "#fff" : "inherit",
          backdropFilter: "blur(4px)", cursor: "pointer",
        }}
      >
        <Hand style={{ width: 14, height: 14 }} />
      </button>

      <button
        type="button"
        onClick={onZoomReset}
        style={{ ...zoomBtnStyle, minWidth: 44, fontSize: 10, fontVariantNumeric: "tabular-nums" }}
        title="Сбросить масштаб"
      >
        {Math.round(zoom * 100)}%
      </button>
    </div>
  )
})

const zoomBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  height: 30, minWidth: 30, borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "rgba(255,255,255,0.85)",
  backdropFilter: "blur(4px)", cursor: "pointer",
  padding: "0 6px",
}

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
  sizeDef, rotation = 0, zoom, pan, offsetX, offsetY,
  totalW, totalH, stageW, stageH,
  isPanMode, onPanStart, onBgClick,
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
  const bodyDX = offsetX + sizeDef.w_px / 2 - stageW / 2
  const bodyDY = offsetY + sizeDef.h_px / 2 - stageH / 2
  const bodyCenterX = stageCX + (bodyDX * cos - bodyDY * sin) * zoom
  const bodyCenterY = stageCY + (bodyDX * sin + bodyDY * cos) * zoom

  return (
    <div
      ref={viewportRef}
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
          left: bodyCenterX,
          top: bodyCenterY,
          // Смещаем SVG так, чтобы его трансформация вращения происходила точно вокруг центра холста Fabric
          transform: `translate(-50%, -50%) scale(${zoom})`,
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 1,
        }}
      >
        <LabelBackground sizeDef={sizeDef} rotation={rotation} />
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
      {onZoomTo && onZoomReset && onTogglePan && (
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
