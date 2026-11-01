"use server"

import { getRequestCrmContext } from "@/lib/supabase/request-context"

/**
 * Returns the store's product-card units recorded since the measurement
 * migration was installed. RLS limits the count to the active shop.
 */
export async function getProductUnitUsageCount(): Promise<number | null> {
  try {
    const { supabase, user, profile, shopId } = await getRequestCrmContext()
    if (!user || profile?.status !== "approved" || !shopId) return null

    const { count, error } = await supabase
      .from("product_unit_usage")
      .select("product_id", { count: "exact", head: true })
      .eq("shop_id", shopId)

    if (error) {
      console.warn("[product-unit-usage] Count is not available:", error.code)
      return null
    }
    return count ?? 0
  } catch (error) {
    console.warn("[product-unit-usage] Count is not available:", error instanceof Error ? error.message : "unknown")
    return null
  }
}
