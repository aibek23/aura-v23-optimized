"use client"

import { useState, useEffect, useCallback, useRef, useTransition } from "react"
import { createClient } from "@/lib/supabase/client"
import type { SuperadminNotification } from "@/lib/types"
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  approveFromNotification,
  rejectFromNotification,
} from "@/app/actions/notifications"
import { toast } from "sonner"

export type NotificationState = {
  items: SuperadminNotification[]
  unreadCount: number
  isLoading: boolean
}

export function useNotifications() {
  const [state, setState] = useState<NotificationState>({
    items: [],
    unreadCount: 0,
    isLoading: true,
  })
  const [isPending, startTransition] = useTransition()

  // -------------------------------------------------------------------------
  // Initial fetch — сервер-экшн сам проверяет роль через requireSuperAdmin.
  // Если пользователь не super_admin — возвращается { success: false },
  // компонент просто показывает пустое состояние без ошибок.
  // -------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const [notifResult, countResult] = await Promise.all([
      getNotifications(50, 0),
      getUnreadCount(),
    ])

    setState((prev) => ({
      ...prev,
      isLoading: false,
      items: notifResult.success ? notifResult.data : prev.items,
      unreadCount: countResult.success ? countResult.data : prev.unreadCount,
    }))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // -------------------------------------------------------------------------
  // Supabase Realtime: live-обновления при изменении таблицы уведомлений.
  // Работает через WebSocket (postgres_changes) — НЕ требует разрешения
  // браузера на уведомления. При любом событии просто вызывает refresh().
  // -------------------------------------------------------------------------
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    const supabase = createClient()

    // Уникальное имя канала предотвращает конфликт при повторном монтировании
    const topic = `superadmin_notifications_${Math.random().toString(36).slice(2)}`

    let realtimeWorking = false

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "superadmin_notifications",
        },
        () => {
          // При любом INSERT/UPDATE — перечитываем список с сервера
          refreshRef.current()
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeWorking = true
        }
        // Если Realtime недоступен (таблица не опубликована) — игнорируем,
        // пользователь всё равно может обновить вручную
        if (status === "CHANNEL_ERROR") {
          realtimeWorking = false
          console.warn("[Notifications] Realtime недоступен, используется polling")
        }
      })

    // Резервный polling каждые 15 сек — на случай если Realtime не настроен
    const pollInterval = setInterval(() => {
      if (!realtimeWorking) {
        refreshRef.current()
      }
    }, 15_000)

    return () => {
      clearInterval(pollInterval)
      supabase.removeChannel(channel)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const markRead = useCallback(
    (id: string) => {
      startTransition(async () => {
        // Оптимистичное обновление
        setState((prev) => ({
          ...prev,
          items: prev.items.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        }))

        const result = await markNotificationRead(id)
        if (!result.success) {
          toast.error("Ошибка", { description: result.error })
          refresh()
        }
      })
    },
    [refresh],
  )

  const markAllRead = useCallback(() => {
    startTransition(async () => {
      setState((prev) => ({
        ...prev,
        items: prev.items.map((n) => ({ ...n, is_read: true })),
        unreadCount: 0,
      }))

      const result = await markAllNotificationsRead()
      if (!result.success) {
        toast.error("Ошибка", { description: result.error })
        refresh()
      }
    })
  }, [refresh])

  const approve = useCallback(
    (profileId: string, role: "admin" | "seller") => {
      startTransition(async () => {
        const result = await approveFromNotification(profileId, role)
        if (result.success) {
          toast.success("Заявка одобрена")
          refresh()
        } else {
          toast.error("Не удалось одобрить заявку", { description: result.error })
        }
      })
    },
    [refresh],
  )

  const reject = useCallback(
    (profileId: string) => {
      startTransition(async () => {
        const result = await rejectFromNotification(profileId)
        if (result.success) {
          toast.success("Заявка отклонена")
          refresh()
        } else {
          toast.error("Не удалось отклонить заявку", { description: result.error })
        }
      })
    },
    [refresh],
  )

  return {
    ...state,
    isPending,
    refresh,
    markRead,
    markAllRead,
    approve,
    reject,
  }
}
