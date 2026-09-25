export interface BaseEntity {
  id: string
  shop_id: string
  updated_at: string
  deleted_at?: string | null
  version?: number
  client_op_id?: string | null
}

export interface OutboxItem {
  id: string
  client_op_id: string
  shop_id: string
  entity: string
  op_type: 'create' | 'update' | 'delete' | 'atomic_sale' | 'atomic_return' | 'atomic_cash' | 'product_add' | 'product_update' | 'product_delete' | 'stock_change'
  payload: any
  status: 'pending' | 'syncing' | 'failed' | 'completed'
  retries: number
  error?: string | null
  created_at: string
  scheduled_at?: string | null
}

export interface SyncMeta {
  key: string
  value: any
  updated_at: string
}

export interface DailyAggregate {
  date: string // YYYY-MM-DD
  shop_id: string
  total_sales_som: number
  total_sales_count: number
  total_returns_som: number
  total_returns_count: number
  net_revenue_som: number
  cash_income_som: number
  cash_outcome_som: number
  cash_collection_som: number
  scrap_weight_bought: number
  updated_at: string
}

export type TableName =
  | 'products'
  | 'sales'
  | 'sale_returns'
  | 'customers'
  | 'cash_operations'
  | 'cash_reason_presets'
  | 'metal_rates'
  | 'supplier_debt_operations'
  | 'label_templates'
  | 'shop_settings'
  | 'profiles'
  | 'daily_aggregates'
  | 'outbox'
  | 'sync_meta'
  | 'user_session'

export interface SyncProgressState {
  status: 'idle' | 'syncing' | 'offline' | 'error' | 'synced'
  percent: number // 0 - 100
  totalToProcess: number
  processedCount: number
  outboxPendingCount: number
  lastSuccessAt: string | null
  currentTask: string | null
  priorityPhase: 1 | 2 | 3 | 4 | 5
  phaseLabel: string
  lastError: string | null
}
