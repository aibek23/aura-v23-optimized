"use client"

import { useState, useEffect, useRef } from "react"
import { subscribeSyncState, getSyncState, type SyncProgressState } from "@/lib/local-db/sync-store"
import { syncEngine } from "@/lib/sync/sync-engine"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  AlertCircle,
  Database,
  X,
  Wifi,
  WifiOff,
} from "lucide-react"

/**
 * Isolated Sync Indicator component.
 * Uses subscribeSyncState directly, so it updates at up to 4fps WITHOUT
 * causing any parent screens or the main dashboard to re-render!
 */
export function SyncIndicator() {
  const [state, setState] = useState<SyncProgressState>(getSyncState())
  const [isOpen, setIsOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return subscribeSyncState((newState) => {
      setState({ ...newState })
    })
  }, [])

  useEffect(() => {
    const updateNetworkStatus = () => setIsOnline(navigator.onLine)
    updateNetworkStatus()
    window.addEventListener("online", updateNetworkStatus)
    window.addEventListener("offline", updateNetworkStatus)
    return () => {
      window.removeEventListener("online", updateNetworkStatus)
      window.removeEventListener("offline", updateNetworkStatus)
    }
  }, [])

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  const {
    status,
    percent,
    outboxPendingCount,
    lastSuccessAt,
    currentTask,
    lastError,
    isStale,
  } = state

  const handleSyncNow = () => {
    syncEngine.triggerSync()
  }

  const dotColor =
    status === "synced"
      ? "bg-emerald-500"
      : status === "syncing"
      ? "bg-blue-500 animate-pulse"
      : status === "offline"
      ? "bg-amber-500"
      : status === "error"
      ? "bg-destructive"
      : "bg-muted-foreground"
  const progressPercent = Math.max(0, Math.min(100, Math.round(percent)))
  const statusDescription =
    status === "synced"
      ? "Онлайн"
      : status === "syncing"
      ? `Синхронизация, ${progressPercent}%`
      : status === "offline"
      ? "Офлайн"
      : status === "error"
      ? "Ошибка связи"
      : "Ожидание"

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/60 shadow-xs transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        title={`Статус синхронизации: ${statusDescription}${outboxPendingCount > 0 ? `; неотправленных операций: ${outboxPendingCount}` : ""}`}
        aria-label={`Статус синхронизации: ${statusDescription}${outboxPendingCount > 0 ? `; неотправленных операций: ${outboxPendingCount}` : ""}`}
        aria-expanded={isOpen}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} aria-hidden="true" />
        {outboxPendingCount > 0 && (
          <span
            className="absolute right-0 top-0 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-card"
            title="Есть неотправленные данные"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Detail Popover Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 p-4 rounded-xl shadow-xl border border-border bg-popover text-popover-foreground z-50 animate-in fade-in-50 zoom-in-95">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Синхронизация данных</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={
                    status === "synced"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : status === "syncing"
                      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300"
                      : status === "offline"
                      ? "bg-muted text-muted-foreground"
                      : status === "error"
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : "bg-muted text-muted-foreground border-border"
                  }
                >
                  {status === "synced" && "Всё зеркально"}
                  {status === "syncing" && `Обмен (${Math.round(percent)}%)`}
                  {status === "offline" && "Локальный режим"}
                  {status === "error" && "Сбой связи"}
                  {status === "idle" && "Ожидание"}
                </Badge>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Прогресс синхронизации</span>
                <span className="font-medium text-foreground">{progressPercent}%</span>
              </div>
              {status === "syncing" && (
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Прогресс синхронизации"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Состояние сети:</span>
              <span className={`inline-flex items-center gap-1.5 font-medium ${isOnline ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {isOnline ? "Подключение есть" : "Нет подключения"}
              </span>
            </div>

            {isStale && (
              <div>
                <Badge
                  variant="outline"
                  className="h-5 border-amber-300 bg-amber-50 px-2 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                  title="Показаны локальные данные, не подтверждённые облаком"
                >
                  Устаревшие данные
                </Badge>
              </div>
            )}

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Локальное хранилище:</span>
                <span className="font-medium text-foreground">IndexedDB (активно)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Очередь отправки (Outbox):</span>
                <span className="font-medium text-foreground">
                  {outboxPendingCount > 0 ? `${outboxPendingCount} операций` : "Очередь пуста"}
                </span>
              </div>
              {lastSuccessAt && (
                <div className="flex items-center justify-between">
                  <span>Последняя сверка:</span>
                  <span className="font-medium text-foreground">
                    {new Date(lastSuccessAt).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>

            {currentTask && (
              <div className="p-2 rounded bg-muted/60 text-xs text-muted-foreground flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                <span className="truncate">{currentTask}</span>
              </div>
            )}

            {lastError && (
              <div className="p-2 rounded bg-destructive/10 text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{lastError}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between border-t border-border">
              <span className="text-[11px] text-muted-foreground">
                Работает без интернета
              </span>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs px-2.5"
                onClick={handleSyncNow}
                disabled={status === "syncing"}
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${status === "syncing" ? "animate-spin" : ""}`} />
                Синхронизировать
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
