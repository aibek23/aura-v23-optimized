"use client"

import { useState, useEffect, useRef } from "react"
import { subscribeSyncState, getSyncState, type SyncProgressState } from "@/lib/local-db/sync-store"
import { syncEngine } from "@/lib/sync/sync-engine"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Send,
  Database,
  X,
} from "lucide-react"

/**
 * Isolated Sync Indicator component.
 * Uses subscribeSyncState directly, so it updates at up to 4fps WITHOUT
 * causing any parent screens or the main dashboard to re-render!
 */
export function SyncIndicator() {
  const [state, setState] = useState<SyncProgressState>(getSyncState())
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return subscribeSyncState((newState) => {
      setState({ ...newState })
    })
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
  } = state

  const handleSyncNow = () => {
    syncEngine.triggerSync()
  }

  // Circular progress math (r=7, perimeter ≈ 44)
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percent / 100) * circumference

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer bg-card/60 hover:bg-card border-border shadow-xs"
        title="Статус синхронизации"
      >
        {/* Circular Progress Ring */}
        <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 -rotate-90">
            <circle
              cx="10"
              cy="10"
              r={radius}
              className="stroke-muted-foreground/20"
              strokeWidth="2.2"
              fill="none"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              className={`transition-all duration-300 ${
                status === "error"
                  ? "stroke-destructive"
                  : status === "offline"
                  ? "stroke-muted-foreground"
                  : "stroke-emerald-600 dark:stroke-emerald-400"
              }`}
              strokeWidth="2.2"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="none"
            />
          </svg>

          {/* Icon inside or alongside */}
          <div className="absolute inset-0 flex items-center justify-center">
            {status === "syncing" && (
              <RefreshCw className="w-2.5 h-2.5 text-emerald-600 animate-spin" />
            )}
            {status === "synced" && (
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
            )}
            {status === "offline" && (
              <WifiOff className="w-2.5 h-2.5 text-muted-foreground" />
            )}
            {status === "error" && (
              <AlertCircle className="w-2.5 h-2.5 text-destructive" />
            )}
          </div>
        </div>

        {/* Status Text and Percentage */}
        <div className="flex items-center gap-1.5">
          {status === "syncing" && (
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
              Синхр. {Math.round(percent)}%
            </span>
          )}
          {status === "synced" && (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Онлайн
            </span>
          )}
          {status === "offline" && (
            <span className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
              <WifiOff className="w-3 h-3 text-amber-600" />
              Офлайн
            </span>
          )}
          {status === "error" && (
            <span className="text-destructive font-medium">Ошибка связи</span>
          )}

          {/* Outbox badge if pending operations exist */}
          {outboxPendingCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-[10px] px-1.5 py-0 h-4 border-amber-300 dark:border-amber-800"
            >
              <Send className="w-2.5 h-2.5 mr-0.5 inline" />
              {outboxPendingCount}
            </Badge>
          )}
        </div>
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
                      : "bg-destructive/10 text-destructive border-destructive/20"
                  }
                >
                  {status === "synced" && "Всё зеркально"}
                  {status === "syncing" && `Обмен (${Math.round(percent)}%)`}
                  {status === "offline" && "Локальный режим"}
                  {status === "error" && "Сбой связи"}
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

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Локальное хранилище:</span>
                <span className="font-medium text-foreground">OPFS / IndexedDB (активно)</span>
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
