"use client"

/**
 * Генерация .xlsx в браузере через SheetJS.
 * Библиотека подгружается только при запуске экспорта.
 */
import type { Product, Sale, SaleReturn } from "@/lib/types"
import {
  GNS_RETURN_COLUMNS,
  GNS_SALES_COLUMNS,
  GNS_STOCK_COLUMNS,
  MANAGER_SALES_COLUMNS,
  RETURN_COLUMNS,
  SUMMARY_COLUMNS,
  allSales,
  excelSerialBishkek,
  fileDate,
  fiscalSales,
  gnsNetSummary,
  inStock,
  managerNetSummary,
  managerStockColumns,
  returnLines,
  saleLines,
  type CellKind,
  type Column,
  type ProductInfo,
} from "@/lib/report-export"

const FORMATS: Record<CellKind, string | undefined> = {
  text: undefined,
  datetime: "yyyy-mm-dd hh:mm",
  weight: "0.00",
  money: "#,##0.00",
  int: "0",
  percent: "0.0%",
}

type XlsxModule = typeof import("xlsx")

function buildSheet<Row>(XLSX: XlsxModule, columns: Column<Row>[], rows: Row[]) {
  const values = rows.map((row) =>
    columns.map((column) => {
      const raw = column.value(row)
      if (column.kind === "text") return String(raw ?? "")
      if (column.kind === "datetime") return typeof raw === "string" ? excelSerialBishkek(raw) : null
      return Number(raw) || 0
    }),
  )
  // SheetJS converts a whole matrix more efficiently than encoding and
  // assigning every cell separately on the main thread.
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...values])
  for (let c = 0; c < columns.length; c++) {
    const format = FORMATS[columns[c].kind]
    if (!format) continue
    for (let r = 0; r < rows.length; r++) {
      const address = XLSX.utils.encode_cell({ r: r + 1, c })
      const cell = sheet[address]
      if (cell && typeof cell.v === "number") cell.z = format
    }
  }
  sheet["!cols"] = columns.map((c) => ({ wch: c.width }))
  if (columns.length > 0) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: columns.length - 1 },
      }),
    }
  }
  return sheet
}

export type ExportInput = {
  sales: Sale[]
  productInfo: ProductInfo[]
  products: Product[]
  returns: SaleReturn[]
  /** null — «за всё время». */
  from: number | null
  to: number
}

/** Начинаем загружать библиотеку вместе с данными, а не после них. */
export function preloadXlsx() {
  return import("xlsx")
}

/** Файл для налоговой: фискальные чеки, возвраты по ним и остатки. */
export async function exportGnsReport(input: ExportInput) {
  const XLSX = await preloadXlsx()
  const info = new Map(input.productInfo.map((p) => [p.id, p]))
  for (const p of input.products) info.set(p.id, p)
  const lines = saleLines(fiscalSales(input.sales, input.from, input.to), info)
  const fiscalIds = new Set(input.sales.filter((sale) => sale.receipt_type === "fiscal").map((sale) => sale.id))
  const refunds = returnLines(input.returns.filter((refund) => fiscalIds.has(refund.sale_id)), input.sales, info)
  const stock = inStock(input.products)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, GNS_SALES_COLUMNS, lines), "Фискальные продажи")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, GNS_RETURN_COLUMNS, refunds), "Возвраты")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, GNS_STOCK_COLUMNS, stock), "Остатки на складе")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, SUMMARY_COLUMNS, gnsNetSummary(lines, refunds)), "Итоги")
  // Deflate is expensive on mobile and these workbooks are bounded; skip it
  // to make the "file ready" step noticeably faster.
  XLSX.writeFile(book, `GNS_Report_${fileDate()}.xlsx`, { compression: false })
  return { sales: lines.length, returns: refunds.length, stock: stock.length }
}

/** Управленческий файл: все чеки с возвратами, себестоимостью и складом. */
export async function exportManagerReport(input: ExportInput & { scrapPrices: Record<string, number> }) {
  const XLSX = await preloadXlsx()
  const info = new Map(input.productInfo.map((p) => [p.id, p]))
  for (const p of input.products) info.set(p.id, p)
  const lines = saleLines(allSales(input.sales, input.from, input.to), info)
  const refunds = returnLines(input.returns, input.sales, info)
  const stock = inStock(input.products)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, MANAGER_SALES_COLUMNS, lines), "Все продажи")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, RETURN_COLUMNS, refunds), "Возвраты")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, managerStockColumns(input.scrapPrices), stock), "Полный склад")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, SUMMARY_COLUMNS, managerNetSummary(lines, refunds)), "Итоги")
  XLSX.writeFile(book, `Manager_Report_${fileDate()}.xlsx`, { compression: false })
  return { sales: lines.length, returns: refunds.length, stock: stock.length }
}
