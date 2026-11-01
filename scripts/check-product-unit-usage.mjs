import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const migration = readFileSync(join(root, "supabase/migrations/20261025_product_unit_usage.sql"), "utf8")
const usageAction = readFileSync(join(root, "app/actions/product-units.ts"), "utf8")
const stockStats = readFileSync(join(root, "components/screens/sklad/sklad-stats.tsx"), "utf8")
const cabinetScreen = readFileSync(join(root, "components/screens/kabinet/index.tsx"), "utf8")

const checks = [
  [
    "existing catalog is grandfathered and only successful new inserts add a unit",
    () => {
      assert.match(migration, /CREATE TRIGGER products_record_new_unit\s+AFTER INSERT ON public\.products/)
      assert.match(migration, /ON CONFLICT \(product_id\) DO NOTHING/)
      assert.doesNotMatch(migration, /INSERT INTO public\.product_unit_usage\s+SELECT/i)
      assert.doesNotMatch(migration, /CREATE TRIGGER products_record_new_unit\s+AFTER UPDATE/i)
    },
  ],
  [
    "usage records remain append-only when a product is sold, changed, or deleted",
    () => {
      assert.doesNotMatch(migration, /DELETE FROM public\.product_unit_usage/)
      assert.doesNotMatch(migration, /CREATE TRIGGER [\s\S]*?AFTER DELETE ON public\.products/)
      assert.doesNotMatch(migration, /CREATE TRIGGER [\s\S]*?AFTER UPDATE ON public\.products/)
    },
  ],
  [
    "shops have read-only tenant-scoped access and only superadmins can see all shops",
    () => {
      assert.match(migration, /REVOKE ALL ON TABLE public\.product_unit_usage FROM PUBLIC, anon, authenticated/)
      assert.match(migration, /GRANT SELECT ON TABLE public\.product_unit_usage TO authenticated/)
      assert.match(migration, /shop_id = public\.current_shop_id\(\)\s+AND public\.is_approved\(\)/)
      assert.match(migration, /IF NOT public\.is_super_admin\(\) THEN/)
    },
  ],
  [
    "the meter is shown in the cabinet, not the stock screen, and never blocks product creation",
    () => {
      assert.match(usageAction, /\.select\("product_id", \{ count: "exact", head: true \}\)/)
      assert.doesNotMatch(usageAction, /\.insert\(|\.update\(|\.delete\(/)
      assert.match(cabinetScreen, /getProductUnitUsageCount/)
      assert.match(cabinetScreen, /Новые карточки товаров/)
      assert.match(cabinetScreen, /добавление товаров не блокируется/i)
      assert.doesNotMatch(stockStats, /getProductUnitUsageCount|Новые карточки после запуска счётчика/)
    },
  ],
]

for (const [name, check] of checks) {
  check()
  console.log(`✓ ${name}`)
}
console.log(`${checks.length} product-unit meter checks passed.`)
