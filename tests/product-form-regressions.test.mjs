import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import vm from "node:vm"

const metalSource = readFileSync(new URL("../lib/metal.ts", import.meta.url), "utf8")
  .replace(/^export \{[^\n]*\}\s+from\s+["'][^"']+["'];?$/gm, "")
  .replace(/^export\s+/gm, "")
const metalContext = vm.createContext({})
vm.runInContext(
  `${stripTypeScriptTypes(metalSource, { mode: "strip" })}\nglobalThis.getMetalSelectionDefaults = getMetalSelectionDefaults`,
  metalContext,
)

test("choosing silver defaults to silver color and 925 purity", () => {
  const result = metalContext.getMetalSelectionDefaults(
    "Серебро", "Золото", "585", "Жёлтое золото",
  )
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    purity: "925",
    metalColor: "Серебро",
  })
})

test("changing only purity on silver preserves the selected purity and color", () => {
  const result = metalContext.getMetalSelectionDefaults(
    "Серебро", "Серебро", "999", "Серебро",
  )
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    purity: "999",
    metalColor: "Серебро",
  })
})

test("leaving silver resets its default purity and color for gold", () => {
  const result = metalContext.getMetalSelectionDefaults(
    "Золото", "Серебро", "925", "Серебро",
  )
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    purity: "585",
    metalColor: "Жёлтое золото",
  })
})

test("product form offers cancel, add-and-print, and numeric size entry without a print prompt", () => {
  const dialog = readFileSync(new URL(
    "../components/screens/sklad/add-edit-Product/product-dialog.tsx",
    import.meta.url,
  ), "utf8")
  const generalInfo = readFileSync(new URL(
    "../components/screens/sklad/add-edit-Product/product-general-info.tsx",
    import.meta.url,
  ), "utf8")
  const metalPicker = readFileSync(new URL("../components/metal-picker.tsx", import.meta.url), "utf8")

  assert.match(dialog, /onClick=\{\(\) => void submit\(true\)\}/)
  assert.match(dialog, /"Добавить и распечатать"/)
  assert.match(dialog, /<Button type="button" variant="outline" disabled=\{saving\} onClick=\{cancel\}>/)
  assert.match(dialog, /id="p-size"[\s\S]*?type="number"[\s\S]*?inputMode="decimal"/)
  assert.doesNotMatch(dialog, /printConfirmOpen|Хотите распечатать этикетку сейчас/)
  assert.match(generalInfo, /setField\("metal_color", defaults\.metalColor\)/)
  assert.match(metalPicker, /getMetalSelectionDefaults\(b, base, purity, ""\)/)
})
