"use server"

import { createClient } from "@/lib/supabase/server"
import type { GeneratedArticle } from "@/lib/article"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

/** Проверка авторизации и подтверждённого профиля. */
async function requireProfile() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Требуется вход в систему")
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  if (!profile || profile.status !== "approved") {
    throw new Error("Аккаунт не подтверждён")
  }

  return { supabase, user, profile }
}

/** Нормализует ответ RPC: функция возвращает колонки out_article/out_prefix/... */
function normalizeArticle(row: Record<string, unknown>): GeneratedArticle {
  return {
    article: String(row["out_article"] ?? row["article"] ?? ""),
    prefix: String(row["out_prefix"] ?? row["prefix"] ?? ""),
    seq: Number(row["out_seq"] ?? row["seq"] ?? 0),
    reused: Boolean(row["out_reused"] ?? row["reused"] ?? false),
  }
}

function cleanPrefix(prefix: string | null | undefined): string {
  const match = (prefix ?? "").match(/^[А-ЯЁа-яёA-Za-z]{2}/)
  return match ? match[0].toUpperCase() : "КЖ"
}

async function nextArticle(supabase: SupabaseClient, prefix: string): Promise<GeneratedArticle> {
  const { data, error } = await supabase.rpc("next_article", { p_prefix: cleanPrefix(prefix) }).single()
  if (error) throw new Error(error.message)
  return normalizeArticle((data ?? {}) as Record<string, unknown>)
}

/** Генерация (предпросмотр) артикула для клиента. */
export async function generateArticle(prefix: string): Promise<GeneratedArticle> {
  const { supabase } = await requireProfile()
  return nextArticle(supabase, prefix)
}

/** Создание товара со строгой генерацией артикула перед вставкой. */
export async function createProduct(formData: {
  name: string
  prefix: string
  weight: number
  quantity: number
  sale_price: number
  purchase_price: number
  photos?: string[]
}) {
  const { supabase, user, profile } = await requireProfile()

  // 1. Свежий артикул непосредственно перед сохранением.
  const generated = await nextArticle(supabase, formData.prefix)

  // 2. Сохраняем товар с уникальным номером.
  const images = formData.photos ?? []
  const { data: product, error: insertErr } = await supabase
    .from("products")
    .insert({
      name: formData.name,
      article_prefix: generated.prefix,
      article_seq: generated.seq,
      sku: generated.article,
      weight: formData.weight,
      quantity: formData.quantity,
      sale_price: formData.sale_price,
      purchase_price: formData.purchase_price,
      images,
      image_url: images[0] ?? null,
      shop_id: profile.shop_id,
      status: "in_stock",
      created_by: user.id,
    })
    .select()
    .single()

  if (insertErr) {
    if (insertErr.code === "23505") {
      throw new Error("Артикул только что был занят другим пользователем. Нажмите «Сохранить» ещё раз.")
    }
    throw new Error(insertErr.message)
  }

  return product
}
