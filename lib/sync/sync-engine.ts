import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { bulkPut, bulkDelete, getMeta, setMeta, ensureShopScope, localDatabaseWasRebuilt } from '../local-db/db'
import {
  getDueOutboxItems,
  getOutboxPendingCount,
  getNextRetryDelayMs,
  markOutboxSyncing,
  markOutboxCompleted,
  markOutboxFailed,
} from '../local-db/outbox'
import { setLocalSaleSyncState } from '../local-db/sale-record'
import { updateSyncState, resetSyncState, recomputeStaleness } from '../local-db/sync-store'
import type { OutboxItem, TableName } from '../local-db/schema'

interface CursorInfo {
  updated_at: string
  id: string
}

/** Per-request timeout: a hung fetch must never freeze the sync loop. */
const REQUEST_TIMEOUT_MS = 20000
/** Whole-pull safety valve, so pagination cannot loop forever. */
const MAX_PAGES_PER_TABLE = 500
const PERIODIC_SYNC_MS = 45000
/** Retry schedule for failed pulls (exponential with jitter). */
const PULL_BACKOFF_BASE_MS = 5000
const PULL_BACKOFF_MAX_MS = 5 * 60 * 1000

type SupabaseErrorKind = 'transient' | 'permanent' | 'auth' | 'conflict'

/** Classify a Supabase/network failure: only transient errors deserve a retry. */
function classifyError(err: any): SupabaseErrorKind {
  const code = String(err?.code || '')
  const status = Number(err?.status || err?.statusCode || 0)
  const message = String(err?.message || '').toLowerCase()

  if (status === 401 || status === 403 || code === 'PGRST301' || message.includes('jwt')) return 'auth'
  if (status === 409 || code === '23505' || message.includes('duplicate key')) return 'conflict'
  // Keep offline receipts queued if the RPC has not reached PostgREST's schema
  // cache yet; a transient retry lets the same operation succeed after deploy.
  if (code === 'PGRST202' || code === '42883') return 'transient'

  // Network-level failures, aborts and rate limits are always worth retrying.
  if (
    err?.name === 'AbortError' ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599) ||
    code === '40001' || // serialization failure
    code === '40P01' || // deadlock
    code === '57014' || // statement timeout
    code === '08006' ||
    code === '08003'
  ) {
    return 'transient'
  }

  // Constraint violations, bad payloads and RLS denials will never succeed on retry.
  if (code.startsWith('22') || code.startsWith('23') || code.startsWith('42') || (status >= 400 && status < 500)) {
    return 'permanent'
  }

  return 'transient'
}

function backoff(attempt: number, base = PULL_BACKOFF_BASE_MS, max = PULL_BACKOFF_MAX_MS): number {
  const exponential = Math.min(base * 2 ** Math.max(0, attempt), max)
  return Math.round(exponential + Math.random() * exponential * 0.25)
}

/** Run a Supabase query builder with a hard timeout. */
async function withTimeout<T>(runner: (signal: AbortSignal) => PromiseLike<T>, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await runner(controller.signal)
  } catch (err: any) {
    if (controller.signal.aborted) {
      const timeoutError: any = new Error(`Превышено время ожидания сети (${label})`)
      timeoutError.name = 'AbortError'
      throw timeoutError
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Throw on a Supabase error so the caller's classification logic handles it. */
function unwrap<T>(res: { data: T | null; error: any }, label: string): T | null {
  if (res.error) {
    res.error.__label = label
    throw res.error
  }
  return res.data
}

interface PullSpec {
  table: TableName
  /** Extra filter applied to the very first (initial) pull only. */
  initialFilter?: (query: any) => any
}

class SyncEngine {
  private isRunning = false
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  private activeShopId: string | null = null
  private syncTimer: any = null
  private outboxTimer: any = null
  private pullRetryTimer: any = null
  private stalenessTimer: any = null
  private pullFailures = 0
  private stopped = false
  private listenersBound = false

  constructor() {
    this.bindListeners()
  }

  private bindListeners() {
    if (this.listenersBound || typeof window === 'undefined') return
    this.listenersBound = true

    window.addEventListener('online', () => this.handleOnlineState(true))
    window.addEventListener('offline', () => this.handleOnlineState(false))
    window.addEventListener('aura:outbox_enqueued', () => this.scheduleOutboxFlush(300))

    // A tab that comes back to the foreground should verify freshness immediately.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isOnline && !this.stopped) {
        this.triggerSync()
      }
    })

    // The service worker tells us when the app booted from the offline shell.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type === 'AURA_OFFLINE_SHELL') {
          updateSyncState({ isStale: true, phaseLabel: 'Офлайн-режим (данные могут быть устаревшими)' })
        }
      })
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async init(shopId: string) {
    if (!shopId) return

    this.stopped = false
    this.bindListeners()

    const previousShop = this.activeShopId
    this.activeShopId = shopId

    // Switching shops must never mix local data: purge everything that is not this shop.
    const switched = await ensureShopScope(shopId)
    if (switched || (previousShop && previousShop !== shopId)) {
      await this.clearCursors()
      resetSyncState()
      this.notifyServiceWorker({ type: 'AURA_SHOP_CHANGED', shopId })
    }

    updateSyncState({ scopeShopId: shopId })

    this.startPeriodicSync()
    this.startStalenessWatch()
    this.flushOutbox()

    // A rebuilt IndexedDB cannot be trusted as a baseline → do a full pull instead
    // of a delta.
    const needsFull =
      localDatabaseWasRebuilt() ||
      !(await getMeta<boolean>('initial_sync_done', false))

    if (needsFull) {
      await this.runInitialSync()
    } else {
      await this.runDeltaSync()
    }
  }

  /** Stop all timers and detach from the current shop (used on logout). */
  public stop() {
    this.stopped = true
    this.activeShopId = null
    if (this.syncTimer) clearInterval(this.syncTimer)
    if (this.outboxTimer) clearTimeout(this.outboxTimer)
    if (this.pullRetryTimer) clearTimeout(this.pullRetryTimer)
    if (this.stalenessTimer) clearInterval(this.stalenessTimer)
    this.syncTimer = null
    this.outboxTimer = null
    this.pullRetryTimer = null
    this.stalenessTimer = null
    this.isRunning = false
    this.pullFailures = 0
    resetSyncState()
  }

  public getActiveShopId(): string | null {
    return this.activeShopId
  }

  public handleOnlineState(online: boolean) {
    this.isOnline = online
    if (!online) {
      updateSyncState({ status: 'offline', phaseLabel: 'Офлайн', isStale: true })
      return
    }
    updateSyncState({ status: 'idle', phaseLabel: 'Подключено' })
    this.pullFailures = 0
    this.triggerSync()
  }

  public triggerSync() {
    if (this.stopped || !this.activeShopId) return
    if (!this.isOnline) {
      updateSyncState({ status: 'offline', phaseLabel: 'Офлайн (нет сети)', isStale: true })
      return
    }
    this.runDeltaSync()
    this.flushOutbox()
  }

  private startPeriodicSync() {
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isRunning && !this.stopped) {
        this.runDeltaSync()
        this.flushOutbox()
      }
    }, PERIODIC_SYNC_MS)
  }

  /** Keep the "data may be outdated" flag accurate even when nothing else happens. */
  private startStalenessWatch() {
    if (this.stalenessTimer) clearInterval(this.stalenessTimer)
    this.stalenessTimer = setInterval(() => recomputeStaleness(), 15000)
  }

  private notifyServiceWorker(message: any) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage(message))
      .catch(() => {})
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

  // -------------------------------------------------------------------------
  // Cursors
  // -------------------------------------------------------------------------

  private cursorKey(table: TableName): string {
    return `cursor:${this.activeShopId}:${table}`
  }

  private async getCursor(table: TableName): Promise<string | null> {
    return getMeta<string | null>(this.cursorKey(table), null)
  }

  private async setCursor(table: TableName, updatedAt: string): Promise<void> {
    await setMeta(this.cursorKey(table), updatedAt)
  }

  private async clearCursors(): Promise<void> {
    const tables: TableName[] = [
      'products',
      'customers',
      'sales',
      'sale_returns',
      'cash_operations',
      'cash_reason_presets',
      'metal_rates',
      'supplier_debt_operations',
      'shop_settings',
    ]
    for (const table of tables) {
      await setMeta(this.cursorKey(table), null)
    }
    await setMeta('initial_sync_done', false)
  }

  // -------------------------------------------------------------------------
  // Pull: fully paginated, deletion-aware
  // -------------------------------------------------------------------------

  /**
   * Pull every row of one table, page by page, using a keyset cursor on
   * (updated_at, id). Unlike a plain `.limit()`, this never silently truncates the
   * dataset. Soft-deleted rows (`deleted_at`) are removed locally in the same pass, so
   * a record deleted in the cloud disappears from the device too.
   */
  private async pullTable(
    spec: PullSpec,
    options: { incremental: boolean; onProgress?: (fetched: number) => void } = { incremental: true }
  ): Promise<{ fetched: number; deleted: number }> {
    const shopId = this.activeShopId
    if (!shopId) return { fetched: 0, deleted: 0 }

    const supabase = createSupabaseClient()
    const batchSize = this.getBatchSize()
    const since = options.incremental ? await this.getCursor(spec.table) : null

    let cursor: CursorInfo | null = null
    let fetched = 0
    let deletedCount = 0
    let page = 0
    let latestUpdatedAt = since

    while (page < MAX_PAGES_PER_TABLE) {
      page++

      const data = await withTimeout(async (signal) => {
        const pkCol = spec.table === 'shop_settings' ? 'shop_id' : 'id'
        let query = supabase
          .from(spec.table)
          .select('*')
          .eq('shop_id', shopId)
          .order('updated_at', { ascending: true })
          .order(pkCol, { ascending: true })
          .limit(batchSize)
          .abortSignal(signal)

        if (!options.incremental && spec.initialFilter) {
          query = spec.initialFilter(query)
        }

        if (cursor) {
          query = query.or(
            `updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},${pkCol}.gt.${cursor.id})`
          )
        } else if (since) {
          query = query.gt('updated_at', since)
        }

        const res = await query
        if (res.error) {
          // Graceful fallback if a table is in pre-migration state without updated_at
          if (res.error.message?.includes('updated_at') || res.error.details?.includes('updated_at')) {
            let fallbackQuery = supabase
              .from(spec.table)
              .select('*')
              .eq('shop_id', shopId)
              .order('created_at', { ascending: true })
              .limit(batchSize)
              .abortSignal(signal)
            if (!options.incremental && spec.initialFilter) {
              fallbackQuery = spec.initialFilter(fallbackQuery)
            }
            return unwrap(await fallbackQuery, spec.table)
          }
          throw res.error
        }
        return res.data
      }, spec.table)

      if (!data || data.length === 0) break

      // Split the page: live rows are written, soft-deleted rows are purged locally.
      const live = data.filter((row: any) => !row.deleted_at)
      const removed = data.filter((row: any) => row.deleted_at).map((row: any) => row.id)

      if (live.length > 0) await bulkPut(spec.table, live)
      if (removed.length > 0) {
        await bulkDelete(spec.table, removed)
        deletedCount += removed.length
      }

      fetched += data.length
      options.onProgress?.(fetched)

      const last = data[data.length - 1]
      const lastUpdatedAt = last.updated_at || last.created_at
      cursor = { updated_at: lastUpdatedAt, id: last.id }
      if (lastUpdatedAt) latestUpdatedAt = lastUpdatedAt

      // Advance the stored cursor per page: an interrupted sync resumes where it stopped.
      if (lastUpdatedAt) await this.setCursor(spec.table, lastUpdatedAt)

      if (data.length < batchSize) break
    }

    if (latestUpdatedAt) await this.setCursor(spec.table, latestUpdatedAt)
    return { fetched, deleted: deletedCount }
  }

  // Stage 1: minimum needed to start working (shop, rates, in-stock products)
  // Stage 2: customers, presets, cash operations
  // Stage 3: sales and returns history
  public async runInitialSync() {
    if (this.isRunning || !this.isOnline || !this.activeShopId || this.stopped) return
    this.isRunning = true
    const shopId = this.activeShopId

    try {
      const supabase = createSupabaseClient()

      updateSyncState({
        status: 'syncing',
        priorityPhase: 1,
        phaseLabel: 'Синхронизация каталога и настроек (Этап 1/3)',
        percent: 10,
        currentTask: 'Загрузка профиля и курсов металлов...',
        scopeShopId: shopId,
      })

      // 1.1 Shop settings and metal rates
      const settingsRes = await withTimeout(
        (signal) =>
          supabase.from('shop_settings').select('*').eq('shop_id', shopId).abortSignal(signal).maybeSingle(),
        'shop_settings'
      )
      const settings = unwrap(settingsRes as any, 'shop_settings')
      if (settings) await bulkPut('shop_settings', [settings])

      await this.pullTable({ table: 'metal_rates' }, { incremental: false })

      // 1.2 Products, fully paginated
      updateSyncState({ percent: 25, currentTask: 'Загрузка товаров в наличии...' })
      await this.pullTable(
        { table: 'products' },
        {
          incremental: false,
          onProgress: (count) =>
            updateSyncState({ currentTask: `Загрузка товаров: ${count}...`, processedCount: count }),
        }
      )

      if (this.activeShopId !== shopId) return // shop switched mid-sync

      // Phase 1 complete: POS / inventory are usable.
      updateSyncState({
        priorityPhase: 2,
        phaseLabel: 'База готова. Догрузка клиентов и кассы (Этап 2/3)',
        percent: 50,
        currentTask: 'Загрузка клиентов и кассовых операций...',
      })

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aura:phase1_ready'))
      }

      // 2. Customers, cash operations, presets — all paginated
      await this.pullTable({ table: 'customers' }, { incremental: false })
      await this.pullTable({ table: 'cash_reason_presets' }, { incremental: false })

      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      const startOfMonthIso = startOfMonth.toISOString()

      await this.pullTable(
        {
          table: 'cash_operations',
          initialFilter: (query) => query.gte('created_at', startOfMonthIso),
        },
        { incremental: false }
      )

      if (this.activeShopId !== shopId) return

      // Phase 3: history
      updateSyncState({
        priorityPhase: 3,
        phaseLabel: 'Догрузка истории продаж (Этап 3/3)',
        percent: 75,
        currentTask: 'Фоновая загрузка истории чеков...',
      })

      await this.pullTable({ table: 'sales' }, { incremental: false })
      await this.pullTable({ table: 'sale_returns' }, { incremental: false })
      await this.pullTable({ table: 'supplier_debt_operations' }, { incremental: false })

      if (this.activeShopId !== shopId) return

      await setMeta('initial_sync_done', true)
      this.pullFailures = 0

      const pendingOutbox = await getOutboxPendingCount(shopId)
      updateSyncState({
        status: 'synced',
        percent: 100,
        priorityPhase: 4,
        phaseLabel: 'Всё синхронизировано',
        currentTask: null,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        isStale: false,
        outboxPendingCount: pendingOutbox,
        scopeShopId: shopId,
      })
    } catch (err: any) {
      this.handlePullError(err, 'Ошибка синхронизации')
    } finally {
      this.isRunning = false
    }
  }

  /** Delta sync: only rows changed since the stored per-table cursor. */
  public async runDeltaSync() {
    if (this.isRunning || !this.isOnline || !this.activeShopId || this.stopped) return

    // If local data was never fully loaded, a delta would leave permanent gaps.
    if (!(await getMeta<boolean>('initial_sync_done', false))) {
      return this.runInitialSync()
    }

    this.isRunning = true
    const shopId = this.activeShopId

    try {
      updateSyncState({ status: 'syncing', currentTask: 'Проверка обновлений в облаке...', scopeShopId: shopId })

      const tables: TableName[] = [
        'products',
        'sales',
        'sale_returns',
        'cash_operations',
        'customers',
        'cash_reason_presets',
        'metal_rates',
        'supplier_debt_operations',
      ]

      // Sequential on purpose: keeps request count predictable on weak connections
      // and lets every table persist its own cursor before the next one starts.
      for (const table of tables) {
        if (this.activeShopId !== shopId || this.stopped) return
        await this.pullTable({ table }, { incremental: true })
      }

      const settingsRes = await withTimeout(
        (signal) =>
          supabaseSettingsQuery(shopId, signal),
        'shop_settings'
      )
      const settings = unwrap(settingsRes as any, 'shop_settings')
      if (settings) await bulkPut('shop_settings', [settings])

      this.pullFailures = 0
      const pendingOutbox = await getOutboxPendingCount(shopId)

      updateSyncState({
        status: pendingOutbox > 0 ? 'syncing' : 'synced',
        percent: 100,
        outboxPendingCount: pendingOutbox,
        phaseLabel: pendingOutbox > 0 ? `${pendingOutbox} ожидают отправки` : 'Всё синхронизировано',
        currentTask: null,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        isStale: false,
        scopeShopId: shopId,
      })
    } catch (err: any) {
      this.handlePullError(err, 'Ошибка обновления')
    } finally {
      this.isRunning = false
    }
  }

  /** Report a pull failure and schedule a retry when the failure looks temporary. */
  private handlePullError(err: any, fallbackMessage: string) {
    const kind = classifyError(err)
    console.error('[Sync] Pull failed:', err)

    if (kind === 'auth') {
      updateSyncState({
        status: 'error',
        lastError: 'Сессия истекла — войдите снова',
        phaseLabel: 'Требуется вход',
        isStale: true,
      })
      return
    }

    updateSyncState({
      status: 'error',
      lastError: err?.message || fallbackMessage,
      phaseLabel: kind === 'transient' ? 'Ошибка сети — повтор' : 'Ошибка — повторить',
      isStale: true,
    })

    if (kind === 'transient') {
      this.pullFailures++
      if (this.pullRetryTimer) clearTimeout(this.pullRetryTimer)
      this.pullRetryTimer = setTimeout(() => {
        if (this.isOnline && !this.stopped) this.runDeltaSync()
      }, backoff(this.pullFailures))
    }
  }

  // -------------------------------------------------------------------------
  // Push: outbox flush
  // -------------------------------------------------------------------------

  public scheduleOutboxFlush(delayMs = 300) {
    if (this.outboxTimer) clearTimeout(this.outboxTimer)
    this.outboxTimer = setTimeout(() => {
      this.flushOutbox()
    }, delayMs)
  }

  /**
   * Push queued operations to the cloud.
   *
   * Each item is claimed (`syncing`) before the request, removed only after a
   * confirmed success, and rescheduled with exponential backoff on a transient
   * failure. `client_op_id` makes retries idempotent, so a request that actually
   * landed before the connection dropped cannot create a second row.
   */
  public async flushOutbox() {
    if (!this.isOnline || !this.activeShopId || this.stopped) return
    const shopId = this.activeShopId

    const due = await getDueOutboxItems(shopId, 20)
    if (due.length === 0) {
      const pendingCount = await getOutboxPendingCount(shopId)
      updateSyncState({
        outboxPendingCount: pendingCount,
        phaseLabel: pendingCount === 0 ? 'Всё синхронизировано' : `${pendingCount} ожидают отправки`,
      })
      await this.scheduleNextOutboxWake(shopId)
      return
    }

    const supabase = createSupabaseClient()
    let syncedCount = 0

    for (const item of due) {
      if (this.stopped || this.activeShopId !== shopId) return

      try {
        await markOutboxSyncing(item.id)
        await this.pushItem(supabase, item)
        await markOutboxCompleted(item.id)
        syncedCount++
      } catch (err: any) {
        const kind = classifyError(err)

        if (err?.code === 'OFFLINE_SALE_CONFLICT') {
          await markOutboxFailed(item.id, err.message, { permanent: true })
          toast.error(`Продажа не подтверждена: «${err.productName || 'товар'}» уже продан`, {
            description: 'Чек исключён из итогов. Обновите каталог перед следующей продажей.',
            duration: 8000,
          })
          continue
        }

        if (kind === 'conflict') {
          // The operation already exists on the server (idempotency key matched).
          await markOutboxCompleted(item.id)
          syncedCount++
          continue
        }

        console.error('[Sync] Outbox item failed:', item.id, err)

        if (kind === 'permanent') {
          if (item.op_type === 'atomic_sale' && item.payload?.id) {
            await setLocalSaleSyncState(item.payload.id, 'rejected', {
              reason: err?.message || 'Продажа отклонена сервером',
              shopId,
            })
          }
          await markOutboxFailed(item.id, err?.message || 'Операция отклонена сервером', { permanent: true })
          toast.error('Операция отклонена сервером и требует проверки')
        } else if (kind === 'auth') {
          await markOutboxFailed(item.id, 'Сессия истекла')
          break // no point trying the rest with an invalid session
        } else {
          await markOutboxFailed(item.id, err?.message || 'Ошибка отправки')
        }
      }
    }

    if (syncedCount > 0) {
      toast.success(`Отправлено ${syncedCount} операций`)
    }

    const remaining = await getOutboxPendingCount(shopId)
    updateSyncState({
      outboxPendingCount: remaining,
      phaseLabel: remaining === 0 ? 'Всё синхронизировано' : `${remaining} ожидают отправки`,
    })

    await this.scheduleNextOutboxWake(shopId)
  }

  /** Wake the flusher exactly when the earliest backoff expires. */
  private async scheduleNextOutboxWake(shopId: string) {
    const delay = await getNextRetryDelayMs(shopId)
    if (delay === null) return
    this.scheduleOutboxFlush(Math.max(1000, Math.min(delay, PULL_BACKOFF_MAX_MS)))
  }

  /** Deliver a single outbox operation. */
  private async pushItem(supabase: any, item: OutboxItem): Promise<void> {
    const nowIso = new Date().toISOString()

    // Conflict detection for updates and stock changes (unchanged behaviour).
    if (
      (item.op_type === 'product_update' || item.op_type === 'stock_change' || item.op_type === 'update') &&
      item.payload?.id &&
      item.payload?.original_updated_at
    ) {
      const targetTable = item.entity || 'products'
      const serverRow: any = unwrap(
        await withTimeout(
          (signal) =>
            supabase
              .from(targetTable)
              .select('updated_at, name, sku')
              .eq('id', item.payload.id)
              .abortSignal(signal)
              .maybeSingle(),
          `${targetTable}:conflict-check`
        ) as any,
        targetTable
      )

      if (
        serverRow &&
        serverRow.updated_at &&
        new Date(serverRow.updated_at).getTime() > new Date(item.payload.original_updated_at).getTime()
      ) {
        const label = serverRow.name || serverRow.sku || item.payload.name || item.payload.sku || 'Запись'
        toast.warning(`Конфликт данных: «${label}» был изменён на сервере. Изменения не перезаписаны.`, {
          duration: 6000,
        })
        const conflict: any = new Error('Конфликт изменений на сервере: запись была изменена')
        conflict.status = 422 // permanent: needs human resolution, retrying cannot help
        throw conflict
      }
    }

    if (item.op_type === 'atomic_sale') {
      const {
        total_price,
        final_price,
        original_updated_at,
        sync_status,
        sync_error,
        ...salePayload
      } = item.payload
      const result = await this.run(supabase, (client, signal) =>
        client.rpc('commit_offline_sale', {
          _client_op_id: item.client_op_id,
          _sale: salePayload,
        }).abortSignal(signal)
      )

      if (result?.accepted !== true) {
        await setLocalSaleSyncState(item.payload.id, 'rejected', {
          reason: 'Товар уже продан на другом устройстве',
          unavailableProductId: result?.product_id,
          shopId: item.shop_id,
        })
        const conflict: any = new Error('Товар уже продан на другом устройстве')
        conflict.status = 422
        conflict.code = 'OFFLINE_SALE_CONFLICT'
        conflict.productId = result?.product_id
        conflict.productName = result?.product_name
        throw conflict
      }

      await setLocalSaleSyncState(item.payload.id, 'confirmed', { shopId: item.shop_id })
      return
    }

    if (item.op_type === 'atomic_return') {
      const payload = item.payload
      const { data: userData } = await supabase.auth.getUser()
      const userId = payload.created_by || userData?.user?.id
      let cashOpId = payload.cash_operation_id

      if (!cashOpId && payload.amount && Number(payload.amount) > 0) {
        const cashClientOpId = `${item.client_op_id}:cash`
        const refundAmt = Number(payload.amount)
        const { data: cashOp } = await supabase
          .from('cash_operations')
          .upsert(
            {
              shop_id: item.shop_id,
              created_by: userId,
              author_name: payload.author_name || null,
              type: 'outcome',
              amount: refundAmt,
              source: 'cash',
              amount_cash: refundAmt,
              amount_electronic: 0,
              reason: payload.reason || `Возврат: ${payload.item_name || 'Товар'}`,
              client_op_id: cashClientOpId,
              updated_at: nowIso,
            },
            { onConflict: 'client_op_id', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle()
        if (cashOp?.id) cashOpId = cashOp.id
      }

      const returnPayload = {
        ...payload,
        item_name: payload.item_name || payload.product_name || 'Товар',
        created_by: userId,
        cash_operation_id: cashOpId || payload.cash_operation_id || null,
        client_op_id: item.client_op_id,
        shop_id: item.shop_id,
        updated_at: nowIso,
      }
      delete (returnPayload as any).product_name
      delete (returnPayload as any).return_amount
      delete (returnPayload as any).original_updated_at

      await this.run(supabase, (client, signal) =>
        client
          .from('sale_returns')
          .upsert(returnPayload, { onConflict: 'client_op_id', ignoreDuplicates: true })
          .abortSignal(signal)
      )

      if (payload.product_id) {
        await this.run(supabase, (client, signal) =>
          client
            .from('products')
            .update({ status: 'in_stock', updated_at: nowIso })
            .eq('id', payload.product_id)
            .abortSignal(signal)
        )
      }
      return
    }

    if (item.op_type === 'atomic_cash') {
      const { original_updated_at, ...cleanPayload } = item.payload
      await this.run(supabase, (client, signal) =>
        client
          .from('cash_operations')
          .upsert(
            { ...cleanPayload, client_op_id: item.client_op_id, shop_id: item.shop_id, updated_at: nowIso },
            { onConflict: 'client_op_id', ignoreDuplicates: true }
          )
          .abortSignal(signal)
      )
      return
    }

    if (item.op_type === 'product_add') {
      const { original_updated_at, ...cleanPayload } = item.payload
      await this.run(supabase, (client, signal) =>
        client
          .from('products')
          .upsert(
            { ...cleanPayload, shop_id: item.shop_id, updated_at: nowIso },
            { onConflict: 'id', ignoreDuplicates: false }
          )
          .abortSignal(signal)
      )
      return
    }

    if (item.op_type === 'product_update' || item.op_type === 'stock_change') {
      const { id: prodId, original_updated_at, ...cleanPayload } = item.payload
      await this.run(supabase, (client, signal) =>
        client
          .from('products')
          .update({ ...cleanPayload, updated_at: nowIso })
          .eq('id', prodId)
          .abortSignal(signal)
      )
      return
    }

    if (item.op_type === 'create' || item.op_type === 'update') {
      const { original_updated_at, ...cleanPayload } = item.payload
      const targetShopId = item.shop_id || cleanPayload.shop_id || this.activeShopId
      const finalPayload = {
        ...cleanPayload,
        ...(targetShopId ? { shop_id: targetShopId } : {}),
        updated_at: nowIso,
      }
      await this.run(supabase, (client, signal) =>
        client
          .from(item.entity)
          .upsert(finalPayload)
          .abortSignal(signal)
      )
      return
    }

    if (item.op_type === 'delete' || item.op_type === 'product_delete') {
      const targetTable = item.entity || 'products'
      await this.run(supabase, (client, signal) =>
        client
          .from(targetTable)
          .update({ deleted_at: nowIso, updated_at: nowIso })
          .eq('id', item.payload.id)
          .abortSignal(signal)
      )
    }
  }

  /** Execute one write with a timeout and Supabase error unwrapping. */
  private async run(supabase: any, build: (client: any, signal: AbortSignal) => PromiseLike<any>): Promise<any> {
    const res = await withTimeout((signal) => build(supabase, signal), 'write')
    if (res?.error) throw res.error
    return res?.data
  }
}

/** Small helper kept separate so the delta path stays readable. */
function supabaseSettingsQuery(shopId: string, signal: AbortSignal) {
  const supabase = createSupabaseClient()
  return supabase.from('shop_settings').select('*').eq('shop_id', shopId).abortSignal(signal).maybeSingle()
}

export const syncEngine = new SyncEngine()
