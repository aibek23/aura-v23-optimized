export type Role = "seller" | "admin" | "super_admin"
export type ProfileStatus = "pending" | "approved" | "rejected"

export type Profile = {
  id: string
  full_name: string | null
  shop_name: string | null
  shop_id: string | null
  phone: string | null
  requested_role: string | null
  role: Role | null
  status: ProfileStatus
  bonus_points: number
  bonus_rate?: number | null
  manager_id?: string | null
  last_seen_at?: string | null
  email?: string | null
  created_at: string
}

export type ProductStatus = "in_stock" | "reserved" | "sold" | "archived" | "draft"

export type Customer = {
  id: string
  shop_id: string
  name: string | null
  phone: string | null
  gender: string | null
  whatsapp: string | null
  instagram: string | null
  email: string | null
  /** Целочисленные бонусные баллы (INTEGER в БД). */
  bonus_points: number
  /** true — клиент в чёрном списке. */
  is_blacklisted: boolean
  /** Денормализованный счётчик покупок (синхронизируется при checkout). */
  purchase_count: number
  /** Суммарная выручка по клиенту. */
  total_spent: number
  /** Дата последней покупки. */
  last_purchase_at: string | null
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  client_op_id?: string | null
}

/** Статус подписки магазина. */
export type SubscriptionStatus = "trial" | "active" | "past_due" | "frozen" | "cancelled"

/** Человекочитаемые метки статусов подписки. */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial:     "Пробный",
  active:    "Активна",
  past_due:  "Просрочена",
  frozen:    "Заморожена",
  cancelled: "Отменена",
}

/** Запись настроек магазина (включая биллинг). */
export type ShopSettings = {
  shop_id: string
  shop_name: string | null
  default_bonus_rate: number
  public_enabled: boolean
  updated_at: string
  paid_until: string | null
  subscription_status: SubscriptionStatus
  auto_block: boolean
  is_frozen: boolean
  frozen_at: string | null
  notes: string | null
}

/** Профиль с полем имперсонации (только для super_admin). */
export type ProfileWithImpersonation = Profile & {
  impersonated_shop_id: string | null
}

export type Product = {
  id: string
  shop_id: string
  /** Короткий числовой ID магазина для QR-ссылок (seq_id из shop_settings). */
  shop_seq_id?: number | null
  created_by: string
  name: string
  category: string | null
  metal: string | null
  metal_color: string | null
  /** Колонка purity удалена из БД — проба вычисляется из metal (purityFromMetal). */
  weight: number
  size: string | null
  sku: string | null
  /** Порядковый номер артикула внутри префикса (1–99999). */
  article_seq?: number | null
  is_hidden: boolean | null
  purchase_price: number
  /**
   * Закупочная цена, которую видит продавец (может отличаться от реальной).
   * Переименовано из purchase_price_seller → purchase_price_visible (v20).
   */
  purchase_price_visible: number | null
  /**
   * Цена за грамм закупки для продавца.
   * Переименовано из price_per_gram_purchase_seller → price_per_gram_purchase_visible (v20).
   */
  price_per_gram_purchase_visible: number | null
  price_per_gram_sale: number | null
  price_per_gram_purchase: number | null
  stones: string | null
  description: string | null
  sale_price: number
  image_url: string | null
  images: string[] | null
  supplier_name: string | null
  supplier_phone: string | null
  consignment_operation_id?: string | null
  consignment_at?: string | null
  consignment_by?: string | null
  status: ProductStatus
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  client_op_id?: string | null
}

export type SaleItemKind = "product" | "scrap"

export type SaleItem = {
  /** null для лома — товара нет на складе. */
  product_id: string | null
  id?: string | null
  sku?: string | null
  kind?: SaleItemKind
  /**
   * Историческое поле чеков. Новые позиции всегда сохраняются ровно с
   * quantity=1, потому что каждое ювелирное изделие — отдельная запись.
   */
  quantity: number
  name: string
  weight: number
  metal: string | null
  price_per_gram?: number | null
  price: number
  cost: number
}

export type Sale = {
  id: string
  shop_id: string
  seller_id: string
  seller_name: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  payment_method: string
  /** Разбивка смешанной оплаты. */
  amount_cash?: number | null
  amount_electronic?: number | null
  subtotal: number
  discount: number
  total: number
  cost_total: number
  profit: number
  bonus_earned: number
  bonus_used: number
  items: SaleItem[]
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  total_price?: number
  final_price?: number
  client_op_id?: string | null
  /** Device-only delivery state; this field is never stored in Supabase. */
  sync_status?: "pending" | "confirmed" | "rejected"
  sync_error?: string
  cash_operation_id?: string | null
}

/** Возврат одной позиции чека (таблица sale_returns, миграция v33). */
export type SaleReturn = {
  id: string
  shop_id: string
  sale_id: string
  /** null для лома — товара на складе не было. */
  product_id?: string | null
  /** Индекс позиции внутри sales.items исходного чека. */
  item_index: number
  item_name?: string
  item_metal?: string | null
  item_weight?: number
  /** Сумма, фактически выплаченная покупателю (по оплаченной цене). */
  amount?: number
  /** Себестоимость возвращённого товара — снова учитывается на складе. */
  cost?: number
  /** Расходная операция кассы, созданная атомарно вместе с возвратом. */
  cash_operation_id?: string | null
  reason: string
  created_by?: string
  author_name?: string | null
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  sku?: string
  product_name?: string
  return_amount?: number
  client_op_id?: string | null
}

export type MetalRate = {
  id: string
  shop_id: string
  metal: string
  price_per_gram: number
  scrap_price_per_gram: number
  updated_at: string
  deleted_at?: string | null
}

export const CATEGORIES = ["Кольца", "Серьги", "Цепи", "Браслеты", "Подвески", "Часы", "Прочее"] as const

export const METALS = [
  "Золото 375",
  "Золото 585",
  "Золото 750",
  "Золото 999",
  "Белое золото",
  "Серебро 925",
  "Платина",
  "Вторичное золото 375",
  "Вторичное золото 585",
  "Вторичное золото 750",
  "Вторичное золото 999",
  "Вторичное серебро 925",
] as const

/** Цвет металла — выбирается кнопками в карточке товара. */
export const METAL_COLORS = [
  "Жёлтое золото",
  "Белое золото",
  "Красное золото",
  "Розовое золото",
  "Комбинированный",
  "Серебро",
] as const

export const PAYMENT_METHODS = [
  { value: "cash", label: "Наличные" },
  { value: "transfer", label: "Перевод / карта" },
  { value: "mixed", label: "Смешанно" },
] as const

/** Устаревший способ «card» остаётся для старых чеков. */
export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод / карта",
  mixed: "Смешанно",
}

export type CashOpType = "income" | "outcome" | "collection"

/** Источник средств операции: наличные, электронные или оба сразу. */
export type CashSource = "cash" | "electronic" | "mixed"

export const CASH_SOURCES: { value: CashSource; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "electronic", label: "Электронные (безнал)" },
  { value: "mixed", label: "Смешанно / из обоих" },
]

export type CashOperation = {
  id: string
  shop_id: string
  created_by?: string
  author_name?: string | null
  type: CashOpType
  amount: number
  source?: CashSource
  amount_cash?: number
  amount_electronic?: number
  reason: string
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  supplier_name?: string | null
  supplier_phone?: string | null
  supplier_debt_operation_id?: string | null
  client_op_id?: string | null
}

export type CashReasonPreset = {
  id: string
  shop_id: string
  created_by: string
  text: string
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
}

export type SupplierDebtOperationType = "consignment" | "adjustment" | "payment"
export type SupplierDebtSource = "cash" | "electronic" | "mixed" | null

export type SupplierDebtOperation = {
  id: string
  shop_id: string
  supplier_name: string
  supplier_phone: string | null
  operation_type: SupplierDebtOperationType
  amount: number
  balance_before: number
  balance_after: number
  product_id: string | null
  cash_operation_id: string | null
  source: SupplierDebtSource
  amount_cash: number
  amount_electronic: number
  reason: string
  author_name: string | null
  device_info: string | null
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
  client_op_id?: string | null
}

export type SupplierDebtSummary = {
  supplier_name: string
  supplier_phone: string | null
  balance: number
  last_operation_at: string
}

/** Акцентный «нейтральный» цвет интерфейса (инкассация, выделения). */
export const GOLD_ACCENT = "#E5AC4C"

// =============================================================================
// v22: Система уведомлений суперадмина
// =============================================================================

/** Тип события уведомления. */
export type NotificationKind = "pending_request"

/** Человекочитаемые метки типов уведомлений. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  pending_request: "Ожидание подтверждения",
}

/** Уведомление суперадмина (строка из superadmin_notifications). */
export type SuperadminNotification = {
  id: string
  kind: NotificationKind
  profile_id: string
  shop_id: string | null
  full_name: string | null
  shop_name: string | null
  requested_role: string | null
  is_read: boolean
  is_processed: boolean
  created_at: string
}

/** Результат сервер-экшна (единый формат успех/ошибка). */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }
