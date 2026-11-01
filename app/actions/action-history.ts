"use server"

import { revalidatePath } from "next/cache"
import { requireApprovedContext } from "@/lib/supabase/request-context"
import {
  ACTION_HISTORY_LIMIT,
  ACTION_HISTORY_PAGE_SIZE,
  type ActionHistoryItem,
  type UndoActionResult,
} from "@/lib/action-history"

async function requireContext() {
  const { supabase, shopId } = await requireApprovedContext()
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

export async function getActionHistoryPage(page: number): Promise<{
  items: ActionHistoryItem[]
  hasMore: boolean
}> {
  const pageCount = Math.ceil(ACTION_HISTORY_LIMIT / ACTION_HISTORY_PAGE_SIZE)
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
    throw new Error("Некорректный номер страницы истории")
  }

  const { supabase, shopId } = await requireContext()
  if (!shopId) return { items: [], hasMore: false }

  const offset = page * ACTION_HISTORY_PAGE_SIZE
  // Fetch one extra row (except on the final page) to know whether a next page exists.
  const end = Math.min(offset + ACTION_HISTORY_PAGE_SIZE, ACTION_HISTORY_LIMIT - 1)
  const { data, error } = await supabase
    .from("action_history")
    .select("id, shop_id, entity_type, entity_id, created_at, employee_id, employee_name, description, status, undone_at, undone_by")
    .eq("shop_id", shopId)
    .order("seq", { ascending: false })
    .range(offset, end)
  if (error) throw historyError(error)

  const fetched = (data ?? []) as ActionHistoryItem[]
  return {
    items: fetched.slice(0, ACTION_HISTORY_PAGE_SIZE),
    hasMore: offset + ACTION_HISTORY_PAGE_SIZE < ACTION_HISTORY_LIMIT
      && fetched.length > ACTION_HISTORY_PAGE_SIZE,
  }
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