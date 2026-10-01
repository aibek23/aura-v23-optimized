import { cache } from "react"
import { getActiveShopId } from "@/lib/supabase/current-shop"
import { createClient } from "@/lib/supabase/server"

/**
 * Reuse authentication/profile lookups during one server render. CRM pages call
 * several server actions in parallel; without request-scoped memoization each
 * action repeated auth.getUser(), the profile query, and current_shop_id().
 *
 * React cache is scoped to a server request, so this never shares a session
 * between different users or requests.
 */
export const getRequestCrmContext = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, profile: null, shopId: null }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile) {
    return { supabase, user, profile: null, shopId: null }
  }

  const fallbackShopId =
    profile.role === "super_admin"
      ? profile.impersonated_shop_id ?? profile.shop_id
      : profile.shop_id
  const shopId = await getActiveShopId(supabase, fallbackShopId ?? null)

  return { supabase, user, profile, shopId }
})