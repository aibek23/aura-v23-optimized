"use server"

import { createClient } from "@/lib/supabase/server"

/** Публичная карточка изделия для страницы /store/[store_id]/product/[article]. */
export type PublicProduct = {
  id: string
  shop_id: string
  shop_name: string | null
  name: string
  category: string | null
  metal: string | null
  metal_color: string | null
  purity: string | null
  weight: number
  size: string | null
  sku: string | null
  stones: string | null
  description: string | null
  sale_price: number
  quantity: number
  status: string
  images: string[] | null
  image_url: string | null
  created_at: string
}

/**
 * Читает изделие без авторизации через security-definer функцию, которая
 * отдаёт только безопасные колонки (без закупочных цен и поставщика).
 */
export async function getPublicProduct(storeId: string, article: string): Promise<PublicProduct | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_product", {
    _shop_id: storeId,
    _article: decodeURIComponent(article),
  })
  if (error) {
    console.error("[store] public_product error:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row as PublicProduct) ?? null
}

/** Несколько других изделий того же магазина — блок «Смотрите также». */
export async function getPublicShopProducts(storeId: string, limit = 8): Promise<PublicProduct[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_shop_products", {
    _shop_id: storeId,
    _limit: limit,
  })
  if (error) {
    console.error("[store] public_shop_products error:", error.message)
    return []
  }
  return (data as PublicProduct[]) ?? []
}
