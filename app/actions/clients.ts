"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Customer } from "@/lib/types"

async function requireProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Требуется вход в систему")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile || profile.status !== "approved") throw new Error("Аккаунт не подтверждён")
  return { supabase, user, profile }
}

export async function getClients(): Promise<Customer[]> {
  const { supabase, profile } = await requireProfile()

  // 1. Загружаем клиентов магазина
  const { data: clients, error: clientsError } = await supabase
    .from("customers")
    .select("*")
    .eq("shop_id", profile.shop_id)
    .order("created_at", { ascending: false })

  if (clientsError) throw clientsError
  if (!clients || clients.length === 0) return []

  // v18: purchase_count теперь — денормализованная колонка в таблице customers.
  // Запрос уже включает её через select("*"), дополнительный JOIN не нужен.
  return clients as Customer[]
}

export type ClientPurchase = {
  id: string
  created_at: string
  total: number
  items: Array<{ sku?: string; name: string; quantity: number; price: number }>
  payment_method: string
}

/** История покупок конкретного клиента (по customer_id или совпадению имени+телефона). */
export async function getClientPurchases(customerId: string): Promise<ClientPurchase[]> {
  const { supabase, profile } = await requireProfile()
  const { data, error } = await supabase
    .from("sales")
    .select("id, created_at, total, items, payment_method")
    .eq("shop_id", profile.shop_id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw new Error(`Ошибка загрузки истории: ${error.message}`)
  return (data ?? []) as ClientPurchase[]
}

/** Добавить/убрать клиента из чёрного списка. */
export async function setClientBlacklist(id: string, blacklisted: boolean): Promise<void> {
  const { supabase } = await requireProfile()
  const { error } = await supabase
    .from("customers")
    .update({ is_blacklisted: blacklisted })
    .eq("id", id)
  if (error) throw new Error(`Не удалось обновить статус: ${error.message}`)
  revalidatePath("/crm")
}

export type ClientInput = {
  name: string
  phone?: string | null
  gender?: string | null
  whatsapp?: string | null
  instagram?: string | null
  email?: string | null
}

function validateClient(input: Partial<ClientInput>) {
  if (input.name !== undefined && !String(input.name).trim()) {
    throw new Error("Укажите имя клиента")
  }
  if (input.phone) {
    const cleaned = input.phone.trim()
    if (cleaned && !/^[\d+()\s-]{5,20}$/.test(cleaned)) {
      throw new Error("Некорректный номер телефона")
    }
  }
}

export async function createClient_(input: ClientInput): Promise<void> {
  const { supabase, profile } = await requireProfile()
  validateClient(input)
  const { error } = await supabase.from("customers").insert({
    shop_id: profile.shop_id,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    gender: input.gender || null,
    whatsapp: input.whatsapp?.trim() || null,
    instagram: input.instagram?.trim() || null,
    email: input.email?.trim() || null,
    bonus_points: 0,
  })
  if (error) throw new Error(`Не удалось создать клиента: ${error.message}`)
  revalidatePath("/crm")
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<void> {
  const { supabase } = await requireProfile()
  validateClient(input)
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
  if (input.gender !== undefined) patch.gender = input.gender || null
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp?.trim() || null
  if (input.instagram !== undefined) patch.instagram = input.instagram?.trim() || null
  if (input.email !== undefined) patch.email = input.email?.trim() || null
  const { error } = await supabase.from("customers").update(patch).eq("id", id)
  if (error) throw new Error(`Не удалось обновить клиента: ${error.message}`)
  revalidatePath("/crm")
}

export async function deleteClient(id: string): Promise<void> {
  const { supabase } = await requireProfile()
  const { error } = await supabase.from("customers").delete().eq("id", id)
  if (error) throw new Error(`Не удалось удалить клиента: ${error.message}`)
  revalidatePath("/crm")
}
