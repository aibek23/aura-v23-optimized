"use server"

import { createClient } from "@/lib/supabase/server"

export type PublicShop = {
  shop_id: string
  shop_name: string | null
}

/** Список публичных магазинов для главной страницы (витрина маркетплейса). */
export async function getPublicShops(limit = 24): Promise<PublicShop[]> {
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
}