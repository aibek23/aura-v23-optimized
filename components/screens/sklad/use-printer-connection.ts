"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  changePrinterDevice,
  getPrinterConnectionSnapshot,
  identifyPrinter,
  printPrinterTestLabel,
  reconnectPrinter,
  savePrinterModelKey,
  startPrinterConnectionMonitor,
  subscribeToPrinterConnection,
  type PrinterConnectionSnapshot,
} from "@/lib/niimbot"

export function usePrinterConnection() {
  const [snapshot, setSnapshot] = useState<PrinterConnectionSnapshot>(getPrinterConnectionSnapshot)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeToPrinterConnection(setSnapshot)
    startPrinterConnectionMonitor()
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
    typeof navigator !== "undefined" && "bluetooth" in navigator

  return {
    ...snapshot,
    busy,
    bluetoothSupported,
    setModelKey,
    connect,
    reconnect,
    changeDevice,
    printTest,
  }
}