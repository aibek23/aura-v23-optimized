// ---------------------------------------------------------------------------
// Текстовые данные изделия
// ---------------------------------------------------------------------------
import type { Product } from "@/lib/types"

export function buildJewelryText(data: Product) {
  const rawMetal  = data.metal ? String(data.metal).trim() : ""
  const metalLine = rawMetal.replace(/^металл\s*:?\s*/i, "").trim() || "—"
  const weightLine = data.weight || "—"
  const sizeLine   = data.size   || "—"
  const priceLine  = data.sale_price
    ? `${data.sale_price.toLocaleString("ru")}`
    : "—"
  return { metalLine, weightLine, sizeLine, priceLine }
}
