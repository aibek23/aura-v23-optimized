import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { bulkPut, getLocalDB } from '../local-db/db'
import {
  getPendingOutboxItems,
  getOutboxPendingCount,
  updateOutboxItemStatus,
} from '../local-db/outbox'
import { updateSyncState, getSyncState } from '../local-db/sync-store'
import type { OutboxItem, TableName } from '../local-db/schema'
import { updateDailyAggregateForDate } from '../local-db/aggregates'

interface CursorInfo {
  updated_at: string
  id: string
}

class SyncEngine {
  private isRunning = false
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  private activeShopId: string | null = null
  private syncTimer: any = null
  private outboxTimer: any = null

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnlineState(true))
      window.addEventListener('offline', () => this.handleOnlineState(false))
      window.addEventListener('aura:outbox_enqueued', () => this.scheduleOutboxFlush(300))

      // Check battery or connection constraints
      if ('connection' in navigator) {
        ;(navigator as any).connection?.addEventListener('change', () => {
          // Adjust chunk sizes dynamically
        })
      }
    }
  }

  public init(shopId: string) {
    this.activeShopId = shopId
    this.startPeriodicSync()
    this.flushOutbox()
    this.runInitialSync()
  }

  public handleOnlineState(online: boolean) {
    this.isOnline = online
    if (!online) {
      updateSyncState({ status: 'offline', phaseLabel: 'Офлайн' })
    } else {
      updateSyncState({ status: 'idle', phaseLabel: 'Подключено' })
      this.triggerSync()
      this.flushOutbox()
    }
  }

  public triggerSync() {
    if (!this.activeShopId) return
    if (!this.isOnline) {
      updateSyncState({ status: 'offline', phaseLabel: 'Офлайн (нет сети)' })
      return
    }
    this.runDeltaSync()
    this.flushOutbox()
  }

  private startPeriodicSync() {
    if (this.syncTimer) clearInterval(this.syncTimer)
    // Run delta sync every 45 seconds when online
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isRunning) {
        this.runDeltaSync()
        this.flushOutbox()
      }
    }, 45000)
  }

  private getBatchSize(): number {
    if (typeof navigator !== 'undefined') {
      const conn = (navigator as any).connection
      if (conn?.saveData || conn?.effectiveType === '3g' || conn?.effectiveType === '2g') {
        return 200
      }
    }
    return 500
  }

  // Stage 1: Minimum to start work (Shop, Rates, In-stock Products, Profile)
  // Stage 2: Customers, Suppliers, Current Month Cash
  // Stage 3: Sales & Returns History (newest to oldest)
  public async runInitialSync() {
    if (this.isRunning || !this.isOnline || !this.activeShopId) return
    this.isRunning = true

    try {
      const shopId = this.activeShopId
      const supabase = createSupabaseClient()
      const batchSize = this.getBatchSize()

      updateSyncState({
        status: 'syncing',
        priorityPhase: 1,
        phaseLabel: 'Синхронизация каталога и настроек (Этап 1/3)',
        percent: 10,
        currentTask: 'Загрузка профиля и курсов металлов...',
      })

      // 1.1 Shop settings and metal rates
      const [settingsRes, ratesRes] = await Promise.all([
        supabase.from('shop_settings').select('*').eq('shop_id', shopId).maybeSingle(),
        supabase.from('metal_rates').select('*').eq('shop_id', shopId),
      ])

      if (settingsRes.data) {
        await bulkPut('shop_settings', [settingsRes.data])
      }
      if (ratesRes.data && ratesRes.data.length > 0) {
        await bulkPut('metal_rates', ratesRes.data)
      }

      // 1.2 In-stock products with cursor pagination (chunks of 200-500)
      let productCursor: CursorInfo | null = null
      let totalProductsFetched = 0
      let hasMoreProducts = true

      updateSyncState({
        percent: 25,
        currentTask: 'Загрузка товаров в наличии...',
      })

      while (hasMoreProducts) {
        let query = supabase
          .from('products')
          .select('*')
          .eq('shop_id', shopId)
          .eq('status', 'in_stock')
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(batchSize)

        if (productCursor) {
          query = query.or(
            `updated_at.gt.${productCursor.updated_at},and(updated_at.eq.${productCursor.updated_at},id.gt.${productCursor.id})`
          )
        }

        const { data, error } = await query
        if (error) throw error

        if (data && data.length > 0) {
          await bulkPut('products', data)
          totalProductsFetched += data.length
          const last = data[data.length - 1]
          productCursor = { updated_at: last.updated_at || last.created_at, id: last.id }
          if (data.length < batchSize) {
            hasMoreProducts = false
          }
        } else {
          hasMoreProducts = false
        }
      }

      // Phase 1 COMPLETE: UI is unlocked and ready for POS / Inventory!
      updateSyncState({
        priorityPhase: 2,
        phaseLabel: 'База готова. Догрузка клиентов и кассы (Этап 2/3)',
        percent: 50,
        currentTask: 'Загрузка клиентов и кассовых операций...',
      })

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aura:phase1_ready'))
      }

      // 2. Customers and Cash operations of current month
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      const startOfMonthIso = startOfMonth.toISOString()

      const [customersRes, cashRes, presetsRes] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).limit(500),
        supabase
          .from('cash_operations')
          .select('*')
          .eq('shop_id', shopId)
          .gte('created_at', startOfMonthIso)
          .limit(500),
        supabase.from('cash_reason_presets').select('*').eq('shop_id', shopId),
      ])

      if (customersRes.data) await bulkPut('customers', customersRes.data)
      if (cashRes.data) await bulkPut('cash_operations', cashRes.data)
      if (presetsRes.data) await bulkPut('cash_reason_presets', presetsRes.data)

      // Phase 2 COMPLETE
      updateSyncState({
        priorityPhase: 3,
        phaseLabel: 'Догрузка истории продаж (Этап 3/3)',
        percent: 75,
        currentTask: 'Фоновая загрузка истории чеков...',
      })

      // 3. Sales and Returns history (recent 300)
      const [salesRes, returnsRes] = await Promise.all([
        supabase
          .from('sales')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('sale_returns')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false })
          .limit(200),
      ])

      if (salesRes.data) await bulkPut('sales', salesRes.data)
      if (returnsRes.data) await bulkPut('sale_returns', returnsRes.data)

      // Mark success
      const nowIso = new Date().toISOString()
      updateSyncState({
        status: 'synced',
        percent: 100,
        priorityPhase: 4,
        phaseLabel: 'Всё синхронизировано',
        currentTask: null,
        lastSuccessAt: nowIso,
        lastError: null,
      })
    } catch (err: any) {
      console.error('Initial sync error:', err)
      updateSyncState({
        status: 'error',
        lastError: err?.message || 'Ошибка синхронизации',
        phaseLabel: 'Ошибка — повторить',
      })
    } finally {
      this.isRunning = false
    }
  }

  // Delta sync: fetch only updated_at > last_sync_at
  public async runDeltaSync() {
    if (this.isRunning || !this.isOnline || !this.activeShopId) return
    this.isRunning = true

    try {
      const shopId = this.activeShopId
      const supabase = createSupabaseClient()
      const currentState = getSyncState()
      const since = currentState.lastSuccessAt || new Date(Date.now() - 86400000).toISOString()

      updateSyncState({
        status: 'syncing',
        currentTask: 'Проверка обновлений в облаке...',
      })

      // Fetch delta changes
      const [productsDelta, salesDelta, returnsDelta, cashDelta, customersDelta] = await Promise.all([
        supabase.from('products').select('*').eq('shop_id', shopId).gt('updated_at', since).limit(200),
        supabase.from('sales').select('*').eq('shop_id', shopId).gt('updated_at', since).limit(200),
        supabase.from('sale_returns').select('*').eq('shop_id', shopId).gt('updated_at', since).limit(100),
        supabase.from('cash_operations').select('*').eq('shop_id', shopId).gt('updated_at', since).limit(100),
        supabase.from('customers').select('*').eq('shop_id', shopId).gt('updated_at', since).limit(100),
      ])

      if (productsDelta.data?.length) await bulkPut('products', productsDelta.data)
      if (salesDelta.data?.length) await bulkPut('sales', salesDelta.data)
      if (returnsDelta.data?.length) await bulkPut('sale_returns', returnsDelta.data)
      if (cashDelta.data?.length) await bulkPut('cash_operations', cashDelta.data)
      if (customersDelta.data?.length) await bulkPut('customers', customersDelta.data)

      const pendingOutbox = await getOutboxPendingCount()
      updateSyncState({
        status: pendingOutbox > 0 ? 'syncing' : 'synced',
        percent: 100,
        outboxPendingCount: pendingOutbox,
        phaseLabel: pendingOutbox > 0 ? `${pendingOutbox} ожидают отправки` : 'Всё синхронизировано',
        currentTask: null,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
      })
    } catch (err: any) {
      console.error('Delta sync error:', err)
      updateSyncState({
        status: 'error',
        lastError: err?.message || 'Ошибка обновления',
      })
    } finally {
      this.isRunning = false
    }
  }

  public scheduleOutboxFlush(delayMs = 300) {
    if (this.outboxTimer) clearTimeout(this.outboxTimer)
    this.outboxTimer = setTimeout(() => {
      this.flushOutbox()
    }, delayMs)
  }

  // Push pending outbox items to Supabase
  public async flushOutbox() {
    if (!this.isOnline || !this.activeShopId) return

    const pending = await getPendingOutboxItems(20)
    if (pending.length === 0) {
      const pendingCount = await getOutboxPendingCount()
      updateSyncState({
        outboxPendingCount: pendingCount,
        phaseLabel: pendingCount === 0 ? 'Всё синхронизировано' : `${pendingCount} ожидают отправки`,
      })
      return
    }

    const supabase = createSupabaseClient()
    let syncedCount = 0

    for (const item of pending) {
      try {
        await updateOutboxItemStatus(item.id, 'syncing')

        // Conflict detection for updates and stock changes
        if (
          (item.op_type === 'product_update' || item.op_type === 'stock_change' || item.op_type === 'update') &&
          item.payload?.id &&
          item.payload?.original_updated_at
        ) {
          const targetTable = item.entity || 'products'
          const { data: serverRow } = await supabase
            .from(targetTable)
            .select('updated_at, name, sku')
            .eq('id', item.payload.id)
            .maybeSingle()

          if (
            serverRow &&
            serverRow.updated_at &&
            new Date(serverRow.updated_at).getTime() > new Date(item.payload.original_updated_at).getTime()
          ) {
            const label = serverRow.name || serverRow.sku || item.payload.name || item.payload.sku || 'Запись'
            toast.warning(`Конфликт данных: «${label}» был изменён на сервере. Изменения не перезаписаны.`, {
              duration: 6000,
            })
            await updateOutboxItemStatus(item.id, 'failed', 'Конфликт изменений на сервере: запись была изменена')
            continue
          }
        }

        if (item.op_type === 'atomic_sale') {
          // Idempotent checkout via server RPC or atomic insertion
          const payload = item.payload
          const { error } = await supabase.from('sales').insert({
            ...payload,
            client_op_id: item.client_op_id,
            shop_id: item.shop_id,
          })
          if (error && !error.message?.includes('duplicate key')) {
            throw error
          }
          // Update product status in cloud
          if (payload.items && Array.isArray(payload.items)) {
            for (const it of payload.items) {
              if (it.product_id) {
                await supabase
                  .from('products')
                  .update({ status: 'sold', updated_at: new Date().toISOString() })
                  .eq('id', it.product_id)
              }
            }
          }
        } else if (item.op_type === 'atomic_return') {
          const payload = item.payload
          const { error } = await supabase.from('sale_returns').insert({
            ...payload,
            client_op_id: item.client_op_id,
            shop_id: item.shop_id,
          })
          if (error && !error.message?.includes('duplicate key')) {
            throw error
          }
          // Restore product status to in_stock
          if (payload.product_id) {
            await supabase
              .from('products')
              .update({ status: 'in_stock', updated_at: new Date().toISOString() })
              .eq('id', payload.product_id)
          }
        } else if (item.op_type === 'atomic_cash') {
          const payload = item.payload
          const { error } = await supabase.from('cash_operations').insert({
            ...payload,
            client_op_id: item.client_op_id,
            shop_id: item.shop_id,
          })
          if (error && !error.message?.includes('duplicate key')) {
            throw error
          }
        } else if (item.op_type === 'product_add') {
          const { error } = await supabase.from('products').insert({
            ...item.payload,
            shop_id: item.shop_id,
            updated_at: new Date().toISOString(),
          })
          if (error) throw error
        } else if (item.op_type === 'product_update' || item.op_type === 'stock_change') {
          const { id: prodId, original_updated_at, ...cleanPayload } = item.payload
          const { error } = await supabase
            .from('products')
            .update({
              ...cleanPayload,
              updated_at: new Date().toISOString(),
            })
            .eq('id', prodId)
          if (error) throw error
        } else if (item.op_type === 'create' || item.op_type === 'update') {
          const { original_updated_at, ...cleanPayload } = item.payload
          const { error } = await supabase
            .from(item.entity)
            .upsert({ ...cleanPayload, shop_id: item.shop_id, updated_at: new Date().toISOString() })
          if (error) throw error
        } else if (item.op_type === 'delete' || item.op_type === 'product_delete') {
          // Soft delete in cloud
          const targetTable = item.entity || 'products'
          const { error } = await supabase
            .from(targetTable)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', item.payload.id)
          if (error) throw error
        }

        await updateOutboxItemStatus(item.id, 'completed')
        syncedCount++
      } catch (err: any) {
        console.error('Failed to sync outbox item:', item.id, err)
        await updateOutboxItemStatus(item.id, 'failed', err?.message || 'Sync error')
      }
    }

    if (syncedCount > 0) {
      toast.success(`Отправлено ${syncedCount} операций`)
    }

    const remaining = await getOutboxPendingCount()
    updateSyncState({
      outboxPendingCount: remaining,
      phaseLabel: remaining === 0 ? 'Всё синхронизировано' : `${remaining} ожидают отправки`,
    })

    if (remaining > 0) {
      // Retry with backoff if more items remain
      setTimeout(() => this.flushOutbox(), 5000)
    }
  }
}

export const syncEngine = new SyncEngine()
