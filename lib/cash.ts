import type { CashOperation, Sale } from "@/lib/types"

/** Способы оплаты, попадающие в «электронные» средства. */
export const ELECTRONIC_METHODS = ["card", "transfer"]

export type CashBalances = {
  cash: number
  electronic: number
  total: number
}

function saleSplit(sale: Sale): { cash: number; electronic: number } {
  const total = Number(sale.total) || 0
  if (sale.payment_method === "mixed") {
    const cash = Number(sale.amount_cash) || 0
    const electronic = Number(sale.amount_electronic) || 0
    // Подстраховка для старых чеков без разбивки.
    if (cash + electronic <= 0) return { cash: total, electronic: 0 }
    return { cash, electronic }
  }
  if (ELECTRONIC_METHODS.includes(sale.payment_method)) return { cash: 0, electronic: total }
  return { cash: total, electronic: 0 }
}

/** Разбивка суммы операции по источникам. Старые записи считаются наличными. */
export function operationSplit(op: CashOperation): { cash: number; electronic: number } {
  const amount = Number(op.amount) || 0
  if (op.source === "electronic") return { cash: 0, electronic: amount }
  if (op.source === "mixed") {
    const cash = Number(op.amount_cash) || 0
    const electronic = Number(op.amount_electronic) || 0
    if (cash + electronic <= 0) return { cash: amount, electronic: 0 }
    return { cash, electronic }
  }
  return { cash: amount, electronic: 0 }
}

/**
 * Балансы кассы: продажи плюс внесения, минус изъятия.
 * Инкассация — это перемещение средств: сумма уходит из «наличных»
 * и приходит в «электронные», поэтому общий баланс не меняется и
 * кассового разрыва (отрицательных наличных) не возникает.
 */
export function computeBalances(
  sales: Sale[],
  operations: CashOperation[],
  filter?: (createdAt: string) => boolean,
): CashBalances {
  let cash = 0
  let electronic = 0

  for (const s of sales) {
    if (filter && !filter(s.created_at)) continue
    const split = saleSplit(s)
    cash += split.cash
    electronic += split.electronic
  }

  for (const o of operations) {
    if (filter && !filter(o.created_at)) continue
    const split = operationSplit(o)
    if (o.type === "collection") {
      // Перевод наличных в электронные средства.
      const moved = split.cash + split.electronic
      cash -= moved
      electronic += moved
      continue
    }
    const sign = o.type === "income" ? 1 : -1
    cash += sign * split.cash
    electronic += sign * split.electronic
  }

  return { cash, electronic, total: cash + electronic }
}
