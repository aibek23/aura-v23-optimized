"use server"

import { createClient } from "@/lib/supabase/server"
import { getRequestCrmContext } from "@/lib/supabase/request-context"
import { revalidatePath } from "next/cache"

export type PublicShop = {
  shop_id: string
  shop_name: string | null
}

/** Список публичных магазинов для главной страницы (витрина маркетплейса). */
export async function getPublicShops(limit = 24): Promise<PublicShop[]> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return []
    }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("shop_settings")
      .select("shop_id, shop_name")
      .eq("public_enabled", true)
      .limit(limit)

    if (error) {
      console.error("[shops] public shops error:", error.message)
      return []
    }
    return (data as PublicShop[]) ?? []
  } catch (err) {
    console.warn("[shops] public shops fallback:", err)
    return []
  }
}

export type OwnShopPublicState = { enabled: boolean; canToggle: boolean }

async function requireOwnShopAdminContext() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Требуется вход в систему")
  if (!profile || profile.status !== "approved" || profile.role !== "admin") {
    throw new Error("Только администратор магазина может менять публичность витрины")
  }
  if (!profile.shop_id || shopId !== profile.shop_id) {
    throw new Error("Не удалось подтвердить ваш магазин")
  }
  return { supabase, shopId: profile.shop_id }
}

/** Читает состояние публичности только собственного магазина администратора. */
export async function getOwnShopPublicState(): Promise<OwnShopPublicState> {
  const { supabase, shopId } = await requireOwnShopAdminContext()
  const { data: settings, error } = await supabase
    .from("shop_settings")
    .select("public_enabled")
    .eq("shop_id", shopId)
    .single()
  if (error || !settings) throw new Error("Не удалось загрузить настройки публичной витрины")

  // До применения SQL-миграции переключатель остаётся выключенным, чтобы
  // нельзя было скрыть магазин, пока прямые публичные URL ещё не защищены.
  const { data: rpcEnabled, error: visibilityError } = await supabase.rpc(
    "public_shop_is_enabled",
    { _shop_id: shopId },
  )
  return {
    enabled: Boolean(settings.public_enabled),
    canToggle: !visibilityError && typeof rpcEnabled === "boolean" && rpcEnabled === Boolean(settings.public_enabled),
  }
}

/** Меняет публичность только для магазина, привязанного к текущему admin-профилю. */
export async function setOwnShopPublicEnabled(enabled: boolean): Promise<void> {
  if (typeof enabled !== "boolean") throw new Error("Некорректное значение публичности витрины")
  const { supabase, shopId } = await requireOwnShopAdminContext()
  const { data: rpcEnabled, error: visibilityError } = await supabase.rpc("public_shop_is_enabled", { _shop_id: shopId })
  if (!visibilityError && typeof rpcEnabled !== "boolean") {
    throw new Error("Не удалось подтвердить состояние публичной витрины")
  }
  if (visibilityError) {
    if (["PGRST202", "42883"].includes(visibilityError.code ?? "")) {
      throw new Error("Сначала необходимо обновить базу данных для управления публичной витриной")
    }
    throw new Error("Не удалось проверить публичную витрину: " + visibilityError.message)
  }

  const { data, error } = await supabase
    .from("shop_settings")
    .update({ public_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .select("public_enabled")
    .single()
  if (error || !data || data.public_enabled !== enabled) {
    throw new Error("Не удалось изменить публичность витрины" + (error ? ": " + error.message : ""))
  }

  revalidatePath("/crm/showcase")
  revalidatePath("/")
  revalidatePath("/store/[store_id]", "page")
  revalidatePath("/store/[store_id]/product/[article]", "page")
  revalidatePath("/q/[shopId]/[sku]", "page")
}

/** Проверяет, доступна ли публичная витрина для посетителя. */
export async function isPublicShopEnabled(shopId: string): Promise<boolean> {
  if (!shopId) return false
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("public_shop_is_enabled", { _shop_id: shopId })
    if (!error) return data === true
    if (["PGRST202", "42883"].includes(error.code ?? "")) {
      // Preserve existing public pages until the rollout migration is deployed.
      console.warn("[shops] Public visibility migration is not applied yet")
      return true
    }
    console.error("[shops] Public visibility check failed:", error.message)
    return false
  } catch (error) {
    console.error("[shops] Public visibility check failed:", error)
    return false
  }
}
