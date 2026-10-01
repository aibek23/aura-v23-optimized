import type { IDBPDatabase } from "idb"
import type { ActionHistoryItem, UndoEditResult } from "@/lib/action-history"

export type UndoLocalBaseline = {
  entityType: ActionHistoryItem["entity_type"]
  entityId: string
  shopId: string
  fingerprint: string | null
}

/** Compare actual content, not client clock timestamps; ignore derived QR data. */
export function undoRecordFingerprint(record: unknown): string | null {
  if (record == null) return null
  return JSON.stringify(record, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value)
        .filter(([key]) => key !== "shop_seq_id")
        .sort(([a], [b]) => a.localeCompare(b))
      return Object.fromEntries(entries)
    }
    return value
  })
}

export async function captureUndoBaseline(
  db: IDBPDatabase,
  action: ActionHistoryItem,
): Promise<UndoLocalBaseline> {
  const table = action.entity_type === "metal_rate" ? "metal_rates"
    : action.entity_type === "sale" ? "sales"
    : action.entity_type === "cash_operation" ? "cash_operations"
    : "products"
  return {
    entityType: action.entity_type,
    entityId: action.entity_id,
    shopId: action.shop_id,
    fingerprint: undoRecordFingerprint(await db.get(table, action.entity_id)),
  }
}

/**
 * Do not overwrite a checkout/edit/sync that arrived while the RPC was running.
 * The comparison, Outbox recheck and write share ONE IndexedDB transaction.
 * Readwrite store locks coordinate with other tabs, not just this component.
 */
export async function commitUndoCache(
  db: IDBPDatabase,
  result: UndoEditResult,
  baseline: UndoLocalBaseline,
): Promise<boolean> {
  if (baseline.entityId !== result.record.id || baseline.shopId !== result.record.shop_id ||
    baseline.entityType !== result.entity_type) {
    throw new Error("Ответ отмены не соответствует локальной записи")
  }
  const table = result.entity_type === "product" ? "products" : "metal_rates"
  const tx = db.transaction([table, "outbox", "sync_meta"], "readwrite")
  try {
    const store = tx.objectStore(table)
    const [current, pending, scope] = await Promise.all([
      store.get(result.record.id),
      tx.objectStore("outbox").getAll(),
      tx.objectStore("sync_meta").get("active_shop_id"),
    ])
    const hasPending = pending.some((item) => item.shop_id === baseline.shopId &&
      ["pending", "failed", "syncing"].includes(item.status))
    if (hasPending || (scope && scope.value !== baseline.shopId) ||
      undoRecordFingerprint(current) !== baseline.fingerprint) {
      await tx.done
      return false
    }
    const record = result.entity_type === "product"
      ? { ...result.record, shop_seq_id: result.record.shop_seq_id ?? current?.shop_seq_id }
      : result.record
    await store.put(record)
    await tx.done
    return true
  } catch (error) {
    try { tx.abort() } catch { /* May already be aborted. */ }
    await tx.done.catch(() => undefined)
    throw error
  }
}