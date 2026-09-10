"use client"
// ---------------------------------------------------------------------------
// Режим «Рука» (Pan Mode):
//   • кнопка остаётся обычным toggle;
//   • на desktop Alt — временная рука: отпустили Alt → вернулись к выделению.
// ---------------------------------------------------------------------------
import { useState, useRef, useEffect, useCallback } from "react"
import type { Canvas as FabricCanvas } from "fabric"

export function usePanMode(
  fabricRef: React.RefObject<FabricCanvas | null>,
  viewportElRef: React.RefObject<HTMLDivElement | null>,
  sizeKey: string,
) {
  const [manualPanMode, setManualPanMode] = useState(false)
  const [altPanMode, setAltPanMode] = useState(false)
  const isPanMode = manualPanMode || altPanMode
  const isPanModeRef               = useRef(false)
  isPanModeRef.current             = isPanMode

  const togglePanMode = useCallback(() => {
    setManualPanMode((v) => !v)
  }, [])

  // Жесты включают режим, но не ломают его повторным событием.
  const activatePanMode = useCallback(() => {
    setManualPanMode(true)
  }, [])

  const deactivatePanMode = useCallback(() => {
    setManualPanMode(false)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape всегда возвращает к режиму выделения.
      if (e.key === "Escape") {
        setManualPanMode(false)
        setAltPanMode(false)
        return
      }
      if (e.key !== "Alt" || e.repeat) return
      setAltPanMode(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltPanMode(false)
    }
    const onBlur = () => setAltPanMode(false)
    const onVisibility = () => { if (document.hidden) setAltPanMode(false) }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  // Применяем режим к Fabric при каждом изменении isPanMode или sizeKey
  useEffect(() => {
    const fabric = fabricRef.current
    if (!fabric) return
    if (isPanMode) {
      fabric.selection = false
      fabric.getObjects().forEach((o) => {
        o.selectable = false
        o.evented    = false
      })
      if (viewportElRef.current) viewportElRef.current.style.cursor = "grab"
    } else {
      fabric.selection = true
      fabric.getObjects().forEach((o) => {
        const role = (o as unknown as { data?: { role?: string } }).data?.role
        o.selectable = role !== "bg"
        o.evented    = role !== "bg"
      })
      if (viewportElRef.current) viewportElRef.current.style.cursor = "default"
    }
    fabric.requestRenderAll()
  }, [isPanMode, fabricRef, viewportElRef, sizeKey])

  return {
    isPanMode, isPanModeRef,
    togglePanMode, activatePanMode, deactivatePanMode,
  }
}
