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

/* -------------------------------------------------------------------------- */
/* Shared access guards for server actions.                                    */
/* Messages are in Russian on purpose: app/crm/error.tsx and crm-screen.tsx    */
/* match "Требуется вход" / "Аккаунт" to redirect to login or show pending.    */
/* -------------------------------------------------------------------------- */

export const AUTH_REQUIRED_MESSAGE = "Требуется вход в систему"
export const NOT_APPROVED_MESSAGE = "Аккаунт не подтверждён"
export const FORBIDDEN_MESSAGE = "Недостаточно прав"
export const NO_SHOP_MESSAGE = "Ваш аккаунт не привязан к магазину"

/** Signed-in user with an approved profile. */
export async function requireApprovedContext() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error(AUTH_REQUIRED_MESSAGE)
  if (!profile || profile.status !== "approved") throw new Error(NOT_APPROVED_MESSAGE)
  return { supabase, user, profile, shopId }
}

/** Approved user attached to an active shop (shopId is guaranteed non-null). */
export async function requireShopContext(noShopMessage = NO_SHOP_MESSAGE) {
  const ctx = await requireApprovedContext()
  if (!ctx.shopId) throw new Error(noShopMessage)
  return { ...ctx, shopId: ctx.shopId as string }
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin"
}

/** Approved shop admin or super admin. */
export async function requireAdminContext() {
  const ctx = await requireApprovedContext()
  if (!isAdminRole(ctx.profile.role)) throw new Error(FORBIDDEN_MESSAGE)
  return ctx
}

/** Approved super admin. */
export async function requireSuperAdminContext() {
  const ctx = await requireApprovedContext()
  if (ctx.profile.role !== "super_admin") throw new Error(FORBIDDEN_MESSAGE)
  return ctx
}
