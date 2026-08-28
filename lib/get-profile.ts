import { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/lib/types"

/**
 * Returns the authenticated user's profile row, or null if unauthenticated.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  return (data as Profile) ?? null
}
