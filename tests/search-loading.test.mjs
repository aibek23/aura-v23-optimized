import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import vm from "node:vm"

function load(path, expression, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["']\s*;?$/gm, "")
    .replace(/^export /gm, "")
  const context = vm.createContext({ console, Date, Map, Set, ...mocks })
  vm.runInContext(`${stripTypeScriptTypes(source, { mode: "strip" })}\nglobalThis.subject = ${expression}`, context)
  return context.subject
}

const productSearch = load("lib/product-search.ts", "({ parseProductSearchQuery })")
const saleSearch = load("lib/sale-search.ts", "({ flattenSaleUnits, matchesSaleUnit })", productSearch)

function makeActions({ salesPages, products = [], refunds = [], productError = null }) {
  const calls = []
  const supabase = {
    from(table) {
      const call = { table, steps: [] }
      calls.push(call)
      const builder = {
        then(resolve, reject) {
          let data = []
          let error = null
          if (table === "sales") data = salesPages.shift() ?? []
          if (table === "products") {
            data = products
            error = productError
          }
          if (table === "sale_returns") data = refunds
          return Promise.resolve({ data: structuredClone(data), error }).then(resolve, reject)
        },
      }
      for (const method of ["select", "eq", "ilike", "in", "is", "order", "limit", "range", "or"]) {
        builder[method] = (...args) => { call.steps.push([method, ...args]); return builder }
      }
      return builder
    },
  }
  const actions = load("app/actions/sales.ts", "({ getSalesPage })", {
    ...productSearch, ...saleSearch,
    getRequestCrmContext: async () => ({
      supabase, user: { id: "user-1" },
      profile: { status: "approved", role: "admin" }, shopId: "shop-1",
    }),
  })
  return { ...actions, calls }
}

function receipt(id, item, createdAt = "2020-01-01T12:00:00.000Z") {
  return { id, shop_id: "shop-1", created_at: createdAt, items: [item] }
}
const item = { product_id: null, name: "Кольцо", sku: "AU00042", weight: 1.25, price: 12000 }

test("old sold article is read server-side and legacy item.id gets its missing SKU", async () => {
  const old = receipt("old-sale", { ...item, sku: undefined, id: "sold-product" })
  const refund = { id: "refund-old", sale_id: old.id, item_index: 0 }
  const { getSalesPage, calls } = makeActions({
    salesPages: [[old]], products: [{ id: "sold-product", sku: "AU00042" }], refunds: [refund],
  })
  const page = await getSalesPage({ query: "au00042" })
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].items[0].sku, "AU00042")
  assert.equal(page.returns[0].id, "refund-old")
  assert.equal(page.nextCursor, null)
  const saleCall = calls.find((call) => call.table === "sales")
  const expression = saleCall.steps.find(([method]) => method === "or")[1]
  assert.match(expression, /"product_id":"sold-product"/)
  assert.match(expression, /"id":"sold-product"/)
  assert.match(expression, /"sku":"AU00042"/)
  assert.ok(saleCall.steps.some((step) => JSON.stringify(step) === '["eq","shop_id","shop-1"]'))
  assert.ok(saleCall.steps.some((step) => JSON.stringify(step) === '["is","deleted_at",null]'))
  assert.ok(!calls.filter((call) => call.table === "products").some(
    (call) => call.steps.some(([method, column]) => method === "eq" && column === "status"),
  ), "sold products must not be excluded by an in_stock filter")
})

test("prefix search continues beyond the first 500 receipts instead of false not-found", async () => {
  const recent = Array.from({ length: 500 }, (_, i) => receipt(`recent-${i}`, { ...item, sku: "OTHER" }))
  const old = receipt("archive-match", { ...item, sku: "XY99999" })
  const { getSalesPage } = makeActions({ salesPages: [[...recent, old], [old]] })
  const first = await getSalesPage({ query: "xy9" })
  assert.equal(first.items.length, 0)
  assert.equal(first.nextCursor.id, "recent-499")
  const second = await getSalesPage({ query: "xy9", cursor: first.nextCursor })
  assert.equal(second.items[0].id, "archive-match")
  assert.equal(second.nextCursor, null)
})

test("search pagination resumes after the last displayed match, not the end of the scan", async () => {
  const candidates = Array.from({ length: 501 }, (_, i) => receipt(`sale-${i}`, item))
  const { getSalesPage } = makeActions({ salesPages: [candidates] })
  const page = await getSalesPage({ query: "кольцо", limit: 2 })
  assert.equal(page.items.length, 2)
  assert.equal(page.nextCursor.id, "sale-1")
})

test("search uses the same weight/price predicates as the browser", async () => {
  for (const query of ["1,25 г", "12000 с"]) {
    const { getSalesPage, calls } = makeActions({ salesPages: [[receipt("match", item)]] })
    const page = await getSalesPage({ query })
    assert.equal(page.items[0].id, "match")
    assert.equal(calls.some((call) => call.steps.some(([method]) => method === "ilike")), false)
  }
})

test("SKU lookup failure is reported, not silently shown as an empty archive", async () => {
  const { getSalesPage } = makeActions({
    salesPages: [], productError: { message: "database unavailable" },
  })
  await assert.rejects(getSalesPage({ query: "AU00042" }), /database unavailable/)
})

test("receipt SKU remains authoritative if the catalog's article later changes", () => {
  const units = saleSearch.flattenSaleUnits(
    [receipt("old", { ...item, product_id: "product-1" })],
    [{ id: "product-1", sku: "NEW-ARTICLE" }],
  )
  assert.equal(units[0].sku, "AU00042")
})

// Run the actual supplier-loading effect through a small dependency/cleanup
// harness. This reproduces the old self-cancellation on setLoading(true).
function supplierHarness() {
  const dashboard = readFileSync(new URL("../components/dashboard.tsx", import.meta.url), "utf8")
  const start = dashboard.indexOf('  // This ledger can contain')
  const end = dashboard.indexOf('  // Local-first data', start)
  const effect = dashboard.slice(start, end)
  let previous = null
  let cleanup
  let scheduled = false
  const requests = []
  const context = vm.createContext({
    activeScreen: "suppliers", isAdmin: true,
    supplierDebtLoaded: false, supplierDebtLoading: false, supplierDebtLoadError: null,
    supplierDebtData: null,
    getSupplierDebtData: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  })
  function render() {
    scheduled = false
    let next
    context.useEffect = (fn, deps) => { next = { fn, deps } }
    vm.runInContext(effect, context)
    if (!previous || next.deps.some((value, index) => !Object.is(value, previous[index]))) {
      cleanup?.()
      previous = [...next.deps]
      cleanup = next.fn()
    }
  }
  function set(key, value) {
    context[key] = value
    if (!scheduled) { scheduled = true; queueMicrotask(render) }
  }
  for (const name of ["Loaded", "Loading", "LoadError", "Data"]) {
    context[`setSupplierDebt${name}`] = (value) => set(`supplierDebt${name}`, value)
  }
  render()
  return { context, requests, set, render }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test("Suppliers finishes loading after loading-state rerender", async () => {
  const h = supplierHarness()
  await settle()
  assert.equal(h.context.supplierDebtLoading, true)
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve({ operations: [], suppliers: [{ supplier_name: "Supplier" }] })
  await settle()
  assert.equal(h.context.supplierDebtLoaded, true)
  assert.equal(h.context.supplierDebtLoading, false)
  assert.equal(h.context.supplierDebtData.suppliers.length, 1)
})

test("Suppliers ignores late responses after navigation and can load on return", async () => {
  const h = supplierHarness()
  await settle()
  h.set("activeScreen", "pos")
  await settle()
  h.requests[0].resolve({ suppliers: [{ supplier_name: "stale" }] })
  await settle()
  assert.equal(h.context.supplierDebtLoaded, false)
  h.set("activeScreen", "suppliers")
  await settle()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve({ suppliers: [{ supplier_name: "fresh" }] })
  await settle()
  assert.equal(h.context.supplierDebtData.suppliers[0].supplier_name, "fresh")
  assert.equal(h.context.supplierDebtLoading, false)
})

test("Suppliers stops spinning on error and supports retry", async () => {
  const h = supplierHarness()
  await settle()
  h.requests[0].reject(new Error("offline"))
  await settle()
  assert.equal(h.context.supplierDebtLoading, false)
  assert.ok(h.context.supplierDebtLoadError)
  h.set("supplierDebtLoadError", null)
  await settle()
  h.requests[1].resolve({ operations: [], suppliers: [], profiles: [] })
  await settle()
  assert.equal(h.context.supplierDebtLoaded, true)
})

test("POS history has one shared searchable input with QR instead of a second modal", () => {
  const source = readFileSync(new URL("../components/sales-history/index.tsx", import.meta.url), "utf8")
  assert.equal((source.match(/<ProductSearch\b/g) ?? []).length, 1)
  assert.equal(source.includes("ReturnSearchModal"), false)
  assert.match(source, /query: debouncedQuery/)
})

test("supplier inventory links target/highlight a specific item instead of printing/editing/deleting it inline", () => {
  const products = readFileSync(new URL("../components/screens/suppliers/supplier-payout/supplier-products.tsx", import.meta.url), "utf8")
  const warehouse = readFileSync(new URL("../components/screens/sklad/index.tsx", import.meta.url), "utf8")
  assert.match(products, /Link2/)
  assert.match(products, /onOpenProduct\(p\)/)
  assert.doesNotMatch(products, /Printer|Pencil|Trash2|deleteProduct/)
  assert.match(warehouse, /focusProduct/)
  assert.match(warehouse, /setFocusedSupplierProductId\(product\.id\)/)
  assert.match(warehouse, /scrollIntoView/)
  assert.match(warehouse, /data-inventory-product-id/)
})

test("supplier photo and deletion actions are scoped to admin-owned shop paths", () => {
  const actions = readFileSync(new URL("../app/actions/suppliers.ts", import.meta.url), "utf8")
  const migration = readFileSync(new URL("../supabase/migrations/010_supplier_profiles.sql", import.meta.url), "utf8")
  const card = readFileSync(new URL("../components/screens/suppliers/supplier-payout/supplier-card.tsx", import.meta.url), "utf8")
  assert.match(actions, /requireAdmin\(\)/)
  assert.match(actions, /supplier-profiles\//)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /IF v_balance > 0 THEN/)
  assert.match(migration, /product-images/)
  assert.match(card, /Удалить поставщика\?/)
  assert.match(card, /disabled=\{hasDebt\}/)
  assert.match(card, /deleteSupplierProfile/)
})

function supplierActionHarness({ role = "admin", rpcError = null } = {}) {
  const calls = []
  const shopId = "shop-1"
  const supabase = {
    from(table) {
      const call = { table, steps: [] }
      calls.push(call)
      const query = {
        upsert(value, options) { call.steps.push(["upsert", value, options]); return query },
        update(value) { call.steps.push(["update", value]); return query },
        select(value) { call.steps.push(["select", value]); return query },
        single: async () => ({ data: {
          supplier_name: "Золотой дом", supplier_phone: null,
          photo_path: "shop-1/supplier-profiles/one.webp", deleted_at: null,
        }, error: null }),
        eq(column, value) { call.steps.push(["eq", column, value]); return query },
        then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject) },
      }
      return query
    },
    rpc: async (name, args) => {
      calls.push({ table: "rpc", name, args })
      return rpcError
        ? { data: null, error: rpcError }
        : { data: `${shopId}/supplier-profiles/one.webp`, error: null }
    },
    storage: {
      from(bucket) {
        return { remove: async (paths) => {
          calls.push({ table: "storage", bucket, paths })
          return { data: paths, error: null }
        } }
      },
    },
  }
  const actions = load("app/actions/suppliers.ts", "({ saveSupplierProfilePhoto, deleteSupplierProfile })", {
    supabase,
    requireShopContext: async () => ({
      supabase, shopId, profile: { role }, user: { id: "user-1" },
    }),
    isAdminRole: (value) => value === "admin" || value === "super_admin",
    FORBIDDEN_MESSAGE: "Недостаточно прав",
    revalidatePath: () => {},
    headers: async () => ({ get: () => null }),
    supplierIdentityKey: (name, phone) => `${name.trim().toLowerCase()}\u0000${phone?.trim() ?? ""}`,
  })
  return { ...actions, calls }
}

test("supplier photo save writes a shop-scoped identity and cannot accept another shop's path", async () => {
  const h = supplierActionHarness()
  const saved = await h.saveSupplierProfilePhoto({
    supplierName: "Золотой дом", supplierPhone: null,
    photoPath: "shop-1/supplier-profiles/photo.webp",
  })
  assert.equal(saved.photo_path, "shop-1/supplier-profiles/one.webp")
  const upsert = h.calls.find((call) => call.table === "supplier_profiles").steps[0][1]
  assert.equal(upsert.shop_id, "shop-1")
  assert.equal(upsert.identity_key, "золотой дом\u001f")
  assert.equal(upsert.deleted_at, null)

  await assert.rejects(h.saveSupplierProfilePhoto({
    supplierName: "Золотой дом", photoPath: "other-shop/supplier-profiles/photo.webp",
  }), /текущего магазина/)
  assert.equal(h.calls.filter((call) => call.table === "supplier_profiles").length, 1)
})

test("supplier delete removes only its shop photo after the debt-check RPC", async () => {
  const h = supplierActionHarness()
  const result = await h.deleteSupplierProfile({ supplierName: "Золотой дом", supplierPhone: null })
  assert.equal(result.photo_path, null)
  const rpcIndex = h.calls.findIndex((call) => call.table === "rpc")
  const storageIndex = h.calls.findIndex((call) => call.table === "storage")
  assert.ok(rpcIndex >= 0 && storageIndex > rpcIndex)
  assert.equal(JSON.stringify(h.calls[storageIndex].paths), '["shop-1/supplier-profiles/one.webp"]')
  assert.ok(h.calls.find((call) => call.table === "supplier_profiles").steps.some(
    (step) => step[0] === "eq" && step[1] === "shop_id" && step[2] === "shop-1",
  ))
})

test("supplier delete stops before removing a photo when the atomic debt check rejects it", async () => {
  const h = supplierActionHarness({ rpcError: { message: "Нельзя удалить: есть долг" } })
  await assert.rejects(
    h.deleteSupplierProfile({ supplierName: "Золотой дом" }),
    /есть долг/,
  )
  assert.equal(h.calls.some((call) => call.table === "storage"), false)
  assert.equal(h.calls.some((call) => call.table === "supplier_profiles"), false)
})

test("supplier photos and deletion are admin-only", async () => {
  const h = supplierActionHarness({ role: "seller" })
  await assert.rejects(
    h.saveSupplierProfilePhoto({
      supplierName: "Золотой дом",
      photoPath: "shop-1/supplier-profiles/photo.webp",
    }),
    /Недостаточно прав/,
  )
  assert.equal(h.calls.length, 0)
})
