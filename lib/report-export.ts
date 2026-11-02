/**
 * Подготовка строк для Excel-выгрузок экрана «Отчёты».
 *
 * Модуль чистый (без React, браузера и алиасов "@/"), поэтому его можно
 * проверять тестами напрямую через node. Само создание файла — в
 * lib/report-export-xlsx.ts.
 *
 * Два набора данных:
 *  • ГНС (налоговая) — только фискальные чеки и остатки по розничной цене.
 *    Себестоимость, прибыль, закупочные цены и поставщики сюда не попадают.
 *  • Управленческий — все чеки, себестоимость, скидки, прибыль, маржа,
 *    закупка, поставщики и стоимость лома.
 */
import type { Product, Sale, SaleItem, SaleReturn } from "./types"

export type CellKind = "text" | "datetime" | "weight" | "money" | "int" | "percent"
export type Column<Row> = { header: string; kind: CellKind; width: number; value: (row: Row) => string | number | null }
export type ProductInfo = Pick<Product, "id" | "category" | "metal">

export type SaleLine = {
  createdAt: string
  receiptNo: string
  receiptType: string
  seller: string
  customer: string
  sku: string
  name: string
  category: string
  metal: string
  purity: string
  weight: number
  quantity: number
  payment: string
  /** Сумма позиции до скидки чека и списания бонусов. */
  gross: number
  /** Фактическая скидка: доля скидки чека + доля оплаченных бонусов. */
  discount: number
  /** Фактически оплаченная сумма позиции (доля итога чека). */
  total: number
  cost: number
  profit: number
  /** Доля 0..1 для формата Excel «0.0%». */
  margin: number
}

export type ReturnLine = {
  createdAt: string
  receiptNo: string
  author: string
  sku: string
  name: string
  metal: string
  purity: string
  weight: number
  amount: number
  cost: number
  reason: string
}

export type SummaryLine = { metric: string; value: number }

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
export const round2 = (value: number) => Math.round((num(value) + Number.EPSILON) * 100) / 100

/** Короткий номер чека — так же, как его показывают в истории продаж. */
export const receiptNumber = (sale: Pick<Sale, "id">) => sale.id.slice(0, 8).toUpperCase()

/** «Золото 585» → «585»; «Платина» → «». */
export function purityOfMetal(metal: string | null | undefined): string {
  const match = (metal ?? "").trim().match(/(\d{3,4})\s*$/)
  return match ? match[1] : ""
}

/** «Вторичное золото 585» → «Вторичное золото»; «Золото 585» → «Золото». */
export function metalBase(metal: string | null | undefined): string {
  const raw = (metal ?? "").trim()
  const base = raw.replace(/\s*\d{3,4}\s*$/, "").trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ""
}

export function metalWithPurity(metal: string | null | undefined): string {
  const base = metalBase(metal)
  const purity = purityOfMetal(metal)
  return [base, purity].filter(Boolean).join(" ")
}

/** Способ оплаты для налоговой: нал / безнал. */
export function paymentLabel(sale: Pick<Sale, "payment_method">): string {
  switch (sale.payment_method) {
    case "cash":
      return "Наличные"
    case "card":
    case "transfer":
      return "Безналичные"
    case "mixed":
      return "Наличные + безналичные"
    case "credit":
      return "В долг"
    default:
      return sale.payment_method || "—"
  }
}

/** Чек, который реально проведён: не удалён и не ждёт/не отклонён синхронизацией. */
export function isCountedSale(sale: Sale): boolean {
  return !sale.deleted_at && sale.sync_status !== "pending" && sale.sync_status !== "rejected"
}

export function inRange(iso: string, from: number | null, to: number): boolean {
  const time = Date.parse(iso)
  return Number.isFinite(time) && (from === null || time >= from) && time < to
}

/** Строго фискальные чеки — старые чеки без типа и нефискальные исключаются. */
export function fiscalSales(sales: Sale[], from: number | null, to: number): Sale[] {
  return sales.filter((s) => s.receipt_type === "fiscal" && isCountedSale(s) && inRange(s.created_at, from, to))
}

export function allSales(sales: Sale[], from: number | null, to: number): Sale[] {
  return sales.filter((s) => isCountedSale(s) && inRange(s.created_at, from, to))
}

/**
 * Раскладывает итог чека по позициям пропорционально цене позиции.
 * Последняя позиция забирает остаток округления, поэтому сумма строк
 * всегда равна итогу чека до копейки.
 */
function splitByShare(total: number, items: SaleItem[]): number[] {
  const weights = items.map((item) => Math.max(0, num(item.price) * Math.max(1, num(item.quantity))))
  const gross = weights.reduce((a, b) => a + b, 0)
  const parts = items.map((_, i) => (gross > 0 ? weights[i] / gross : 1 / items.length))
  let rest = round2(total)
  return parts.map((share, i) => {
    if (i === items.length - 1) return round2(rest)
    const value = round2(total * share)
    rest -= value
    return value
  })
}

export function saleLines(sales: Sale[], products: Map<string, ProductInfo>): SaleLine[] {
  const lines: SaleLine[] = []
  const sorted = [...sales].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const sale of sorted) {
    const items = sale.items ?? []
    if (items.length === 0) continue
    const totals = splitByShare(num(sale.total), items)
    const discounts = splitByShare(num(sale.discount) + num(sale.bonus_used), items)
    items.forEach((item, i) => {
      const product = products.get(item.product_id ?? "")
      const metal = item.metal ?? product?.metal ?? null
      const quantity = Math.max(1, num(item.quantity))
      const total = totals[i]
      const cost = round2(num(item.cost) * quantity)
      const profit = round2(total - cost)
      lines.push({
        createdAt: sale.created_at,
        receiptNo: receiptNumber(sale),
        receiptType: sale.receipt_type === "fiscal" ? "Фискальный" : sale.receipt_type === "non_fiscal" ? "Нефискальный" : "Не указан",
        seller: sale.seller_name ?? "",
        customer: sale.customer_name ?? "",
        sku: item.kind === "scrap" ? "" : item.sku ?? "",
        name: item.name || (item.kind === "scrap" ? "Лом" : ""),
        category: item.kind === "scrap" ? "Лом" : product?.category ?? "Прочее",
        metal: metalBase(metal),
        purity: purityOfMetal(metal),
        weight: round2(num(item.weight)),
        quantity,
        payment: paymentLabel(sale),
        gross: round2(total + discounts[i]),
        discount: discounts[i],
        total,
        cost,
        profit,
        margin: total > 0 ? Math.round((profit / total) * 10000) / 10000 : 0,
      })
    })
  }
  return lines
}

/** Возвраты отражаются в день фактической выплаты, а не в день исходной продажи. */
export function returnLines(
  returns: SaleReturn[],
  sales: Sale[],
  products: Map<string, ProductInfo>,
): ReturnLine[] {
  const saleById = new Map(sales.map((sale) => [sale.id, sale]))
  return [...returns]
    .filter((refund) => !refund.deleted_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((refund) => {
      const sale = saleById.get(refund.sale_id)
      const item = sale?.items?.[refund.item_index]
      const product = products.get(refund.product_id ?? item?.product_id ?? "")
      const metal = refund.item_metal ?? item?.metal ?? product?.metal ?? null
      return {
        createdAt: refund.created_at,
        receiptNo: sale ? receiptNumber(sale) : refund.sale_id.slice(0, 8).toUpperCase(),
        author: refund.author_name ?? "",
        sku: item?.sku ?? refund.sku ?? "",
        name: refund.item_name ?? refund.product_name ?? item?.name ?? "",
        metal: metalBase(metal),
        purity: purityOfMetal(metal),
        weight: round2(num(refund.item_weight ?? item?.weight)),
        amount: round2(num(refund.amount ?? refund.return_amount)),
        cost: round2(num(refund.cost)),
        reason: refund.reason ?? "",
      }
    })
}

export function managerNetSummary(sales: SaleLine[], refunds: ReturnLine[]): SummaryLine[] {
  const revenue = round2(sales.reduce((sum, line) => sum + line.total, 0))
  const refundAmount = round2(refunds.reduce((sum, line) => sum + line.amount, 0))
  const cost = round2(sales.reduce((sum, line) => sum + line.cost, 0))
  const returnedCost = round2(refunds.reduce((sum, line) => sum + line.cost, 0))
  const netRevenue = round2(revenue - refundAmount)
  const netCost = round2(cost - returnedCost)
  return [
    { metric: "Сумма продаж", value: revenue },
    { metric: "Возвращено покупателям", value: refundAmount },
    { metric: "Выручка после возвратов", value: netRevenue },
    { metric: "Себестоимость продаж", value: cost },
    { metric: "Себестоимость возвращённых изделий", value: returnedCost },
    { metric: "Чистая себестоимость", value: netCost },
    { metric: "Чистая прибыль после возвратов", value: round2(netRevenue - netCost) },
  ]
}

export function gnsNetSummary(sales: SaleLine[], refunds: ReturnLine[]): SummaryLine[] {
  const revenue = round2(sales.reduce((sum, line) => sum + line.total, 0))
  const refundAmount = round2(refunds.reduce((sum, line) => sum + line.amount, 0))
  return [
    { metric: "Фискальные продажи", value: revenue },
    { metric: "Возвраты по фискальным чекам", value: refundAmount },
    { metric: "Фискальная выручка после возвратов", value: round2(revenue - refundAmount) },
  ]
}

export const inStock = (products: Product[]) =>
  products
    .filter((p) => p.status === "in_stock" && !p.deleted_at)
    .sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? "", "ru"))

/* ─── Колонки ГНС ─────────────────────────────────────────────────────── */

export const GNS_SALES_COLUMNS: Column<SaleLine>[] = [
  { header: "Дата и время", kind: "datetime", width: 17, value: (r) => r.createdAt },
  { header: "Номер чека/продажи", kind: "text", width: 14, value: (r) => r.receiptNo },
  { header: "Артикул", kind: "text", width: 14, value: (r) => r.sku },
  { header: "Наименование изделия", kind: "text", width: 32, value: (r) => r.name },
  { header: "Металл и проба", kind: "text", width: 20, value: (r) => [r.metal, r.purity].filter(Boolean).join(" ") },
  { header: "Вес (г)", kind: "weight", width: 10, value: (r) => r.weight },
  { header: "Количество", kind: "int", width: 11, value: (r) => r.quantity },
  { header: "Способ оплаты", kind: "text", width: 22, value: (r) => r.payment },
  { header: "Сумма (сом)", kind: "money", width: 14, value: (r) => r.total },
]

export const GNS_STOCK_COLUMNS: Column<Product>[] = [
  { header: "Артикул", kind: "text", width: 14, value: (p) => p.sku ?? "" },
  { header: "Категория", kind: "text", width: 14, value: (p) => p.category ?? "Прочее" },
  { header: "Металл", kind: "text", width: 18, value: (p) => metalBase(p.metal) },
  { header: "Проба", kind: "text", width: 8, value: (p) => purityOfMetal(p.metal) },
  { header: "Вес (г)", kind: "weight", width: 10, value: (p) => round2(num(p.weight)) },
  { header: "Размер", kind: "text", width: 9, value: (p) => p.size ?? "" },
  { header: "Количество", kind: "int", width: 11, value: () => 1 },
  { header: "Розничная цена (сом)", kind: "money", width: 18, value: (p) => round2(num(p.sale_price)) },
]

export const RETURN_COLUMNS: Column<ReturnLine>[] = [
  { header: "Дата и время возврата", kind: "datetime", width: 20, value: (r) => r.createdAt },
  { header: "Номер исходного чека", kind: "text", width: 18, value: (r) => r.receiptNo },
  { header: "Оформил возврат", kind: "text", width: 20, value: (r) => r.author },
  { header: "Артикул", kind: "text", width: 14, value: (r) => r.sku },
  { header: "Наименование", kind: "text", width: 30, value: (r) => r.name },
  { header: "Металл", kind: "text", width: 16, value: (r) => r.metal },
  { header: "Проба", kind: "text", width: 8, value: (r) => r.purity },
  { header: "Вес (г)", kind: "weight", width: 10, value: (r) => r.weight },
  { header: "Возвращено покупателю (сом)", kind: "money", width: 24, value: (r) => r.amount },
  { header: "Возвращённая себестоимость (сом)", kind: "money", width: 28, value: (r) => r.cost },
  { header: "Причина", kind: "text", width: 34, value: (r) => r.reason },
]

export const GNS_RETURN_COLUMNS: Column<ReturnLine>[] = [
  { header: "Дата и время возврата", kind: "datetime", width: 20, value: (r) => r.createdAt },
  { header: "Номер исходного чека", kind: "text", width: 18, value: (r) => r.receiptNo },
  { header: "Артикул", kind: "text", width: 14, value: (r) => r.sku },
  { header: "Наименование", kind: "text", width: 30, value: (r) => r.name },
  { header: "Металл", kind: "text", width: 16, value: (r) => r.metal },
  { header: "Проба", kind: "text", width: 8, value: (r) => r.purity },
  { header: "Вес (г)", kind: "weight", width: 10, value: (r) => r.weight },
  { header: "Возвращено покупателю (сом)", kind: "money", width: 24, value: (r) => r.amount },
  { header: "Причина", kind: "text", width: 34, value: (r) => r.reason },
]

export const SUMMARY_COLUMNS: Column<SummaryLine>[] = [
  { header: "Показатель", kind: "text", width: 42, value: (r) => r.metric },
  { header: "Сумма (сом)", kind: "money", width: 20, value: (r) => r.value },
]

/* ─── Колонки управленческого отчёта ──────────────────────────────────── */

export const MANAGER_SALES_COLUMNS: Column<SaleLine>[] = [
  { header: "Дата и время", kind: "datetime", width: 17, value: (r) => r.createdAt },
  { header: "Номер чека", kind: "text", width: 12, value: (r) => r.receiptNo },
  { header: "Тип чека", kind: "text", width: 14, value: (r) => r.receiptType },
  { header: "Продавец", kind: "text", width: 18, value: (r) => r.seller },
  { header: "Покупатель", kind: "text", width: 18, value: (r) => r.customer },
  { header: "Артикул", kind: "text", width: 14, value: (r) => r.sku },
  { header: "Наименование", kind: "text", width: 30, value: (r) => r.name },
  { header: "Категория", kind: "text", width: 13, value: (r) => r.category },
  { header: "Металл", kind: "text", width: 16, value: (r) => r.metal },
  { header: "Проба", kind: "text", width: 8, value: (r) => r.purity },
  { header: "Вес (г)", kind: "weight", width: 10, value: (r) => r.weight },
  { header: "Количество", kind: "int", width: 11, value: (r) => r.quantity },
  { header: "Способ оплаты", kind: "text", width: 22, value: (r) => r.payment },
  { header: "Сумма до скидки (сом)", kind: "money", width: 18, value: (r) => r.gross },
  { header: "Фактическая скидка (сом)", kind: "money", width: 20, value: (r) => r.discount },
  { header: "Сумма продажи (сом)", kind: "money", width: 18, value: (r) => r.total },
  { header: "Себестоимость (сом)", kind: "money", width: 18, value: (r) => r.cost },
  { header: "Чистая прибыль (сом)", kind: "money", width: 18, value: (r) => r.profit },
  { header: "Маржа", kind: "percent", width: 9, value: (r) => r.margin },
]

export function managerStockColumns(scrapPrices: Record<string, number>): Column<Product>[] {
  const scrapPrice = (p: Product) => num(scrapPrices[purityOfMetal(p.metal) || (/платин/i.test(p.metal ?? "") ? "950" : "Прочее")])
  return [
    { header: "Артикул", kind: "text", width: 14, value: (p) => p.sku ?? "" },
    { header: "Наименование", kind: "text", width: 30, value: (p) => p.name },
    { header: "Категория", kind: "text", width: 13, value: (p) => p.category ?? "Прочее" },
    { header: "Металл", kind: "text", width: 18, value: (p) => metalBase(p.metal) },
    { header: "Проба", kind: "text", width: 8, value: (p) => purityOfMetal(p.metal) },
    { header: "Вес (г)", kind: "weight", width: 10, value: (p) => round2(num(p.weight)) },
    { header: "Размер", kind: "text", width: 9, value: (p) => p.size ?? "" },
    { header: "Количество", kind: "int", width: 11, value: () => 1 },
    { header: "Цена закупки (сом)", kind: "money", width: 17, value: (p) => round2(num(p.purchase_price)) },
    { header: "Закупка за грамм (сом)", kind: "money", width: 19, value: (p) => round2(num(p.price_per_gram_purchase)) },
    { header: "Розничная цена (сом)", kind: "money", width: 18, value: (p) => round2(num(p.sale_price)) },
    { header: "Поставщик", kind: "text", width: 20, value: (p) => p.supplier_name ?? "" },
    { header: "Телефон поставщика", kind: "text", width: 17, value: (p) => p.supplier_phone ?? "" },
    { header: "Цена лома за грамм (сом)", kind: "money", width: 20, value: (p) => round2(scrapPrice(p)) },
    { header: "Стоимость лома (сом)", kind: "money", width: 18, value: (p) => round2(num(p.weight) * scrapPrice(p)) },
    { header: "Дата поступления", kind: "datetime", width: 17, value: (p) => p.created_at },
  ]
}

/** Сводная строка значений таблицы (для проверки и записи в лист). */
export function tableRows<Row>(columns: Column<Row>[], rows: Row[]) {
  return rows.map((row) => columns.map((column) => column.value(row)))
}

/** Дата для имени файла по времени Бишкека (UTC+6): YYYY-MM-DD. */
export function fileDate(now = new Date()): string {
  return new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10)
}

/** ISO → серийная дата Excel в часовом поясе Бишкека (UTC+6, без перехода на летнее время). */
export function excelSerialBishkek(iso: string): number | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  return (time + 6 * 3_600_000) / 86_400_000 + 25_569
}
