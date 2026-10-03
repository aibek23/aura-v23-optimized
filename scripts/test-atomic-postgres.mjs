// ONLY for a newly created, disposable PostgreSQL database called aura_atomic_test.
// PGHOST/PGPORT/PGUSER select the local test server. Never use production credentials.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import assert from "node:assert/strict"
if (process.env.PGDATABASE !== "aura_atomic_test") throw new Error("Use a fresh disposable PGDATABASE=aura_atomic_test only")
const root = new URL("../", import.meta.url)
function psql(args) {
  return new Promise((resolve) => {
    const proc = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...args], { env: process.env })
    let output = "", error = ""
    proc.stdout.on("data", (d) => { output += d })
    proc.stderr.on("data", (d) => { error += d })
    proc.on("close", (code) => resolve({ code, output, error }))
  })
}
async function query(sql) {
  const result = await psql(["-c", sql])
  assert.equal(result.code, 0, result.error)
  return result.output.trim()
}
for (const path of ["tests/atomic-fixture.sql", "supabase/v36_atomic_offline_sales.sql", "supabase/v45_atomic_cash_operations.sql", "tests/atomic-transactions.sql"]) {
  const result = await psql(["-f", fileURLToPath(new URL(path, root))])
  assert.equal(result.code, 0, `${path}: ${result.error}`)
}
console.log("PASS: sequential PostgreSQL integration tests (ledger, retries, permissions, rollback, impersonation)")
const shop = "11111111-1111-4111-8111-111111111111"
const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const auth = `SET ROLE authenticated; SET request.jwt.claim.sub='${uid}';`
const cash = (key, amount = 80) => `SELECT public.create_cash_operation_atomic('${key}', 'outcome', ${amount}, 'cash', 0, 0, 'Расход');`
async function reset() {
  await query(`TRUNCATE public.sales, public.cash_operations, public.supplier_debt_operations, public.customers, public.cash_reason_presets;
    UPDATE public.products SET status='in_stock'; UPDATE public.profiles SET bonus_points=0;
    INSERT INTO public.cash_operations(shop_id,created_by,type,amount,reason,source,amount_cash,amount_electronic)
    VALUES ('${shop}','${uid}','income',100,'Start','cash',100,0);`)
}
async function race(first, second) {
  const a = psql(["-c", `${auth} BEGIN; ${first} SELECT pg_sleep(1); COMMIT;`])
  await new Promise((r) => setTimeout(r, 150))
  const b = psql(["-c", `${auth} ${second}`])
  return Promise.all([a, b])
}
await reset()
let results = await race(cash(randomUUID()), cash(randomUUID()))
assert.equal(results.filter((r) => r.code === 0).length, 1)
assert.match(results.find((r) => r.code !== 0).error, /Недостаточно наличных/)
assert.equal(await query(`SELECT cash FROM public.cash_ledger_balances('${shop}')`), "20.00")
console.log("PASS: concurrent withdrawals cannot both spend the same 100")
await reset()
const duplicateKey = randomUUID()
results = await race(cash(duplicateKey), cash(duplicateKey))
assert.ok(results.every((r) => r.code === 0), JSON.stringify(results))
assert.equal(await query(`SELECT count(*) FROM public.cash_operations WHERE client_op_id='${duplicateKey}'`), "1")
assert.equal(await query(`SELECT cash FROM public.cash_ledger_balances('${shop}')`), "20.00")
console.log("PASS: concurrent duplicate cash requests insert once")
for (const supplierFirst of [false, true]) {
  await reset()
  await query(`INSERT INTO public.supplier_debt_operations(shop_id,supplier_name,operation_type,amount)
    VALUES ('${shop}','Supplier','consignment',100);`)
  const payout = "SELECT (public.pay_supplier_debt('Supplier',NULL,80,'cash',80,0,'Supplier payment',NULL)).id;"
  const withdrawal = cash(randomUUID())
  results = await race(supplierFirst ? payout : withdrawal, supplierFirst ? withdrawal : payout)
  assert.equal(results.filter((r) => r.code === 0).length, 1, JSON.stringify(results))
  assert.equal(await query(`SELECT cash FROM public.cash_ledger_balances('${shop}')`), "20.00")
}
console.log("PASS: supplier payout and withdrawal share the same shop lock (both orders)")
await reset()
const sale = (key) => `SELECT public.commit_offline_sale('${key}','{"items":[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1,"price":100}]}');`
results = await race(sale(randomUUID()), sale(randomUUID()))
assert.ok(results.every((r) => r.code === 0), JSON.stringify(results))
assert.equal(results.filter((r) => r.output.includes('"accepted": true')).length, 1)
assert.equal(results.filter((r) => r.output.includes('"accepted": false')).length, 1)
assert.equal(await query("SELECT count(*) FROM public.sales"), "1")
console.log("PASS: concurrent sales of a unique product produce exactly one receipt")