"use server"

import { revalidatePath } from "next/cache"
import type { SaleReturn } from "@/lib/types"
import { getRequestCrmContext } from "@/lib/supabase/request-context"

async function requireProfile() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Сессия истекла. Войдите в систему заново")
  if (!profile) throw new Error("Профиль не найден")
  if (profile.status !== "approved") throw new Error("Ваш аккаунт ещё не подтверждён администратором")
  return { supabase, user, profile, shopId }
}

/**
 * Все возвраты магазина (новые сверху).
 * Если миграция v33 ещё не применена — возвращаем пустой список,
 * чтобы не ломать экраны кассы и отчётов.
 */
export async function getSaleReturns(): Promise<SaleReturn[]> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return []
  const { data, error } = await supabase
    .from("sale_returns")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .range(0, 49)
  if (error) {
    console.error("[returns] getSaleReturns error:", error.message)
    return []
  }
  return (data as SaleReturn[]) ?? []
}

const EXPORT_RETURN_PAGE_SIZE = 500
const EXPORT_RETURN_LIMIT = 5000

/**
 * Возвраты за диапазон для Excel. В отличие от списка на экране, эта выборка
 * постраничная: экспорт не должен молча терять возвраты после первых 50 строк.
 */
export async function getSaleReturnsInRange(input: {
  from?: string | null
  to: string
}): Promise<{ returns: SaleReturn[]; truncated: boolean }> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return { returns: [], truncated: false }

  const from = input.from ? Date.parse(input.from) : null
  const to = Date.parse(input.to)
  if ((from !== null && !Number.isFinite(from)) || !Number.isFinite(to) || (from !== null && to <= from)) {
    throw new Error("Неверный диапазон дат возвратов")
  }

  const rows: SaleReturn[] = []
  for (let offset = 0; offset < EXPORT_RETURN_LIMIT; offset += EXPORT_RETURN_PAGE_SIZE) {
    let query = supabase
      .from("sale_returns")
      .select("*")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .lt("created_at", new Date(to).toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + EXPORT_RETURN_PAGE_SIZE - 1)
    if (from !== null) query = query.gte("created_at", new Date(from).toISOString())
    const { data, error } = await query
    if (error) throw new Error(`Не удалось загрузить возвраты для Excel: ${error.message}`)
    const page = (data ?? []) as SaleReturn[]
    rows.push(...page)
    if (page.length < EXPORT_RETURN_PAGE_SIZE) break
  }

  let truncated = rows.length === EXPORT_RETURN_LIMIT
  if (truncated) {
    let probe = supabase
      .from("sale_returns")
      .select("id")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .lt("created_at", new Date(to).toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(EXPORT_RETURN_LIMIT, EXPORT_RETURN_LIMIT)
    if (from !== null) probe = probe.gte("created_at", new Date(from).toISOString())
    const { data, error } = await probe
    if (error) throw new Error(`Не удалось проверить полноту возвратов: ${error.message}`)
    truncated = Boolean(data?.length)
  }

  return { returns: rows, truncated }
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
