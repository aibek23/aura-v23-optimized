import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import vm from "node:vm"

// Exercise the real TypeScript without Next/Supabase, a database or credentials.
// These tests require Node >=22.13 (or Node 24).
function loadSource(path, expression, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["']\s*;?$/gm, "")
    .replace(/^export default /gm, "")
    .replace(/^export /gm, "")
  const js = stripTypeScriptTypes(source, { mode: "strip" })
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    console: { error() {}, warn() {}, log() {} },
    process: { env: {} },
    ...mocks,
  })
  vm.runInContext(`${js}\nglobalThis.subject = ${expression}`, context)
  return context.subject
}

test("public QR routes bypass auth, but /stores and /crm remain protected", () => {
  const config = loadSource("proxy.ts", "config")
  const matcher = new RegExp(`^${config.matcher[0]}$`)
  for (const path of ["/q/12/AU001", "/store/shop", "/store/shop/product/AU001"]) {
    assert.equal(matcher.test(path), false, path)
  }
  for (const path of ["/stores", "/crm/pos", "/customers"]) {
    assert.equal(matcher.test(path), true, path)
  }
})

test("auth callback accepts local paths and rejects normalized external redirects", async () => {
  const GET = loadSource("app/auth/callback/route.ts", "GET", {
    createClient: async () => ({
      auth: { exchangeCodeForSession: async () => ({ error: null }) },
    }),
    NextResponse: { redirect: (url) => new URL(url).href },
  })
  for (const next of ["/\\evil.example", "//evil.example", "/\t/evil.example", "https://evil.example"]) {
    const nextUrl = new URL("https://aura.example/auth/callback")
    nextUrl.searchParams.set("code", "test-code")
    nextUrl.searchParams.set("next", next)
    assert.equal(await GET({ nextUrl }), "https://aura.example/", next)
  }
  const nextUrl = new URL("https://aura.example/auth/callback?code=test&next=%2Fcrm%2Fpos%3Ftab%3D1")
  assert.equal(await GET({ nextUrl }), "https://aura.example/crm/pos?tab=1")
})

function makeEngine(overrides = {}) {
  const events = { completed: [], failed: [], rpc: [], mutations: [] }
  const item = {
    id: "queue-1", client_op_id: "operation-1", shop_id: "shop-1",
    entity: "products", op_type: "product_add", payload: { id: "product-1" },
  }
  const engine = loadSource("lib/sync/sync-engine.ts", "syncEngine", {
    toast: { success() {}, error() {}, warning() {} },
    getDueOutboxItems: async () => [item],
    getOutboxPendingCount: async () => 0,
    getNextRetryDelayMs: async () => null,
    markOutboxSyncing: async () => {},
    markOutboxCompleted: async (id) => events.completed.push(id),
    markOutboxFailed: async (...args) => events.failed.push(args),
    updateSyncState() {},
    createSupabaseClient: () => ({}),
    setLocalSaleSyncState: async () => {},
    ...overrides,
  })
  engine.activeShopId = "shop-1"
  engine.isOnline = true
  return { engine, events, item }
}

test("unique constraints and HTTP 409 never silently discard queued writes", async () => {
  for (const error of [{ code: "23505" }, { status: 409 }]) {
    const { engine, events } = makeEngine()
    engine.pushItem = async () => { throw error }
    await engine.flushOutbox()
    assert.deepEqual(events.completed, [])
    assert.equal(events.failed.length, 1)
    assert.equal(events.failed[0][2].permanent, true)
  }
})

test("overlapping flush triggers send once and release the lock after failure", async () => {
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const { engine, events } = makeEngine()
  let sends = 0
  engine.pushItem = async () => { sends++; await wait }
  const first = engine.flushOutbox()
  await Promise.resolve()
  const second = engine.flushOutbox()
  release()
  await Promise.all([first, second])
  assert.equal(sends, 1)
  assert.deepEqual(events.completed, ["queue-1"])
  engine.flushOutboxBatch = async () => { throw new Error("IndexedDB failed") }
  await assert.rejects(engine.flushOutbox(), /IndexedDB failed/)
  assert.equal(engine.outboxFlushing, false)
})

function makeReturnEngine(rpcResult) {
  const mutations = []
  const stores = Object.fromEntries(["sale_returns", "cash_operations"].map((name) => [name, {
    index: () => ({ getAll: async () => [{ id: "local-cash", client_op_id: "operation-1:cash" }] }),
    delete: async (id) => mutations.push(["delete", name, id]),
    put: async (row) => mutations.push(["put", name, row.id]),
  }]))
  const { engine, item } = makeEngine({
    getLocalDB: async () => ({
      transaction: () => ({ objectStore: (name) => stores[name], done: Promise.resolve() }),
    }),
  })
  item.op_type = "atomic_return"
  item.payload = { id: "local-return", sale_id: "sale-1", item_index: 0, amount: 999999 }
  const calls = []
  const supabase = {
    rpc(name, args) {
      calls.push([name, args])
      return { abortSignal: async () => rpcResult }
    },
    from(name) {
      calls.push(["read", name])
      const builder = {
        select() { return this }, eq() { return this }, is() { return this },
        abortSignal() { return this },
        single: async () => ({ data: { id: "server-cash" }, error: null }),
        maybeSingle: async () => ({ data: rpcResult.existing ?? null, error: null }),
      }
      return builder
    },
  }
  return { engine, item, supabase, calls, mutations }
}

const confirmedReturn = {
  id: "server-return", shop_id: "shop-1", sale_id: "sale-1",
  item_index: 0, cash_operation_id: "server-cash", amount: 100,
}

test("offline return uses one atomic RPC and replaces optimistic money/return rows", async () => {
  const { engine, item, supabase, calls, mutations } = makeReturnEngine({ data: confirmedReturn, error: null })
  await engine.pushItem(supabase, item)
  assert.equal(calls[0][0], "return_sale_item")
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["_item_index", "_reason", "_sale_id"])
  assert.deepEqual(mutations, [
    ["delete", "cash_operations", "local-cash"],
    ["delete", "sale_returns", "local-return"],
    ["put", "sale_returns", "server-return"],
    ["put", "cash_operations", "server-cash"],
  ])
})

test("a failed atomic return makes no local or separate server writes", async () => {
  const error = { code: "08006", message: "network failure" }
  const { engine, item, supabase, calls, mutations } = makeReturnEngine({ data: null, error })
  await assert.rejects(engine.pushItem(supabase, item), (e) => e === error)
  assert.deepEqual(calls.map(([name]) => name), ["return_sale_item"])
  assert.deepEqual(mutations, [])
})

test("return replay requires an existing exact server row, not just a conflict", async () => {
  for (const existing of [confirmedReturn, null]) {
    const error = { code: "P0001", message: "already returned" }
    const { engine, item, supabase, mutations } = makeReturnEngine({ data: null, error, existing })
    if (existing) {
      await engine.pushItem(supabase, item)
      assert.equal(mutations.length, 4)
    } else {
      await assert.rejects(engine.pushItem(supabase, item), (e) => e === error)
      assert.deepEqual(mutations, [])
    }
  }
})
