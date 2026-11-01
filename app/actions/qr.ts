"use server"

import { getRequestCrmContext } from "@/lib/supabase/request-context"

export type QrShopCheck =
  | { ok: true; shopSeqId: number | null; shopName: string | null }
  | {
      ok: false
      reason: "foreign_shop"
      scannedSeqId: number
      ownSeqId: number
      ownShopName: string | null
    }
  | { ok: false; reason: "unauthorized" }

/**
 * Проверяет, принадлежит ли отсканированный QR-код (seq_id магазина) текущему
 * магазину сотрудника. Читаем ТОЛЬКО свой магазин (RLS shop_settings), название
 * чужого магазина не запрашиваем — никаких дополнительных функций в БД не нужно.
 */
export async function checkQrShop(shopSeqId: number): Promise<QrShopCheck> {
  // Текущий магазин (учитывает имперсонацию super_admin через current_shop_id()).
  const { supabase, user, shopId } = await getRequestCrmContext()
  if (!user) return { ok: false, reason: "unauthorized" }

  if (!shopId) return { ok: true, shopSeqId: null, shopName: null }

  const { data: own, error } = await supabase
    .from("shop_settings")
    .select("seq_id, shop_name")
    .eq("shop_id", shopId)
    .maybeSingle()

  if (error) {
    console.error("[qr] own shop lookup error:", error.message)
    // Не блокируем поиск, если магазин прочитать не удалось.
    return { ok: true, shopSeqId: null, shopName: null }
  }

  const ownRow = own as { seq_id: number | null; shop_name: string | null } | null
  if (!ownRow?.seq_id || ownRow.seq_id === shopSeqId) {
    return { ok: true, shopSeqId: ownRow?.seq_id ?? null, shopName: ownRow?.shop_name ?? null }
  }

  return {
    ok: false,
    reason: "foreign_shop",
    scannedSeqId: shopSeqId,
    ownSeqId: ownRow.seq_id,
    ownShopName: ownRow.shop_name ?? null,
  }
}
