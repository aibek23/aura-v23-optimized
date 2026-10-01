import type { CashOperation, MetalRate, Product, Sale } from "@/lib/types"

export const ACTION_HISTORY_LIMIT = 50

export type ActionEntityType = "product" | "metal_rate" | "product_create" | "sale" | "cash_operation"

/** Records whose undo removes (soft-deletes) a created row instead of restoring fields. */
export const REMOVAL_ENTITY_TYPES = ["product_create", "sale", "cash_operation"] as const
export type RemovalEntityType = (typeof REMOVAL_ENTITY_TYPES)[number]
export function isRemovalEntity(type: ActionEntityType): type is RemovalEntityType {
  return (REMOVAL_ENTITY_TYPES as readonly string[]).includes(type)
}
/** Undo of sales and cash movements is administrator-only (enforced in the RPC). */
export function requiresAdminUndo(type: ActionEntityType) {
  return type === "metal_rate" || type === "sale" || type === "cash_operation"
}

/** Public metadata only: the database never grants browser access to snapshots. */
export type ActionHistoryItem = {
  id: string
  shop_id: string
  entity_type: ActionEntityType
  entity_id: string
  created_at: string
  employee_id: string | null
  employee_name: string
  description: string
  status: "active" | "undone"
  undone_at: string | null
  undone_by: string | null
}

export type UndoEditResult =
  | { entity_type: "product"; record: Product }
  | { entity_type: "metal_rate"; record: MetalRate }

export type UndoRemovalResult = {
  entity_type: RemovalEntityType
  removed_id: string
  shop_id: string
  removed_record: Product | Sale | CashOperation
  /** Products returned to stock by a cancelled sale. */
  restored_products: Product[]
  /** Cash entries created together with a cancelled sale. */
  removed_cash_operations: CashOperation[]
}

export type UndoActionResult = UndoEditResult | UndoRemovalResult