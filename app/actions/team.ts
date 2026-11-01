"use server"

import { requireAdminContext } from "@/lib/supabase/request-context"
import { revalidatePath } from "next/cache"
import type { Profile, Role } from "@/lib/types"

async function requireAdmin() {
  const { supabase, profile } = await requireAdminContext()
  return { supabase, profile }
}

export async function getTeam(): Promise<Profile[]> {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as Profile[]) ?? []
}

export async function approveMember(id: string, role: Role) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from("profiles").update({ status: "approved", role }).eq("id", id)
  if (error) throw error
  revalidatePath("/crm")
}

export async function rejectMember(id: string) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.from("profiles").update({ status: "rejected", role: null }).eq("id", id)
  if (error) throw error
  revalidatePath("/crm")
}
