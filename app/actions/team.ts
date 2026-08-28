"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Profile, Role } from "@/lib/types"

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile || (profile.role !== "admin" && profile.role !== "super_admin") || profile.status !== "approved") {
    throw new Error("Forbidden")
  }
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
