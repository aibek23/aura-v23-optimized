// Run: node --test scripts/test-atomic-actions.mjs (after installing dependencies).
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"

const root = new URL("../", import.meta.url)
function load(path, mocks = {}) {
  const source = readFileSync(new URL(path, root), "utf8")
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true, fileName: path,
  })
  assert.equal(diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0)
  const exports = {}
  new Function("require", "exports", outputText)((id) => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`)
    return mocks[id]
  }, exports)
  return exports
}
const operations = load("lib/client-operation.ts", {
  "@/lib/local-db/id": load("lib/local-db/id.ts"),
})
const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const product = { product_id: key, kind: "product", quantity: 1, name: "Кольцо", weight: 1, metal: "Золото", price: 100, cost: 40 }
const saleInput = { items: [product], payment_method: "cash", discount: 0, bonus_used: 0, customer_name: "", customer_phone: "", client_op_id: key }
function actions({ rpc, receipt = { id: key, total: 100, bonus_earned: 1, profit: 60 }, readError = null, role = "admin" } = {}) {
  const calls = []
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      return rpc ? rpc(name, args) : { data: { accepted: true, duplicate: false, sale_id: key, operation_id: key }, error: null }
    },
    from: (table) => {
      // Any products lookup, manual INSERT, statistics update or ledger fetch fails.
      assert.equal(table, "sales")
      const query = {
        select: () => query, eq: () => query,
        single: async () => ({ data: receipt, error: readError }),
      }
      return query
    },
  }
  const mocks = {
    "next/cache": { revalidatePath: () => calls.push({ revalidate: true }) },
    "@/lib/rates": { DEFAULT_RATES: {} },
    "@/lib/client-operation": operations,
    "@/lib/supabase/request-context": {
      getRequestCrmContext: async () => ({
        supabase, user: { id: key }, profile: { status: "approved", role }, shopId: key,
      }),
    },
  }
  return { sales: load("app/actions/sales.ts", mocks), cash: load("app/actions/cash.ts", mocks), calls }
}

test("UUID is generated once; unchanged payload keeps it on retries", () => {
  const first = operations.getClientOperationAttempt(null, { amount: 10 })
  assert.match(first.clientOpId, /^[0-9a-f-]{36}$/)
  assert.equal(operations.getClientOperationAttempt(first, { amount: 10 }), first)
  assert.notEqual(operations.getClientOperationAttempt(first, { amount: 20 }).clientOpId, first.clientOpId)
  assert.throws(() => operations.resolveClientOperationId("invalid"))
})
test("checkout delegates ALL writes and bonus/statistics changes to one RPC", async () => {
  const { sales, calls } = actions()
  const result = await sales.checkout(saleInput)
  assert.equal(result.total, 100)
  assert.equal(result.clientOpId, key)
  assert.equal(calls.filter((c) => c.name).length, 1)
  assert.equal(calls[0].name, "commit_offline_sale")
  assert.equal(calls[0].args._client_op_id, key)
})
test("duplicate receipt uses committed totals, not the retried price", async () => {
  const { sales } = actions({ rpc: () => ({ data: { accepted: true, duplicate: true, sale_id: key } }) })
  const result = await sales.checkout({ ...saleInput, items: [{ ...product, price: 200 }] })
  assert.equal(result.duplicate, true)
  assert.equal(result.total, 100)
})
test("stock conflict is a readable failure, with no rollback RPC or other writes", async () => {
  const { sales, calls } = actions({ rpc: () => ({ data: { accepted: false, product_name: "Кольцо" } }) })
  await assert.rejects(sales.checkout(saleInput), /Конфликт остатков.*Кольцо/)
  assert.equal(calls.length, 1)
})
test("lost receipt read can be retried with the SAME key", async () => {
  const committed = new Set()
  let writes = 0
  const rpc = (_, args) => {
    const duplicate = committed.has(args._client_op_id)
    if (!duplicate) { writes++; committed.add(args._client_op_id) }
    return { data: { accepted: true, duplicate, sale_id: key } }
  }
  await assert.rejects(actions({ rpc, readError: { message: "timeout" } }).sales.checkout(saleInput), /Продажа проведена/)
  const result = await actions({ rpc }).sales.checkout(saleInput)
  assert.equal(result.duplicate, true)
  assert.equal(writes, 1)
})
test("cash uses RPC without reading tables or manually saving a preset", async () => {
  const { cash, calls } = actions()
  const result = await cash.createCashOperation({
    type: "outcome", amount: 10.25, reason: "Оплата", client_op_id: key, savePreset: true,
  })
  assert.equal(result.ok, true)
  assert.equal(calls[0].name, "create_cash_operation_atomic")
  assert.equal(calls[0].args._client_op_id, key)
  assert.equal(calls[0].args._save_preset, true)
  assert.equal(calls[0].args._amount_cash, 10.25)
})
test("cash duplicate returns success and preserves its key", async () => {
  const { cash } = actions({ rpc: () => ({ data: { accepted: true, duplicate: true, operation_id: key } }) })
  assert.equal((await cash.createCashOperation({ type: "income", amount: 1, reason: "Внесение", client_op_id: key })).duplicate, true)
})
test("insufficient cash from SQL is shown to the user; no revalidation on error", async () => {
  const { cash, calls } = actions({ rpc: () => ({ error: { message: "Недостаточно наличных: доступно 5 с" } }) })
  await assert.rejects(cash.createCashOperation({ type: "outcome", amount: 10, reason: "Оплата", client_op_id: key }), /Недостаточно наличных/)
  assert.equal(calls.length, 1)
})
test("cash rejects non-finite and mismatched mixed amounts before sending", async () => {
  const { cash, calls } = actions()
  for (const amount_cash of [Infinity, NaN, 9]) {
    await assert.rejects(cash.createCashOperation({
      type: "outcome", amount: 10, source: "mixed", amount_cash, amount_electronic: 0, reason: "Оплата",
    }))
  }
  assert.equal(calls.length, 0)
})
test("changed TS/TSX files have no syntax diagnostics", () => {
  for (const path of [
    "components/screens/kassa/index.tsx",
    "components/screens/kassa/cash-operation-dialog.tsx",
    "components/screens/kassa/kassa-scrap.tsx",
    "lib/sync/sync-engine.ts",
  ]) {
    const result = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: fileURLToPath(new URL(path, root)), reportDiagnostics: true,
    })
    assert.deepEqual(result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error), [], path)
  }
})