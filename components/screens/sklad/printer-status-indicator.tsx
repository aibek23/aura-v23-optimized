"use client"

import { Bluetooth } from "lucide-react"
import { cn } from "@/lib/utils"
import type { usePrinterConnection } from "./use-printer-connection"

type PrinterConnectionState = ReturnType<typeof usePrinterConnection>

export function PrinterStatusIndicator({ connection }: { connection: PrinterConnectionState }) {
  const connected = connection.status === "connected"
  const checking = !connection.clientReady || connection.status === "checking" || connection.status === "connecting"
  const unavailable = connection.status === "unsupported" || (connection.clientReady && !connection.bluetoothSupported)

  const label = connected
    ? connection.deviceName || "Bluetooth подключён"
    : checking
      ? connection.status === "checking" ? "Проверка Bluetooth…" : "Подключение Bluetooth…"
      : unavailable
        ? "Bluetooth недоступен"
        : connection.deviceName
          ? `${connection.deviceName} · не подключён`
          : "Bluetooth не подключён"

  return (
    <div
      role="status"
      aria-live="polite"
      title={label}
      data-testid="printer-status-indicator"
      className="inline-flex h-9 min-w-0 max-w-[220px] items-center gap-2 rounded-md border border-border/80 bg-background/70 px-2.5"
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <Bluetooth
          className={cn(
            "h-4 w-4",
            connected ? "text-emerald-600 dark:text-emerald-400" :
              unavailable ? "text-destructive" :
                checking ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-background",
            connected ? "bg-emerald-500" :
              unavailable ? "bg-destructive" :
                checking ? "bg-amber-500" : "bg-muted-foreground/45",
          )}
          aria-hidden="true"
        />
      </span>
      <span className="truncate text-xs font-medium">{label}</span>
    </div>
  )
}