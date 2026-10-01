"use server"

import { revalidatePath } from "next/cache"
import type { MetalRate } from "@/lib/types"
import { getRequestCrmContext } from "@/lib/supabase/request-context"

async function requireProfile() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Требуется вход в систему")
  if (!profile || profile.status !== "approved") throw new Error("Аккаунт не подтверждён")
  return { supabase, user, profile, shopId }
}

/** Курсы металлов магазина. Пустой список — используются значения по умолчанию. */
export async function getMetalRates(): Promise<MetalRate[]> {
  try {
    const { supabase, shopId } = await requireProfile()
    if (!shopId) return []
    const { data } = await supabase
      .from("metal_rates")
      .select("*")
      .eq("shop_id", shopId)
      .order("metal")
    return (data as MetalRate[]) ?? []
  } catch {
    // Миграция ещё не применена или пользователь не авторизован — не роняем страницу.
    return []
  }
}

/** Обновление рыночного курса металла. Только администратор. */
export async function upsertMetalRate(input: {
  metal: string
  price_per_gram: number
  scrap_price_per_gram: number
}) {
  const { supabase, profile, shopId } = await requireProfile()
  if (profile.role !== "admin" && profile.role !== "super_admin") {
    throw new Error("Изменять курсы может только администратор")
  }
  if (!shopId) throw new Error("Сначала выберите магазин")
  const metal = (input.metal ?? "").trim()
  if (!metal) throw new Error("Укажите металл")
  const sale = Number(input.price_per_gram)
  const scrap = Number(input.scrap_price_per_gram)
  if (!Number.isFinite(sale) || sale < 0) throw new Error("Некорректная цена за грамм")
  if (!Number.isFinite(scrap) || scrap < 0) throw new Error("Некорректный курс лома")

  const { error } = await supabase.from("metal_rates").upsert(
    {
      shop_id: shopId,
      metal,
      price_per_gram: sale,
      scrap_price_per_gram: scrap,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id,metal" },
  )
  if (error) throw new Error(`Не удалось сохранить курс: ${error.message}`)

  revalidatePath("/crm")
  return { ok: true }
}
