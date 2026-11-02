"use server"

import { revalidatePath } from "next/cache"
import type { Sale, SaleItem } from "@/lib/types"
import { DEFAULT_RATES } from "@/lib/rates"
import { getRequestCrmContext } from "@/lib/supabase/request-context"
import { resolveClientOperationId } from "@/lib/client-operation"
import { isReceiptType, type ReceiptType } from "@/lib/receipt-type"

/** Ошибки «функции/колонки ещё нет» — значит, SQL-миграция не применена. */
const MISSING_SCHEMA_CODES = ["42883", "42P01", "42703", "PGRST202", "PGRST204", "PGRST205"]

async function requireProfile() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Сессия истекла. Войдите в систему заново")
  if (!profile) throw new Error("Профиль не найден")
  if (profile.status !== "approved") throw new Error("Ваш аккаунт ещё не подтверждён администратором")
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  return { supabase, user, profile, shopId }
}

const SALE_COLUMNS =
  "id, shop_id, seller_id, seller_name, customer_id, customer_name, customer_phone, payment_method, amount_cash, amount_electronic, subtotal, discount, total, cost_total, profit, bonus_earned, bonus_used, items, created_at, updated_at, deleted_at, client_op_id, cash_operation_id"
const REPORT_PAGE_SIZE = 500

export async function getSales(): Promise<Sale[]> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return []
  const readSales = (columns: string) =>
    supabase
      .from("sales")
      .select(columns)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .range(0, 49)
  let { data, error } = await readSales(SALE_COLUMNS + ", receipt_type")
  // До применения миграции 007 колонки receipt_type нет — читаем без неё.
  if (error && MISSING_SCHEMA_CODES.includes(error.code ?? "")) {
    ;({ data, error } = await readSales(SALE_COLUMNS))
  }
  if (error) throw error
  return ((data ?? []) as unknown as Sale[])
}

// ---------------------------------------------------------------------------
// Серверная история продаж с пагинацией.
// Локально (IndexedDB) хранятся только последние 100 чеков, всё остальное
// читается с сервера постранично — так слабые устройства не держат в памяти
// всю историю магазина.
// ---------------------------------------------------------------------------

export type SalesPageCursor = { created_at: string; id: string }
export type SalesPage = { items: Sale[]; nextCursor: SalesPageCursor | null }

function parseIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Одна страница истории продаж (новые сверху), keyset-пагинация по
 * (created_at, id) — стабильна при добавлении новых чеков.
 */
type SalesPageInput = {
  limit?: number
  cursor?: SalesPageCursor | null
  from?: string | null
  to?: string | null
  sellerId?: string | null
}

export async function getSalesPage(input: SalesPageInput = {}): Promise<SalesPage> {
  const { supabase, shopId } = await requireProfile()
  return readSalesPage(supabase, shopId, input)
}

async function readSalesPage(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  shopId: string,
  input: SalesPageInput,
  resolveSkus = true,
): Promise<SalesPage> {
  const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 30), 1), REPORT_PAGE_SIZE)
  const from = parseIsoOrNull(input.from)
  const to = parseIsoOrNull(input.to)
  const sellerId = input.sellerId && UUID_RE.test(input.sellerId) ? input.sellerId : null
  const cursorAt = parseIsoOrNull(input.cursor?.created_at)
  const cursorId = input.cursor?.id && /^[\w-]{1,64}$/.test(input.cursor.id) ? input.cursor.id : null

  const readPage = (columns: string) => {
    let query = supabase
      .from("sales")
      .select(columns)
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)
    if (from) query = query.gte("created_at", from)
    if (to) query = query.lt("created_at", to)
    if (sellerId) query = query.eq("seller_id", sellerId)
    if (cursorAt && cursorId) {
      query = query.or(`created_at.lt.${cursorAt},and(created_at.eq.${cursorAt},id.lt.${cursorId})`)
    }
    return query
  }

  let { data, error } = await readPage(SALE_COLUMNS + ", receipt_type")
  if (error && MISSING_SCHEMA_CODES.includes(error.code ?? "")) {
    ;({ data, error } = await readPage(SALE_COLUMNS))
  }
  if (error) throw new Error(`Не удалось загрузить историю продаж: ${error.message}`)

  const rows = (data ?? []) as unknown as Sale[]
  const items = rows.slice(0, limit)
  if (resolveSkus) await fillMissingSkus(supabase, shopId, items)
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: rows.length > limit && last ? { created_at: last.created_at, id: last.id } : null,
  }
}

/**
 * Проданные товары больше не лежат в локальном каталоге, поэтому артикул
 * для поиска/возврата по QR дописываем в позиции чека на сервере.
 */
async function fillMissingSkus(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  shopId: string,
  sales: Sale[],
) {
  const ids = [
    ...new Set(
      sales.flatMap((sale) =>
        (sale.items ?? []).filter((item) => item.product_id && !item.sku).map((item) => item.product_id as string),
      ),
    ),
  ]
  if (ids.length === 0) return
  const skuById = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("products")
      .select("id, sku")
      .eq("shop_id", shopId)
      .in("id", ids.slice(i, i + 200))
    if (error || !data) continue
    for (const row of data as { id: string; sku: string | null }[]) skuById.set(row.id, row.sku)
  }
  for (const sale of sales) {
    sale.items = (sale.items ?? []).map((item) =>
      item.product_id && !item.sku && skuById.get(item.product_id)
        ? { ...item, sku: skuById.get(item.product_id) }
        : item,
    )
  }
}

export type ReportProductInfo = { id: string; category: string | null; metal: string | null; sku?: string | null }

export type DailySalesSummaryRow = {
  report_day: string
  revenue: number
  cost: number
  profit: number
  receipt_count: number
  refund_amount: number
  refund_cost: number
  return_count: number
}

/**
 * Compact, server-side report data. The SQL function aggregates existing
 * sales/returns at request time; it does not persist duplicate daily rows.
 */
export async function getDailySalesSummary(input: {
  from: string | null
  to: string
  allTime?: boolean
}): Promise<DailySalesSummaryRow[]> {
  const { supabase, profile, shopId } = await requireProfile()
  if (profile.role !== "admin" && profile.role !== "super_admin") {
    throw new Error("Раздел доступен только администраторам")
  }

  let from = input.from
  if (input.allTime) {
    // shop_settings has no registration timestamp; the signup trigger creates
    // its first profile and shop row together, so the earliest shop profile is
    // the registration date without adding a new database column.
    const { data: firstProfile, error: profileError } = await supabase
      .from("profiles")
      .select("created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (profileError) {
      throw new Error(`Не удалось определить дату регистрации магазина: ${profileError.message}`)
    }
    from = firstProfile?.created_at ?? null
  }

  if (!from) throw new Error("Не удалось определить дату регистрации магазина")
  const fromMs = Date.parse(from)
  const toMs = Date.parse(input.to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("Неверный диапазон дат отчёта")
  }

  const { data, error } = await supabase.rpc("get_daily_sales_summary", {
    _from: new Date(fromMs).toISOString(),
    _to: new Date(toMs).toISOString(),
  })
  if (error) throw new Error(`Не удалось загрузить дневной отчёт: ${error.message}`)

  return ((data ?? []) as DailySalesSummaryRow[]).map((row) => ({
    ...row,
    revenue: Number(row.revenue) || 0,
    cost: Number(row.cost) || 0,
    profit: Number(row.profit) || 0,
    receipt_count: Number(row.receipt_count) || 0,
    refund_amount: Number(row.refund_amount) || 0,
    refund_cost: Number(row.refund_cost) || 0,
    return_count: Number(row.return_count) || 0,
  }))
}

/** Максимум чеков за один экспорт — защита слабых устройств от гигантских ответов. */
const RANGE_MAX_SALES = 5000

/**
 * Продажи за период (для отчётов и статистики продавцов). Читаются с сервера
 * постранично, плюс категории проданных товаров — их больше нет в локальном
 * каталоге, потому что проданные товары на устройство не загружаются.
 */
export async function getSalesInRange(input: {
  from?: string | null
  to?: string | null
  withProducts?: boolean
  /** Чеки вне периода, нужные для привязки возвратов к продавцу. */
  includeSaleIds?: string[]
}): Promise<{ sales: Sale[]; products: ReportProductInfo[]; truncated: boolean }> {
  const { supabase, shopId } = await requireProfile()
  const sales: Sale[] = []
  let cursor: SalesPageCursor | null = null
  let truncated = false

  while (true) {
    // Export reads larger keyset pages than the interactive history so a
    // 5,000-receipt report needs roughly 10 round trips instead of 50.
    const page = await readSalesPage(
      supabase,
      shopId,
      { limit: REPORT_PAGE_SIZE, cursor, from: input.from, to: input.to },
      false,
    )
    sales.push(...page.items)
    if (!page.nextCursor) break
    if (sales.length >= RANGE_MAX_SALES) {
      truncated = true
      break
    }
    cursor = page.nextCursor
  }

  const known = new Set(sales.map((sale) => sale.id))
  const extraIds = [...new Set((input.includeSaleIds ?? []).filter((id) => typeof id === "string" && UUID_RE.test(id)))]
    .filter((id) => !known.has(id))
    .slice(0, 5000)
  for (let i = 0; i < extraIds.length; i += 200) {
    const chunk = extraIds.slice(i, i + 200)
    const readExtraSales = async (columns: string) => {
      const result = await supabase
        .from("sales")
        .select(columns)
        .eq("shop_id", shopId)
        .is("deleted_at", null)
        .in("id", chunk)
      return { data: result.data as unknown, error: result.error }
    }
    let result = await readExtraSales(SALE_COLUMNS + ", receipt_type")
    if (result.error && MISSING_SCHEMA_CODES.includes(result.error.code ?? "")) {
      result = await readExtraSales(SALE_COLUMNS)
    }
    if (result.error) break
    sales.push(...((result.data ?? []) as Sale[]))
  }

  let products: ReportProductInfo[] = []
  if (input.withProducts) {
    const ids = [
      ...new Set(
        sales.flatMap((sale) => (sale.items ?? []).map((item) => item.product_id).filter(Boolean) as string[]),
      ),
    ]
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data, error } = await supabase
        .from("products")
        .select("id, category, metal, sku")
        .eq("shop_id", shopId)
        .in("id", chunk)
      if (error) break
      products.push(...((data ?? []) as ReportProductInfo[]))
    }
    const skuById = new Map(products.map((product) => [product.id, product.sku]))
    for (const sale of sales) {
      sale.items = (sale.items ?? []).map((item) =>
        item.product_id && !item.sku && skuById.get(item.product_id)
          ? { ...item, sku: skuById.get(item.product_id) }
          : item,
      )
    }
  } else {
    // Resolve old receipt SKUs once for the whole export, not once per page.
    await fillMissingSkus(supabase, shopId, sales)
  }

  return { sales, products, truncated }
}

export type CheckoutInput = {
  items: SaleItem[]
  discount: number
  payment_method: string
  amount_cash?: number
  amount_electronic?: number
  customer_name: string
  customer_phone: string
  customer_id?: string | null
  credit_due_date?: string
  /** Фискальный / нефискальный чек. Не указан — сервер подставит настройку магазина. */
  receipt_type?: ReceiptType | null
  bonus_used: number
  /** Generate once on the client and reuse when retrying an uncertain result. */
  client_op_id?: string
}

function getBishkekToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)?.value ?? "").join("-")
}

const PAYMENTS = new Set(["cash", "card", "transfer", "mixed", "credit"])

export async function checkout(input: CheckoutInput) {
  const { supabase, shopId } = await requireProfile()
  const clientOpId = resolveClientOperationId(input.client_op_id)
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length === 0) throw new Error("Чек пуст — добавьте хотя бы одну позицию")
  if (items.length > 200) throw new Error("Слишком много позиций в одном чеке")
  if (!PAYMENTS.has(input.payment_method)) throw new Error("Выберите корректный способ оплаты")
  const receiptType = input.receipt_type ?? null
  if (receiptType !== null && !isReceiptType(receiptType)) {
    throw new Error("Выберите тип чека: фискальный или нефискальный")
  }
  if (items.some((item) => Number(item.quantity) !== 1)) {
    throw new Error("Количество каждой позиции должно быть равно 1")
  }
  const phone = (input.customer_phone ?? "").trim()
  const customerId = (input.customer_id ?? "").trim() || null
  if (input.payment_method === "credit" && !customerId) {
    throw new Error("Для продажи в долг выберите клиента из списка")
  }
  const creditDueDate = (input.credit_due_date ?? "").trim()
  if (input.payment_method === "credit") {
    const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(creditDueDate)
      ? Date.parse(creditDueDate + "T00:00:00Z")
      : Number.NaN
    if (!Number.isFinite(parsedDueDate) || new Date(parsedDueDate).toISOString().slice(0, 10) !== creditDueDate) {
      throw new Error("Укажите срок оплаты долга")
    }
    if (creditDueDate < getBishkekToday()) throw new Error("Срок оплаты не может быть в прошлом")
  }
  if (phone && !/^[\d+()\s-]{5,20}$/.test(phone)) throw new Error("Проверьте номер телефона клиента")

  // Resolve all scrap prices in one round trip instead of querying once per
  // scrap line. Checkouts with several scrap items now make at most one lookup.
  const scrapMetals = [...new Set(
    items
      .filter((item) => item.kind === "scrap")
      .map((item) => item.metal ?? "")
      .filter(Boolean),
  )]
  const scrapRates = new Map<string, number>()
  if (scrapMetals.length > 0) {
    const { data: rateRows, error: rateError } = await supabase
      .from("metal_rates")
      .select("metal, scrap_price_per_gram")
      .eq("shop_id", shopId)
      .in("metal", scrapMetals)
    if (rateError) throw new Error(`Не удалось прочитать курс лома: ${rateError.message}`)
    for (const row of rateRows ?? []) {
      scrapRates.set(row.metal, Number(row.scrap_price_per_gram) || 0)
    }
  }

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
      const rate = scrapRates.get(metal) || DEFAULT_RATES[metal]?.scrap || 0
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

  const salePayload = {
    items: validated,
    payment_method: input.payment_method,
    customer_id: customerId,
    amount_cash: input.amount_cash,
    amount_electronic: input.amount_electronic,
    bonus_used: input.bonus_used,
    customer_name: (input.customer_name ?? "").trim() || null,
    customer_phone: phone || null,
    receipt_type: receiptType,
  }
  const legacyCommit = () =>
    input.payment_method === "credit"
      ? supabase.rpc("commit_offline_credit_sale", {
          _client_op_id: clientOpId,
          _sale: salePayload,
          _due_date: creditDueDate,
        })
      : supabase.rpc("commit_offline_sale", {
          _client_op_id: clientOpId,
          _sale: salePayload,
        })
  // commit_sale_with_receipt (миграция 007) вызывает те же функции продажи,
  // но дополнительно записывает тип чека. Пока миграция не применена —
  // продажа проходит по-старому, тип чека не сохраняется.
  let rpcResponse = await supabase.rpc("commit_sale_with_receipt", {
    _client_op_id: clientOpId,
    _sale: salePayload,
    _due_date: input.payment_method === "credit" ? creditDueDate : null,
  })
  if (rpcResponse.error && ["42883", "PGRST202"].includes(rpcResponse.error.code ?? "")) {
    console.warn("[checkout] commit_sale_with_receipt не найдена — примените миграцию 007_fiscal_receipts.sql")
    rpcResponse = await legacyCommit()
  }
  const { data: result, error } = rpcResponse
  if (error) {
    if (input.payment_method === "credit" && (MISSING_SCHEMA_CODES.includes(error.code ?? "") || error.message.includes("Некорректный способ оплаты"))) {
      throw new Error("Сначала примените SQL-миграции продаж в долг и сроков: supabase/migrations/001_customer_credit_sales.sql и supabase/migrations/002_customer_credit_due_dates.sql")
    }
    throw new Error(`Не удалось провести продажу: ${error.message}`)
  }
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
