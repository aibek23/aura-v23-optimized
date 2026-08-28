"use client"

import { useNotifications } from "@/hooks/useNotifications"
import { NotificationItem } from "@/components/notifications/NotificationItem"
import { Bell, CheckCheck, Loader2, RefreshCw } from "lucide-react"

/**
 * Full-page notification centre for the super admin.
 * Route: /cabinet/notifications  (or wherever the super_admin cabinet places it)
 *
 * Usage:
 *   import { NotificationsPage } from "@/components/notifications/NotificationsPage"
 *   export default function Page() { return <NotificationsPage /> }
 */
export function NotificationsPage() {
  const {
    items,
    unreadCount,
    isLoading,
    isPending,
    refresh,
    markRead,
    markAllRead,
    approve,
    reject,
  } = useNotifications()

  const unread = items.filter((n) => !n.is_read)
  const read = items.filter((n) => n.is_read)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Уведомления</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-muted-foreground">
                Непрочитанных: {unreadCount}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={isLoading || isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${(isLoading || isPending) ? "animate-spin" : ""}`} />
            Обновить
          </button>

          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <CheckCheck className="h-4 w-4" />
              Все прочитаны
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-base font-medium text-muted-foreground">Нет уведомлений</p>
          <p className="text-sm text-muted-foreground/70">
            Здесь будут появляться заявки на подтверждение и другие события.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Unread section */}
          {unread.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Новые ({unread.length})
              </h2>
              <div className="flex flex-col gap-2">
                {unread.map((n) => (
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
            </section>
          )}

          {/* Read / processed section */}
          {read.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Прочитанные ({read.length})
              </h2>
              <div className="flex flex-col gap-2">
                {read.map((n) => (
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
            </section>
          )}
        </div>
      )}
    </div>
  )
}
