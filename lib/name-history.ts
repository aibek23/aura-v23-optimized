"use client"

/** История введённых названий изделий и черновик формы товара — localStorage. */

const NAMES_KEY = "aura_product_name_history_v1"
const DRAFT_KEY = "aura_product_draft_v1"
const MAX_NAMES = 60

export function readNameHistory(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(NAMES_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function pushNameHistory(name: string): string[] {
  const clean = name.trim()
  if (!clean) return readNameHistory()
  const next = [clean, ...readNameHistory().filter((n) => n.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_NAMES)
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(next))
  } catch {
    /* квота переполнена — игнорируем */
  }
  return next
}

export function removeNameHistory(name: string): string[] {
  const next = readNameHistory().filter((n) => n !== name)
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

export function readDraft<T>(): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveDraft(value: unknown) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}
