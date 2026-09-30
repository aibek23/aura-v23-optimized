"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  changePrinterDevice,
  getPrinterConnectionSnapshot,
  identifyPrinter,
  loadNiimbot,
  NIIMBOT_MODEL,
  printPrinterTestLabel,
  reconnectPrinter,
  savePrinterModelKey,
  startPrinterConnectionMonitor,
  subscribeToPrinterConnection,
  type PrinterConnectionSnapshot,
} from "@/lib/niimbot"

const initialSnapshot: PrinterConnectionSnapshot = {
  status: "disconnected",
  modelKey: NIIMBOT_MODEL.key,
  deviceName: null,
  hasRememberedDevice: false,
  error: null,
}

export function usePrinterConnection() {
  // Keep the first server and browser renders identical. Browser storage is read
  // after hydration, when the effect synchronizes the real connection state.
  const [snapshot, setSnapshot] = useState<PrinterConnectionSnapshot>(initialSnapshot)
  const [busy, setBusy] = useState(false)
  const [clientReady, setClientReady] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeToPrinterConnection(setSnapshot)
    setSnapshot(getPrinterConnectionSnapshot())
    startPrinterConnectionMonitor()
    setClientReady(true)
    // Load the driver before the user starts printing so the dynamic import
    // does not delay the Web Bluetooth chooser after the print-button click.
    if (window.isSecureContext && "bluetooth" in navigator) {
      void loadNiimbot().catch(() => undefined)
    }
    return unsubscribe
  }, [])

  const setModelKey = useCallback((modelKey: string) => {
    savePrinterModelKey(modelKey)
    setSnapshot(getPrinterConnectionSnapshot())
  }, [])

  const runAction = useCallback(async <T,>(action: () => Promise<T>) => {
    setBusy(true)
    try {
      return await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось выполнить действие с принтером."
      setSnapshot(getPrinterConnectionSnapshot())
      toast.error(message, { duration: 6000 })
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(
    () => runAction(() => identifyPrinter(snapshot.modelKey)),
    [runAction, snapshot.modelKey],
  )
  const reconnect = useCallback(
    () => runAction(() => reconnectPrinter(snapshot.modelKey)),
    [runAction, snapshot.modelKey],
  )
  const changeDevice = useCallback(
    () => runAction(() => changePrinterDevice(snapshot.modelKey)),
    [runAction, snapshot.modelKey],
  )
  const printTest = useCallback(
    () => runAction(() => printPrinterTestLabel(snapshot.modelKey)),
    [runAction, snapshot.modelKey],
  )

  const bluetoothSupported =
    clientReady && typeof window !== "undefined" && window.isSecureContext && "bluetooth" in navigator

  return {
    ...snapshot,
    busy,
    clientReady,
    bluetoothSupported,
    setModelKey,
    connect,
    reconnect,
    changeDevice,
    printTest,
  }
}