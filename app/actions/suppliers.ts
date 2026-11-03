"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { FORBIDDEN_MESSAGE, isAdminRole, requireShopContext } from "@/lib/supabase/request-context"
import type {
  SupplierDebtOperation,
  SupplierDebtSummary,
  CashSource,
} from "@/lib/types"
import { supplierIdentityKey } from "@/lib/supplier-identity"

const requireProfile = () => requireShopContext("Ваш аккаунт не привязан ни к одному магазину")

async function requireAdmin() {
  const ctx = await requireProfile()
  if (!isAdminRole(ctx.profile.role)) throw new Error(FORBIDDEN_MESSAGE)
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
  profiles: SupplierProfile[]
}

export type SupplierProfile = {
  supplier_name: string
  supplier_phone: string | null
  photo_path: string | null
  deleted_at: string | null
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
  const [operationsResult, profilesResult] = await Promise.all([
    supabase
      .from("supplier_debt_operations")
      .select(SUPPLIER_DEBT_COLUMNS)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    supabase
      .from("supplier_profiles")
      .select("supplier_name, supplier_phone, photo_path, deleted_at")
      .eq("shop_id", shopId),
  ])

  if (operationsResult.error) throw new Error(`Не удалось загрузить журнал поставщиков: ${operationsResult.error.message}`)
  if (
    profilesResult.error &&
    !["42P01", "PGRST205"].includes(profilesResult.error.code ?? "")
  ) {
    throw new Error(`Не удалось загрузить карточки поставщиков: ${profilesResult.error.message}`)
  }
  const operations = (operationsResult.data as unknown as SupplierDebtOperation[]) ?? []
  const profiles = profilesResult.error ? [] : ((profilesResult.data ?? []) as SupplierProfile[])
  const profileByKey = new Map(
    profiles.map((item) => [supplierIdentityKey(item.supplier_name, item.supplier_phone), item]),
  )
  const map = new Map<string, SupplierDebtSummary>()
  for (const operation of operations) {
    const key = supplierIdentityKey(operation.supplier_name, operation.supplier_phone)
    const existing = map.get(key)
    const amountInCents = Math.round(Number(operation.amount) * 100)
    const signedAmount = (operation.operation_type === "payment" ? -amountInCents : amountInCents) / 100
    if (existing) {
      existing.balance = Math.round((existing.balance + signedAmount) * 100) / 100
    } else {
      map.set(key, {
        supplier_name: operation.supplier_name,
        supplier_phone: operation.supplier_phone,
        balance: signedAmount,
        last_operation_at: operation.created_at,
      })
    }
  }
  for (const [key, supplier] of map) {
    const profile = profileByKey.get(key)
    if (profile?.deleted_at && Date.parse(profile.deleted_at) >= Date.parse(supplier.last_operation_at)) {
      map.delete(key)
    }
  }
  return {
    operations,
    suppliers: [...map.values()].sort((a, b) => b.balance - a.balance),
    profiles,
  }
}

function persistedSupplierKey(name: string, phone: string | null) {
  return supplierIdentityKey(name, phone).replace("\u0000", "\u001f")
}

/** Сохраняет фото карточки поставщика в папку текущего магазина. */
export async function saveSupplierProfilePhoto(input: {
  supplierName: string
  supplierPhone?: string | null
  photoPath: string
}): Promise<SupplierProfile> {
  const { supabase, shopId } = await requireAdmin()
  const supplierName = input.supplierName.trim()
  const supplierPhone = input.supplierPhone?.trim() || null
  const photoPath = input.photoPath
  if (!supplierName || supplierName.length > 200) throw new Error("Некорректное имя поставщика")
  if (supplierPhone && supplierPhone.length > 50) throw new Error("Некорректный телефон поставщика")
  if (
    typeof photoPath !== "string" ||
    photoPath.length > 500 ||
    !photoPath.startsWith(`${shopId}/supplier-profiles/`) ||
    photoPath.includes("..")
  ) {
    throw new Error("Фото должно находиться в папке текущего магазина")
  }

  const profileData = {
    shop_id: shopId,
    identity_key: persistedSupplierKey(supplierName, supplierPhone),
    supplier_name: supplierName,
    supplier_phone: supplierPhone,
    photo_path: photoPath,
    deleted_at: null,
  }
  const { data, error } = await supabase
    .from("supplier_profiles")
    .upsert(profileData, { onConflict: "shop_id,identity_key" })
    .select("supplier_name, supplier_phone, photo_path, deleted_at")
    .single()
  if (error) throw new Error(`Не удалось сохранить карточку поставщика: ${error.message}`)
  revalidatePath("/crm")
  return data as SupplierProfile
}

/** Удаляет карточку только при нулевом долге; RPC блокирует параллельную запись долга. */
export async function deleteSupplierProfile(input: {
  supplierName: string
  supplierPhone?: string | null
}): Promise<SupplierProfile> {
  const { supabase, shopId } = await requireAdmin()
  const supplierName = input.supplierName.trim()
  const supplierPhone = input.supplierPhone?.trim() || null
  if (!supplierName) throw new Error("Не указано имя поставщика")

  const { data: photoPath, error } = await supabase.rpc("delete_supplier_profile", {
    _supplier_name: supplierName,
    _supplier_phone: supplierPhone,
  })
  if (error) throw new Error(error.message)

  if (typeof photoPath === "string" && photoPath) {
    if (!photoPath.startsWith(`${shopId}/supplier-profiles/`) || photoPath.includes("..")) {
      throw new Error("Нельзя удалить фото вне папки текущего магазина")
    }
    const { error: storageError } = await supabase.storage.from("product-images").remove([photoPath])
    if (storageError) throw new Error(`Поставщик скрыт, но фото не удалено: ${storageError.message}`)
  }

  const { error: profileError } = await supabase
    .from("supplier_profiles")
    .update({ photo_path: null })
    .eq("shop_id", shopId)
    .eq("identity_key", persistedSupplierKey(supplierName, supplierPhone))
  if (profileError) throw new Error(`Поставщик скрыт, но не удалось завершить очистку фото: ${profileError.message}`)

  revalidatePath("/crm")
  return {
    supplier_name: supplierName,
    supplier_phone: supplierPhone,
    photo_path: null,
    deleted_at: new Date().toISOString(),
  }
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