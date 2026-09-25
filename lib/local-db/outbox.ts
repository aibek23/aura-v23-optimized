import { getLocalDB } from './db'
import type { OutboxItem, TableName } from './schema'

type OutboxListener = (count: number) => void
const listeners = new Set<OutboxListener>()

export function subscribeOutboxCount(listener: OutboxListener): () => void {
  listeners.add(listener)
  getOutboxPendingCount().then((count) => listener(count))
  return () => listeners.delete(listener)
}

function notifyListeners(count: number) {
  for (const listener of listeners) {
    try {
      listener(count)
    } catch (e) {
      console.error('Error in outbox listener:', e)
    }
  }
}

export async function enqueueOutbox(
  item: Omit<OutboxItem, 'id' | 'client_op_id' | 'status' | 'retries' | 'created_at'> & {
    id?: string
    client_op_id?: string
  }
): Promise<OutboxItem> {
  const db = await getLocalDB()
  const outboxItem: OutboxItem = {
    id: item.id || (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
    client_op_id:
      item.client_op_id ||
      (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
    shop_id: item.shop_id,
    entity: item.entity,
    op_type: item.op_type,
    payload: item.payload,
    status: 'pending',
    retries: 0,
    created_at: new Date().toISOString(),
    scheduled_at: null,
  }

  const tx = db.transaction('outbox', 'readwrite')
  await tx.objectStore('outbox').put(outboxItem)
  await tx.done

  // Notify listeners of pending count change
  const count = await getOutboxPendingCount()
  notifyListeners(count)

  // Dispatch global custom event for sync worker or listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aura:outbox_enqueued', { detail: outboxItem }))
  }

  return outboxItem
}

export async function getOutboxPendingCount(): Promise<number> {
  try {
    const db = await getLocalDB()
    const tx = db.transaction('outbox', 'readonly')
    const index = tx.objectStore('outbox').index('status')
    const pending = await index.getAll('pending')
    const failed = await index.getAll('failed')
    return pending.length + failed.length
  } catch {
    return 0
  }
}

export async function getPendingOutboxItems(limit = 50): Promise<OutboxItem[]> {
  const db = await getLocalDB()
  const tx = db.transaction('outbox', 'readonly')
  const index = tx.objectStore('outbox').index('status')
  const pending = await index.getAll('pending')
  return (pending as OutboxItem[]).slice(0, limit)
}

export async function updateOutboxItemStatus(
  id: string,
  status: 'pending' | 'syncing' | 'failed' | 'completed',
  error?: string | null
): Promise<void> {
  const db = await getLocalDB()
  const tx = db.transaction('outbox', 'readwrite')
  const store = tx.objectStore('outbox')
  const item = await store.get(id)
  if (item) {
    if (status === 'completed') {
      await store.delete(id)
    } else {
      item.status = status
      item.error = error || null
      if (status === 'failed') {
        item.retries = (item.retries || 0) + 1
      }
      await store.put(item)
    }
  }
  await tx.done

  const count = await getOutboxPendingCount()
  notifyListeners(count)
}
