"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { MetalRate } from "@/lib/types"

async function requireProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Требуется вход в систему")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile || profile.status !== "approved") throw new Error("Аккаунт не подтверждён")
  return { supabase, user, profile }
}

/** Курсы металлов магазина. Пустой список — используются значения по умолчанию. */
export async function getMetalRates(): Promise<MetalRate[]> {
  try {
    const { supabase, profile } = await requireProfile()
    const { data } = await supabase
      .from("metal_rates")
      .select("*")
      .eq("shop_id", profile.shop_id)
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
  const { supabase, profile } = await requireProfile()
  if (profile.role !== "admin" && profile.role !== "super_admin") {
    throw new Error("Изменять курсы может только администратор")
  }
  const metal = (input.metal ?? "").trim()
  if (!metal) throw new Error("Укажите металл")
  const sale = Number(input.price_per_gram)
  const scrap = Number(input.scrap_price_per_gram)
  if (!Number.isFinite(sale) || sale < 0) throw new Error("Некорректная цена за грамм")
  if (!Number.isFinite(scrap) || scrap < 0) throw new Error("Некорректный курс лома")

  const { error } = await supabase.from("metal_rates").upsert(
    {
      shop_id: profile.shop_id,
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
