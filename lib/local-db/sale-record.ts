import type { CashOperation, Product, Sale } from '@/lib/types'
import { getLocalDB } from './db'
import { createLocalId } from './id'
import type { OutboxItem } from './schema'

type SaleSyncState = 'pending' | 'confirmed' | 'rejected'

/**
 * Persist the local sale, stock reservation, cash row and outbox event together.
 * A failed write cannot leave a receipt without its queued sync operation.
 */
export async function persistOfflineSale(input: {
  sale: Sale
  productIds: string[]
  cachedProducts: Product[]
  cashOperation: CashOperation | null
}): Promise<Product[]> {
  const db = await getLocalDB()
  const tx = db.transaction(['products', 'sales', 'cash_operations', 'outbox'], 'readwrite')
  const products = tx.objectStore('products')
  const sales = tx.objectStore('sales')
  const cashOperations = tx.objectStore('cash_operations')
  const outbox = tx.objectStore('outbox')
  const cachedById = new Map(input.cachedProducts.map((product) => [product.id, product]))
  const updatedProducts: Product[] = []

  try {
    for (const productId of input.productIds) {
      const current =
        ((await products.get(productId)) as Product | undefined) ?? cachedById.get(productId)

      if (!current || current.shop_id !== input.sale.shop_id) {
        throw new Error('Товар не найден в локальном каталоге. Сначала обновите каталог.')
      }
      if (current.deleted_at || current.status !== 'in_stock') {
        throw new Error(`«${current.name}» уже продан или недоступен`)
      }

      const updated: Product = {
        ...current,
        status: 'sold',
        updated_at: input.sale.created_at,
      }
      await products.put(updated)
      updatedProducts.push(updated)
    }

    const clientOpId = input.sale.client_op_id
    if (!clientOpId) throw new Error('Не удалось создать идентификатор продажи')

    const outboxItem: OutboxItem = {
      id: createLocalId(),
      client_op_id: clientOpId,
      shop_id: input.sale.shop_id,
      entity: 'sales',
      op_type: 'atomic_sale',
      payload: input.sale,
      status: 'pending',
      retries: 0,
      created_at: input.sale.created_at,
      scheduled_at: null,
      attempted_at: null,
      error: null,
    }

    await sales.put(input.sale)
    if (input.cashOperation) await cashOperations.put(input.cashOperation)
    await outbox.add(outboxItem)
    await tx.done

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aura:outbox_enqueued', { detail: outboxItem }))
    }

    return updatedProducts
  } catch (error) {
    try {
      tx.abort()
    } catch {}
    throw error
  }
}

/** Update local-only status after the server accepts or rejects a queued sale. */
export async function setLocalSaleSyncState(
  saleId: string,
  status: SaleSyncState,
  options: { reason?: string; unavailableProductId?: string; shopId?: string } = {}
): Promise<void> {
  const db = await getLocalDB()
  const tx = db.transaction(['sales', 'products'], 'readwrite')
  const sales = tx.objectStore('sales')
  const products = tx.objectStore('products')

  try {
    const sale = (await sales.get(saleId)) as (Sale & { sync_status?: SaleSyncState; sync_error?: string }) | undefined
    if (sale) {
      sale.sync_status = status
      sale.sync_error = status === 'rejected' ? options.reason || 'Продажа отклонена сервером' : undefined
      await sales.put(sale)
    }

    if (status === 'rejected' && options.unavailableProductId) {
      const product = (await products.get(options.unavailableProductId)) as Product | undefined
      if (product && (!options.shopId || product.shop_id === options.shopId)) {
        await products.put({ ...product, status: 'sold', updated_at: new Date().toISOString() })
      }
    }

    await tx.done
  } catch (error) {
    try {
      tx.abort()
    } catch {}
    throw error
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aura:sale_sync_state_changed', {
        detail: { saleId, status, shopId: options.shopId },
      })
    )
  }
}