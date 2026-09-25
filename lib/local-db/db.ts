import { openDB, type IDBPDatabase } from 'idb'
import type { BaseEntity, DailyAggregate, OutboxItem, SyncMeta, TableName } from './schema'
import {
  saveProductsSqlite,
  getProductsSqlite,
  saveCustomersSqlite,
  getCustomersSqlite,
  saveSuppliersSqlite,
  getSuppliersSqlite,
  saveShopSettingsSqlite,
  getShopSettingsSqlite,
  saveMetalRatesSqlite,
  getMetalRatesSqlite,
  clearUserSessionSqlite,
} from './sqlite-opfs'

const DB_NAME = 'aura_crm_local_v1'
const DB_VERSION = 2

let dbInstance: IDBPDatabase | null = null

export function normalizeSearchString(text: string): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}

export async function getLocalDB(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    throw new Error('LocalDB cannot be initialized on server side')
  }

  if (dbInstance) return dbInstance

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Products
      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('status', 'status')
        store.createIndex('sku', 'sku')
        store.createIndex('updated_at', 'updated_at')
        store.createIndex('deleted_at', 'deleted_at')
        store.createIndex('search_normalized', 'search_normalized')
      }

      // Sales
      if (!db.objectStoreNames.contains('sales')) {
        const store = db.createObjectStore('sales', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('created_at', 'created_at')
        store.createIndex('updated_at', 'updated_at')
        store.createIndex('deleted_at', 'deleted_at')
        store.createIndex('client_op_id', 'client_op_id')
      }

      // Sale Returns
      if (!db.objectStoreNames.contains('sale_returns')) {
        const store = db.createObjectStore('sale_returns', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('sale_id', 'sale_id')
        store.createIndex('created_at', 'created_at')
        store.createIndex('updated_at', 'updated_at')
        store.createIndex('client_op_id', 'client_op_id')
      }

      // Customers
      if (!db.objectStoreNames.contains('customers')) {
        const store = db.createObjectStore('customers', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('phone', 'phone')
        store.createIndex('updated_at', 'updated_at')
        store.createIndex('deleted_at', 'deleted_at')
        store.createIndex('search_normalized', 'search_normalized')
      }

      // Cash operations
      if (!db.objectStoreNames.contains('cash_operations')) {
        const store = db.createObjectStore('cash_operations', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('created_at', 'created_at')
        store.createIndex('updated_at', 'updated_at')
        store.createIndex('deleted_at', 'deleted_at')
        store.createIndex('client_op_id', 'client_op_id')
      }

      // Cash reason presets
      if (!db.objectStoreNames.contains('cash_reason_presets')) {
        const store = db.createObjectStore('cash_reason_presets', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('updated_at', 'updated_at')
      }

      // Metal rates
      if (!db.objectStoreNames.contains('metal_rates')) {
        const store = db.createObjectStore('metal_rates', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('metal', 'metal')
      }

      // Supplier debt operations
      if (!db.objectStoreNames.contains('supplier_debt_operations')) {
        const store = db.createObjectStore('supplier_debt_operations', { keyPath: 'id' })
        store.createIndex('shop_id', 'shop_id')
        store.createIndex('supplier_name', 'supplier_name')
        store.createIndex('created_at', 'created_at')
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

      // Daily aggregates
      if (!db.objectStoreNames.contains('daily_aggregates')) {
        const store = db.createObjectStore('daily_aggregates', { keyPath: 'date' })
        store.createIndex('shop_id', 'shop_id')
      }

      // Outbox queue
      if (!db.objectStoreNames.contains('outbox')) {
        const store = db.createObjectStore('outbox', { keyPath: 'id' })
        store.createIndex('status', 'status')
        store.createIndex('client_op_id', 'client_op_id')
        store.createIndex('created_at', 'created_at')
        store.createIndex('shop_id', 'shop_id')
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
  })

  return dbInstance
}

// Bulk put with transaction (persisting to IndexedDB and SQLite WASM with OPFS)
export async function bulkPut<T extends { id?: string; shop_id?: string }>(
  tableName: TableName,
  items: T[]
): Promise<void> {
  if (!items || items.length === 0) return

  // 1. Persist to SQLite WASM with OPFS
  try {
    const shopId = items[0]?.shop_id || ''
    if (shopId) {
      if (tableName === 'products') {
        await saveProductsSqlite(shopId, items)
      } else if (tableName === 'customers') {
        await saveCustomersSqlite(shopId, items)
      } else if (tableName === 'supplier_debt_operations') {
        await saveSuppliersSqlite(shopId, items)
      } else if (tableName === 'shop_settings') {
        await saveShopSettingsSqlite(shopId, items[0])
      } else if (tableName === 'metal_rates') {
        await saveMetalRatesSqlite(shopId, items)
      }
    }
  } catch (err) {
    console.warn(`[LocalDB] SQLite save error for ${tableName}:`, err)
  }

  // 2. Persist to IndexedDB
  const db = await getLocalDB()
  const tx = db.transaction(tableName, 'readwrite')
  const store = tx.objectStore(tableName)

  for (const item of items) {
    // Inject normalized search if applicable
    const enriched = enrichItemWithSearch(tableName, item)
    await store.put(enriched)
  }

  await tx.done
}

function enrichItemWithSearch(tableName: TableName, item: any): any {
  if (tableName === 'products') {
    const raw = `${item.name || ''} ${item.sku || ''} ${item.category || ''} ${item.metal || ''} ${item.supplier_name || ''} ${item.description || ''}`
    return { ...item, search_normalized: normalizeSearchString(raw) }
  }
  if (tableName === 'customers') {
    const raw = `${item.name || ''} ${item.phone || ''} ${item.notes || ''}`
    return { ...item, search_normalized: normalizeSearchString(raw) }
  }
  return item
}

// Get all non-deleted records for a shop (with SQLite WASM + OPFS and IndexedDB dual strategy)
export async function getShopRecords<T>(tableName: TableName, shopId: string): Promise<T[]> {
  // First try SQLite WASM with OPFS
  try {
    if (tableName === 'products') {
      const records = await getProductsSqlite(shopId)
      if (records && records.length > 0) return records as T[]
    } else if (tableName === 'customers') {
      const records = await getCustomersSqlite(shopId)
      if (records && records.length > 0) return records as T[]
    } else if (tableName === 'supplier_debt_operations') {
      const records = await getSuppliersSqlite(shopId)
      if (records && records.length > 0) return records as T[]
    } else if (tableName === 'shop_settings') {
      const record = await getShopSettingsSqlite(shopId)
      if (record) return [record] as T[]
    } else if (tableName === 'metal_rates') {
      const records = await getMetalRatesSqlite(shopId)
      if (records && records.length > 0) return records as T[]
    }
  } catch (err) {
    console.warn(`[LocalDB] SQLite read fallback for ${tableName}:`, err)
  }

  // Fallback to IndexedDB
  const db = await getLocalDB()
  const tx = db.transaction(tableName, 'readonly')
  const store = tx.objectStore(tableName)

  if (store.indexNames.contains('shop_id')) {
    const index = store.index('shop_id')
    const records = await index.getAll(shopId)
    return records.filter((r: any) => !r.deleted_at) as T[]
  }

  const all = await store.getAll()
  return (all as any[]).filter((r) => r.shop_id === shopId && !r.deleted_at) as T[]
}

// Fast search over local index
export async function searchLocalProducts(
  shopId: string,
  query: string,
  limit = 100
): Promise<any[]> {
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
    const target = p.search_normalized || normalizeSearchString(`${p.name} ${p.sku}`)
    const matches = tokens.every((token) => target.includes(token))
    if (matches) {
      results.push(p)
      if (results.length >= limit) break
    }
  }

  return results
}

// Wipe all local database stores on user logout
export async function wipeLocalDatabase(): Promise<void> {
  try {
    await clearUserSessionSqlite()
    const db = await getLocalDB()
    const storeNames = Array.from(db.objectStoreNames) as TableName[]
    const tx = db.transaction(storeNames, 'readwrite')
    for (const name of storeNames) {
      await tx.objectStore(name).clear()
    }
    await tx.done
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('aura_session')
      localStorage.removeItem('aura_active_shop')
      localStorage.removeItem('aura_sync_meta')
      localStorage.removeItem('kassa_cart_state_v2')
      localStorage.removeItem('aura_offline_session')
      localStorage.removeItem('aura_offline_outbox')
    }
  } catch (err) {
    console.error('Failed to wipe local database:', err)
  }
}
