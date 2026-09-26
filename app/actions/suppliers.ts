"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getActiveShopId } from "@/lib/supabase/current-shop"
import type {
  SupplierDebtOperation,
  SupplierDebtSummary,
  CashSource,
} from "@/lib/types"

async function requireProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile || profile.status !== "approved") throw new Error("Not approved")
  const fallbackShopId =
    profile.role === "super_admin" ? profile.impersonated_shop_id ?? profile.shop_id : profile.shop_id
  const shopId = await getActiveShopId(supabase, fallbackShopId ?? null)
  if (!shopId) throw new Error("Ваш аккаунт не привязан ни к одному магазину")
  return { supabase, user, profile, shopId }
}

async function requireAdmin() {
  const ctx = await requireProfile()
  if (ctx.profile.role !== "admin" && ctx.profile.role !== "super_admin") {
    throw new Error("Недостаточно прав")
  }
  return ctx
}

async function deviceInfo() {
  const requestHeaders = await headers()
  const userAgent = requestHeaders.get("user-agent") ?? "Неизвестное устройство"
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
  return `${userAgent}${forwarded ? ` · IP ${forwarded}` : ""}`.slice(0, 500)
}

export type SupplierDebtData = {
  operations: SupplierDebtOperation[]
  suppliers: SupplierDebtSummary[]
}

const SUPPLIER_DEBT_COLUMNS = [
  "id",
  "shop_id",
  "supplier_name",
  "supplier_phone",
  "operation_type",
  "amount",
  "balance_before",
  "balance_after",
  "product_id",
  "cash_operation_id",
  "source",
  "amount_cash",
  "amount_electronic",
  "reason",
  "author_name",
  "device_info",
  "created_at",
].join(", ")

/** Журнал долга поставщиков и текущие остатки. Остаток считается только из журнала. */
export async function getSupplierDebtData(): Promise<SupplierDebtData> {
  const { supabase, profile, shopId } = await requireProfile()
  const { data, error } = await supabase
    .from("supplier_debt_operations")
    .select(SUPPLIER_DEBT_COLUMNS)
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Не удалось загрузить журнал поставщиков: ${error.message}`)
  const operations = (data as unknown as SupplierDebtOperation[]) ?? []
  const map = new Map<string, SupplierDebtSummary>()
  for (const operation of operations) {
    const key = `${operation.supplier_name}\u0000${operation.supplier_phone ?? ""}`
    if (!map.has(key)) {
      map.set(key, {
        supplier_name: operation.supplier_name,
        supplier_phone: operation.supplier_phone,
        balance: Number(operation.balance_after),
        last_operation_at: operation.created_at,
      })
    }
  }
  return { operations, suppliers: [...map.values()].sort((a, b) => b.balance - a.balance) }
}

/** Отмечает товар на реализацию и добавляет его закупочную стоимость в долг. */
export async function takeProductOnConsignment(productId: string) {
  const { supabase, profile } = await requireProfile()
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("supplier_name")
    .eq("id", productId)
    .single()
  if (productError) throw new Error(`Не удалось прочитать товар: ${productError.message}`)

  // Если checkbox отмечен без поставщика, поставщиком становится пользователь,
  // который оформил операцию. Это также сохраняет товар в suppliers.
  if (!product?.supplier_name?.trim()) {
    const fallbackName = profile.full_name?.trim() || "Администратор"
    const { error: supplierError } = await supabase
      .from("products")
      .update({ supplier_name: fallbackName })
      .eq("id", productId)
    if (supplierError) throw new Error(`Не удалось назначить поставщика: ${supplierError.message}`)
  }

  const { data, error } = await supabase.rpc("take_product_on_consignment", {
    _product_id: productId,
    _device_info: await deviceInfo(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/crm")
  return data as SupplierDebtOperation
}

/** Администраторская ручная корректировка долга при пересмотре цены. */
export async function adjustSupplierDebt(input: {
  supplierName: string
  supplierPhone?: string | null
  amount: number
  reason: string
}) {
  const { supabase } = await requireAdmin()
  const supplierName = input.supplierName.trim()
  const reason = input.reason.trim()
  const amount = Number(input.amount)
  if (!supplierName) throw new Error("Укажите поставщика")
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля")
  if (!reason) throw new Error("Укажите причину изменения")

  const { data, error } = await supabase.rpc("adjust_supplier_debt", {
    _supplier_name: supplierName,
    _supplier_phone: input.supplierPhone?.trim() || null,
    _amount: amount,
    _reason: reason,
    _device_info: await deviceInfo(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/crm")
  return data as SupplierDebtOperation
}

/** Выплата поставщику одновременно создаёт расход кассы и уменьшает долг. */
export async function paySupplierDebt(input: {
  supplierName: string
  supplierPhone?: string | null
  amount: number
  source: CashSource
  amountCash?: number
  amountElectronic?: number
  reason?: string
}) {
  const { supabase } = await requireAdmin()
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля")

  const { data, error } = await supabase.rpc("pay_supplier_debt", {
    _supplier_name: input.supplierName.trim(),
    _supplier_phone: input.supplierPhone?.trim() || null,
    _amount: amount,
    _source: input.source,
    _amount_cash: Number(input.amountCash) || 0,
    _amount_electronic: Number(input.amountElectronic) || 0,
    _reason: input.reason?.trim() || "Выплата поставщику",
    _device_info: await deviceInfo(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/crm")
  return data as SupplierDebtOperation
}