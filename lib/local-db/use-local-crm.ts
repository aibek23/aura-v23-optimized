"use client"

import { useState, useEffect, useCallback } from 'react'
import type { Customer, Product, Profile, Role, Sale, SaleItem, SaleReturn, MetalRate, CashOperation } from '@/lib/types'
import type { CashData } from '@/app/actions/cash'
import type { SupplierDebtData } from '@/app/actions/suppliers'
import {
  getLocalDB,
  getShopRecords,
  bulkPut,
  searchLocalProducts,
  ensureShopScope,
} from './db'
import { enqueueOutbox } from './outbox'
import { syncEngine } from '../sync/sync-engine'
import { createLocalId } from './id'
import { persistOfflineSale } from './sale-record'
import { toast } from 'sonner'
import type { TableName } from './schema'

/**
 * Server props are a useful first seed, but may be an older offline page snapshot.
 * Insert only rows whose primary key is not present locally: `bulkPut` on every app
 * start would otherwise overwrite edits, offline stock changes, and soft deletes
 * after a hard refresh.
 */
async function seedMissingLocalRows<T extends { id?: string; shop_id?: string }>(
  table: TableName,
  rows: T[],
  shopId: string,
) {
  if (!rows.length) return

  const db = await getLocalDB()
  const tx = db.transaction(table, 'readonly')
  const store = tx.objectStore(table)
  const existing = store.indexNames.contains('shop_id')
    ? await store.index('shop_id').getAll(shopId)
    : await store.getAll()
  await tx.done

  // Include soft-deleted rows in this key set. A stale cached server page must not
  // bring a locally deleted record back to life.
  const knownKeys = new Set<string>(
    existing
      .filter((row: any) => !row.shop_id || row.shop_id === shopId)
      .map((row: any) => String(row.id ?? row.shop_id ?? ''))
      .filter(Boolean),
  )
  const missing = rows.filter((row) => {
    const key = row.id ?? row.shop_id
    return Boolean(key) && !knownKeys.has(String(key))
  })

  if (missing.length) await bulkPut(table, missing)
}

export function useLocalCrm(initialData: {
  profile: Profile
  enabled?: boolean
  products?: Product[]
  sales?: Sale[]
  returns?: SaleReturn[]
  cash?: CashData
  rates?: MetalRate[]
  clients?: Customer[]
  supplierDebts?: SupplierDebtData
}) {
  const shopId = initialData.profile.shop_id || 'default_shop'
  const enabled = initialData.enabled ?? true
  const [products, setProducts] = useState<Product[]>(initialData.products || [])
  const [sales, setSales] = useState<Sale[]>(initialData.sales || [])
  const [returns, setReturns] = useState<SaleReturn[]>(initialData.returns || [])
  const [cash, setCash] = useState<CashData>(
    initialData.cash || { operations: [], presets: [] }
  )
  const [rates, setRates] = useState<MetalRate[]>(initialData.rates || [])
  const [clients, setClients] = useState<Customer[]>(initialData.clients || [])
  const [isReady, setIsReady] = useState(!enabled)

  // 1. Initialize Sync Engine and seed initial server data if local DB is empty
  useEffect(() => {
    let mounted = true

    if (!enabled) {
      syncEngine.stop()
      setIsReady(true)
      return () => {
        mounted = false
      }
    }

    async function initData() {
      try {
        await getLocalDB()

        // Привязываем локальную базу к текущему магазину. Если магазин сменился,
        // все локальные данные прошлого магазина удаляются до чтения и записи —
        // так товары и чеки разных магазинов не могут смешаться.
        const shopSwitched = await ensureShopScope(shopId)
        if (shopSwitched && mounted) {
          setProducts([])
          setSales([])
          setReturns([])
          setCash({ operations: [], presets: [] })
          setClients([])
          setRates([])
        }

        // Seed new server records without replacing the local source of truth.
        const ofShop = <T extends { shop_id?: string }>(rows?: T[]) =>
          (rows || []).filter((row) => !row.shop_id || row.shop_id === shopId)

        if (initialData.products && initialData.products.length > 0) {
          await seedMissingLocalRows('products', ofShop(initialData.products), shopId)
        }
        if (initialData.sales && initialData.sales.length > 0) {
          await seedMissingLocalRows('sales', ofShop(initialData.sales), shopId)
        }
        if (initialData.returns && initialData.returns.length > 0) {
          await seedMissingLocalRows('sale_returns', ofShop(initialData.returns), shopId)
        }
        if (initialData.cash?.operations && initialData.cash.operations.length > 0) {
          await seedMissingLocalRows('cash_operations', ofShop(initialData.cash.operations), shopId)
        }
        if (initialData.cash?.presets && initialData.cash.presets.length > 0) {
          await seedMissingLocalRows('cash_reason_presets', ofShop(initialData.cash.presets), shopId)
        }
        if (initialData.clients && initialData.clients.length > 0) {
          await seedMissingLocalRows('customers', ofShop(initialData.clients), shopId)
        }
        if (initialData.rates && initialData.rates.length > 0) {
          await seedMissingLocalRows('metal_rates', ofShop(initialData.rates), shopId)
        }

        // Read all active records from local DB
        const [localProducts, localSales, localReturns, localCashOps, localPresets, localClients, localRates] =
          await Promise.all([
            getShopRecords<Product>('products', shopId),
            getShopRecords<Sale>('sales', shopId),
            getShopRecords<SaleReturn>('sale_returns', shopId),
            getShopRecords<CashOperation>('cash_operations', shopId),
            getShopRecords<any>('cash_reason_presets', shopId),
            getShopRecords<Customer>('customers', shopId),
            getShopRecords<MetalRate>('metal_rates', shopId),
          ])

        if (mounted) {
          setProducts(localProducts)
          setSales(localSales)
          setReturns(localReturns)
          setCash({
            operations: localCashOps,
            presets: localPresets,
          })
          setClients(localClients)
          setRates(localRates)
          setIsReady(true)
        }

        // Start background Sync Engine
        syncEngine.init(shopId)
      } catch (err) {
        console.error('Error initializing local CRM database:', err)
        if (mounted) setIsReady(true)
      }
    }

    initData()

    // Listen to phase 1 ready event
    const onPhase1Ready = async () => {
      const refreshedProducts = await getShopRecords<Product>('products', shopId)
      if (mounted && refreshedProducts.length > 0) {
        setProducts(refreshedProducts)
      }
    }

    const refreshAfterSaleSync = async () => {
      const [refreshedProducts, refreshedSales, refreshedClients] = await Promise.all([
        getShopRecords<Product>('products', shopId),
        getShopRecords<Sale>('sales', shopId),
        getShopRecords<Customer>('customers', shopId),
      ])
      if (!mounted) return
      if (refreshedProducts.length > 0) setProducts(refreshedProducts)
      setSales(refreshedSales)
      setClients(refreshedClients)
    }

    const onSaleSyncStateChanged = () => {
      void refreshAfterSaleSync()
    }

    window.addEventListener('aura:phase1_ready', onPhase1Ready)
    window.addEventListener('aura:sale_sync_state_changed', onSaleSyncStateChanged)
    return () => {
      mounted = false
      window.removeEventListener('aura:phase1_ready', onPhase1Ready)
      window.removeEventListener('aura:sale_sync_state_changed', onSaleSyncStateChanged)
    }
  }, [shopId, enabled])

  // 2. Offline-first Checkout (Sales POS)
  const localCheckout = useCallback(
    async (input: {
      items: SaleItem[]
      discount: number
      payment_method: string
      amount_cash?: number
      amount_electronic?: number
      customer_name: string
      customer_phone: string
      bonus_used: number
    }) => {
      if (!input.items.length) throw new Error('Чек пуст — добавьте хотя бы одну позицию')
      if (input.items.some((item) => Number(item.quantity) !== 1)) {
        throw new Error('Количество каждой позиции должно быть равно 1')
      }

      const clientOpId = createLocalId()
      const saleId = createLocalId()
      const nowIso = new Date().toISOString()
      const items = input.items.map((item) => {
        const price = Number(item.price)
        if (!Number.isFinite(price) || price < 0) throw new Error('В чеке указана некорректная цена')

        if (item.kind === 'scrap') {
          const weight = Number(item.weight)
          if (!Number.isFinite(weight) || weight <= 0) throw new Error('Укажите корректный вес лома')
          return { ...item, kind: 'scrap' as const, product_id: null, quantity: 1, price }
        }

        const candidateId = item.product_id || item.id
        const product = products.find(
          (row) => row.id === candidateId || (item.sku && row.sku === item.sku)
        )
        if (!product) throw new Error('Товар не найден в локальном каталоге')

        return {
          ...item,
          id: product.id,
          product_id: product.id,
          kind: 'product' as const,
          quantity: 1,
          sku: product.sku,
          name: item.name || product.name,
          cost: Number(product.purchase_price) || 0,
          price,
        }
      })

      const productIds = items
        .filter((item) => item.kind !== 'scrap' && item.product_id)
        .map((item) => item.product_id as string)
      if (new Set(productIds).size !== productIds.length) {
        throw new Error('Одно изделие нельзя добавить в чек дважды')
      }

      const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0)
      const bonusUsed = Math.max(0, Math.min(Number(input.bonus_used) || 0, subtotal))
      // Prices already include line-level discounts from the POS screen.
      const discount = 0
      const finalPrice = Math.max(0, subtotal - bonusUsed)
      const costTotal = items.reduce((sum, item) => sum + Number(item.cost || 0), 0)

      let cashAmount = 0
      let electronicAmount = 0
      if (input.payment_method === 'cash') {
        cashAmount = finalPrice
      } else if (input.payment_method === 'mixed') {
        cashAmount = Math.round(Number(input.amount_cash) || 0)
        electronicAmount = Math.round(Number(input.amount_electronic) || 0)
        if (cashAmount < 0 || electronicAmount < 0 || Math.abs(cashAmount + electronicAmount - finalPrice) > 1) {
          throw new Error('Сумма оплаты не совпадает с итогом чека')
        }
      } else if (input.payment_method === 'card' || input.payment_method === 'transfer') {
        electronicAmount = finalPrice
      } else {
        throw new Error('Выберите корректный способ оплаты')
      }

      const newSale: Sale = {
        id: saleId,
        shop_id: shopId,
        seller_id: initialData.profile.id,
        seller_name: initialData.profile.full_name || null,
        customer_id: null,
        customer_name: input.customer_name || null,
        customer_phone: input.customer_phone || null,
        payment_method: input.payment_method,
        amount_cash: cashAmount,
        amount_electronic: electronicAmount,
        subtotal,
        discount,
        total: finalPrice,
        cost_total: costTotal,
        profit: finalPrice - costTotal,
        bonus_earned: 0,
        bonus_used: bonusUsed,
        items,
        total_price: subtotal,
        final_price: finalPrice,
        created_at: nowIso,
        client_op_id: clientOpId,
        sync_status: 'pending',
      }

      let newCashOp: CashOperation | null = null
      if (finalPrice > 0) {
        const source =
          cashAmount > 0 && electronicAmount > 0
            ? 'mixed'
            : electronicAmount > 0
              ? 'electronic'
              : 'cash'
        newCashOp = {
          id: createLocalId(),
          shop_id: shopId,
          created_by: initialData.profile.id,
          author_name: initialData.profile.full_name || null,
          type: 'income',
          amount: finalPrice,
          source,
          amount_cash: cashAmount,
          amount_electronic: electronicAmount,
          reason: `Продажа чека #${saleId.slice(0, 8)}`,
          created_at: nowIso,
          client_op_id: `${clientOpId}:cash`,
        } as CashOperation
        newSale.cash_operation_id = newCashOp.id
      }

      const changedProducts = await persistOfflineSale({
        sale: newSale,
        productIds,
        cachedProducts: products,
        cashOperation: newCashOp,
      })
      const changedById = new Map(changedProducts.map((product) => [product.id, product]))
      const updatedProducts = products.map((product) => changedById.get(product.id) || product)

      // Update memory state immediately
      setProducts(updatedProducts)
      setSales((prev) => [newSale, ...prev])
      if (newCashOp) {
        setCash((prev) => ({ ...prev, operations: [newCashOp!, ...prev.operations] }))
      }

      return { success: true, sale: newSale }
    },
    [shopId, initialData.profile.id, initialData.profile.full_name, products]
  )

  // 3. Offline-first Return
  const localReturn = useCallback(
    async (input: { saleId: string; itemIndex: number; reason?: string }) => {
      const clientOpId = createLocalId()
      const returnId = createLocalId()
      const nowIso = new Date().toISOString()

      const targetSale = sales.find((s) => s.id === input.saleId)
      if (!targetSale || !targetSale.items || !targetSale.items[input.itemIndex]) {
        throw new Error('Чек или позиция не найдены')
      }

      const item = targetSale.items[input.itemIndex]
      const returnAmount = Number(item.price || targetSale.final_price || 0)

      const newReturn: SaleReturn = {
        id: returnId,
        shop_id: shopId,
        sale_id: targetSale.id,
        item_index: input.itemIndex,
        sku: item.sku,
        product_name: item.name || 'Товар',
        return_amount: returnAmount,
        reason: input.reason || 'Возврат клиентом',
        created_at: nowIso,
        client_op_id: clientOpId,
      } as SaleReturn

      // Restore product status
      const updatedProducts = products.map((p) => {
        if (p.id === item.id || p.sku === item.sku) {
          return { ...p, status: 'in_stock' as const, updated_at: nowIso }
        }
        return p
      })

      // Add cash outcome
      const cashOutOp: CashOperation = {
        id: createLocalId(),
        shop_id: shopId,
        type: 'outcome',
        amount: returnAmount,
        reason: `Возврат по чеку #${targetSale.id.slice(0, 8)} (${item.name || item.sku})`,
        created_at: nowIso,
        client_op_id: `${clientOpId}:cash`,
      } as CashOperation

      // Write to local DB
      await bulkPut('sale_returns', [newReturn])
      await bulkPut('products', updatedProducts.filter((p) => p.id === item.id || p.sku === item.sku))
      await bulkPut('cash_operations', [cashOutOp])

      // Enqueue to Outbox
      await enqueueOutbox({
        client_op_id: clientOpId,
        shop_id: shopId,
        entity: 'sale_returns',
        op_type: 'atomic_return',
        payload: {
          ...newReturn,
          product_id: item.id,
        },
      })

      setReturns((prev) => [newReturn, ...prev])
      setProducts(updatedProducts)
      setCash((prev) => ({ ...prev, operations: [cashOutOp, ...prev.operations] }))

      return { success: true, returnRecord: newReturn }
    },
    [sales, products, shopId]
  )

  // 4. Offline-first Product Management
  const localSaveProduct = useCallback(
    async (productData: Partial<Product>) => {
      const nowIso = new Date().toISOString()
      const clientOpId = createLocalId()
      const productId = productData.id || createLocalId()

      const fullProduct: Product = {
        ...productData,
        id: productId,
        shop_id: shopId,
        status: productData.status || 'in_stock',
        created_at: productData.created_at || nowIso,
        updated_at: nowIso,
      } as Product

      await bulkPut('products', [fullProduct])

      await enqueueOutbox({
        client_op_id: clientOpId,
        shop_id: shopId,
        entity: 'products',
        op_type: productData.id ? 'product_update' : 'product_add',
        payload: {
          ...fullProduct,
          original_updated_at: productData.updated_at || null,
        },
      })

      setProducts((prev) => {
        const exists = prev.some((p) => p.id === productId)
        if (exists) {
          return prev.map((p) => (p.id === productId ? fullProduct : p))
        }
        return [fullProduct, ...prev]
      })

      return fullProduct
    },
    [shopId]
  )

  const localDeleteProduct = useCallback(
    async (productId: string) => {
      const nowIso = new Date().toISOString()
      const clientOpId = createLocalId()

      const target = products.find((p) => p.id === productId)
      if (!target) return

      const softDeleted = { ...target, deleted_at: nowIso, updated_at: nowIso }
      await bulkPut('products', [softDeleted])

      await enqueueOutbox({
        client_op_id: clientOpId,
        shop_id: shopId,
        entity: 'products',
        op_type: 'product_delete',
        payload: { id: productId },
      })

      setProducts((prev) => prev.filter((p) => p.id !== productId))
    },
    [products, shopId]
  )

  // 5. Offline-first Customer Management
  const localAddCustomer = useCallback(
    async (customerData: Partial<Customer>) => {
      const nowIso = new Date().toISOString()
      const clientOpId = createLocalId()
      const customerId = customerData.id || createLocalId()

      const fullCustomer: Customer = {
        ...customerData,
        id: customerId,
        shop_id: shopId,
        created_at: customerData.created_at || nowIso,
        updated_at: nowIso,
      } as Customer

      await bulkPut('customers', [fullCustomer])

      await enqueueOutbox({
        client_op_id: clientOpId,
        shop_id: shopId,
        entity: 'customers',
        op_type: customerData.id ? 'update' : 'create',
        payload: fullCustomer,
      })

      setClients((prev) => {
        const exists = prev.some((c) => c.id === customerId)
        if (exists) {
          return prev.map((c) => (c.id === customerId ? fullCustomer : c))
        }
        return [fullCustomer, ...prev]
      })

      return fullCustomer
    },
    [shopId]
  )

  // 6. Offline-first Cash Operation
  const localAddCashOperation = useCallback(
    async (input: { type: 'income' | 'outcome' | 'collection'; amount: number; reason: string }) => {
      const clientOpId = createLocalId()
      const opId = createLocalId()
      const nowIso = new Date().toISOString()

      const newOp: CashOperation = {
        id: opId,
        shop_id: shopId,
        type: input.type,
        amount: input.amount,
        reason: input.reason,
        created_at: nowIso,
        client_op_id: clientOpId,
      } as CashOperation

      await bulkPut('cash_operations', [newOp])

      await enqueueOutbox({
        client_op_id: clientOpId,
        shop_id: shopId,
        entity: 'cash_operations',
        op_type: 'atomic_cash',
        payload: newOp,
      })

      setCash((prev) => ({ ...prev, operations: [newOp, ...prev.operations] }))
      return newOp
    },
    [shopId]
  )

  return {
    isReady,
    products,
    sales,
    returns,
    cash,
    rates,
    clients,
    localCheckout,
    localReturn,
    localSaveProduct,
    localDeleteProduct,
    localAddCustomer,
    localAddCashOperation,
  }
}
