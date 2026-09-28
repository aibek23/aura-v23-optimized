"use client"

import { useState } from "react"
import {
  Bluetooth,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Printer,
  RefreshCw,
  Settings2,
} from "lucide-react"
import { PRINTER_PROFILES, getPrinterProfile } from "@/lib/niimbot"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { usePrinterConnection } from "./use-printer-connection"

type PrinterConnectionState = ReturnType<typeof usePrinterConnection>
type PrinterStatus = PrinterConnectionState["status"]

const statusCopy: Record<PrinterStatus, string> = {
  checking: "Проверка Bluetooth",
  connected: "Принтер подключён",
  disconnected: "Принтер не подключён",
  unsupported: "Bluetooth недоступен",
  connecting: "Подключение к принтеру",
}

function statusTone(status: PrinterStatus) {
  if (status === "connected") return "text-emerald-600 dark:text-emerald-400"
  if (status === "unsupported") return "text-destructive"
  if (status === "connecting" || status === "checking") return "text-amber-600 dark:text-amber-400"
  return "text-muted-foreground"
}

function statusDot(status: PrinterStatus) {
  if (status === "connected") return "bg-emerald-500"
  if (status === "unsupported") return "bg-destructive"
  if (status === "connecting" || status === "checking") return "bg-amber-500"
  return "bg-muted-foreground/45"
}

export function PrinterSettings({ connection }: { connection: PrinterConnectionState }) {
  const [open, setOpen] = useState(false)
  const profile = getPrinterProfile(connection.modelKey)
  const isWorking = connection.busy || connection.status === "connecting" || connection.status === "checking"
  const canUseBluetooth = connection.bluetoothSupported && connection.status !== "unsupported"

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 min-w-0 justify-start gap-2 border-border/80 bg-background/70 px-2.5 sm:px-3"
        onClick={() => setOpen(true)}
        aria-label="Открыть настройки Bluetooth-принтера"
        data-testid="button-open-printer-settings"
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <Bluetooth className={cn("h-4 w-4", statusTone(connection.status))} />
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-background",
              statusDot(connection.status),
            )}
            aria-hidden="true"
          />
        </span>
        <span className="hidden max-w-[160px] truncate text-xs font-medium sm:inline">
          {connection.deviceName || "Настроить принтер"}
        </span>
        <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
          <DialogHeader className="border-b bg-muted/20 px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bluetooth className="h-4 w-4" />
              </span>
              Настройки принтера
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Выберите модель и подключите устройство для печати этикеток напрямую из Aura.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-5">
            <div
              className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/25 p-3"
              data-testid="status-printer-connection"
            >
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background", statusTone(connection.status))}>
                {connection.status === "connected" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : connection.status === "unsupported" ? (
                  <CircleAlert className="h-4 w-4" />
                ) : (
                  <Bluetooth className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", statusDot(connection.status))} aria-hidden="true" />
                  <p className={cn("text-sm font-medium", statusTone(connection.status))}>
                    {statusCopy[connection.status]}
                  </p>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {connection.deviceName || "Имя устройства появится после подключения"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="printer-settings-model" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Модель принтера
              </label>
              <select
                id="printer-settings-model"
                value={connection.modelKey}
                onChange={(event) => connection.setModelKey(event.target.value)}
                disabled={isWorking}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="select-printer-model"
              >
                {PRINTER_PROFILES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.displayName}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {profile.dpi} dpi · печатаемая ширина {profile.printheadPx} px
              </p>
            </div>

            {!connection.bluetoothSupported && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive" role="alert">
                Браузер не поддерживает Web Bluetooth. Откройте Aura в Chrome, Edge или Opera на устройстве с Bluetooth.
              </p>
            )}

            {connection.error && (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200" role="alert" data-testid="text-printer-error">
                {connection.error}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="gap-1.5"
                onClick={() => void connection.connect()}
                disabled={isWorking || !canUseBluetooth || connection.status === "connected"}
                data-testid="button-connect-printer"
              >
                {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bluetooth className="h-3.5 w-3.5" />}
                {connection.status === "connected" ? "Подключён" : "Подключить"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => void connection.reconnect()}
                disabled={isWorking || !canUseBluetooth || !connection.hasRememberedDevice}
                data-testid="button-reconnect-printer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Переподключить
              </Button>
              <Button
                type="button"
                variant="outline"
                className="col-span-2 gap-1.5"
                onClick={() => void connection.changeDevice()}
                disabled={isWorking || !canUseBluetooth}
                data-testid="button-change-printer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Сменить устройство
              </Button>
            </div>

            <div className="border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2"
                onClick={() => void connection.printTest()}
                disabled={isWorking || !canUseBluetooth || connection.status !== "connected"}
                data-testid="button-print-test-label"
              >
                <Printer className="h-4 w-4" />
                {connection.busy ? "Печать пробной этикетки…" : "Напечатать одну тестовую этикетку"}
              </Button>
              <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">
                Печать доступна после подключения выбранного устройства.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}