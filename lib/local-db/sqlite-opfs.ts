/**
 * SQLite WASM with OPFS (Origin Private File System) persistence layer for Aura CRM.
 * Manages local offline caching of catalogs (products, customers, categories,
 * suppliers, shop settings), employee session/profile, and outbox transaction queue.
 */

export interface SqliteOpfsStatus {
  isInitialized: boolean
  isOpfsSupported: boolean
  storageType: 'opfs' | 'indexeddb-fallback' | 'memory'
  lastSyncAt: string | null
  dbSize: number
}

let sqliteModule: any = null
let db: any = null
let opfsFileHandle: any = null
let isInitialized = false
let initPromise: Promise<any> | null = null
let isOpfsSupported = false
let storageType: 'opfs' | 'indexeddb-fallback' | 'memory' = 'memory'

const OPFS_DB_FILENAME = 'aura_crm_sqlite.db'

/**
 * Check if Origin Private File System is available in this browser environment.
 */
export async function checkOpfsSupport(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  try {
    if (navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      const root = await navigator.storage.getDirectory()
      const testHandle = await root.getFileHandle('__opfs_test.tmp', { create: true })
      await root.removeEntry('__opfs_test.tmp')
      return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * Initialize SQLite WASM with OPFS persistent storage.
 */
export async function getSqliteDB(): Promise<any> {
  if (typeof window === 'undefined') return null
  if (db && isInitialized) return db

  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      // 1. Check OPFS
      isOpfsSupported = await checkOpfsSupport()
      storageType = isOpfsSupported ? 'opfs' : 'indexeddb-fallback'

      // 2. Load SQLite WASM module
      // Dynamically load at browser runtime via relative public path '/sqlite3/index.mjs'
      // No localhost hardcoding; robust fallback to avoid MIME-type errors
      let sqlite3InitModule: any = null
      try {
        if (typeof window !== 'undefined' && (window as any).sqlite3InitModule) {
          sqlite3InitModule = (window as any).sqlite3InitModule
        } else {
          const dynamicImport = new Function('specifier', 'return import(specifier)')
          try {
            const mod = await dynamicImport('/sqlite3/index.mjs')
            sqlite3InitModule = mod?.default || mod
          } catch (importErr) {
            console.warn('[SQLite-OPFS] Dynamic import of /sqlite3/index.mjs failed, checking fallbacks:', importErr)
            if (typeof window !== 'undefined' && (window as any).sqlite3InitModule) {
              sqlite3InitModule = (window as any).sqlite3InitModule
            }
          }
        }
      } catch (err) {
        console.warn('[SQLite-OPFS] SQLite WASM module load warning:', err)
        if (typeof window !== 'undefined' && (window as any).sqlite3InitModule) {
          sqlite3InitModule = (window as any).sqlite3InitModule
        }
      }

      if (sqlite3InitModule) {
        sqliteModule = await sqlite3InitModule({
          locateFile: (file: string) => `/sqlite3/${file}`,
          print: () => {},
          printErr: (msg: string) => console.warn('[SQLite-WASM]:', msg),
        })

        // Check if sqlite3.oo1.OpfsDb is supported directly
        if (isOpfsSupported && sqliteModule.oo1?.OpfsDb) {
          try {
            db = new sqliteModule.oo1.OpfsDb(`/${OPFS_DB_FILENAME}`)
            storageType = 'opfs'
          } catch (e) {
            console.warn('[SQLite-OPFS] Direct OpfsDb init failed, falling back to oo1.DB with OPFS file sync:', e)
          }
        }

        // If direct OpfsDb not used, use oo1.DB with OPFS file bytes persistence
        if (!db && sqliteModule.oo1?.DB) {
          db = new sqliteModule.oo1.DB(':memory:')

          // If OPFS exists, try to restore from OPFS file
          if (isOpfsSupported) {
            try {
              const root = await navigator.storage.getDirectory()
              opfsFileHandle = await root.getFileHandle(OPFS_DB_FILENAME, { create: true })
              const file = await opfsFileHandle.getFile()
              if (file.size > 0) {
                const arrayBuffer = await file.arrayBuffer()
                const uint8 = new Uint8Array(arrayBuffer)
                if (sqliteModule.capi?.sqlite3_deserialize) {
                  sqliteModule.oo1.DB.deserialize(db, uint8)
                }
              }
            } catch (restoreErr) {
              console.warn('[SQLite-OPFS] Error restoring from OPFS file:', restoreErr)
            }
          }
        }
      }

      // If sqlite wasm couldn't instantiate OO1 db, create a lightweight fallback in memory / local state
      if (!db) {
        console.info('[SQLite-OPFS] Operating in resilient browser fallback mode')
      } else {
        // Initialize table schema
        initTables(db)
      }

      isInitialized = true
      return db
    } catch (err) {
      console.error('[SQLite-OPFS] Initialization error:', err)
      isInitialized = true
      return null
    }
  })()

  return initPromise
}

/**
 * Initialize all CRM tables in SQLite database.
 */
function initTables(database: any) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        data TEXT,
        sku TEXT,
        name TEXT,
        category TEXT,
        status TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        data TEXT,
        phone TEXT,
        name TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT,
        data TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT,
        data TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS shop_settings (
        shop_id TEXT PRIMARY KEY,
        data TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS metal_rates (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        metal TEXT,
        data TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        data TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        client_op_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sales_shop ON sales(shop_id);

      CREATE TABLE IF NOT EXISTS sale_returns (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        sale_id TEXT,
        data TEXT,
        created_at TEXT,
        client_op_id TEXT
      );

      CREATE TABLE IF NOT EXISTS cash_operations (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        data TEXT,
        created_at TEXT,
        client_op_id TEXT
      );

      CREATE TABLE IF NOT EXISTS user_session (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT,
        profile_data TEXT,
        session_data TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        client_op_id TEXT,
        shop_id TEXT,
        entity TEXT,
        op_type TEXT,
        payload TEXT,
        status TEXT,
        retries INTEGER DEFAULT 0,
        error TEXT,
        created_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );
    `)
  } catch (err) {
    console.error('[SQLite-OPFS] Error creating schema tables:', err)
  }
}

/**
 * Flush SQLite in-memory changes to OPFS file handle if available.
 */
export async function persistToOpfs(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (!db || !isOpfsSupported) return
    // If using OpfsDb, sqlite manages flushing automatically.
    // If using oo1.DB with OPFS file:
    if (sqliteModule?.capi && typeof db.export === 'function') {
      const binary = db.export()
      const root = await navigator.storage.getDirectory()
      const fileHandle = await root.getFileHandle(OPFS_DB_FILENAME, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(binary)
      await writable.close()
    }
  } catch (err) {
    console.warn('[SQLite-OPFS] Failed to persist binary to OPFS:', err)
  }
}

// ---------------------------------------------------------------------------
// 1. PRODUCTS (Товары)
// ---------------------------------------------------------------------------

export async function saveProductsSqlite(shopId: string, products: any[]): Promise<void> {
  if (!products || products.length === 0) return
  const database = await getSqliteDB()
  if (!database) {
    saveToLocalStorage(`aura_cache_products_${shopId}`, products)
    return
  }

  try {
    database.exec('BEGIN TRANSACTION;')
    for (const p of products) {
      const pId = p.id || p.sku
      const pSku = p.sku || ''
      const pName = p.name || ''
      const pCategory = p.category || ''
      const pStatus = p.status || 'in_stock'
      const pUpdated = p.updated_at || new Date().toISOString()
      const pDeleted = p.deleted_at || null
      const dataJson = JSON.stringify(p)

      database.exec({
        sql: `INSERT OR REPLACE INTO products (id, shop_id, data, sku, name, category, status, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        bind: [pId, shopId, dataJson, pSku, pName, pCategory, pStatus, pUpdated, pDeleted],
      })
    }
    database.exec('COMMIT;')
    await persistToOpfs()
  } catch (err) {
    try { database.exec('ROLLBACK;') } catch {}
    console.error('[SQLite-OPFS] Error saving products:', err)
    saveToLocalStorage(`aura_cache_products_${shopId}`, products)
  }
}

export async function getProductsSqlite(shopId: string): Promise<any[]> {
  const database = await getSqliteDB()
  if (!database) {
    return getFromLocalStorage(`aura_cache_products_${shopId}`, [])
  }

  try {
    const rows: any[] = []
    database.exec({
      sql: `SELECT data FROM products WHERE shop_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC;`,
      bind: [shopId],
      rowMode: 'object',
      callback: (row: any) => {
        if (row.data) {
          try {
            rows.push(JSON.parse(row.data))
          } catch {}
        }
      },
    })

    if (rows.length === 0) {
      return getFromLocalStorage(`aura_cache_products_${shopId}`, [])
    }
    return rows
  } catch (err) {
    console.warn('[SQLite-OPFS] Error reading products, using fallback:', err)
    return getFromLocalStorage(`aura_cache_products_${shopId}`, [])
  }
}

// ---------------------------------------------------------------------------
// 2. CUSTOMERS (Клиенты)
// ---------------------------------------------------------------------------

export async function saveCustomersSqlite(shopId: string, customers: any[]): Promise<void> {
  if (!customers || customers.length === 0) return
  const database = await getSqliteDB()
  if (!database) {
    saveToLocalStorage(`aura_cache_customers_${shopId}`, customers)
    return
  }

  try {
    database.exec('BEGIN TRANSACTION;')
    for (const c of customers) {
      const cId = c.id
      const cPhone = c.phone || ''
      const cName = c.name || ''
      const cUpdated = c.updated_at || new Date().toISOString()
      const cDeleted = c.deleted_at || null
      const dataJson = JSON.stringify(c)

      database.exec({
        sql: `INSERT OR REPLACE INTO customers (id, shop_id, data, phone, name, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?);`,
        bind: [cId, shopId, dataJson, cPhone, cName, cUpdated, cDeleted],
      })
    }
    database.exec('COMMIT;')
    await persistToOpfs()
  } catch (err) {
    try { database.exec('ROLLBACK;') } catch {}
    console.error('[SQLite-OPFS] Error saving customers:', err)
    saveToLocalStorage(`aura_cache_customers_${shopId}`, customers)
  }
}

export async function getCustomersSqlite(shopId: string): Promise<any[]> {
  const database = await getSqliteDB()
  if (!database) {
    return getFromLocalStorage(`aura_cache_customers_${shopId}`, [])
  }

  try {
    const rows: any[] = []
    database.exec({
      sql: `SELECT data FROM customers WHERE shop_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC;`,
      bind: [shopId],
      rowMode: 'object',
      callback: (row: any) => {
        if (row.data) {
          try {
            rows.push(JSON.parse(row.data))
          } catch {}
        }
      },
    })
    return rows.length > 0 ? rows : getFromLocalStorage(`aura_cache_customers_${shopId}`, [])
  } catch {
    return getFromLocalStorage(`aura_cache_customers_${shopId}`, [])
  }
}

// ---------------------------------------------------------------------------
// 3. SUPPLIERS & DEBTS (Поставщики)
// ---------------------------------------------------------------------------

export async function saveSuppliersSqlite(shopId: string, suppliers: any[]): Promise<void> {
  if (!suppliers) return
  const database = await getSqliteDB()
  if (!database) {
    saveToLocalStorage(`aura_cache_suppliers_${shopId}`, suppliers)
    return
  }

  try {
    database.exec('BEGIN TRANSACTION;')
    for (const s of suppliers) {
      const sId = s.id || s.supplier_name || s.name
      const sName = s.supplier_name || s.name || ''
      const sUpdated = new Date().toISOString()
      const dataJson = JSON.stringify(s)

      database.exec({
        sql: `INSERT OR REPLACE INTO suppliers (id, shop_id, name, data, updated_at)
              VALUES (?, ?, ?, ?, ?);`,
        bind: [sId, shopId, sName, dataJson, sUpdated],
      })
    }
    database.exec('COMMIT;')
    await persistToOpfs()
  } catch (err) {
    try { database.exec('ROLLBACK;') } catch {}
    saveToLocalStorage(`aura_cache_suppliers_${shopId}`, suppliers)
  }
}

export async function getSuppliersSqlite(shopId: string): Promise<any[]> {
  const database = await getSqliteDB()
  if (!database) {
    return getFromLocalStorage(`aura_cache_suppliers_${shopId}`, [])
  }

  try {
    const rows: any[] = []
    database.exec({
      sql: `SELECT data FROM suppliers WHERE shop_id = ?;`,
      bind: [shopId],
      rowMode: 'object',
      callback: (row: any) => {
        if (row.data) {
          try {
            rows.push(JSON.parse(row.data))
          } catch {}
        }
      },
    })
    return rows.length > 0 ? rows : getFromLocalStorage(`aura_cache_suppliers_${shopId}`, [])
  } catch {
    return getFromLocalStorage(`aura_cache_suppliers_${shopId}`, [])
  }
}

// ---------------------------------------------------------------------------
// 4. CATEGORIES & SHOP SETTINGS (Настройки магазина и категории)
// ---------------------------------------------------------------------------

export async function saveShopSettingsSqlite(shopId: string, settings: any): Promise<void> {
  if (!settings) return
  const database = await getSqliteDB()
  if (!database) {
    saveToLocalStorage(`aura_cache_settings_${shopId}`, settings)
    return
  }

  try {
    const dataJson = JSON.stringify(settings)
    database.exec({
      sql: `INSERT OR REPLACE INTO shop_settings (shop_id, data, updated_at) VALUES (?, ?, ?);`,
      bind: [shopId, dataJson, new Date().toISOString()],
    })
    await persistToOpfs()
  } catch (err) {
    saveToLocalStorage(`aura_cache_settings_${shopId}`, settings)
  }
}

export async function getShopSettingsSqlite(shopId: string): Promise<any | null> {
  const database = await getSqliteDB()
  if (!database) {
    return getFromLocalStorage(`aura_cache_settings_${shopId}`, null)
  }

  try {
    let result: any = null
    database.exec({
      sql: `SELECT data FROM shop_settings WHERE shop_id = ?;`,
      bind: [shopId],
      rowMode: 'object',
      callback: (row: any) => {
        if (row.data) {
          try {
            result = JSON.parse(row.data)
          } catch {}
        }
      },
    })
    return result || getFromLocalStorage(`aura_cache_settings_${shopId}`, null)
  } catch {
    return getFromLocalStorage(`aura_cache_settings_${shopId}`, null)
  }
}

// ---------------------------------------------------------------------------
// 5. METAL RATES (Курсы металлов)
// ---------------------------------------------------------------------------

export async function saveMetalRatesSqlite(shopId: string, rates: any[]): Promise<void> {
  if (!rates || rates.length === 0) return
  const database = await getSqliteDB()
  if (!database) {
    saveToLocalStorage(`aura_cache_rates_${shopId}`, rates)
    return
  }

  try {
    database.exec('BEGIN TRANSACTION;')
    for (const r of rates) {
      const rId = r.id || `${shopId}_${r.metal}`
      database.exec({
        sql: `INSERT OR REPLACE INTO metal_rates (id, shop_id, metal, data, updated_at) VALUES (?, ?, ?, ?, ?);`,
        bind: [rId, shopId, r.metal || '', JSON.stringify(r), new Date().toISOString()],
      })
    }
    database.exec('COMMIT;')
    await persistToOpfs()
  } catch (err) {
    try { database.exec('ROLLBACK;') } catch {}
    saveToLocalStorage(`aura_cache_rates_${shopId}`, rates)
  }
}

export async function getMetalRatesSqlite(shopId: string): Promise<any[]> {
  const database = await getSqliteDB()
  if (!database) {
    return getFromLocalStorage(`aura_cache_rates_${shopId}`, [])
  }

  try {
    const rows: any[] = []
    database.exec({
      sql: `SELECT data FROM metal_rates WHERE shop_id = ?;`,
      bind: [shopId],
      rowMode: 'object',
      callback: (row: any) => {
        if (row.data) {
          try {
            rows.push(JSON.parse(row.data))
          } catch {}
        }
      },
    })
    return rows.length > 0 ? rows : getFromLocalStorage(`aura_cache_rates_${shopId}`, [])
  } catch {
    return getFromLocalStorage(`aura_cache_rates_${shopId}`, [])
  }
}

// ---------------------------------------------------------------------------
// 6. AUTH SESSION & PROFILE PERSISTENCE (Сохранение сессии и профиля сотрудника)
// ---------------------------------------------------------------------------

export interface SavedUserSession {
  userId: string
  email?: string
  profile: any
  session?: any
  shopId?: string
  updatedAt: string
}

export async function saveUserSessionSqlite(data: {
  userId: string
  email?: string
  profile: any
  session?: any
  shopId?: string
}): Promise<void> {
  const sessionRecord: SavedUserSession = {
    userId: data.userId,
    email: data.email || data.profile?.email || '',
    profile: data.profile,
    session: data.session || null,
    shopId: data.shopId || data.profile?.shop_id,
    updatedAt: new Date().toISOString(),
  }

  // Always mirror in localStorage for instantaneous synchronous boot
  saveToLocalStorage('aura_offline_session', sessionRecord)

  const database = await getSqliteDB()
  if (!database) return

  try {
    database.exec({
      sql: `INSERT OR REPLACE INTO user_session (id, user_id, email, profile_data, session_data, updated_at)
            VALUES (?, ?, ?, ?, ?, ?);`,
      bind: [
        'current_user',
        data.userId,
        sessionRecord.email || '',
        JSON.stringify(data.profile),
        JSON.stringify(data.session || {}),
        sessionRecord.updatedAt,
      ],
    })
    await persistToOpfs()
  } catch (err) {
    console.warn('[SQLite-OPFS] Error saving user session:', err)
  }
}

export async function getUserSessionSqlite(): Promise<SavedUserSession | null> {
  // First check fast memory / localStorage
  const local = getFromLocalStorage<SavedUserSession | null>('aura_offline_session', null)

  const database = await getSqliteDB()
  if (!database) return local

  try {
    let result: SavedUserSession | null = null
    database.exec({
      sql: `SELECT * FROM user_session WHERE id = 'current_user' LIMIT 1;`,
      rowMode: 'object',
      callback: (row: any) => {
        if (row.profile_data) {
          try {
            const profile = JSON.parse(row.profile_data)
            const session = row.session_data ? JSON.parse(row.session_data) : null
            result = {
              userId: row.user_id,
              email: row.email,
              profile,
              session,
              shopId: profile.shop_id,
              updatedAt: row.updated_at,
            }
          } catch {}
        }
      },
    })
    return result || local
  } catch {
    return local
  }
}

export async function clearUserSessionSqlite(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('aura_offline_session')
    localStorage.removeItem('aura_session')
  }

  const database = await getSqliteDB()
  if (!database) return

  try {
    database.exec(`DELETE FROM user_session;`)
    await persistToOpfs()
  } catch {}
}

// ---------------------------------------------------------------------------
// 7. OFFLINE OPERATIONS OUTBOX (Очередь операций с обработкой конфликтов)
// ---------------------------------------------------------------------------

export interface SqliteOutboxItem {
  id: string
  client_op_id: string
  shop_id: string
  entity: string
  op_type: string
  payload: any
  status: 'pending' | 'syncing' | 'failed' | 'conflict' | 'completed'
  retries: number
  error: string | null
  created_at: string
}

export async function enqueueOutboxSqlite(item: {
  shop_id: string
  entity: string
  op_type: string
  payload: any
  client_op_id?: string
  id?: string
}): Promise<SqliteOutboxItem> {
  const id = item.id || (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2))
  const clientOpId = item.client_op_id || id
  const now = new Date().toISOString()

  const outboxItem: SqliteOutboxItem = {
    id,
    client_op_id: clientOpId,
    shop_id: item.shop_id,
    entity: item.entity,
    op_type: item.op_type,
    payload: item.payload,
    status: 'pending',
    retries: 0,
    error: null,
    created_at: now,
  }

  const database = await getSqliteDB()
  if (!database) {
    // Fallback store in localStorage
    const pending = getFromLocalStorage<SqliteOutboxItem[]>('aura_offline_outbox', [])
    pending.push(outboxItem)
    saveToLocalStorage('aura_offline_outbox', pending)
  } else {
    try {
      database.exec({
        sql: `INSERT OR REPLACE INTO outbox (id, client_op_id, shop_id, entity, op_type, payload, status, retries, error, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        bind: [
          outboxItem.id,
          outboxItem.client_op_id,
          outboxItem.shop_id,
          outboxItem.entity,
          outboxItem.op_type,
          JSON.stringify(outboxItem.payload),
          outboxItem.status,
          outboxItem.retries,
          outboxItem.error,
          outboxItem.created_at,
        ],
      })
      await persistToOpfs()
    } catch (err) {
      console.error('[SQLite-OPFS] Error enqueuing outbox item:', err)
      const pending = getFromLocalStorage<SqliteOutboxItem[]>('aura_offline_outbox', [])
      pending.push(outboxItem)
      saveToLocalStorage('aura_offline_outbox', pending)
    }
  }

  // Trigger dispatch event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aura:outbox_changed', { detail: { count: await getOutboxCountSqlite() } }))
  }

  return outboxItem
}

export async function getPendingOutboxSqlite(limit = 100): Promise<SqliteOutboxItem[]> {
  const database = await getSqliteDB()
  if (!database) {
    const list = getFromLocalStorage<SqliteOutboxItem[]>('aura_offline_outbox', [])
    return list.filter((i) => i.status === 'pending' || i.status === 'failed').slice(0, limit)
  }

  try {
    const rows: SqliteOutboxItem[] = []
    database.exec({
      sql: `SELECT * FROM outbox WHERE status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?;`,
      bind: [limit],
      rowMode: 'object',
      callback: (row: any) => {
        try {
          rows.push({
            id: row.id,
            client_op_id: row.client_op_id,
            shop_id: row.shop_id,
            entity: row.entity,
            op_type: row.op_type,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            status: row.status,
            retries: row.retries || 0,
            error: row.error,
            created_at: row.created_at,
          })
        } catch {}
      },
    })
    return rows
  } catch {
    return []
  }
}

export async function updateOutboxItemSqlite(
  id: string,
  status: 'pending' | 'syncing' | 'failed' | 'conflict' | 'completed',
  error?: string | null
): Promise<void> {
  const database = await getSqliteDB()
  if (!database) {
    const list = getFromLocalStorage<SqliteOutboxItem[]>('aura_offline_outbox', [])
    const idx = list.findIndex((i) => i.id === id)
    if (idx >= 0) {
      if (status === 'completed') {
        list.splice(idx, 1)
      } else {
        list[idx].status = status
        list[idx].error = error || null
        if (status === 'failed') list[idx].retries += 1
      }
      saveToLocalStorage('aura_offline_outbox', list)
    }
  } else {
    try {
      if (status === 'completed') {
        database.exec({
          sql: `DELETE FROM outbox WHERE id = ?;`,
          bind: [id],
        })
      } else {
        database.exec({
          sql: `UPDATE outbox SET status = ?, error = ?, retries = retries + 1 WHERE id = ?;`,
          bind: [status, error || null, id],
        })
      }
      await persistToOpfs()
    } catch (err) {
      console.warn('[SQLite-OPFS] Error updating outbox status:', err)
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aura:outbox_changed', { detail: { count: await getOutboxCountSqlite() } }))
  }
}

export async function getOutboxCountSqlite(): Promise<number> {
  const database = await getSqliteDB()
  if (!database) {
    const list = getFromLocalStorage<SqliteOutboxItem[]>('aura_offline_outbox', [])
    return list.filter((i) => i.status === 'pending' || i.status === 'failed' || i.status === 'conflict').length
  }

  try {
    let count = 0
    database.exec({
      sql: `SELECT COUNT(*) as cnt FROM outbox WHERE status IN ('pending', 'failed', 'conflict');`,
      rowMode: 'object',
      callback: (row: any) => {
        count = Number(row.cnt || 0)
      },
    })
    return count
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveToLocalStorage(key: string, data: any) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {}
}

function getFromLocalStorage<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
