"use client"

// ---------------------------------------------------------------------------
// Рабочая область редактора этикеток — Многослойный холст
//
// Слой 1 (staticCanvasRef): сетка + контур печатной области (2D API)
// Слой 2 (canvasRef):       Fabric.js — интерактивные объекты, текст, QR
// Слой 3 (rulersCanvasRef): линейки ВПРИТЫК к превью + маркеры границ элементов
// Слой 4 (guidesCanvasRef): подсказки выделенного элемента и smart guides
//
// Поведение линеек (стиль NIIMBOT):
//   • вертикальная линейка примыкает строго к левой границе превью этикетки,
//     горизонтальная — строго к верхней границе, без зазора
//   • ноль линеек совпадает с краем печатной области
//   • на линейках отображаются маркеры границ ВСЕХ элементов этикетки
//     (QR-код, текстовые блоки, рамки): верх/низ — на вертикальной,
//     лево/право — на горизонтальной; выделенный элемент подсвечен
// ---------------------------------------------------------------------------
import { useEffect, useRef, useCallback, useState, type RefObject } from "react"
import { ZoomIn, ZoomOut, Crosshair } from "lucide-react"
import { LabelBackground } from "./label-background"
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./label-editor.types"
import type { LabelSizeDef } from "@/lib/niimbot"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"

// ─── Константы линеек ───────────────────────────────────────────────────────
const RULER_SIZE = 18  // px — толщина линейки
const TICK_MAJOR = 10  // мм
const TICK_MINOR = 5   // мм

/** Плотность пикселей на миллиметр, выведенная из ключа размера (T25x30_45). */
function getPxPerMm(sizeDef: LabelSizeDef): number {
  const m = /T(\d+)x(\d+)(?:_(\d+))?/.exec(sizeDef.key)
  if (m) {
    const wmm = Number(m[1])
    if (wmm > 0) return sizeDef.w_px / wmm
  }
  return 8
}

/** Габариты объекта в координатах печатной области. */
function objBounds(o: FabricObject) {
  const left = o.left ?? 0
  const top = o.top ?? 0
  const w = o.getScaledWidth?.() ?? o.width ?? 0
  const h = o.getScaledHeight?.() ?? o.height ?? 0
  return { left, top, right: left + w, bottom: top + h }
}

/** Объекты, границы которых показываем на линейках (без служебного фона). */
function measurableObjects(canvas: FabricCanvas | null): FabricObject[] {
  if (!canvas) return []
  return canvas.getObjects().filter((o) => {
    if (o.visible === false) return false
    const role = (o as unknown as { data?: { role?: string } }).data?.role
    return role !== "bg"
  })
}

// ─── Типы ───────────────────────────────────────────────────────────────────
interface LabelEditorCanvasAreaProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Прямая ссылка на Fabric-инстанс — нужна для линеек и smart guides */
  fabricRef: RefObject<FabricCanvas | null>
  sizeDef: LabelSizeDef
  stageW: number
  stageH: number
  offsetX: number
  offsetY: number
  zoom: number
  sizeKey: string
  onZoom: (delta: number) => void
}

// ─── Главный компонент ──────────────────────────────────────────────────────
export function LabelEditorCanvasArea({
  canvasRef,
  fabricRef,
  sizeDef,
  stageW,
  stageH,
  offsetX,
  offsetY,
  zoom,
  sizeKey,
  onZoom,
}: LabelEditorCanvasAreaProps) {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null)
  const rulersCanvasRef = useRef<HTMLCanvasElement>(null)
  const guidesCanvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  // ── Свободное перемещение холста (pan) ───────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // Общие координаты сцены
  const totalW = stageW + RULER_SIZE
  const totalH = stageH + RULER_SIZE
  // Левый/верхний край ПРЕВЬЮ (печатной области) внутри сцены
  const labelX = RULER_SIZE + offsetX
  const labelY = RULER_SIZE + offsetY
  // Линейки примыкают ВПРИТЫК к границам превью
  const rulerVX = labelX - RULER_SIZE
  const rulerHY = labelY - RULER_SIZE

  const prepare = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (!el) return null
      const ctx = el.getContext("2d")
      if (!ctx) return null
      const dpr = window.devicePixelRatio || 1
      if (el.width !== totalW * dpr || el.height !== totalH * dpr) {
        el.width = totalW * dpr
        el.height = totalH * dpr
        el.style.width = `${totalW}px`
        el.style.height = `${totalH}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, totalW, totalH)
      return ctx
    },
    [totalW, totalH],
  )

  // ── Слой 1: сетка + рамка печатной области ────────────────────────────────
  const drawStatic = useCallback(() => {
    const ctx = prepare(staticCanvasRef.current)
    if (!ctx) return

    const isDark = document.documentElement.classList.contains("dark")
    const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"

    ctx.fillStyle = gridColor
    for (let gx = 0; gx < stageW; gx += 20) {
      for (let gy = 0; gy < stageH; gy += 20) {
        ctx.fillRect(RULER_SIZE + gx, RULER_SIZE + gy, 1.5, 1.5)
      }
    }

    ctx.strokeStyle = "#3b82f6"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(labelX + 0.5, labelY + 0.5, sizeDef.w_px - 1, sizeDef.h_px - 1)
    ctx.setLineDash([])
  }, [prepare, stageW, stageH, sizeDef, labelX, labelY])

  // ── Слой 3: линейки впритык + маркеры границ всех элементов ───────────────
  const drawRulers = useCallback(() => {
    const ctx = prepare(rulersCanvasRef.current)
    if (!ctx) return

    const isDark = document.documentElement.classList.contains("dark")
    const rulerBg = isDark ? "#1e1e1e" : "#f4f4f5"
    const rulerBorder = isDark ? "#3f3f46" : "#d4d4d8"
    const rulerFg = isDark ? "#71717a" : "#a1a1aa"
    const rulerText = isDark ? "#a1a1aa" : "#52525b"
    const markColor = isDark ? "rgba(244,244,245,0.85)" : "rgba(24,24,27,0.75)"
    const markActive = "rgba(99,102,241,0.95)"

    const pxPerMm = getPxPerMm(sizeDef)
    const { w_px, h_px } = sizeDef

    // Полосы линеек: примыкают к превью без зазора
    ctx.fillStyle = rulerBg
    ctx.fillRect(rulerVX, labelY, RULER_SIZE, h_px)          // вертикальная (слева)
    ctx.fillRect(labelX, rulerHY, w_px, RULER_SIZE)          // горизонтальная (сверху)
    ctx.fillRect(rulerVX, rulerHY, RULER_SIZE, RULER_SIZE)   // угол

    // Тонкая разделительная линия ровно по границе превью
    ctx.fillStyle = rulerBorder
    ctx.fillRect(labelX - 1, rulerHY, 1, h_px + RULER_SIZE)
    ctx.fillRect(rulerVX, labelY - 1, w_px + RULER_SIZE, 1)

    // Деления по X (ноль — левый край превью)
    ctx.font = "8px system-ui, sans-serif"
    ctx.textAlign = "center"
    for (let mm = 0; mm * pxPerMm <= w_px; mm += TICK_MINOR) {
      const x = labelX + mm * pxPerMm
      const isMajor = mm % TICK_MAJOR === 0
      const tickH = isMajor ? 7 : 4
      ctx.fillStyle = rulerFg
      ctx.fillRect(x, labelY - tickH, 1, tickH)
      if (isMajor && mm > 0) {
        ctx.fillStyle = rulerText
        ctx.fillText(`${mm}`, x, rulerHY + 8)
      }
    }

    // Деления по Y (ноль — верхний край превью)
    ctx.textAlign = "right"
    for (let mm = 0; mm * pxPerMm <= h_px; mm += TICK_MINOR) {
      const y = labelY + mm * pxPerMm
      const isMajor = mm % TICK_MAJOR === 0
      const tickW = isMajor ? 7 : 4
      ctx.fillStyle = rulerFg
      ctx.fillRect(labelX - tickW, y, tickW, 1)
      if (isMajor && mm > 0) {
        ctx.save()
        ctx.translate(rulerVX + 9, y)
        ctx.rotate(-Math.PI / 2)
        ctx.fillStyle = rulerText
        ctx.fillText(`${mm}`, 0, 0)
        ctx.restore()
      }
    }

    // Надпись «мм» в углу
    ctx.fillStyle = rulerText
    ctx.font = "7px system-ui"
    ctx.textAlign = "center"
    ctx.fillText("мм", rulerVX + RULER_SIZE / 2, rulerHY + RULER_SIZE / 2 + 3)

    // ── Маркеры границ ВСЕХ элементов этикетки (NIIMBOT-style) ──────────────
    const fabric = fabricRef.current
    const active = fabric?.getActiveObject() ?? null
    for (const o of measurableObjects(fabric)) {
      const isActive =
        o === active ||
        (active && typeof (active as unknown as { contains?: (x: FabricObject) => boolean }).contains === "function"
          ? Boolean((active as unknown as { contains: (x: FabricObject) => boolean }).contains(o))
          : false)
      const b = objBounds(o)
      ctx.fillStyle = isActive ? markActive : markColor
      const thick = isActive ? 2 : 1

      // Горизонтальная линейка: левая и правая границы
      for (const px of [b.left, b.right]) {
        const x = labelX + px
        if (x < labelX - 1 || x > labelX + w_px + 1) continue
        ctx.fillRect(x - (thick - 1) / 2, rulerHY + 2, thick, RULER_SIZE - 2)
      }
      // Вертикальная линейка: верхняя и нижняя границы
      for (const py of [b.top, b.bottom]) {
        const y = labelY + py
        if (y < labelY - 1 || y > labelY + h_px + 1) continue
        ctx.fillRect(rulerVX + 2, y - (thick - 1) / 2, RULER_SIZE - 2, thick)
      }
    }
  }, [prepare, sizeDef, fabricRef, labelX, labelY, rulerVX, rulerHY])

  // ── Слой 4: подсказки выделенного элемента + smart guides ─────────────────
  const drawEdgeIndicators = useCallback(() => {
    const ctx = prepare(guidesCanvasRef.current)
    if (!ctx) return

    const fabric = fabricRef.current
    const activeObj = fabric?.getActiveObject()
    if (!activeObj) return

    const b = objBounds(activeObj)
    const pxPerMm = getPxPerMm(sizeDef)
    const accent = "rgba(99,102,241,0.95)"
    const accentSoft = "rgba(99,102,241,0.45)"

    ctx.save()
    ctx.font = "8px system-ui, sans-serif"
    ctx.textAlign = "center"

    // Подписи и направляющие для левой/правой границы
    for (const px of [b.left, b.right]) {
      const x = labelX + px
      const label = `${(px / pxPerMm).toFixed(1)}`
      const tw = ctx.measureText(label).width + 6
      ctx.fillStyle = accent
      ctx.fillRect(x - tw / 2, labelY + 1, tw, 11)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(label, x, labelY + 9)
      ctx.strokeStyle = accentSoft
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, labelY)
      ctx.lineTo(x, labelY + sizeDef.h_px)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Подписи и направляющие для верхней/нижней границы
    ctx.textAlign = "left"
    for (const py of [b.top, b.bottom]) {
      const y = labelY + py
      const label = `${(py / pxPerMm).toFixed(1)}`
      const tw = ctx.measureText(label).width + 6
      ctx.fillStyle = accent
      ctx.fillRect(labelX + 1, y - 5.5, tw, 11)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(label, labelX + 4, y + 3)
      ctx.strokeStyle = accentSoft
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(labelX, y)
      ctx.lineTo(labelX + sizeDef.w_px, y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── Smart Guides: центр и края печатной области ─────────────────────────
    const objCX = (b.left + b.right) / 2
    const objCY = (b.top + b.bottom) / 2
    const centerX = sizeDef.w_px / 2
    const centerY = sizeDef.h_px / 2
    const snapThreshold = 5

    ctx.strokeStyle = "rgba(16,185,129,0.8)"
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    if (Math.abs(objCX - centerX) < snapThreshold) {
      const gx = labelX + centerX
      ctx.beginPath(); ctx.moveTo(gx, rulerHY); ctx.lineTo(gx, labelY + sizeDef.h_px); ctx.stroke()
    }
    if (Math.abs(objCY - centerY) < snapThreshold) {
      const gy = labelY + centerY
      ctx.beginPath(); ctx.moveTo(rulerVX, gy); ctx.lineTo(labelX + sizeDef.w_px, gy); ctx.stroke()
    }

    ctx.strokeStyle = "rgba(239,68,68,0.6)"
    for (const ex of [0, sizeDef.w_px]) {
      for (const ox of [b.left, b.right]) {
        if (Math.abs(ex - ox) < snapThreshold) {
          const gx = labelX + ex
          ctx.beginPath(); ctx.moveTo(gx, labelY); ctx.lineTo(gx, labelY + sizeDef.h_px); ctx.stroke()
        }
      }
    }
    for (const ey of [0, sizeDef.h_px]) {
      for (const oy of [b.top, b.bottom]) {
        if (Math.abs(ey - oy) < snapThreshold) {
          const gy = labelY + ey
          ctx.beginPath(); ctx.moveTo(labelX, gy); ctx.lineTo(labelX + sizeDef.w_px, gy); ctx.stroke()
        }
      }
    }
    ctx.setLineDash([])
    ctx.restore()
  }, [prepare, sizeDef, fabricRef, labelX, labelY, rulerVX, rulerHY])

  // ── Инициализация + перерисовка при изменении параметров ─────────────────
  useEffect(() => {
    drawStatic()
    drawRulers()
    const redrawAll = () => { drawStatic(); drawRulers() }
    const observer = new MutationObserver(redrawAll)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [drawStatic, drawRulers])

  // ── Подписка на Fabric-события: линейки и подсказки следуют за элементами ─
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    const redraw = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        drawRulers()
        drawEdgeIndicators()
      })
    }
    const clearGuides = () => {
      prepare(guidesCanvasRef.current)
      drawRulers()
    }
    const events = [
      "object:moving", "object:scaling", "object:rotating", "object:modified",
      "object:added", "object:removed",
      "selection:created", "selection:updated",
    ] as const
    events.forEach((ev) => fabric.on(ev, redraw))
    fabric.on("selection:cleared", clearGuides)
    // первичная отрисовка маркеров уже размещённых элементов
    redraw()
    return () => {
      events.forEach((ev) => fabric.off(ev, redraw))
      fabric.off("selection:cleared", clearGuides)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [fabricRef, drawRulers, drawEdgeIndicators, prepare, sizeKey])

  // ── Свободное перемещение холста ─────────────────────────────────────────
  const onPanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Драг только по фону, не по интерактивному Fabric-слою
    const target = e.target as HTMLElement
    if (target.closest("[data-fabric-layer]")) return
    panStartRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [pan.x, pan.y])

  const onPanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (!start) return
    setPan({ x: start.x + (e.clientX - start.px), y: start.y + (e.clientY - start.py) })
  }, [])

  const onPanPointerUp = useCallback(() => { panStartRef.current = null }, [])

  const resetView = useCallback(() => setPan({ x: 0, y: 0 }), [])

  return (
    // Холст занимает всё доступное пространство экрана
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: "linear-gradient(135deg, #a1a1aa 0%, #d4d4d8 50%, #e4e4e7 100%)" }}
    >
      {/* Паттерн точек подложки */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Область свободного перемещения */}
      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        onPointerCancel={onPanPointerUp}
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0) scale(${zoom})`,
            transformOrigin: "center center",
            width: totalW,
            height: totalH,
          }}
        >
          {/* ── Слой 1: сетка + рамка печатной зоны ──────────────── */}
          <canvas
            ref={staticCanvasRef}
            className="absolute top-0 left-0 pointer-events-none label-canvas-gpu"
            style={{ zIndex: 1 }}
          />

          {/* ── SVG реалистичная форма бумаги ─────────────────────── */}
          <LabelBackground
            sizeDef={sizeDef}
            showPrintArea={false}
            className="absolute pointer-events-none"
            style={{ top: RULER_SIZE, left: RULER_SIZE, zIndex: 2 }}
          />

          {/* ── Слой 2: Fabric-холст (интерактивный) ──────────────── */}
          <div
            data-fabric-layer
            className="absolute label-canvas-gpu"
            style={{
              top: RULER_SIZE,
              left: RULER_SIZE,
              zIndex: 3,
              touchAction: "none",
            }}
          >
            <canvas ref={canvasRef} />
          </div>

          {/* ── Затемнение вне печатной области ───────────────────── */}
          <NonPrintOverlay
            stageW={stageW}
            stageH={stageH}
            offsetX={offsetX + RULER_SIZE}
            offsetY={offsetY + RULER_SIZE}
            sizeDef={sizeDef}
          />

          {/* ── Слой 3: линейки впритык + маркеры границ элементов ── */}
          <canvas
            ref={rulersCanvasRef}
            className="absolute top-0 left-0 pointer-events-none label-canvas-gpu"
            style={{ zIndex: 8 }}
          />

          {/* ── Слой 4: подсказки + smart guides ──────────────────── */}
          <canvas
            ref={guidesCanvasRef}
            className="absolute top-0 left-0 pointer-events-none label-canvas-gpu"
            style={{ zIndex: 10 }}
          />
        </div>
      </div>

      {/* ── Компактная полупрозрачная панель зума (плавающая) ───────────── */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-1">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/20 bg-black/35 px-1 py-0.5 backdrop-blur-md shadow-lg">
          <button
            type="button"
            onClick={() => onZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            aria-label="Уменьшить"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-9 select-none text-center font-mono text-[10px] text-white/90">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            aria-label="Увеличить"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={resetView}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Центрировать холст"
            title="Центрировать"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>
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

function NonPrintOverlay({ stageW, stageH, offsetX, offsetY, sizeDef }: NonPrintOverlayProps) {
  const { w_px, h_px } = sizeDef
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 4 }}>
      {/* сверху */}
      <div className="absolute bg-white/65"
        style={{ left: 0, top: 0, width: stageW + RULER_SIZE, height: offsetY }} />
      {/* снизу */}
      <div className="absolute bg-white/65"
        style={{ left: 0, top: offsetY + h_px, width: stageW + RULER_SIZE,
          height: Math.max(0, stageH + RULER_SIZE - offsetY - h_px) }} />
      {/* слева */}
      <div className="absolute bg-white/65"
        style={{ left: 0, top: offsetY, width: offsetX, height: h_px }} />
      {/* справа */}
      <div className="absolute bg-white/65"
        style={{ left: offsetX + w_px, top: offsetY,
          width: Math.max(0, stageW + RULER_SIZE - offsetX - w_px), height: h_px }} />
    </div>
  )
}
