"use server"

import { createClient } from "@/lib/supabase/server"
import type { SuperadminNotification, ActionResult } from "@/lib/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireSuperAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Не авторизован")

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "super_admin" || profile?.status !== "approved") {
    throw new Error("Forbidden: requires super_admin role")
  }
  return supabase
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Получить список уведомлений суперадмина.
 */
export async function getNotifications(
  limit = 50,
  offset = 0,
): Promise<ActionResult<SuperadminNotification[]>> {
  try {
    const supabase = await requireSuperAdmin()
    const { data, error } = await supabase.rpc("superadmin_get_notifications", {
      _limit: limit,
      _offset: offset,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as SuperadminNotification[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}

/**
 * Количество непрочитанных уведомлений.
 */
export async function getUnreadCount(): Promise<ActionResult<number>> {
  try {
    const supabase = await requireSuperAdmin()
    const { data, error } = await supabase.rpc("superadmin_get_unread_count")
    if (error) return { success: false, error: error.message }
    return { success: true, data: Number(data ?? 0) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}

/**
 * Пометить одно уведомление прочитанным.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult> {
  try {
    const supabase = await requireSuperAdmin()
    const { error } = await supabase.rpc("superadmin_mark_notification_read", {
      _notification_id: notificationId,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}

/**
 * Пометить все уведомления прочитанными.
 */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  try {
    const supabase = await requireSuperAdmin()
    const { error } = await supabase.rpc("superadmin_mark_all_notifications_read")
    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}

/**
 * Подтвердить заявку прямо из уведомления.
 * Вызывает существующий superadmin_approve_request RPC и помечает уведомление
 * обработанным (триггер сделает это автоматически через UPDATE profiles.status).
 */
export async function approveFromNotification(
  profileId: string,
  role: "admin" | "seller",
): Promise<ActionResult> {
  try {
    const supabase = await requireSuperAdmin()
    const { error } = await supabase.rpc("superadmin_approve_request", {
      _profile_id: profileId,
      _role: role,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}

/**
 * Отклонить заявку прямо из уведомления.
 */
export async function rejectFromNotification(profileId: string): Promise<ActionResult> {
  try {
    const supabase = await requireSuperAdmin()
    const { error } = await supabase.rpc("superadmin_reject_request", {
      _profile_id: profileId,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Ошибка сервера" }
  }
}
