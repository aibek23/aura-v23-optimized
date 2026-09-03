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

/**
 * Возвращает АКТИВНЫЙ shop_id так, как его видят RLS-политики.
 *
 * RLS проверяет `shop_id = public.current_shop_id()`, а current_shop_id()
 * это COALESCE(impersonated_shop_id для super_admin, profiles.shop_id).
 * Раньше INSERT писал profile.shop_id: для суперадмина в режиме
 * имперсонации (и для профиля без магазина) значения расходились и Postgres
 * отклонял вставку с "new row violates row-level security policy".
 */
async function requireShopId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: { shop_id: string | null },
): Promise<string> {
  const { data } = await supabase.rpc("current_shop_id")
  const shopId = (typeof data === "string" ? data : null) ?? profile.shop_id
  if (!shopId) {
    throw new Error("Ваш аккаунт не привязан к магазину — обратитесь к администратору")
  }
  return shopId
}

/**
 * Дополняет товары коротким числовым ID магазина (shop_settings.seq_id).
 * Без него QR-ссылка теряет идентификатор магазина и превращается в /q//SKU.
 */
async function withShopSeqId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: Product[],
): Promise<Product[]> {
  const shopIds = [...new Set(rows.map((p) => p.shop_id).filter(Boolean))]
  if (shopIds.length === 0) return rows

  const { data: shops } = await supabase
    .from("shop_settings")
    .select("shop_id, seq_id")
    .in("shop_id", shopIds)

  const seqByShop = new Map<string, number | null>(
    (shops ?? []).map((s: { shop_id: string; seq_id: number | null }) => [s.shop_id, s.seq_id]),
  )

  return rows.map((p) => ({ ...p, shop_seq_id: seqByShop.get(p.shop_id) ?? null }))
}

export async function getProducts(): Promise<Product[]> {
  const { supabase } = await requireProfile()
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return withShopSeqId(supabase, (data as Product[]) ?? [])
}


export type ProductInput = {
  name: string
  category: string
  metal: string
  metal_color?: string | null
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

/**
 * Извлекает двухбуквенный ASCII-префикс из артикула или строки-префикса.
 * Принимает только латинские буквы A-Z. Если передан кириллический
 * префикс (наследие старых данных) — возвращает безопасный дефолт "RY".
 */
function extractPrefix(value: string | null | undefined): string {
  const match = (value ?? "").match(/^[A-Za-z]{2}/)
  if (match) return match[0].toUpperCase()
  return "RY" // дефолт: Кольцо / Жёлтое золото → Ring Yellow
}

/**
 * Создаёт товар и ВОЗВРАЩАЕТ сохранённую строку (с реальными id / sku /
 * shop_id / shop_seq_id). Раньше экшн ничего не возвращал, поэтому этикетка
 * печаталась по черновику (id: "draft", shop_id отсутствовал) — и ID не
 * попадал в QR-код.
 */
export async function createProduct(input: ProductInput): Promise<Product> {
  const { supabase, user, profile } = await requireProfile()
  validate(input)

  // shop_id берём из того же источника, что и RLS-политика (см. requireShopId).
  const shopId = await requireShopId(supabase, profile)

  const prefix = extractPrefix(input.sku)

  const { data: artData, error: artErr } = await supabase.rpc("next_article", { p_prefix: prefix }).single()
  if (artErr) throw new Error(`Ошибка генерации артикула: ${artErr.message}`)

  const art = normalizeArticle((artData ?? {}) as Record<string, unknown>)

  const { data, error } = await supabase
    .from("products")
    .insert({
      ...input,
      name: input.name.trim(),
      sku: art.article,
      article_prefix: art.prefix,
      article_seq: art.seq,
      shop_id: shopId,
      created_by: user.id,
      status: "in_stock",
    })
    .select("*")
    .single()

  if (error) {
    if (error.code === "23505") {
      throw new Error("Артикул только что был занят другим товаром. Попробуйте нажать «Сохранить» ещё раз.")
    }
    throw new Error(`Не удалось сохранить товар: ${error.message}`)
  }

  revalidatePath("/crm")

  const [saved] = await withShopSeqId(supabase, [data as Product])
  return saved
}

/** Обновляет товар и возвращает актуальную строку (нужна для печати этикетки). */
export async function updateProduct(
  id: string,
  input: Partial<ProductInput> & { is_hidden?: boolean; is_secondary?: never },
): Promise<Product> {
  const { supabase } = await requireProfile()
  validate(input)
  const { data, error } = await supabase
    .from("products")
    .update(input)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw new Error(`Не удалось обновить товар: ${error.message}`)
  revalidatePath("/crm")
  const [saved] = await withShopSeqId(supabase, [data as Product])
  return saved
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

