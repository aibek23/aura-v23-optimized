"use client"
// ---------------------------------------------------------------------------
// Панорамирование мышью / тачем в режиме «Рука»
// Исправлено: mousedown/mousemove/mouseup на containerRef (не viewportRef)
// Добавлено: onActivatePan-callback для активации режима руки при свайпе
// ---------------------------------------------------------------------------
import { useState, useRef, useEffect } from "react"

export interface PanState { x: number; y: number }

export function useCanvasPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
  isPanModeRef: React.RefObject<boolean>,
  zoomRef: React.RefObject<number>,
) {
  const [pan, setPan]    = useState<PanState>({ x: 0, y: 0 })
  const panRef           = useRef<PanState>({ x: 0, y: 0 })
  panRef.current         = pan

  const isPanningRef     = useRef(false)
  const isTransformingRef = useRef(false)
  const startPanRef      = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)

  // Touch swipe: запоминаем начальную точку одного пальца
  const touchStartRef    = useRef<{ x: number; y: number; time: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // ── Mouse/Pointer pan (только в режиме руки) ──────────────────────────
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      if (!isPanModeRef.current) return
      // Клики по элементам управления (в т.ч. по кнопке «Рука») не должны
      // захватываться панорамированием: pointer capture на контейнере
      // перенаправляет последующий click и кнопка перестаёт срабатывать.
      const target = e.target as HTMLElement | null
      if (target?.closest?.("button, input, select, textarea, a, [role='button']")) return
      e.preventDefault()
      isPanningRef.current = true
      startPanRef.current  = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
      el.setPointerCapture(e.pointerId)
      el.style.cursor = "grabbing"
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !isPanningRef.current || !startPanRef.current) return
      e.preventDefault()
      const dx = e.clientX - startPanRef.current.mx
      const dy = e.clientY - startPanRef.current.my
      setPan({ x: startPanRef.current.px + dx, y: startPanRef.current.py + dy })
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      isPanningRef.current = false
      startPanRef.current  = null
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.style.cursor = isPanModeRef.current ? "grab" : "default"
    }

    // ── Touch свайп одним пальцем (только в режиме руки) ──────────────────
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !isPanModeRef.current) return
      if (!touchStartRef.current) return
      e.preventDefault()
      const t  = e.touches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      setPan({ x: panRef.current.x + dx, y: panRef.current.y + dy })
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    }

    const onTouchEnd = () => {
      touchStartRef.current = null
    }

    // ── Wheel: прокрутка без Ctrl (pan), с Ctrl — usePinchZoom ────────────
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return
      e.preventDefault()
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }))
    }

    el.addEventListener("pointerdown", onDown,      { passive: false })
    el.addEventListener("pointermove", onMove,      { passive: false })
    el.addEventListener("pointerup",     onUp)
    el.addEventListener("pointercancel", onUp)
    el.addEventListener("touchstart",  onTouchStart, { passive: true })
    el.addEventListener("touchmove",   onTouchMove,  { passive: false })
    el.addEventListener("touchend",    onTouchEnd)
    el.addEventListener("wheel",       onWheel,      { passive: false })

    return () => {
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerup",     onUp)
      el.removeEventListener("pointercancel", onUp)
      el.removeEventListener("touchstart",  onTouchStart)
      el.removeEventListener("touchmove",   onTouchMove)
      el.removeEventListener("touchend",    onTouchEnd)
      el.removeEventListener("wheel",       onWheel)
    }
  // pan.x/pan.y не нужны в deps: читаем через panRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, isPanModeRef])

  return { pan, setPan, panRef, isPanningRef, isTransformingRef }
}
