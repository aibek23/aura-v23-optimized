import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolve the store selected by the authenticated database context.
 * For super admins this is the impersonated store; otherwise it is the
 * profile's own store. Keep the profile value as a fallback for older schemas.
 */
export async function getActiveShopId(
  supabase: SupabaseClient,
  fallbackShopId: string | null = null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_shop_id")
  if (!error && typeof data === "string") return data
  return fallbackShopId
}