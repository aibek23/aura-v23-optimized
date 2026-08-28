"use client"

import { useState, useRef, useEffect } from "react"
import { Bell, CheckCheck, Loader2 } from "lucide-react"
import { useNotifications } from "@/hooks/useNotifications"
import { NotificationItem } from "@/components/notifications/NotificationItem"
import { cn } from "@/lib/utils"

type Props = {
  /** If false, the bell is hidden (e.g. non-super_admin roles). */
  visible?: boolean
  /** Optional callback: open the full notifications page. */
  onSeeAll?: () => void
}

/**
 * NotificationBell — drop-down notification centre for the super admin.
 *
 * Usage: place inside the admin layout header.
 * ```tsx
 * <NotificationBell visible={profile.role === "super_admin"} />
 * ```
 */
export function NotificationBell({ visible = true, onSeeAll }: Props) {
  const {
    items,
    unreadCount,
    isLoading,
    isPending,
    markRead,
    markAllRead,
    approve,
    reject,
  } = useNotifications()

  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open, setOpen])

  if (!visible) return null

  const badge = Math.min(unreadCount, 99)

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
        aria-label={`Уведомления${unreadCount > 0 ? `, непрочитанных: ${unreadCount}` : ""}`}
      >
        <Bell className="h-5 w-5" />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {badge}
          </span>
        )}
      </button>

      {/* Drop-down panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-11 z-50 flex w-80 flex-col rounded-xl border border-border bg-background shadow-lg"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Уведомления</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                title="Отметить все прочитанными"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Все прочитаны
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Нет уведомлений</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 p-3">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={markRead}
                    onApprove={approve}
                    onReject={reject}
                    isPending={isPending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {onSeeAll && (
            <button
              onClick={() => {
                setOpen(false)
                onSeeAll()
              }}
              className="border-t border-border py-2.5 text-center text-xs font-medium text-primary transition-colors hover:bg-muted"
            >
              Все уведомления
            </button>
          )}
          {isPending && (
            <div className="flex items-center justify-center gap-1.5 border-t border-border py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Обновление…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
