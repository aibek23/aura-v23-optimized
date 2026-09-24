"use client"
// ---------------------------------------------------------------------------
// Синхронизация панели инструментов с выделенным объектом Fabric
// ---------------------------------------------------------------------------
import { useEffect } from "react"
import { Textbox } from "fabric"
import type { Canvas as FabricCanvas } from "fabric"
import { isAutoFit, getFitRatio } from "../canvas/text-fit"

export interface SelectionSyncState {
  setFont:          (f: string) => void
  setFontSize:      (s: number) => void
  setAutoFitState:  (v: boolean) => void
  setFitRatioState: (v: number) => void
  setBold?:         (b: boolean) => void
  setItalic?:       (i: boolean) => void
  setUnderline?:    (u: boolean) => void
  setLinethrough?:  (l: boolean) => void
  setTextAlign?:    (a: "left" | "center" | "right") => void
  setCharSpacing?:  (cs: number) => void
  setLineHeight?:   (lh: number) => void
}

export function useSelectionSync(
  fabricRef: React.RefObject<FabricCanvas | null>,
  ready: boolean,
  sizeKey: string,
  callbacks: SelectionSyncState,
): void {
  const {
    setFont, setFontSize, setAutoFitState, setFitRatioState,
    setBold, setItalic, setUnderline, setLinethrough,
    setTextAlign, setCharSpacing, setLineHeight,
  } = callbacks

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return

    const sync = () => {
      const tb = canvas.getActiveObjects().find((o) => o.type === "textbox") as Textbox | undefined
      if (!tb) return
      setAutoFitState(isAutoFit(tb))
      setFitRatioState(getFitRatio(tb))
      if (typeof tb.fontSize === "number")   setFontSize(Math.round(tb.fontSize))
      if (typeof tb.fontFamily === "string") setFont(tb.fontFamily)
      const fw = String(tb.fontWeight ?? "")
      setBold?.(fw === "bold" || fw === "700" || fw === "800" || fw === "900")
      setItalic?.(tb.fontStyle === "italic")
      setUnderline?.(Boolean(tb.underline))
      setLinethrough?.(Boolean(tb.linethrough))
      if (tb.textAlign === "left" || tb.textAlign === "center" || tb.textAlign === "right") {
        setTextAlign?.(tb.textAlign)
      }
      if (typeof tb.charSpacing === "number") setCharSpacing?.(tb.charSpacing)
      if (typeof tb.lineHeight === "number") setLineHeight?.(Math.round(tb.lineHeight * 100) / 100)
    }

    canvas.on("selection:created", sync)
    canvas.on("selection:updated", sync)
    return () => {
      canvas.off("selection:created", sync)
      canvas.off("selection:updated", sync)
    }
  }, [
    fabricRef, ready, sizeKey,
    setFont, setFontSize, setAutoFitState, setFitRatioState,
    setBold, setItalic, setUnderline, setLinethrough,
    setTextAlign, setCharSpacing, setLineHeight,
  ])
}
