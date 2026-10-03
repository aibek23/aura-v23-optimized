"use server"

import { revalidatePath } from "next/cache"
import type { Sale, SaleItem } from "@/lib/types"
import { DEFAULT_RATES } from "@/lib/rates"
import { getRequestCrmContext } from "@/lib/supabase/request-context"
import { resolveClientOperationId } from "@/lib/client-operation"

async function requireProfile() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Сессия истекла. Войдите в систему заново")
  if (!profile) throw new Error("Профиль не найден")
  if (profile.status !== "approved") throw new Error("Ваш аккаунт ещё не подтверждён администратором")
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  return { supabase, user, profile, shopId }
}

export async function getSales(): Promise<Sale[]> {
  const { supabase } = await requireProfile()
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .order("created_at", { ascending: false })
    .range(0, 49)
  if (error) throw error
  return (data as Sale[]) ?? []
}

export type CheckoutInput = {
  items: SaleItem[]
  discount: number
  payment_method: string
  amount_cash?: number
  amount_electronic?: number
  customer_name: string
  customer_phone: string
  bonus_used: number
  /** Generate once on the client and reuse when retrying an uncertain result. */
  client_op_id?: string
}

const PAYMENTS = new Set(["cash", "card", "transfer", "mixed"])

export async function checkout(input: CheckoutInput) {
  const { supabase, shopId } = await requireProfile()
  const clientOpId = resolveClientOperationId(input.client_op_id)
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length === 0) throw new Error("Чек пуст — добавьте хотя бы одну позицию")
  if (items.length > 200) throw new Error("Слишком много позиций в одном чеке")
  if (!PAYMENTS.has(input.payment_method)) throw new Error("Выберите корректный способ оплаты")
  if (items.some((item) => Number(item.quantity) !== 1)) {
    throw new Error("Количество каждой позиции должно быть равно 1")
  }
  const phone = (input.customer_phone ?? "").trim()
  if (phone && !/^[\d+()\s-]{5,20}$/.test(phone)) throw new Error("Проверьте номер телефона клиента")

  // Only validate the payload here. Do not check product availability or bonus
  // balances before the RPC: on an idempotent retry they have already changed.
  const validated: SaleItem[] = []
  for (const item of items) {
    if (item.kind === "scrap") {
      const weight = Number(item.weight)
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) {
        throw new Error("Укажите корректный вес лома")
      }
      const metal = item.metal ?? ""
      const { data: rateRow, error: rateError } = await supabase
        .from("metal_rates")
        .select("scrap_price_per_gram")
        .eq("shop_id", shopId)
        .eq("metal", metal)
        .maybeSingle()
      if (rateError) throw new Error(`Не удалось прочитать курс лома: ${rateError.message}`)
      const rate = Number(rateRow?.scrap_price_per_gram) || DEFAULT_RATES[metal]?.scrap || 0
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Не задан курс лома для «${metal || "металла"}»`)
      validated.push({
        product_id: null, kind: "scrap", quantity: 1,
        name: item.name?.trim() || `Лом · ${metal}`,
        weight, metal, price_per_gram: rate, price: Math.round(weight * rate), cost: Math.round(weight * rate),
      })
    } else {
      const price = Number(item.price)
      if (!Number.isFinite(price) || price < 0) throw new Error("В чеке указана некорректная цена")
      if (!item.product_id) throw new Error("В позиции не указан товар")
      validated.push({ ...item, kind: "product", quantity: 1, price: Math.round(price) })
    }
  }

  const { data: result, error } = await supabase.rpc("commit_offline_sale", {
    _client_op_id: clientOpId,
    _sale: {
      items: validated,
      payment_method: input.payment_method,
      amount_cash: input.amount_cash,
      amount_electronic: input.amount_electronic,
      bonus_used: input.bonus_used,
      customer_name: (input.customer_name ?? "").trim() || null,
      customer_phone: phone || null,
    },
  })
  if (error) throw new Error(`Не удалось провести продажу: ${error.message}`)
  if (result?.accepted === false) {
    const product = result.product_name ? ` «${result.product_name}»` : ""
    throw new Error(`Конфликт остатков: товар${product} уже продан или недоступен. Обновите склад и проверьте чек.`)
  }
  if (result?.accepted !== true || !result.sale_id) {
    throw new Error("Не удалось подтвердить продажу. Повторите отправку с тем же идентификатором операции.")
  }

  // Read the committed receipt, including on duplicate=true. Never recompute
  // totals or award bonuses here: the RPC commits those changes exactly once.
  const { data: sale, error: readError } = await supabase
    .from("sales")
    .select("id, total, bonus_earned, profit")
    .eq("id", result.sale_id)
    .eq("shop_id", shopId)
    .single()
  if (readError || !sale) {
    throw new Error("Продажа проведена, но ответ не получен. Повторите отправку с тем же идентификатором — повторного списания не будет.")
  }

  revalidatePath("/crm")
  return {
    total: Number(sale.total),
    bonusEarned: Number(sale.bonus_earned),
    profit: Number(sale.profit),
    saleId: sale.id,
    clientOpId,
    duplicate: result.duplicate === true,
  }
}