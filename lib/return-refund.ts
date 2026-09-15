import type { Sale, SaleItem } from "@/lib/types"
import { ELECTRONIC_METHODS } from "@/lib/cash"

export type RefundBreakdown = {
  /** Фактически оплаченная сумма позиции — её и возвращаем покупателю. */
  amount: number
  /** Себестоимость возвращаемого товара (снова учитывается на складе). */
  cost: number
  /** На сколько уменьшится прибыль после возврата. */
  profitDelta: number
  /** Часть возврата, забираемая из наличных. */
  cash: number
  /** Часть возврата, забираемая из электронных средств. */
  electronic: number
}

/**
 * Сумма возврата по фактически оплаченной цене.
 *
 * `item.price` уже учитывает скидку позиции, но скидка чека и списанные
 * бонусы уменьшают `sale.total`, поэтому доля возврата пропорциональна
 * отношению `total / subtotal`. Та же формула применяется в SQL-функции
 * `return_sale_item`, поэтому превью в UI совпадает с результатом в БД.
 */
export function computeRefund(sale: Sale, item: SaleItem): RefundBreakdown {
  const subtotal = Number(sale.subtotal) || 0
  const total = Number(sale.total) || 0
  const price = Number(item.price) || 0

  const ratio = subtotal > 0 ? Math.min(1, Math.max(0, total / subtotal)) : 1
  const amount = Math.round(price * ratio)
  const cost = Number(item.cost) || 0

  // Источник возврата повторяет источник оплаты чека.
  let saleCash = 0
  let saleElectronic = 0
  if (sale.payment_method === "mixed") {
    saleCash = Number(sale.amount_cash) || 0
    saleElectronic = Number(sale.amount_electronic) || 0
    if (saleCash + saleElectronic <= 0) saleCash = total
  } else if (ELECTRONIC_METHODS.includes(sale.payment_method)) {
    saleElectronic = total
  } else {
    saleCash = total
  }

  const paidFactor = total > 0 ? amount / total : 0
  let cash = Math.round(saleCash * paidFactor)
  cash = Math.min(cash, amount)

  return {
    amount,
    cost,
    profitDelta: amount - cost,
    cash,
    electronic: amount - cash,
  }
}
