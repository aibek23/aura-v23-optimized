"use server"

import { revalidatePath } from "next/cache"
import type { CashOperation, CashReasonPreset, CashSource } from "@/lib/types"
import { getRequestCrmContext } from "@/lib/supabase/request-context"
import { resolveClientOperationId } from "@/lib/client-operation"

async function requireProfile() {
  const { supabase, user, profile, shopId } = await getRequestCrmContext()
  if (!user) throw new Error("Unauthorized")
  if (!profile || profile.status !== "approved") throw new Error("Not approved")
  return { supabase, user, profile, shopId }
}

async function requireAdmin() {
  const ctx = await requireProfile()
  if (ctx.profile.role !== "admin" && ctx.profile.role !== "super_admin") throw new Error("Forbidden")
  return ctx
}

export type CashData = {
  operations: CashOperation[]
  presets: CashReasonPreset[]
}

/** Операции с кассой и шаблоны причин текущего магазина. */
export async function getCashData(): Promise<CashData> {
  const { supabase, shopId } = await requireProfile()
  if (!shopId) return { operations: [], presets: [] }

  const [ops, presets] = await Promise.all([
    supabase
      .from("cash_operations")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .range(0, 199),
    supabase
      .from("cash_reason_presets")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
  ])

  // Таблиц может ещё не быть, пока не выполнена миграция 003 — не роняем экран.
  return {
    operations: (ops.data as CashOperation[]) ?? [],
    presets: (presets.data as CashReasonPreset[]) ?? [],
  }
}

/** Внесение, изъятие или инкассация средств. Причина обязательна. Только администратор. */
export async function createCashOperation(input: {
  type: "income" | "outcome" | "collection"
  amount: number
  /** Источник средств: наличные, электронные или оба. */
  source?: CashSource
  amount_cash?: number
  amount_electronic?: number
  reason: string
  savePreset?: boolean
  /** Списание за лом проводится продавцом, а не только администратором. */
  allowSeller?: boolean
  /** Keep this UUID unchanged when retrying after a network failure. */
  client_op_id?: string
}) {
  const { supabase, shopId } = input.allowSeller ? await requireProfile() : await requireAdmin()
  const clientOpId = resolveClientOperationId(input.client_op_id)

  // Проверка на привязку магазина
  if (!shopId) {
    throw new Error("Ваш аккаунт не привязан ни к одному магазину")
  }

  const amount = Math.round(Number(input.amount) * 100) / 100
  const reason = (input.reason ?? "").trim()
  
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Укажите сумму больше нуля")
  if (!reason) throw new Error("Причина / цель операции обязательна")
  if (reason.length > 300) throw new Error("Причина слишком длинная (максимум 300 символов)")
  
  // Проверяем разрешенные типы операций с учетом инкассации
  if (input.type !== "income" && input.type !== "outcome" && input.type !== "collection") {
    throw new Error("Неверный тип операции")
  }

  // ------------------------------------------------- источник и его разбивка
  // Инкассация всегда переводит наличные в электронные средства.
  const source: CashSource = input.type === "collection" ? "cash" : (input.source ?? "cash")
  if (source !== "cash" && source !== "electronic" && source !== "mixed") {
    throw new Error("Неверный источник средств")
  }

  let fromCash = source === "cash" ? amount : 0
  let fromElectronic = source === "electronic" ? amount : 0
  if (source === "mixed") {
    fromCash = Math.round(Number(input.amount_cash ?? 0) * 100) / 100
    fromElectronic = Math.round(Number(input.amount_electronic ?? 0) * 100) / 100
    if (!Number.isFinite(fromCash) || !Number.isFinite(fromElectronic)) {
      throw new Error("Укажите корректные суммы оплаты")
    }
    if (fromCash < 0 || fromElectronic < 0) throw new Error("Суммы не могут быть отрицательными")
    if (Math.round(fromCash * 100) + Math.round(fromElectronic * 100) !== Math.round(amount * 100)) {
      throw new Error("Сумма наличных и электронных должна совпадать с общей суммой")
    }
  }

  const { data: result, error } = await supabase.rpc("create_cash_operation_atomic", {
    _client_op_id: clientOpId,
    _type: input.type,
    _amount: amount,
    _source: source,
    _amount_cash: fromCash,
    _amount_electronic: fromElectronic,
    _reason: reason,
    _allow_seller: input.allowSeller === true,
    _save_preset: input.savePreset === true,
  })
  if (error) throw new Error(`Не удалось провести кассовую операцию: ${error.message}`)
  if (result?.accepted !== true) {
    throw new Error("Не удалось подтвердить кассовую операцию. Повторите с тем же идентификатором.")
  }

  revalidatePath("/crm")
  return { ok: true, operationId: result.operation_id, clientOpId, duplicate: result.duplicate === true }
}

/** Удалить шаблон причины. Только администратор. */
export async function deleteCashReasonPreset(id: string) {
  const { supabase, shopId } = await requireAdmin()
  if (!shopId) throw new Error("Ваш аккаунт не привязан ни к одному магазину")
  const { error } = await supabase.from("cash_reason_presets").delete().eq("id", id).eq("shop_id", shopId)
  if (error) throw error
  revalidatePath("/crm")
  return { ok: true }
}
