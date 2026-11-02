import test from "node:test"
import assert from "node:assert/strict"
import {
  GNS_RETURN_COLUMNS,
  gnsNetSummary,
  managerNetSummary,
  returnLines,
  saleLines,
} from "../lib/report-export.ts"

const sale = {
  id: "12345678-aaaa-bbbb-cccc-123456789012",
  created_at: "2026-11-02T09:00:00.000Z",
  deleted_at: null,
  sync_status: "confirmed",
  receipt_type: "fiscal",
  seller_name: "Seller",
  customer_name: "Customer",
  payment_method: "cash",
  items: [
    {
      product_id: "product-1",
      sku: "AU-001",
      name: "Кольцо",
      metal: "Золото 585",
      weight: 3.2,
      quantity: 1,
      price: 12000,
      cost: 7000,
    },
  ],
  total: 12000,
  discount: 0,
  bonus_used: 0,
}

const refund = {
  id: "return-1",
  sale_id: sale.id,
  product_id: "product-1",
  item_index: 0,
  item_name: "Кольцо",
  item_metal: "Золото 585",
  item_weight: 3.2,
  amount: 12000,
  cost: 7000,
  reason: "Размер не подошёл",
  author_name: "Admin",
  created_at: "2026-11-02T10:00:00.000Z",
  deleted_at: null,
}

test("return lines include receipt, item details and returned amounts", () => {
  const lines = returnLines([refund], [sale], new Map())
  assert.equal(lines.length, 1)
  assert.equal(lines[0].receiptNo, "12345678")
  assert.equal(lines[0].sku, "AU-001")
  assert.equal(lines[0].name, "Кольцо")
  assert.equal(lines[0].amount, 12000)
  assert.equal(lines[0].cost, 7000)
})

test("returns subtract refund and returned cost from managerial net totals", () => {
  const lines = saleLines([sale], new Map([["product-1", { id: "product-1", category: "Кольца", metal: "Золото 585" }]]))
  const refunds = returnLines([refund], [sale], new Map())
  assert.deepEqual(managerNetSummary(lines, refunds).map((row) => row.value), [
    12000, 12000, 0, 7000, 7000, 0, 0,
  ])
})

test("tax summary deducts fiscal refunds from revenue", () => {
  const lines = saleLines([sale], new Map())
  const refunds = returnLines([refund], [sale], new Map())
  assert.deepEqual(gnsNetSummary(lines, refunds).map((row) => row.value), [12000, 12000, 0])
  assert.equal(GNS_RETURN_COLUMNS.some((column) => column.header.includes("себестоимость")), false)
})

test("deleted returns are excluded", () => {
  const lines = returnLines([{ ...refund, deleted_at: "2026-11-02T12:00:00.000Z" }], [sale], new Map())
  assert.deepEqual(lines, [])
})
