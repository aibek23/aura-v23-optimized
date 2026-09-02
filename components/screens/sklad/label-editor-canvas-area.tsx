"use client"

// ---------------------------------------------------------------------------
// Рабочая область редактора: SVG-подложка, Fabric-холст, управление зумом
// ---------------------------------------------------------------------------
import { ZoomIn, ZoomOut } from "lucide-react"
import { LabelBackground } from "./label-background"
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./label-editor.types"
import type { LabelSizeDef } from "@/lib/niimbot"

interface LabelEditorCanvasAreaProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  sizeDef: LabelSizeDef
  stageW: number
  stageH: number
  offsetX: number
  offsetY: number
  zoom: number
  sizeKey: string
  onZoom: (delta: number) => void
}

export function LabelEditorCanvasArea({
  canvasRef,
  sizeDef,
  stageW,
  stageH,
  offsetX,
  offsetY,
  zoom,
  sizeKey,
  onZoom,
}: LabelEditorCanvasAreaProps) {
  return (
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
            <LabelBackground
              sizeDef={sizeDef}
              showPrintArea={false}
              className="absolute top-0 left-0"
            />

            {/* Fabric-холст на всю бумагу */}
            <div className="absolute left-0 top-0">
              <canvas ref={canvasRef} />
            </div>

            {/* Затемнение зоны вне печатной области */}
            <NonPrintOverlay
              stageW={stageW}
              stageH={stageH}
              offsetX={offsetX}
              offsetY={offsetY}
              sizeDef={sizeDef}
            />
          </div>
        </div>
      </div>

      {/* Управление зумом — правый нижний угол */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-2 py-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => onZoom(-ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30"
          aria-label="Уменьшить"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-9 text-center text-[11px] font-mono text-white/80">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => onZoom(ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          className="rounded p-0.5 text-white/70 hover:text-white disabled:opacity-30"
          aria-label="Увеличить"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Оверлей: затемняет область ЗА печатной зоной
// ---------------------------------------------------------------------------
interface NonPrintOverlayProps {
  stageW: number
  stageH: number
  offsetX: number
  offsetY: number
  sizeDef: LabelSizeDef
}

function NonPrintOverlay({
  stageW,
  stageH,
  offsetX,
  offsetY,
  sizeDef,
}: NonPrintOverlayProps) {
  const { w_px, h_px } = sizeDef
  return (
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
          top: offsetY + h_px,
          width: stageW,
          height: Math.max(0, stageH - offsetY - h_px),
        }}
      />
      {/* слева */}
      <div
        className="absolute bg-white/65"
        style={{ left: 0, top: offsetY, width: offsetX, height: h_px }}
      />
      {/* справа */}
      <div
        className="absolute bg-white/65"
        style={{
          left: offsetX + w_px,
          top: offsetY,
          width: Math.max(0, stageW - offsetX - w_px),
          height: h_px,
        }}
      />
      {/* контур печатной области */}
      <div
        className="absolute border border-dashed border-blue-500/70"
        style={{ left: offsetX, top: offsetY, width: w_px, height: h_px }}
      />
    </div>
  )
}
