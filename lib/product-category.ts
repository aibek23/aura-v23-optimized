import { CATEGORIES } from "@/lib/types"

export type ProductCategory = (typeof CATEGORIES)[number]

const CATEGORY_MATCHERS: ReadonlyArray<[RegExp, ProductCategory]> = [
  [/(цеп|цепочк)/iu, "Цепи"],
  [/(кулон|подвес)/iu, "Подвески"],
  [/(кольц|перстен)/iu, "Кольца"],
  [/(серьг|сережк|серёжк)/iu, "Серьги"],
  [/браслет/iu, "Браслеты"],
  [/(?:^|[^\p{L}])(?:наручные\s+)?(?:часы|часов|часики)(?=$|[^\p{L}])/iu, "Часы"],
]

/** Infer a jewelry category from a product name. */
export function inferProductCategory(name: string): ProductCategory {
  const normalized = name.trim()
  if (!normalized) return "Прочее"

  for (const [matcher, category] of CATEGORY_MATCHERS) {
    if (matcher.test(normalized)) return category
  }

  return "Прочее"
}