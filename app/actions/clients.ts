"use server"

import { revalidatePath } from "next/cache"
import type { Customer, CustomerDebtOperation } from "@/lib/types"
import { resolveClientOperationId } from "@/lib/client-operation"
import { requireApprovedContext } from "@/lib/supabase/request-context"

const requireProfile = requireApprovedContext

export async function getClients(): Promise<Customer[]> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return []

  // Keep the screen usable before the optional credit migration has been applied.
  const baseQuery = (columns: string) =>
    supabase
      .from("customers")
      .select(columns)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .range(0, 49)

  const currentColumns = "id, shop_id, name, phone, gender, whatsapp, instagram, email, bonus_points, is_blacklisted, purchase_count, total_spent, debt_balance, last_purchase_at, created_at, updated_at, deleted_at"
  const legacyColumns = "id, shop_id, name, phone, gender, whatsapp, instagram, email, bonus_points, is_blacklisted, purchase_count, total_spent, last_purchase_at, created_at, updated_at, deleted_at"
  let { data: clients, error: clientsError } = await baseQuery(currentColumns)

  if (clientsError && (clientsError.code === "42703" || clientsError.code === "PGRST204") && clientsError.message.includes("debt_balance")) {
    const legacy = await baseQuery(legacyColumns)
    clients = legacy.data
    clientsError = legacy.error
  }

  if (clientsError) throw clientsError
  if (!clients || clients.length === 0) return []

  const typedClients = clients as unknown as Customer[]
  const customerIds = typedClients.map((client) => client.id)
  const { data: creditSales, error: creditSalesError } = await supabase
    .from("sales")
    .select("id, customer_id, credit_balance, credit_due_date")
    .eq("shop_id", shopId)
    .eq("payment_method", "credit")
    .gt("credit_balance", 0)
    .is("deleted_at", null)
    .in("customer_id", customerIds)

  if (creditSalesError) {
    const missingCreditMigration = ["42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(creditSalesError.code ?? "")
    if (missingCreditMigration) return typedClients
    throw new Error("Не удалось загрузить просроченные долги: " + creditSalesError.message)
  }

  const todayParts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const today = ["year", "month", "day"].map((key) => todayParts.find((part) => part.type === key)?.value ?? "").join("-")
  const activeByCustomer = new Map<string, Array<{ id: string; credit_due_date: string | null; credit_balance: number }>>()

  for (const sale of creditSales ?? []) {
    const dueDate = typeof sale.credit_due_date === "string" ? sale.credit_due_date.slice(0, 10) : null
    const balance = Number(sale.credit_balance) || 0
    if (!sale.customer_id || balance <= 0) continue
    const list = activeByCustomer.get(sale.customer_id) ?? []
    list.push({ id: sale.id, credit_due_date: dueDate, credit_balance: balance })
    activeByCustomer.set(sale.customer_id, list)
  }

  return typedClients.map((client) => {
    const activeCreditSales = (activeByCustomer.get(client.id) ?? [])
      .sort((a, b) => (a.credit_due_date ?? "9999-12-31").localeCompare(b.credit_due_date ?? "9999-12-31"))
    const overdueCreditSales = activeCreditSales.filter((sale) => sale.credit_due_date !== null && sale.credit_due_date < today)
    return {
      ...client,
      active_credit_sales: activeCreditSales,
      credit_debt_balance: activeCreditSales.reduce((sum, sale) => sum + sale.credit_balance, 0),
      next_credit_due_date: activeCreditSales.find((sale) => sale.credit_due_date !== null)?.credit_due_date ?? null,
      overdue_credit_sales: overdueCreditSales,
      overdue_debt_balance: overdueCreditSales.reduce((sum, sale) => sum + sale.credit_balance, 0),
    }
  })
}

export type ClientPurchase = {
  id: string
  created_at: string
  total: number
  items: Array<{ sku?: string; name: string; quantity: number; price: number }>
  payment_method: string
}

/** История покупок конкретного клиента (по customer_id или совпадению имени+телефона). */
export async function getClientPurchases(customerId: string): Promise<ClientPurchase[]> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return []
  const { data, error } = await supabase
    .from("sales")
    .select("id, created_at, total, items, payment_method")
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw new Error(`Ошибка загрузки истории: ${error.message}`)
  return (data ?? []) as ClientPurchase[]
}

export type CustomerDebtData = {
  available: boolean
  balance: number
  operations: CustomerDebtOperation[]
}

/** Текущий баланс долга и последние операции клиента. */
export async function getCustomerDebtData(customerId: string): Promise<CustomerDebtData> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId || !customerId) return { available: false, balance: 0, operations: [] }

  const [customerResult, operationsResult] = await Promise.all([
    supabase.from("customers").select("debt_balance").eq("shop_id", shopId).eq("id", customerId).maybeSingle(),
    supabase
      .from("customer_debt_operations")
      .select("id, shop_id, customer_id, sale_id, sale_return_id, operation_type, amount, balance_before, balance_after, cash_operation_id, source, amount_cash, amount_electronic, reason, author_name, created_at, client_op_id")
      .eq("shop_id", shopId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(100),
  ])

  const unavailableCodes = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"])
  if (unavailableCodes.has(customerResult.error?.code ?? "") || unavailableCodes.has(operationsResult.error?.code ?? "")) {
    return { available: false, balance: 0, operations: [] }
  }
  if (customerResult.error) throw new Error(`Не удалось загрузить баланс клиента: ${customerResult.error.message}`)
  if (operationsResult.error) throw new Error(`Не удалось загрузить историю долга: ${operationsResult.error.message}`)

  return {
    available: Boolean(customerResult.data),
    balance: Number(customerResult.data?.debt_balance) || 0,
    operations: (operationsResult.data ?? []) as CustomerDebtOperation[],
  }
}

/** Частичное или полное погашение клиентского долга. */
export async function payCustomerDebt(input: {
  customerId: string
  amount: number
  source: "cash" | "electronic"
  clientOpId?: string
}): Promise<CustomerDebtOperation> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  const customerId = (input.customerId ?? "").trim()
  const amount = Number(input.amount)
  if (!customerId) throw new Error("Не выбран клиент")
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Укажите сумму платежа больше нуля")
  if (input.source !== "cash" && input.source !== "electronic") throw new Error("Выберите способ оплаты")

  const clientOpId = resolveClientOperationId(input.clientOpId)
  const { data, error } = await supabase.rpc("pay_customer_debt", {
    _client_op_id: clientOpId,
    _customer_id: customerId,
    _amount: Math.round(amount * 100) / 100,
    _source: input.source,
    _amount_cash: input.source === "cash" ? Math.round(amount * 100) / 100 : 0,
    _amount_electronic: input.source === "electronic" ? Math.round(amount * 100) / 100 : 0,
  })

  if (error) {
    if (["42883", "42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
      throw new Error("Сначала примените SQL-миграцию supabase/migrations/001_customer_credit_sales.sql")
    }
    throw new Error(`Не удалось принять оплату долга: ${error.message}`)
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("Платёж не был записан")
  revalidatePath("/crm")
  return row as CustomerDebtOperation
}

/** Продлить срок конкретной просроченной продажи в долг. */
export async function extendCustomerCreditDueDate(input: {
  saleId: string
  dueDate: string
}): Promise<void> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  if (!input.saleId || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new Error("Укажите продажу и новую дату оплаты")
  }

  const { error } = await supabase.rpc("extend_customer_credit_due_date", {
    _sale_id: input.saleId,
    _due_date: input.dueDate,
  })
  if (error) {
    if (["42883", "42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
      throw new Error("Сначала примените SQL-миграцию supabase/migrations/002_customer_credit_due_dates.sql")
    }
    throw new Error("Не удалось продлить срок долга: " + error.message)
  }
  revalidatePath("/crm")
}

/** Добавить/убрать клиента из чёрного списка. */
export async function setClientBlacklist(id: string, blacklisted: boolean): Promise<void> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  const { error } = await supabase
    .from("customers")
    .update({ is_blacklisted: blacklisted })
    .eq("id", id)
    .eq("shop_id", shopId)
  if (error) throw new Error(`Не удалось обновить статус: ${error.message}`)
  revalidatePath("/crm")
}

export type ClientInput = {
  name: string
  phone?: string | null
  gender?: string | null
  whatsapp?: string | null
  instagram?: string | null
  email?: string | null
}

function validateClient(input: Partial<ClientInput>) {
  if (input.name !== undefined && !String(input.name).trim()) {
    throw new Error("Укажите имя клиента")
  }
  if (input.phone) {
    const cleaned = input.phone.trim()
    if (cleaned && !/^[\d+()\s-]{5,20}$/.test(cleaned)) {
      throw new Error("Некорректный номер телефона")
    }
  }
}

export async function createClient_(input: ClientInput): Promise<void> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Сначала выберите магазин")
  validateClient(input)
  const { error } = await supabase.from("customers").insert({
    shop_id: shopId,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    gender: input.gender || null,
    whatsapp: input.whatsapp?.trim() || null,
    instagram: input.instagram?.trim() || null,
    email: input.email?.trim() || null,
    bonus_points: 0,
  })
  if (error) throw new Error(`Не удалось создать клиента: ${error.message}`)
  revalidatePath("/crm")
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<void> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  validateClient(input)
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
  if (input.gender !== undefined) patch.gender = input.gender || null
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp?.trim() || null
  if (input.instagram !== undefined) patch.instagram = input.instagram?.trim() || null
  if (input.email !== undefined) patch.email = input.email?.trim() || null
  const { error } = await supabase.from("customers").update(patch).eq("id", id).eq("shop_id", shopId)
  if (error) throw new Error(`Не удалось обновить клиента: ${error.message}`)
  revalidatePath("/crm")
}

export async function deleteClient(id: string): Promise<void> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) throw new Error("Ваш аккаунт не привязан к магазину")
  const { error } = await supabase.from("customers").delete().eq("id", id).eq("shop_id", shopId)
  if (error) throw new Error(`Не удалось удалить клиента: ${error.message}`)
  revalidatePath("/crm")
}
