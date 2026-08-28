"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Profile } from "@/lib/types"

async function requireProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile || profile.status !== "approved") throw new Error("Not approved")
  return { supabase, user, profile: profile as Profile }
}

async function requireAdmin() {
  const ctx = await requireProfile()
  if (ctx.profile.role !== "admin" && ctx.profile.role !== "super_admin") throw new Error("Forbidden")
  return ctx
}

async function requireSuperAdmin() {
  const ctx = await requireProfile()
  if (ctx.profile.role !== "super_admin") throw new Error("Forbidden")
  return ctx
}

export type CabinetData = {
  team: Profile[]
  requests: Profile[]
  defaultBonusRate: number
}

/** Данные кабинета с учётом роли: супер-админ видит всех, админ — своих продавцов. */
export async function getCabinetData(): Promise<CabinetData> {
  const { supabase, profile } = await requireProfile()

  if (profile.role === "seller") {
    return { team: [], requests: [], defaultBonusRate: profile.bonus_rate ?? 2 }
  }

  const isSuper = profile.role === "super_admin"

  // Супер-админ читает сотрудников своего (или impersonated) магазина.
  const { data: all, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("shop_id", profile.shop_id)
    .order("created_at", { ascending: false })
  if (error) throw error

  const rows = (all as Profile[]) ?? []
  const { data: settings } = await supabase
    .from("shop_settings")
    .select("default_bonus_rate")
    .eq("shop_id", profile.shop_id)
    .maybeSingle()

  const team = rows.filter((p) => {
    if (p.id === profile.id) return false
    if (p.status !== "approved") return false
    if (isSuper) return p.role === "admin" || p.role === "seller"
    // Админ видит только своих продавцов (и ещё не закреплённых).
    return p.role === "seller" && (p.manager_id === profile.id || !p.manager_id)
  })

  // Супер-админ видит заявки из ВСЕХ магазинов (не только своего).
  let requests: Profile[] = []
  if (isSuper) {
    const { data: allPending, error: pendingError } = await supabase
      .from("profiles")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
    if (pendingError) throw pendingError
    requests = (allPending as Profile[]) ?? []
  }

  return {
    team,
    requests,
    defaultBonusRate: Number(settings?.default_bonus_rate ?? 2),
  }
}

/**
 * Одобрить заявку: супер-админ назначает роль (админ / продавец).
 * Работает для заявок из ЛЮБОГО магазина — ограничение .eq("shop_id") снято.
 * Используется RPC-функция superadmin_approve_request (SECURITY DEFINER),
 * которая сама проверяет наличие роли super_admin у вызывающего.
 */
export async function approveRequest(id: string, role: "admin" | "seller") {
  const { supabase } = await requireSuperAdmin()
  const { error } = await supabase.rpc("superadmin_approve_request", {
    _profile_id: id,
    _role: role,
  })
  if (error) throw new Error(`Не удалось одобрить заявку: ${error.message}`)
  revalidatePath("/")
}

/**
 * Отклонить заявку: супер-админ может отклонить из любого магазина.
 * Используется RPC-функция superadmin_reject_request (SECURITY DEFINER).
 */
export async function rejectRequest(id: string) {
  const { supabase } = await requireSuperAdmin()
  const { error } = await supabase.rpc("superadmin_reject_request", {
    _profile_id: id,
  })
  if (error) throw new Error(`Не удалось отклонить заявку: ${error.message}`)
  revalidatePath("/")
}

/** Удаление сотрудника: админ — только своих продавцов, супер-админ — любого. */
export async function removeMember(id: string) {
  const { supabase, profile } = await requireAdmin()
  if (id === profile.id) throw new Error("Нельзя удалить самого себя")

  const { data: target } = await supabase.from("profiles").select("*").eq("id", id).single()
  const t = target as Profile | null
  if (!t || t.shop_id !== profile.shop_id) throw new Error("Сотрудник не найден")

  if (profile.role !== "super_admin") {
    if (t.role !== "seller" || (t.manager_id && t.manager_id !== profile.id)) {
      throw new Error("Можно удалять только своих продавцов")
    }
  }

  const { error } = await supabase.from("profiles").delete().eq("id", id)
  if (error) throw error
  revalidatePath("/")
}

/** Персональный процент бонусов сотрудника. */
export async function setMemberBonusRate(id: string, rate: number) {
  const { supabase, profile } = await requireAdmin()
  const value = Math.max(0, Math.min(100, Number(rate) || 0))

  const { data: target } = await supabase.from("profiles").select("*").eq("id", id).single()
  const t = target as Profile | null
  if (!t || t.shop_id !== profile.shop_id) throw new Error("Сотрудник не найден")
  if (profile.role !== "super_admin" && t.role !== "seller" && t.id !== profile.id) {
    throw new Error("Недостаточно прав")
  }

  const { error } = await supabase.rpc("set_bonus_rate", { _user_id: id, _rate: value })
  if (error) throw error
  revalidatePath("/")
  revalidatePath("/crm")
}

/** Общий процент бонусов по магазину — только супер-админ. */
export async function setDefaultBonusRate(rate: number) {
  const { supabase, profile } = await requireSuperAdmin()
  const value = Math.max(0, Math.min(100, Number(rate) || 0))
  const { error } = await supabase
    .from("shop_settings")
    .upsert(
      { shop_id: profile.shop_id, default_bonus_rate: value, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" },
    )
  if (error) throw error
  revalidatePath("/")
}

/** Отметка присутствия — вызывается клиентом раз в минуту. */
export async function touchPresence() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.rpc("touch_presence")
}

/** Обнулить бонусный баланс сотрудника — только админ / супер-админ. */
export async function resetBonusPoints(id: string) {
  const { supabase, profile } = await requireAdmin()

  const { data: target } = await supabase.from("profiles").select("*").eq("id", id).single()
  const t = target as Profile | null
  if (!t || t.shop_id !== profile.shop_id) throw new Error("Сотрудник не найден")

  // Имя параметра функции — _user_id (ранее передавался неверный target_id,
  // из-за чего админы и супер-админы получали ошибку).
  const { error } = await supabase.rpc("reset_bonus_points", { _user_id: id })
  if (error) throw error
  revalidatePath("/")
  revalidatePath("/crm")
}

/** Установить точное количество бонусных баллов сотрудника — админ / супер-админ. */
export async function setBonusPoints(id: string, points: number) {
  const { supabase, profile } = await requireAdmin()
  const value = Math.max(0, Number(points) || 0)

  const { data: target } = await supabase.from("profiles").select("*").eq("id", id).single()
  const t = target as Profile | null
  if (!t || t.shop_id !== profile.shop_id) throw new Error("Сотрудник не найден")

  const { error } = await supabase.rpc("set_bonus_points", { _user_id: id, _points: value })
  if (error) throw error
  revalidatePath("/")
  revalidatePath("/crm")
}
