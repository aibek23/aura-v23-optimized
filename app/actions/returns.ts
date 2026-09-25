"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SaleReturn } from "@/lib/types"

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

/**
 * Все возвраты магазина (новые сверху).
 * Если миграция v33 ещё не применена — возвращаем пустой список,
 * чтобы не ломать экраны кассы и отчётов.
 */
export async function getSaleReturns(): Promise<SaleReturn[]> {
  const { supabase, profile } = await requireProfile()
  const { data, error } = await supabase
    .from("sale_returns")
    .select("*")
    .eq("shop_id", profile.shop_id)
    .order("created_at", { ascending: false })
    .range(0, 99)
  if (error) {
    console.error("[returns] getSaleReturns error:", error.message)
    return []
  }
  return (data as SaleReturn[]) ?? []
}

export type ReturnSaleItemInput = {
  /** ID чека, позицию которого возвращаем. */
  saleId: string
  /** Индекс позиции внутри sales.items исходного чека. */
  itemIndex: number
  /** Необязательная причина возврата (до 300 символов). */
  reason?: string
}

/**
 * Возврат позиции чека.
 *
 * Всё выполняется одной атомарной операцией в БД (RPC `return_sale_item`):
 *   1. расходная операция в кассе (деньги уменьшаются на сумму возврата);
 *   2. запись возврата в sale_returns;
 *   3. товар переводится обратно в статус `in_stock` — себестоимость
 *      снова учитывается на складе.
 *
 * Сумма считается по фактически оплаченной цене позиции (учитывает скидки
 * и списанные бонусы чека). Повторная продажа создаст новую продажу и новый
 * денежный приход — этот возврат уже не влияет на неё.
 */
export async function returnSaleItem(input: ReturnSaleItemInput): Promise<SaleReturn> {
  const { supabase } = await requireProfile()

  const saleId = (input.saleId ?? "").trim()
  const itemIndex = Number(input.itemIndex)
  const reason = (input.reason ?? "").trim().slice(0, 300)

  if (!saleId) throw new Error("Не указан чек для возврата")
  if (!Number.isInteger(itemIndex) || itemIndex < 0) throw new Error("Не указана позиция чека")

  const { data, error } = await supabase.rpc("return_sale_item", {
    _sale_id: saleId,
    _item_index: itemIndex,
    _reason: reason || null,
  })
  if (error) throw new Error(`Не удалось оформить возврат: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("Возврат не был создан")

  revalidatePath("/crm")
  return row as SaleReturn
}
