"use client"

import { useState } from "react"
import { Bell, Check, X, Clock, User } from "lucide-react"
import type { SuperadminNotification } from "@/lib/types"
import { NOTIFICATION_KIND_LABELS } from "@/lib/types"
import { roleLabel, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = {
  notification: SuperadminNotification
  onMarkRead: (id: string) => void
  onApprove: (profileId: string, role: "admin" | "seller") => void
  onReject: (profileId: string) => void
  isPending: boolean
}

export function NotificationItem({
  notification,
  onMarkRead,
  onApprove,
  onReject,
  isPending,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isPendingRequest = notification.kind === "pending_request"
  const isActionable = isPendingRequest && !notification.is_processed

  const requestedRole =
    notification.requested_role === "admin" || notification.requested_role === "seller"
      ? notification.requested_role
      : "seller"

  function handleApprove() {
    onApprove(notification.profile_id, requestedRole as "admin" | "seller")
    setConfirmOpen(false)
  }

  function handleReject() {
    onReject(notification.profile_id)
    setConfirmOpen(false)
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-sm transition-colors",
        notification.is_read
          ? "border-border bg-card text-muted-foreground"
          : "border-primary/20 bg-primary/5 text-foreground",
        notification.is_processed && "opacity-60",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
              notification.is_read ? "bg-muted" : "bg-primary/10",
            )}
          >
            <Bell className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium leading-tight truncate">
              {NOTIFICATION_KIND_LABELS[notification.kind]}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(notification.created_at)}
            </p>
          </div>
        </div>

        {/* Unread indicator + mark-read button */}
        {!notification.is_read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            disabled={isPending}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Отметить прочитанным"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-0.5 pl-9">
        <div className="flex items-center gap-1.5 text-xs">
          <User className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">
            {notification.full_name ?? "Неизвестный пользователь"}
          </span>
        </div>
        {notification.shop_name && (
          <p className="text-xs text-muted-foreground truncate">
            Магазин: {notification.shop_name}
          </p>
        )}
        {notification.requested_role && (
          <p className="text-xs text-muted-foreground">
            Запрошенная роль:{" "}
            <span className="font-medium text-foreground">
              {roleLabel(notification.requested_role)}
            </span>
          </p>
        )}
      </div>

      {/* Action buttons */}
      {isActionable && !confirmOpen && (
        <div className="flex gap-2 pl-9 pt-1">
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
            Подтвердить
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            Отклонить
          </button>
        </div>
      )}

      {/* Confirm role dialog (inline) */}
      {isActionable && confirmOpen && (
        <div className="flex flex-col gap-2 pl-9 pt-1">
          <p className="text-xs text-muted-foreground">Одобрить с ролью:</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                onApprove(notification.profile_id, "seller")
                setConfirmOpen(false)
              }}
              disabled={isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Продавец
            </button>
            <button
              onClick={() => {
                onApprove(notification.profile_id, "admin")
                setConfirmOpen(false)
              }}
              disabled={isPending}
              className="rounded-md border border-primary bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              Администратор
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Processed badge */}
      {notification.is_processed && (
        <div className="flex items-center gap-1.5 pl-9 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Обработано</span>
        </div>
      )}
    </div>
  )
}
