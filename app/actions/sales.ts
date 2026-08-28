"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Sale, SaleItem } from "@/lib/types"
import { DEFAULT_RATES } from "@/lib/rates"

const DEFAULT_BONUS_RATE = 2 // % от прибыли, если не задано иное
const MAX_PRICE_FACTOR = 10 // защита от опечатки: цена не может быть в 10 раз выше прайса

async function requireProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Сессия истекла. Войдите в систему заново")
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (!profile) throw new Error("Профиль не найден")
  if (profile.status !== "approved") throw new Error("Ваш аккаунт ещё не подтверждён администратором")
  if (!profile.shop_id) throw new Error("Ваш аккаунт не привязан к магазину")
  return { supabase, user, profile }
}

export async function getSales(): Promise<Sale[]> {
  const { supabase } = await requireProfile()
  const { data, error } = await supabase.from("sales").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as Sale[]) ?? []
}

export type CheckoutInput = {
  items: SaleItem[]
  discount: number
  payment_method: string
  /** Для смешанной оплаты: сколько наличными и сколько переводом. */
  amount_cash?: number
  amount_electronic?: number
  customer_name: string
  customer_phone: string
  bonus_used: number
}

const PAYMENTS = new Set(["cash", "card", "transfer", "mixed"])

export async function checkout(input: CheckoutInput) {
  const { supabase, user, profile } = await requireProfile()

  // ------------------------------------------------------------- валидация
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length === 0) throw new Error("Чек пуст — добавьте хотя бы одну позицию")
  if (items.length > 200) throw new Error("Слишком много позиций в одном чеке")
  if (!PAYMENTS.has(input.payment_method)) throw new Error("Выберите корректный способ оплаты")

  const phone = (input.customer_phone ?? "").trim()
  if (phone && !/^[\d+()\s-]{5,20}$/.test(phone)) {
    throw new Error("Проверьте номер телефона клиента")
  }

  const productIds = items
    .filter((i) => i.kind !== "scrap" && i.product_id)
    .map((i) => i.product_id as string)

  const { data: products, error: prodErr } = productIds.length
    ? await supabase
        .from("products")
        .select("id, sale_price, purchase_price, quantity, name, weight, metal, status")
        .in("id", productIds)
    : { data: [], error: null }
  if (prodErr) throw new Error(`Не удалось прочитать склад: ${prodErr.message}`)

  const priceMap = new Map((products ?? []).map((p) => [p.id, p]))

  // Сколько единиц каждого товара уходит в этом чеке — проверяем суммарно.
  const requested = new Map<string, number>()
  for (const i of items) {
    if (i.kind === "scrap" || !i.product_id) continue
    const qty = Math.max(1, Math.floor(Number(i.quantity) || 1))
    requested.set(i.product_id, (requested.get(i.product_id) ?? 0) + qty)
  }
  for (const [id, qty] of requested) {
    const p = priceMap.get(id)
    if (!p) throw new Error("Один из товаров был удалён со склада — обновите страницу")
    if (qty > p.quantity) {
      throw new Error(`«${p.name}»: на складе осталось ${p.quantity} шт., в чеке ${qty} шт.`)
    }
  }

  let subtotal = 0
  let costTotal = 0
  const validated: SaleItem[] = []

  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))

    // ------------------------------------------------------------- лом
    if (item.kind === "scrap") {
      const weight = Number(item.weight)
      if (!Number.isFinite(weight) || weight <= 0) throw new Error("Укажите вес лома больше нуля")
      if (weight > 100000) throw new Error("Некорректный вес лома")
      const metal = item.metal ?? ""

      // Курс берём из настроек магазина, иначе — рыночный по умолчанию.
      const { data: rateRow } = await supabase
        .from("metal_rates")
        .select("scrap_price_per_gram")
        .eq("shop_id", profile.shop_id)
        .eq("metal", metal)
        .maybeSingle()

      const rate = Number(rateRow?.scrap_price_per_gram) || DEFAULT_RATES[metal]?.scrap || 0
      if (rate <= 0) throw new Error(`Не задан курс лома для «${metal || "металла"}»`)

      const price = Math.round(weight * rate)
      subtotal += price * qty
      costTotal += price * qty // лом продаётся по курсу — прибыль в нём не заложена
      validated.push({
        product_id: null,
        kind: "scrap",
        name: item.name?.trim() || `Лом · ${metal}`,
        weight,
        metal,
        price_per_gram: rate,
        quantity: qty,
        price,
        cost: price,
      })
      continue
    }

    // ---------------------------------------------------------- товар
    const p = priceMap.get(item.product_id as string)
    if (!p) throw new Error("Товар не найден на складе")
    if (p.status === "sold" || p.quantity <= 0) throw new Error(`«${p.name}» уже продан`)

    const basePrice = Number(p.sale_price)
    const requestedPrice = Number(item.price)
    if (!Number.isFinite(requestedPrice) || requestedPrice < 0) {
      throw new Error(`«${p.name}»: некорректная цена`)
    }
    if (basePrice > 0 && requestedPrice > basePrice * MAX_PRICE_FACTOR) {
      throw new Error(`«${p.name}»: цена завышена — проверьте расчёт`)
    }

    const price = Math.round(requestedPrice)
    subtotal += price * qty
    costTotal += Number(p.purchase_price) * qty
    validated.push({
      product_id: p.id,
      kind: "product",
      name: p.name,
      weight: Number(p.weight) || Number(item.weight) || 0,
      metal: p.metal ?? item.metal ?? null,
      price_per_gram: Number(p.weight) > 0 ? Math.round(price / Number(p.weight)) : null,
      quantity: qty,
      price,
      cost: Number(p.purchase_price),
    })
  }

  const discount = 0 // скидки уже учтены в цене позиции
  const bonusUsed = Math.max(0, Math.min(Number(input.bonus_used) || 0, subtotal))
  if (bonusUsed > Number(profile.bonus_points ?? 0) && profile.role === "seller") {
    throw new Error("Недостаточно бонусов для списания")
  }
  const total = Math.max(0, subtotal - bonusUsed)
  const profit = total - costTotal

  // ------------------------------------------------ разбивка оплаты по кассам
  let paidCash = 0
  let paidElectronic = 0
  if (input.payment_method === "mixed") {
    paidCash = Math.round(Number(input.amount_cash) || 0)
    paidElectronic = Math.round(Number(input.amount_electronic) || 0)
    if (paidCash < 0 || paidElectronic < 0) throw new Error("Суммы оплаты не могут быть отрицательными")
    if (Math.abs(paidCash + paidElectronic - total) > 1) {
      throw new Error("Сумма наличных и перевода должна совпадать с итогом чека")
    }
  } else if (input.payment_method === "cash") {
    paidCash = total
  } else {
    paidElectronic = total
  }

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("default_bonus_rate")
    .eq("shop_id", profile.shop_id)
    .maybeSingle()
  const rate = Number(profile.bonus_rate ?? settings?.default_bonus_rate ?? DEFAULT_BONUS_RATE)
  const bonusEarned = Math.round(Math.max(0, profit) * (rate / 100))

  // ------------------------------------------------ поиск или автоматическое создание клиента
  let customerId: string | null = null
  const trimmedPhone = (input.customer_phone ?? "").trim()
  const trimmedName = (input.customer_name ?? "").trim()

  if (trimmedPhone) {
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("shop_id", profile.shop_id)
      .eq("phone", trimmedPhone)
      .maybeSingle()

    if (existingCustomer) {
      customerId = existingCustomer.id
      if (trimmedName) {
        await supabase.from("customers").update({ name: trimmedName }).eq("id", customerId)
      }
    } else if (trimmedName) {
      const { data: newCustomer } = await supabase
        .from("customers")
        .insert({
          shop_id: profile.shop_id,
          name: trimmedName,
          phone: trimmedPhone,
          bonus_points: 0,
        })
        .select("id")
        .single()

      if (newCustomer) {
        customerId = newCustomer.id
      }
    }
  }
  // ------------------------------------------------ обновление статистики клиента
  // Атомарно инкрементируем денормализованные счётчики через RPC-функцию,
  // чтобы избежать гонки при параллельных продажах одному клиенту.
  if (customerId) {
    const { error: statsErr } = await supabase.rpc("increment_customer_stats", {
      _customer_id: customerId,
      _amount:      total,
    })
    if (statsErr) {
      // Не прерываем транзакцию — счётчик можно пересчитать позже.
      console.error("[sales] increment_customer_stats error:", statsErr.message)
    }
  }

  // ------------------------------------------------ запись продажи
  const { error: saleErr } = await supabase.from("sales").insert({
    shop_id: profile.shop_id,
    seller_id: user.id,
    seller_name: profile.full_name,
    customer_id: customerId,
    customer_name: trimmedName || null,
    customer_phone: trimmedPhone || null,
    payment_method: input.payment_method,
    amount_cash: paidCash,
    amount_electronic: paidElectronic,
    subtotal,
    discount,
    total,
    cost_total: costTotal,
    profit,
    bonus_earned: bonusEarned,
    bonus_used: bonusUsed,
    items: validated,
  })
  if (saleErr) throw new Error(`Не удалось провести продажу: ${saleErr.message}`)

  // Списание остатков (лом склада не касается).
  for (const [id, qty] of requested) {
    const p = priceMap.get(id)!
    const remaining = p.quantity - qty
    const { error: updErr } = await supabase
      .from("products")
      .update({ quantity: remaining, status: remaining <= 0 ? "sold" : "in_stock" })
      .eq("id", id)
    if (updErr) console.error("[sales] stock update error:", updErr.message)
  }

  if (bonusEarned > 0) {
    const { error: bonusErr } = await supabase.rpc("add_bonus_points", { _amount: bonusEarned })
    if (bonusErr) console.error("[sales] bonus rpc error:", bonusErr.message)
  }

  revalidatePath("/crm")
  return { total, bonusEarned, profit }
}