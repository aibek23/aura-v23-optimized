"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Product } from "@/lib/types"

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

export async function getProducts(): Promise<Product[]> {
  const { supabase } = await requireProfile()
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as Product[]) ?? []
}

export type ProductInput = {
  name: string
  category: string
  metal: string
  metal_color?: string | null
  purity: string
  weight: number
  size: string
  sku: string
  quantity: number
  purchase_price: number
  /** Закупочная цена видимая для продавца (переименовано из purchase_price_seller). */
  purchase_price_visible?: number | null
  price_per_gram_sale?: number | null
  price_per_gram_purchase?: number | null
  /** Курс закупки видимый для продавца (переименовано из price_per_gram_purchase_seller). */
  price_per_gram_purchase_visible?: number | null
  stones?: string | null
  description?: string | null
  sale_price: number
  image_url?: string | null
  images?: string[]
  supplier_name?: string | null
  supplier_phone?: string | null
}

function validate(input: Partial<ProductInput>) {
  if (input.name !== undefined && !String(input.name).trim()) {
    throw new Error("Укажите название изделия")
  }
  const numeric: [keyof ProductInput, string][] = [
    ["weight", "Вес"],
    ["quantity", "Количество"],
    ["sale_price", "Цена продажи"],
    ["purchase_price", "Закупочная цена"],
  ]
  for (const [key, label] of numeric) {
    const v = input[key]
    if (v === undefined || v === null) continue
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: укажите корректное число`)
  }
}

type ArticleRow = { article: string; prefix: string; seq: number; reused: boolean }

/** RPC next_article возвращает out_article/out_prefix/out_seq/out_reused. */
function normalizeArticle(row: Record<string, unknown>): ArticleRow {
  return {
    article: String(row["out_article"] ?? row["article"] ?? ""),
    prefix: String(row["out_prefix"] ?? row["prefix"] ?? ""),
    seq: Number(row["out_seq"] ?? row["seq"] ?? 0),
    reused: Boolean(row["out_reused"] ?? row["reused"] ?? false),
  }
}

function extractPrefix(value: string | null | undefined): string {
  const match = (value ?? "").match(/^[А-ЯЁа-яёA-Za-z]{2}/)
  return match ? match[0].toUpperCase() : "КЖ"
}

export async function createProduct(input: ProductInput) {
  const { supabase, user, profile } = await requireProfile()
  validate(input)

  const prefix = extractPrefix(input.sku)

  const { data: artData, error: artErr } = await supabase.rpc("next_article", { p_prefix: prefix }).single()
  if (artErr) throw new Error(`Ошибка генерации артикула: ${artErr.message}`)

  const art = normalizeArticle((artData ?? {}) as Record<string, unknown>)

  const { error } = await supabase.from("products").insert({
    ...input,
    name: input.name.trim(),
    sku: art.article,
    article_prefix: art.prefix,
    article_seq: art.seq,
    shop_id: profile.shop_id,
    created_by: user.id,
    status: "in_stock",
  })

  if (error) {
    if (error.code === "23505") {
      throw new Error("Артикул только что был занят другим товаром. Попробуйте нажать «Сохранить» ещё раз.")
    }
    throw new Error(`Не удалось сохранить товар: ${error.message}`)
  }

  revalidatePath("/crm")
}

export async function updateProduct(id: string, input: Partial<ProductInput> & { is_hidden?: boolean; is_secondary?: never }) {
  const { supabase } = await requireProfile()
  validate(input)
  const { error } = await supabase.from("products").update(input).eq("id", id)
  if (error) throw new Error(`Не удалось обновить товар: ${error.message}`)
  revalidatePath("/crm")
}

export async function deleteProduct(id: string) {
  const { supabase } = await requireProfile()
  const { error } = await supabase.from("products").delete().eq("id", id)
  if (error) throw new Error(`Не удалось удалить товар: ${error.message}`)
  revalidatePath("/crm")
}

export async function generateArticle(prefix: string) {
  const { supabase } = await requireProfile()

  const { data: artData, error } = await supabase
    .rpc("next_article", { p_prefix: extractPrefix(prefix) })
    .single()

  if (error) throw new Error(error.message)

  return normalizeArticle((artData ?? {}) as Record<string, unknown>)
}

