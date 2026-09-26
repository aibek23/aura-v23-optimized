import { getLocalDB } from './db'
import { createLocalId } from './id'
import type { OutboxItem, OutboxStatus } from './schema'

/** Attempts after which an operation stops retrying and waits for manual attention. */
const MAX_OUTBOX_RETRIES = 8
/** Base delay for exponential backoff (doubles every attempt, capped). */
const BACKOFF_BASE_MS = 2000
const BACKOFF_MAX_MS = 5 * 60 * 1000
/** An item left in `syncing` longer than this is considered abandoned (tab closed / crash). */
const SYNCING_STUCK_MS = 60 * 1000

function newId(): string {
  return createLocalId()
}

/** Exponential retry delay with small jitter, capped at five minutes. */
function backoffDelayMs(retries: number): number {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, retries), BACKOFF_MAX_MS)
  return Math.round(exponential + Math.random() * exponential * 0.25)
}

/**
 * Enqueue an operation exactly once.
 *
 * `client_op_id` is the idempotency key: enqueueing the same key again (double tap,
 * retried handler, replayed effect) returns the existing row instead of creating a
 * duplicate, and the whole write happens inside one transaction.
 */
export async function enqueueOutbox(
  item: Omit<OutboxItem, 'id' | 'client_op_id' | 'status' | 'retries' | 'created_at'> & {
    id?: string
    client_op_id?: string
  }
): Promise<OutboxItem> {
  const db = await getLocalDB()
  const clientOpId = item.client_op_id || newId()

  const tx = db.transaction('outbox', 'readwrite')
  const store = tx.objectStore('outbox')

  // Idempotency check inside the same transaction as the write.
  const existing = (await store.index('client_op_id').get(clientOpId)) as OutboxItem | undefined
  if (existing) {
    await tx.done
    return existing
  }

  const outboxItem: OutboxItem = {
    id: item.id || newId(),
    client_op_id: clientOpId,
    shop_id: item.shop_id,
    entity: item.entity,
    op_type: item.op_type,
    payload: item.payload,
    status: 'pending',
    retries: 0,
    created_at: new Date().toISOString(),
    scheduled_at: null,
    attempted_at: null,
    error: null,
  }

  try {
    await store.put(outboxItem)
    await tx.done
  } catch (err: any) {
    // Unique index violation means another writer won the race — treat as success.
    try {
      tx.abort()
    } catch {}
    const winner = (await db.getFromIndex('outbox', 'client_op_id', clientOpId)) as OutboxItem | undefined
    if (winner) return winner
    throw err
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aura:outbox_enqueued', { detail: outboxItem }))
  }

  return outboxItem
}

/** Number of operations still awaiting delivery (including ones that are backing off). */
export async function getOutboxPendingCount(shopId?: string): Promise<number> {
  try {
    const db = await getLocalDB()
    const all = (await db.getAll('outbox')) as OutboxItem[]
    return all.filter(
      (i) =>
        (i.status === 'pending' || i.status === 'failed' || i.status === 'syncing') &&
        (!shopId || i.shop_id === shopId)
    ).length
  } catch {
    return 0
  }
}

/**
 * Items that are due for delivery right now, oldest first.
 * Respects the backoff schedule, filters to the active shop, and reclaims items
 * left in `syncing` by a crashed or closed tab.
 */
export async function getDueOutboxItems(shopId: string, limit = 20): Promise<OutboxItem[]> {
  const db = await getLocalDB()
  const all = (await db.getAll('outbox')) as OutboxItem[]
  const now = Date.now()

  const due = all
    .filter((item) => item.shop_id === shopId)
    .filter((item) => {
      if (item.status === 'completed' || item.status === 'dead') return false
      if (item.status === 'syncing') {
        const attempted = item.attempted_at ? new Date(item.attempted_at).getTime() : 0
        return now - attempted > SYNCING_STUCK_MS
      }
      if (!item.scheduled_at) return true
      return new Date(item.scheduled_at).getTime() <= now
    })
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))

  return due.slice(0, limit)
}

/** Timestamp of the earliest scheduled retry, used to wake the flusher up. */
export async function getNextRetryDelayMs(shopId: string): Promise<number | null> {
  const db = await getLocalDB()
  const all = (await db.getAll('outbox')) as OutboxItem[]
  const times = all
    .filter((i) => i.shop_id === shopId && (i.status === 'pending' || i.status === 'failed') && i.scheduled_at)
    .map((i) => new Date(i.scheduled_at as string).getTime())
  if (times.length === 0) return null
  return Math.max(0, Math.min(...times) - Date.now())
}

async function patchItem(id: string, patch: (item: OutboxItem) => OutboxItem | null): Promise<void> {
  const db = await getLocalDB()
  const tx = db.transaction('outbox', 'readwrite')
  const store = tx.objectStore('outbox')
  const item = (await store.get(id)) as OutboxItem | undefined
  if (item) {
    const next = patch(item)
    if (next === null) {
      await store.delete(id)
    } else {
      await store.put(next)
    }
  }
  await tx.done
}

/** Mark an item as being sent right now. */
export async function markOutboxSyncing(id: string): Promise<void> {
  await patchItem(id, (item) => ({
    ...item,
    status: 'syncing',
    attempted_at: new Date().toISOString(),
  }))
}

/** Delivered: the item is removed so it can never be replayed. */
export async function markOutboxCompleted(id: string): Promise<void> {
  await patchItem(id, () => null)
}

/**
 * Delivery failed. Transient failures get an exponentially growing retry delay;
 * after MAX_OUTBOX_RETRIES (or for a permanent failure) the item is dead-lettered
 * instead of being retried forever.
 */
export async function markOutboxFailed(
  id: string,
  error: string | null,
  options: { permanent?: boolean } = {}
): Promise<void> {
  await patchItem(id, (item) => {
    const retries = (item.retries || 0) + 1
    if (options.permanent || retries >= MAX_OUTBOX_RETRIES) {
      return { ...item, status: 'dead' as OutboxStatus, retries, error: error || null, scheduled_at: null }
    }
    return {
      ...item,
      status: 'failed' as OutboxStatus,
      retries,
      error: error || null,
      scheduled_at: new Date(Date.now() + backoffDelayMs(retries)).toISOString(),
    }
  })
}

