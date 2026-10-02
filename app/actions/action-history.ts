"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getActiveShopId } from "@/lib/supabase/current-shop"
import {
  ACTION_HISTORY_LIMIT,
  type ActionHistoryItem,
  type UndoActionResult,
} from "@/lib/action-history"

async function requireContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Требуется вход в систему")
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("status, role, shop_id, impersonated_shop_id")
    .eq("id", user.id)
    .single()
  if (error || !profile || profile.status !== "approved") {
    throw new Error("Аккаунт не подтверждён")
  }
  const fallback = profile.role === "super_admin"
    ? profile.impersonated_shop_id ?? profile.shop_id
    : profile.shop_id
  const shopId = await getActiveShopId(supabase, fallback ?? null)
  return { supabase, shopId }
}

function historyError(error: { code?: string; message: string }): Error {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    return new Error(
      "История ещё не настроена. Выполните миграции v39_action_history.sql, v40_undo_create_sale_cash.sql и v43_hard_delete_product_undo.sql в SQL Editor Supabase и обновите страницу.",
    )
  }
  return new Error(error.message)
}

export async function getActionHistory(): Promise<ActionHistoryItem[]> {
  const { supabase, shopId } = await requireContext()
  if (!shopId) return []
  // No select("*"): prev_state/next_state contain private snapshots.
  const { data, error } = await supabase
    .from("action_history")
    .select("id, shop_id, entity_type, entity_id, created_at, employee_id, employee_name, description, status, undone_at, undone_by")
    .eq("shop_id", shopId)
    .order("seq", { ascending: false })
    .limit(ACTION_HISTORY_LIMIT)
  if (error) throw historyError(error)
  return (data ?? []) as ActionHistoryItem[]
}

/** The RPC owns authorization, locking, conflict detection and restoration. */
export async function undoAction(actionId: string): Promise<UndoActionResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionId)) {
    throw new Error("Некорректная запись истории")
  }
  const { supabase, shopId } = await requireContext()
  if (!shopId) throw new Error("Сначала выберите магазин")
  const { data, error } = await supabase.rpc("undo_action", { _action_id: actionId })
  if (error) throw historyError(error)
  const result = data as UndoActionResult
  if (result.entity_type === "product" && "record" in result) {
    // Best-effort derived QR metadata. Never report an already successful undo
    // as failed merely because this optional lookup could not be completed.
    try {
      const { data: settings } = await supabase
        .from("shop_settings")
        .select("seq_id")
        .eq("shop_id", shopId)
        .maybeSingle()
      if (settings?.seq_id) result.record.shop_seq_id = settings.seq_id
    } catch {
      // Restoration has already committed; optional metadata must not mask it.
    }
  }
  for (const path of ["/crm", "/pos", "/money", "/reports", "/customers", "/cabinet", "/crm/cabinet", "/inventory", "/crm/inventory", "/showcase", "/crm/showcase"]) {
    revalidatePath(path)
  }
  return result
}