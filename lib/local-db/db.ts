import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { TableName } from './schema'
import { SHOP_SCOPED_TABLES } from './schema'

const DB_NAME = 'aura_crm_local_v1'
const DB_VERSION = 5
const CURRENT_USER_SESSION_ID = 'current_user'

const ACTIVE_SHOP_KEY = 'active_shop_id'
const SCHEMA_STAMP_KEY = 'schema_stamp'

let dbInstance: IDBPDatabase | null = null
let openPromise: Promise<IDBPDatabase> | null = null
let rebuildAttempted = false
let localDbWasRebuilt = false

/** True when the local database had to be recreated, so a full re-sync is required. */
export function localDatabaseWasRebuilt(): boolean {
  return localDbWasRebuilt
}

async function setRebuildFlag(): Promise<void> {
  localDbWasRebuilt = true
}


export function normalizeSearchString(text: string): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}

export interface SavedUserSession {
  id: string
  userId: string
  email?: string
  profile: any
  session?: any
  shopId?: string
  updatedAt: string
}

function readLegacyOfflineSession(): SavedUserSession | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem('aura_offline_session')
    if (!raw) return null
    const value = JSON.parse(raw)
    if (!value?.profile) return null
    return {
      id: CURRENT_USER_SESSION_ID,
      userId: String(value.userId || value.user_id || value.profile.id || ''),
      email: value.email || value.profile.email || '',
      profile: value.profile,
      session: value.session || undefined,
      shopId: value.shopId || value.shop_id || value.profile.shop_id || undefined,
      updatedAt: value.updatedAt || value.timestamp || new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/** Keep the offline profile in the same IndexedDB used by the local CRM. */
export async function saveUserSession(data: Omit<SavedUserSession, 'id' | 'updatedAt'>): Promise<void> {
  const db = await getLocalDB()
  await db.put('user_session', {
    ...data,
    id: CURRENT_USER_SESSION_ID,
    updatedAt: new Date().toISOString(),
  })
  try {
    localStorage.removeItem('aura_offline_session')
  } catch {}
}

/** Load the offline profile, migrating the previous localStorage copy once. */
export async function getSavedUserSession(): Promise<SavedUserSession | null> {
  try {
    const db = await getLocalDB()
    const saved = await db.get('user_session', CURRENT_USER_SESSION_ID)
    if (saved?.profile) return saved as SavedUserSession

    const legacy = readLegacyOfflineSession()
    if (!legacy) return null
    await db.put('user_session', legacy)
    try {
      localStorage.removeItem('aura_offline_session')
    } catch {}
    return legacy
  } catch {
    // Preserve offline entry if IndexedDB is temporarily unavailable.
    return readLegacyOfflineSession()
  }
}

export async function getLocalDB(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    throw new Error('LocalDB cannot be initialized on server side')
  }

  if (dbInstance) return dbInstance
  if (openPromise) return openPromise

  openPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      // Products
      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Sales
      if (!db.objectStoreNames.contains('sales')) {
        const store = db.createObjectStore('sales', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Sale Returns
      if (!db.objectStoreNames.contains('sale_returns')) {
        const store = db.createObjectStore('sale_returns', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Customers
      if (!db.objectStoreNames.contains('customers')) {
        const store = db.createObjectStore('customers', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Cash operations
      if (!db.objectStoreNames.contains('cash_operations')) {
        const store = db.createObjectStore('cash_operations', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Cash reason presets
      if (!db.objectStoreNames.contains('cash_reason_presets')) {
        const store = db.createObjectStore('cash_reason_presets', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Metal rates
      if (!db.objectStoreNames.contains('metal_rates')) {
        const store = db.createObjectStore('metal_rates', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Supplier debt operations
      if (!db.objectStoreNames.contains('supplier_debt_operations')) {
        const store = db.createObjectStore('supplier_debt_operations', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Label templates
      if (!db.objectStoreNames.contains('label_templates')) {
        const store = db.createObjectStore('label_templates', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Shop settings
      if (!db.objectStoreNames.contains('shop_settings')) {
        db.createObjectStore('shop_settings', { keyPath: 'shop_id' })
      }

      // Profiles
      if (!db.objectStoreNames.contains('profiles')) {
        const store = db.createObjectStore('profiles', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Outbox queue
      if (!db.objectStoreNames.contains('outbox')) {
        const store = db.createObjectStore('outbox', { keyPath: 'id' })
        // Unique: guarantees an operation can never be queued twice (idempotency).
        store.createIndex('client_op_id', 'client_op_id', { unique: true })
      } else if (oldVersion < 3) {
        const store = transaction.objectStore('outbox')
        if (store.indexNames.contains('client_op_id')) {
          store.deleteIndex('client_op_id')
        }
        store.createIndex('client_op_id', 'client_op_id', { unique: true })
      }

      // v4 keeps only indexes with live query call sites. Besides reducing the
      // local database footprint, dropping this derived cache removes data that
      // was written but never read by the app.
      if (oldVersion < 4) {
        const retainedIndexes: Record<string, string[]> = {
          products: ['shop_id'],
          sales: ['shop_id'],
          sale_returns: ['shop_id'],
          customers: ['shop_id'],
          cash_operations: ['shop_id'],
          cash_reason_presets: ['shop_id'],
          metal_rates: ['shop_id'],
          supplier_debt_operations: ['shop_id'],
          label_templates: ['shop_id'],
          profiles: ['shop_id'],
          outbox: ['client_op_id'],
        }

        for (const [storeName, retained] of Object.entries(retainedIndexes)) {
          if (!db.objectStoreNames.contains(storeName)) continue
          const store = transaction.objectStore(storeName)
          for (const indexName of Array.from(store.indexNames) as string[]) {
            if (!retained.includes(indexName)) store.deleteIndex(indexName)
          }
        }

        if (db.objectStoreNames.contains('daily_aggregates')) {
          db.deleteObjectStore('daily_aggregates')
        }

        for (const storeName of ['products', 'customers']) {
          if (!db.objectStoreNames.contains(storeName)) continue
          const store = transaction.objectStore(storeName)
          void (async () => {
            let cursor = await store.openCursor()
            while (cursor) {
              const value = cursor.value as any
              if (value && Object.prototype.hasOwnProperty.call(value, 'search_normalized')) {
                delete value.search_normalized
                await cursor.update(value)
              }
              cursor = await cursor.continue()
            }
          })().catch((err) => {
            console.warn(`[LocalDB] Failed to clear derived search data from ${storeName}:`, err)
          })
        }
      }

      // Sync metadata (cursors, timestamps, sync stats)
      if (!db.objectStoreNames.contains('sync_meta')) {
        db.createObjectStore('sync_meta', { keyPath: 'key' })
      }

      // User session (for offline startup and auth persistence)
      if (!db.objectStoreNames.contains('user_session')) {
        db.createObjectStore('user_session', { keyPath: 'id' })
      }
    },
    blocked() {
      console.warn('[LocalDB] Upgrade blocked by another open tab')
    },
  })
    .then((db) => {
      dbInstance = db
      db.addEventListener('close', () => {
        dbInstance = null
        openPromise = null
      })
      return db
    })
    .catch(async (err) => {
      openPromise = null
      dbInstance = null
      // Corrupted or incompatible database: drop it once and rebuild from scratch.
      console.error('[LocalDB] Failed to open local database:', err)
      if (rebuildAttempted) throw err
      rebuildAttempted = true
      try {
        await deleteDB(DB_NAME)
      } catch {}
      await setRebuildFlag()
      return getLocalDB()
    })

  return openPromise
}

// ---------------------------------------------------------------------------
// Sync metadata
// ---------------------------------------------------------------------------

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getLocalDB()
    const row = await db.get('sync_meta', key)
    return row ? (row.value as T) : fallback
  } catch {
    return fallback
  }
}

export async function setMeta(key: string, value: any): Promise<void> {
  try {
    const db = await getLocalDB()
    await db.put('sync_meta', { key, value, updated_at: new Date().toISOString() })
  } catch (err) {
    console.warn('[LocalDB] Failed to write meta', key, err)
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Atomic bulk write.
 *
 * IndexedDB is the local source of truth and is written in a single transaction —
 * either the whole batch lands or none of it does.
 */
export async function bulkPut<T extends { id?: string; shop_id?: string }>(
  tableName: TableName,
  items: T[]
): Promise<void> {
  if (!items || items.length === 0) return

  // 1. IndexedDB, single transaction (atomic)
  const db = await getLocalDB()
  const tx = db.transaction(tableName, 'readwrite')
  const store = tx.objectStore(tableName)
  try {
    for (const item of items) {
      await store.put(enrichItemWithSearch(item))
    }
    await tx.done
  } catch (err) {
    try {
      tx.abort()
    } catch {}
    throw err
  }

}

/** Hard-delete records locally (cloud reported them as removed). */
export async function bulkDelete(tableName: TableName, ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return

  const db = await getLocalDB()
  const tx = db.transaction(tableName, 'readwrite')
  const store = tx.objectStore(tableName)
  try {
    for (const id of ids) {
      await store.delete(id)
    }
    await tx.done
  } catch (err) {
    try {
      tx.abort()
    } catch {}
    throw err
  }

}

function enrichItemWithSearch(item: any): any {
  // Search terms are derived at query time; storing a second copy on every row
  // needlessly duplicates product/customer text in IndexedDB.
  return item
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Get all non-deleted records for a shop.
 *
 * IndexedDB is the single local source of truth.
 */
export async function getShopRecords<T>(tableName: TableName, shopId: string): Promise<T[]> {
  if (!shopId) return []

  const idbRecords = await readShopRecordsFromIdb<T>(tableName, shopId)
  return idbRecords
}

async function readShopRecordsFromIdb<T>(tableName: TableName, shopId: string): Promise<T[]> {
  const db = await getLocalDB()
  const tx = db.transaction(tableName, 'readonly')
  const store = tx.objectStore(tableName)

  if (store.indexNames.contains('shop_id')) {
    const records = await store.index('shop_id').getAll(shopId)
    return records.filter((r: any) => !r.deleted_at) as T[]
  }

  const all = await store.getAll()
  return (all as any[]).filter((r) => r.shop_id === shopId && !r.deleted_at) as T[]
}

// Fast search over local index
export async function searchLocalProducts(shopId: string, query: string, limit = 100): Promise<any[]> {
  const db = await getLocalDB()
  const norm = normalizeSearchString(query)
  const tx = db.transaction('products', 'readonly')
  const store = tx.objectStore('products')
  const index = store.index('shop_id')
  const products = await index.getAll(shopId)

  if (!norm) {
    return products.filter((p: any) => !p.deleted_at && p.status === 'in_stock').slice(0, limit)
  }

  const tokens = norm.split(' ').filter(Boolean)
  const results: any[] = []

  for (const p of products) {
    if (p.deleted_at) continue
    const target = normalizeSearchString(
      `${p.name || ''} ${p.sku || ''} ${p.category || ''} ${p.metal || ''} ${p.supplier_name || ''} ${p.description || ''}`
    )
    const matches = tokens.every((token) => target.includes(token))
    if (matches) {
      results.push(p)
      if (results.length >= limit) break
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Shop isolation
// ---------------------------------------------------------------------------

export async function getActiveLocalShopId(): Promise<string | null> {
  return getMeta<string | null>(ACTIVE_SHOP_KEY, null)
}

/**
 * Bind the local database to one shop.
 *
 * When the active shop changes, every shop-scoped store is purged before the new
 * shop's data is loaded, so stock, receipts and customers cannot be mixed.
 */
export async function ensureShopScope(shopId: string): Promise<boolean> {
  if (!shopId) return false

  const previous = await getActiveLocalShopId()
  if (previous === shopId) return false

  if (previous) {
    await purgeOtherShops(shopId)
  }

  await setMeta(ACTIVE_SHOP_KEY, shopId)
  await setMeta(SCHEMA_STAMP_KEY, DB_VERSION)

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('aura_active_shop', shopId)
    } catch {}
  }

  return Boolean(previous)
}

/** Drop every locally cached row that does not belong to the given shop. */
export async function purgeOtherShops(shopId: string): Promise<void> {
  const db = await getLocalDB()

  for (const table of SHOP_SCOPED_TABLES) {
    if (!db.objectStoreNames.contains(table)) continue
    const tx = db.transaction(table, 'readwrite')
    const store = tx.objectStore(table)
    const all = await store.getAll()
    for (const row of all as any[]) {
      if (!row?.shop_id || row.shop_id !== shopId) {
        const key = table === 'shop_settings' ? row.shop_id : row.id
        if (key !== undefined) await store.delete(key)
      }
    }
    await tx.done
  }

  // Queued operations of another shop must not be flushed under the new shop.
  if (db.objectStoreNames.contains('outbox')) {
    const tx = db.transaction('outbox', 'readwrite')
    const store = tx.objectStore('outbox')
    const all = await store.getAll()
    for (const row of all as any[]) {
      if (row?.shop_id && row.shop_id !== shopId) await store.delete(row.id)
    }
    await tx.done
  }

  // Sync cursors are per-shop; drop them so the new shop starts with a clean sync.
  if (db.objectStoreNames.contains('sync_meta')) {
    const tx = db.transaction('sync_meta', 'readwrite')
    const store = tx.objectStore('sync_meta')
    const all = await store.getAll()
    for (const row of all as any[]) {
      if (typeof row?.key === 'string' && row.key.startsWith('cursor:')) await store.delete(row.key)
    }
    await tx.done
  }

}

// ---------------------------------------------------------------------------
// Logout cleanup
// ---------------------------------------------------------------------------

/**
 * Wipe local data on logout: IndexedDB is deleted outright (so no store can survive
 * a partially failed clear), and namespaced localStorage keys are dropped.
 */
export async function wipeLocalDatabase(): Promise<void> {
  // Close and delete the whole IndexedDB database — atomic by construction.
  try {
    if (dbInstance) {
      dbInstance.close()
      dbInstance = null
    }
    openPromise = null
    await deleteDB(DB_NAME, {
      blocked() {
        console.warn('[LocalDB] Delete blocked by another open tab')
      },
    })
  } catch (err) {
    console.error('[LocalDB] Failed to delete local database, clearing stores instead:', err)
    try {
      const db = await getLocalDB()
      const storeNames = Array.from(db.objectStoreNames) as TableName[]
      const tx = db.transaction(storeNames, 'readwrite')
      for (const name of storeNames) {
        await tx.objectStore(name).clear()
      }
      await tx.done
    } catch (innerErr) {
      console.error('[LocalDB] Fallback clear failed:', innerErr)
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.startsWith('aura_') || key.startsWith('kassa_'))) keys.push(key)
      }
      for (const key of keys) localStorage.removeItem(key)
    } catch {}
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.clear()
    } catch {}
  }
}
