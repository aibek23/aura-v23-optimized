"use client"

/**
 * Двухуровневый выбор металла: состояние изделия («Новое» / «Вторичное»),
 * базовый металл и проба. Итоговая строка металла собирается так, чтобы
 * совпадать со справочником METALS и курсами (metal_rates).
 */

export type MetalCondition = "new" | "secondary"

export const METAL_CONDITIONS: { value: MetalCondition; label: string }[] = [
  { value: "new", label: "Новое" },
  { value: "secondary", label: "Вторичное" },
]

/** Базовые металлы без пробы. */
export const METAL_BASES = ["Золото", "Белое золото", "Серебро", "Платина"] as const

/** Популярные пробы. Остальные пользователь добавляет вручную. */
export const DEFAULT_PURITIES = ["375", "585", "750", "999", "925"] as const

const PURITY_KEY = "aura_purity_dict_v1"

export function readPurities(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_PURITIES]
  try {
    const raw = localStorage.getItem(PURITY_KEY)
    const custom = raw ? (JSON.parse(raw) as unknown) : []
    const list = Array.isArray(custom) ? custom.filter((x): x is string => typeof x === "string") : []
    return [...new Set([...DEFAULT_PURITIES, ...list])]
  } catch {
    return [...DEFAULT_PURITIES]
  }
}

function writeCustom(list: string[]) {
  try {
    localStorage.setItem(PURITY_KEY, JSON.stringify(list))
  } catch {
    /* квота переполнена — игнорируем */
  }
}

function customOnly(all: string[]): string[] {
  return all.filter((p) => !(DEFAULT_PURITIES as readonly string[]).includes(p))
}

/** Добавить пробу в справочник. Возвращает обновлённый список. */
export function addPurity(value: string): string[] {
  const clean = value.trim()
  if (!clean) return readPurities()
  const all = readPurities()
  if (all.includes(clean)) return all
  const next = [...all, clean]
  writeCustom(customOnly(next))
  return next
}

/** Удалить пользовательскую пробу (популярные удалить нельзя). */
export function removePurity(value: string): string[] {
  if ((DEFAULT_PURITIES as readonly string[]).includes(value)) return readPurities()
  const next = readPurities().filter((p) => p !== value)
  writeCustom(customOnly(next))
  return next
}

/** «Вторичное» + «Золото» + «585» → «Вторичное золото 585». */
export function composeMetal(condition: MetalCondition, base: string, purity: string): string {
  const b = base.trim()
  const p = purity.trim()
  const head = condition === "secondary" ? `Вторичное ${b.toLowerCase()}` : b
  return p ? `${head} ${p}` : head
}

/** Обратный разбор строки металла из карточки товара. */
export function parseMetal(metal: string | null | undefined): {
  condition: MetalCondition
  base: string
  purity: string
} {
  const raw = (metal ?? "").trim()
  const secondary = /^вторичн/i.test(raw)
  const rest = secondary ? raw.replace(/^вторичн\S*\s*/i, "") : raw
  const purityMatch = rest.match(/(\d{3})\s*$/)
  const purity = purityMatch ? purityMatch[1] : ""
  let base = (purityMatch ? rest.slice(0, purityMatch.index) : rest).trim()
  if (!base) base = "Золото"
  base = base.charAt(0).toUpperCase() + base.slice(1)
  return { condition: secondary ? "secondary" : "new", base, purity }
}
