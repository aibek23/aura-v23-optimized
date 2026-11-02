/** Тип чека продажи: фискальный или нефискальный (миграция 007). */
export type ReceiptType = "fiscal" | "non_fiscal"

/** Настройка магазина: спрашивать при каждой продаже или подставлять тип по умолчанию. */
export type ReceiptTypeSetting = "ask" | ReceiptType

export const RECEIPT_TYPES: readonly { value: ReceiptType; label: string }[] = [
  { value: "fiscal", label: "Фискальный" },
  { value: "non_fiscal", label: "Нефискальный" },
]

export const RECEIPT_TYPE_SETTINGS: readonly { value: ReceiptTypeSetting; label: string }[] = [
  { value: "ask", label: "Спрашивать при каждой продаже" },
  { value: "fiscal", label: "По умолчанию фискальный" },
  { value: "non_fiscal", label: "По умолчанию нефискальный" },
]

export const RECEIPT_TYPE_LABELS: Record<ReceiptType, string> = {
  fiscal: "Фискальный",
  non_fiscal: "Нефискальный",
}

export function isReceiptType(value: unknown): value is ReceiptType {
  return value === "fiscal" || value === "non_fiscal"
}

/** Любое неизвестное или пустое значение настройки трактуется как «спрашивать». */
export function normalizeReceiptTypeSetting(value: unknown): ReceiptTypeSetting {
  return isReceiptType(value) ? value : "ask"
}

/** Тип чека, который предвыбран в кассе: null — кассир должен выбрать сам. */
export function initialReceiptType(setting: ReceiptTypeSetting): ReceiptType | null {
  return isReceiptType(setting) ? setting : null
}
