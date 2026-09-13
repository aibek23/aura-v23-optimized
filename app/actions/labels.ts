"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

const DEFAULT_CATEGORY = "Прочее"
const GLOBAL_SCOPE = "global"

async function getContext() {
  const supabase = await createClient()

  // 1. Быстрая проверка сессии из кук (без лишнего сетевого RTT к GoTrue Auth API)
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const user = session?.user
  if (!user) throw new Error("Сессия истекла. Войдите в систему заново")

  // 2. Селективный запрос профиля
  const { data: profile } = await supabase
    .from("profiles")
    .select("shop_id, impersonated_shop_id, role, status")
    .eq("id", user.id)
    .single()

  if (!profile || profile.status !== "approved") {
    throw new Error("Аккаунт не подтверждён")
  }

  const shopId =
    profile.role === "super_admin"
      ? profile.impersonated_shop_id
      : profile.shop_id

  return { supabase, user, profile, shopId }
}

function normalizeKey(category: string, sizeKey?: string) {
  return {
    category: category?.trim() || DEFAULT_CATEGORY,
    sizeKey: sizeKey?.trim() || "default",
  }
}

export async function saveLabelTemplate(
  category: string,
  templateJson: string,
  sizeKey?: string,
): Promise<void> {
  const { supabase, user, profile, shopId } = await getContext()
  const { category: normalizedCategory, sizeKey: normalizedSize } = normalizeKey(category, sizeKey)
  const isGlobal = profile.role === "super_admin" && !shopId

  if (!shopId && !isGlobal) throw new Error("Магазин не выбран")

  const { error } = await supabase
    .from("label_templates")
    .upsert(
      {
        shop_id: isGlobal ? null : shopId,
        scope_key: isGlobal ? GLOBAL_SCOPE : shopId,
        category: normalizedCategory,
        size_key: normalizedSize,
        template_json: templateJson,
        created_by: user.id,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "scope_key,category,size_key" },
    )

  if (error) throw new Error(`Не удалось сохранить шаблон этикетки: ${error.message}`)

  // Оптимизация: Инвалидируем только конкретную страницу, а не весь лейаут /crm
  revalidatePath("/crm/inventory", "page")
}

export async function getLabelTemplate(
  category: string,
  sizeKey?: string,
): Promise<string | null> {
  const { supabase, shopId } = await getContext()
  const { category: normalizedCategory, sizeKey: normalizedSize } = normalizeKey(category, sizeKey)

  // Оптимизация: Запрашиваем локальный и глобальный шаблон параллельно в один round-trip
  if (shopId) {
    const [shopRes, globalRes] = await Promise.all([
      supabase
        .from("label_templates")
        .select("template_json")
        .eq("scope_key", shopId)
        .eq("category", normalizedCategory)
        .eq("size_key", normalizedSize)
        .maybeSingle(),
      supabase
        .from("label_templates")
        .select("template_json")
        .eq("scope_key", GLOBAL_SCOPE)
        .eq("category", normalizedCategory)
        .eq("size_key", normalizedSize)
        .maybeSingle(),
    ])

    if (shopRes.error) throw new Error(`Не удалось загрузить шаблон этикетки: ${shopRes.error.message}`)
    if (shopRes.data?.template_json) return shopRes.data.template_json

    if (globalRes.error) throw new Error(`Не удалось загрузить шаблон по умолчанию: ${globalRes.error.message}`)
    return globalRes.data?.template_json ?? null
  }

  // Если shopId нет (только глобальный контекст)
  const { data: globalTemplate, error: globalError } = await supabase
    .from("label_templates")
    .select("template_json")
    .eq("scope_key", GLOBAL_SCOPE)
    .eq("category", normalizedCategory)
    .eq("size_key", normalizedSize)
    .maybeSingle()

  if (globalError) throw new Error(`Не удалось загрузить шаблон по умолчанию: ${globalError.message}`)
  return globalTemplate?.template_json ?? null
}

export async function deleteLabelTemplate(category: string, sizeKey?: string): Promise<void> {
  const { supabase, profile, shopId } = await getContext()
  const { category: normalizedCategory, sizeKey: normalizedSize } = normalizeKey(category, sizeKey)
  const isGlobal = profile.role === "super_admin" && !shopId

  if (!shopId && !isGlobal) throw new Error("Магазин не выбран")

  const { error } = await supabase
    .from("label_templates")
    .delete()
    .eq("scope_key", isGlobal ? GLOBAL_SCOPE : shopId)
    .eq("category", normalizedCategory)
    .eq("size_key", normalizedSize)

  if (error) throw new Error(`Не удалось удалить шаблон этикетки: ${error.message}`)

  revalidatePath("/crm/inventory", "page")
}