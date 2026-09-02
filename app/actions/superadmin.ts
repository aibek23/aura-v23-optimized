"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SubscriptionStatus } from "@/lib/types"

// ---------------------------------------------------------------------------
// Типы (реэкспорт для обратной совместимости импортов)
// ---------------------------------------------------------------------------

export type { SubscriptionStatus } from "@/lib/types"

export type ShopBillingRow = {
  shop_id: string
  shop_name: string | null
  paid_until: string | null          // ISO date "YYYY-MM-DD"
  subscription_status: SubscriptionStatus
  auto_block: boolean
  is_frozen: boolean
  frozen_at: string | null
  member_count: number
  created_at: string | null
}

export type UpdateShopBillingInput = {
  shop_id:             string
  paid_until?:         string | null
  subscription_status?: SubscriptionStatus
  auto_block?:         boolean
  is_frozen?:          boolean
  notes?:              string | null
}

// ---------------------------------------------------------------------------
// Хелпер: проверить права суперадмина
// ---------------------------------------------------------------------------

async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Требуется вход в систему")
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, status, shop_id")
    .eq("id", user.id)
    .single()
  if (!profile || profile.status !== "approved" || profile.role !== "super_admin") {
    throw new Error("Доступ запрещён: требуется роль суперадмина")
  }
  return { supabase, user, profile }
}

// ---------------------------------------------------------------------------
// Получить список всех магазинов с биллингом
// ---------------------------------------------------------------------------

export async function getSuperAdminShops(): Promise<ShopBillingRow[]> {
  const { supabase } = await requireSuperAdmin()
  const { data, error } = await supabase.rpc("superadmin_list_shops")
  if (error) throw new Error(`Не удалось загрузить список магазинов: ${error.message}`)
  return (data as ShopBillingRow[]) ?? []
}

// ---------------------------------------------------------------------------
// Обновить биллинг магазина
// ---------------------------------------------------------------------------

export async function updateShopBilling(input: UpdateShopBillingInput): Promise<void> {
  const { supabase } = await requireSuperAdmin()
  const { error } = await supabase.rpc("superadmin_update_shop_billing", {
    _shop_id:             input.shop_id,
    _paid_until:          input.paid_until ?? null,
    _subscription_status: input.subscription_status ?? null,
    _auto_block:          input.auto_block ?? null,
    _is_frozen:           input.is_frozen  ?? null,
    _notes:               input.notes      ?? null,
  })
  if (error) throw new Error(`Не удалось обновить биллинг: ${error.message}`)
  revalidatePath("/crm")
}

// ---------------------------------------------------------------------------
// Заморозка / разморозка магазина (единый эндпоинт-переключатель)
// ---------------------------------------------------------------------------

/**
 * Переключает состояние магазина.
 *  frozen = true  → магазин заморожен (subscription_status = 'frozen')
 *  frozen = false → магазин разморожен, статус подписки восстанавливается
 *                   на стороне БД по дате paid_until (active / past_due / trial).
 */
export async function setShopFrozen(shopId: string, frozen: boolean): Promise<void> {
  const { supabase } = await requireSuperAdmin()
  const { error } = await supabase.rpc("superadmin_set_shop_frozen", {
    _shop_id: shopId,
    _frozen: frozen,
  })
  if (error) {
    throw new Error(
      `Не удалось ${frozen ? "заморозить" : "разморозить"} магазин: ${error.message}`,
    )
  }
  revalidatePath("/crm")
}

// ---------------------------------------------------------------------------
// Имперсонация: войти в магазин / выйти
// ---------------------------------------------------------------------------

export async function impersonateShop(shopId: string | null): Promise<void> {
  const { supabase } = await requireSuperAdmin()
  const { error } = await supabase.rpc("superadmin_impersonate", {
    _target_shop_id: shopId,
  })
  if (error) throw new Error(`Ошибка переключения магазина: ${error.message}`)
  revalidatePath("/crm")
}

// ---------------------------------------------------------------------------
// Получить текущий impersonated_shop_id суперадмина (для баннера)
// ---------------------------------------------------------------------------

export async function getImpersonatedShop(): Promise<{ shop_id: string; shop_name: string | null } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("impersonated_shop_id, role")
    .eq("id", user.id)
    .single()

  if (!profile?.impersonated_shop_id || profile.role !== "super_admin") return null

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("shop_id, shop_name")
    .eq("shop_id", profile.impersonated_shop_id)
    .single()

  return settings ? { shop_id: settings.shop_id, shop_name: settings.shop_name } : null
}
