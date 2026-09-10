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
}

export function useSelectionSync(
  fabricRef: React.RefObject<FabricCanvas | null>,
  ready: boolean,
  sizeKey: string,
  callbacks: SelectionSyncState,
): void {
  const { setFont, setFontSize, setAutoFitState, setFitRatioState } = callbacks

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
    }

    canvas.on("selection:created", sync)
    canvas.on("selection:updated", sync)
    return () => {
      canvas.off("selection:created", sync)
      canvas.off("selection:updated", sync)
    }
  }, [fabricRef, ready, sizeKey, setFont, setFontSize, setAutoFitState, setFitRatioState])
}
