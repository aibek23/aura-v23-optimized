"use client"

/**
 * Генерация .xlsx в браузере через SheetJS (XLSX.utils.book_new + XLSX.writeFile).
 * Библиотека подгружается динамически — только когда пользователь нажал кнопку.
 */
import type { Product, Sale } from "@/lib/types"
import {
  GNS_SALES_COLUMNS,
  GNS_STOCK_COLUMNS,
  MANAGER_SALES_COLUMNS,
  allSales,
  excelSerialBishkek,
  fileDate,
  fiscalSales,
  inStock,
  managerStockColumns,
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
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header)])
  rows.forEach((row, r) => {
    columns.forEach((column, c) => {
      const raw = column.value(row)
      const address = XLSX.utils.encode_cell({ r: r + 1, c })
      const z = FORMATS[column.kind]
      if (column.kind === "text") {
        sheet[address] = { t: "s", v: String(raw ?? "") }
      } else if (column.kind === "datetime") {
        const serial = typeof raw === "string" ? excelSerialBishkek(raw) : null
        sheet[address] = serial === null ? { t: "s", v: "" } : { t: "n", v: serial, z }
      } else {
        sheet[address] = { t: "n", v: Number(raw) || 0, z }
      }
    })
  })
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: columns.length - 1 } })
  sheet["!cols"] = columns.map((c) => ({ wch: c.width }))
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: columns.length - 1 } }) }
  return sheet
}

export type ExportInput = {
  sales: Sale[]
  productInfo: ProductInfo[]
  products: Product[]
  /** null — «за всё время». */
  from: number | null
  to: number
}

/** Файл для налоговой: только фискальные чеки и остатки по рознице. */
export async function exportGnsReport(input: ExportInput) {
  const XLSX = await import("xlsx")
  const info = new Map(input.productInfo.map((p) => [p.id, p]))
  for (const p of input.products) info.set(p.id, p)
  const lines = saleLines(fiscalSales(input.sales, input.from, input.to), info)
  const stock = inStock(input.products)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, GNS_SALES_COLUMNS, lines), "Фискальные продажи")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, GNS_STOCK_COLUMNS, stock), "Остатки на складе")
  XLSX.writeFile(book, `GNS_Report_${fileDate()}.xlsx`, { compression: true })
  return { sales: lines.length, stock: stock.length }
}

/** Управленческий файл: все чеки с себестоимостью и полный склад. */
export async function exportManagerReport(input: ExportInput & { scrapPrices: Record<string, number> }) {
  const XLSX = await import("xlsx")
  const info = new Map(input.productInfo.map((p) => [p.id, p]))
  for (const p of input.products) info.set(p.id, p)
  const lines = saleLines(allSales(input.sales, input.from, input.to), info)
  const stock = inStock(input.products)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, MANAGER_SALES_COLUMNS, lines), "Все продажи")
  XLSX.utils.book_append_sheet(book, buildSheet(XLSX, managerStockColumns(input.scrapPrices), stock), "Полный склад")
  XLSX.writeFile(book, `Manager_Report_${fileDate()}.xlsx`, { compression: true })
  return { sales: lines.length, stock: stock.length }
}
