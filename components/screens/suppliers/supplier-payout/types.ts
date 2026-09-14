// ─── Типы, интерфейсы и вспомогательные функции ────────────────────────────

import type { SupplierDebtData } from "@/app/actions/suppliers"

// Активная форма внутри карточки поставщика
export type ActiveForm = "pay" | "debt" | null

// Тип одной записи операции
export type Operation = SupplierDebtData["operations"][number]

// Тип строки поставщика из данных
export type SupplierRow = SupplierDebtData["suppliers"][number]

// Сводная информация по товарам поставщика
export interface GoodsSummary {
  count: number
  quantity: number
  totalWeight: number
  byMetal: Record<string, { quantity: number; weight: number }>
}

// Результат поиска: ключ поставщика + опциональный id найденного товара
export interface SearchMatch {
  key: string
  productId: string | null
}

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Уникальный ключ поставщика по имени и телефону.
 */
export function supplierKey(name: string, phone: string | null): string {
  return `${name}\u0000${phone ?? ""}`
}

/**
 * Человекочитаемое название типа операции.
 */
export function operationLabel(type: string): string {
  if (type === "consignment") return "Взято на реализацию"
  if (type === "adjustment") return "Увеличение долга"
  return "Выплата поставщику"
}
