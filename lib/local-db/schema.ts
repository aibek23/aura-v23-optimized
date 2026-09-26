export interface BaseEntity {
  id: string
  shop_id: string
  updated_at: string
  deleted_at?: string | null
  version?: number
  client_op_id?: string | null
}

export type OutboxOpType =
  | 'create'
  | 'update'
  | 'delete'
  | 'atomic_sale'
  | 'atomic_return'
  | 'atomic_cash'
  | 'product_add'
  | 'product_update'
  | 'product_delete'
  | 'stock_change'

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'completed' | 'dead'

export interface OutboxItem {
  id: string
  client_op_id: string
  shop_id: string
  entity: string
  op_type: OutboxOpType
  payload: any
  status: OutboxStatus
  retries: number
  error?: string | null
  created_at: string
  /** ISO timestamp: item must not be retried before this moment (exponential backoff). */
  scheduled_at?: string | null
  /** ISO timestamp of the last send attempt; used to recover items stuck in `syncing`. */
  attempted_at?: string | null
}

export interface SyncMeta {
  key: string
  value: any
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
  | 'outbox'
  | 'sync_meta'
  | 'user_session'

/** Tables that hold shop-scoped business data and must be isolated per shop. */
export const SHOP_SCOPED_TABLES: TableName[] = [
  'products',
  'sales',
  'sale_returns',
  'customers',
  'cash_operations',
  'cash_reason_presets',
  'metal_rates',
  'supplier_debt_operations',
  'label_templates',
  'shop_settings',
  'profiles',
]

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
  /** True when the UI is showing local data that has not been verified against the cloud recently. */
  isStale: boolean
  /** Shop the local data currently belongs to (guards against cross-shop leaks in the UI). */
  scopeShopId: string | null
}
