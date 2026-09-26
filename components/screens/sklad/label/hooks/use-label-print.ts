"use client"
// ---------------------------------------------------------------------------
// Хук печати: handlePrint + автопечать
// ---------------------------------------------------------------------------
import { useRef, useCallback, useEffect } from "react"
import { toast } from "sonner"
import type { Canvas as FabricCanvas } from "fabric"
import type { LabelSizeDef, PrinterProfile } from "@/lib/niimbot"
import { printCanvas } from "@/lib/niimbot"
import { cropPrintArea } from "../canvas/print"

export function useLabelPrint(
  fabricRef:     React.RefObject<FabricCanvas | null>,
  sizeDef:       LabelSizeDef,
  loaded:        boolean,
  autoPrint:     boolean,
  printerProfile: PrinterProfile,
  copies:        number,
  density:       number,
  setIsPrinting: (v: boolean) => void,
  setStatus:     (v: string) => void,
) {
  const autoPrintedRef = useRef(false)

  const handlePrint = useCallback(async () => {
    const canvas = fabricRef.current
    if (!canvas || !loaded) return
    setIsPrinting(true)
    setStatus("Подготовка печати...")
    try {
      const cropped = cropPrintArea(canvas, sizeDef, printerProfile.dpi)
      await printCanvas(cropped, sizeDef, {
        model: printerProfile,
        copies,
        density,
        onProgress: (msg) => setStatus(String(msg)),
      })
      toast.success("Печать успешно завершена")
    } catch (err) {
      console.error("[Print Error]:", err)
      toast.error((err as Error).message || "Ошибка при печати")
    } finally {
      setIsPrinting(false)
      setStatus("")
    }
  }, [fabricRef, sizeDef, loaded, printerProfile, copies, density, setIsPrinting, setStatus])

  useEffect(() => {
    if (!autoPrint || !loaded || autoPrintedRef.current) return
    autoPrintedRef.current = true
    void handlePrint()
  }, [autoPrint, loaded, handlePrint])

  return { handlePrint }
}
