"use client"

import { useMemo, useState } from "react"
import type { SupplierDebtData } from "@/app/actions/suppliers"
import type { Product, Sale, SupplierDebtSummary } from "@/lib/types"
import { SupplierPayoutPanel } from "../suppliers/supplier-payout-panel"
import { ProductSearch } from "@/components/product-search"
import { matchesSupplier } from "@/lib/product-search"

const NO_SUPPLIER_KEY = "__no_supplier__"

type SupplierGroup = {
  key: string
  name: string
  phone: string | null
  items: Product[]
  totalWeight: number
  totalQuantity: number
  byMetal: Record<string, { quantity: number; weight: number }>
}

function supplierKey(name: string, phone: string | null) {
  return `${name}\u0000${phone ?? ""}`
}

export function SuppliersScreen({
  supplierDebts,
  products = [],
  sales = [],
  isAdmin,
}: {
  supplierDebts: SupplierDebtData
  products?: Product[]
  sales?: Sale[]
  isAdmin: boolean
}) {
  const groups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>()
    for (const product of products) {
      const name = product.supplier_name?.trim() || "Без поставщика"
      const phone = name === "Без поставщика" ? null : product.supplier_phone?.trim() || null
      const key = name === "Без поставщика" ? NO_SUPPLIER_KEY : supplierKey(name, phone)
      let group = map.get(key)
      if (!group) {
        group = { key, name, phone, items: [], totalWeight: 0, totalQuantity: 0, byMetal: {} }
        map.set(key, group)
      }
      const quantity = Math.max(Number(product.quantity) || 0, 0)
      group.items.push(product)
      group.totalQuantity += quantity
      group.totalWeight += (Number(product.weight) || 0) * quantity
      const metal = product.metal?.trim() || "Без металла"
      const metalStats = group.byMetal[metal] ?? { quantity: 0, weight: 0 }
      metalStats.quantity += quantity
      metalStats.weight += (Number(product.weight) || 0) * quantity
      group.byMetal[metal] = metalStats
    }
    return [...map.values()].sort((a, b) => b.totalWeight - a.totalWeight)
  }, [products])

  // Поставщик может быть указан в товаре без операции «На реализацию».
  // В таком случае показываем его с нулевым долгом, но с товарами.
  const supplierData = useMemo<SupplierDebtData>(() => {
    const byKey = new Map<string, SupplierDebtSummary>()
    for (const supplier of supplierDebts.suppliers) {
      byKey.set(supplierKey(supplier.supplier_name, supplier.supplier_phone), supplier)
    }

    for (const group of groups) {
      if (group.key === NO_SUPPLIER_KEY) continue
      if (byKey.has(group.key)) continue
      byKey.set(group.key, {
        supplier_name: group.name,
        supplier_phone: group.phone,
        balance: 0,
        last_operation_at: group.items[0]?.created_at ?? new Date(0).toISOString(),
      })
    }

    return {
      operations: supplierDebts.operations,
      suppliers: [...byKey.values()].sort(
        (a, b) => b.balance - a.balance || a.supplier_name.localeCompare(b.supplier_name),
      ),
    }
  }, [groups, supplierDebts])

  // Сводка по товарам для карточек поставщиков
  const goodsBySupplier = useMemo(() => {
    const map = new Map<string, {
      count: number
      quantity: number
      totalWeight: number
      byMetal: Record<string, { quantity: number; weight: number }>
    }>()
    for (const group of groups) {
      if (group.key === NO_SUPPLIER_KEY) continue
      map.set(group.key, {
        count: group.items.length,
        quantity: group.totalQuantity,
        totalWeight: group.totalWeight,
        byMetal: group.byMetal,
      })
    }
    return map
  }, [groups])

  // Товары по поставщику для встроенного списка внутри карточки
  const productsBySupplier = useMemo(() => {
    const map = new Map<string, Product[]>()
    for (const group of groups) {
      if (group.key === NO_SUPPLIER_KEY) continue
      map.set(group.key, group.items)
    }
    return map
  }, [groups])

  const [query, setQuery] = useState("")
  const filteredData = useMemo<SupplierDebtData>(() => {
    if (!query.trim()) return supplierData
    const visible = supplierData.suppliers.filter((supplier) =>
      matchesSupplier(
        supplier.supplier_name,
        supplier.supplier_phone,
        productsBySupplier.get(supplierKey(supplier.supplier_name, supplier.supplier_phone)) ?? [],
        query,
      ),
    )
    return { ...supplierData, suppliers: visible }
  }, [productsBySupplier, query, supplierData])

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="font-serif text-2xl">Поставщики</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {supplierData.suppliers.length > 0
            ? `${supplierData.suppliers.length} поставщиков · долги, выплаты и история операций`
            : "Долги перед поставщиками, выплаты и журнал операций."}
        </p>
      </div>

      <ProductSearch
        value={query}
        onChange={setQuery}
        placeholder="Поставщик, телефон, товар, 1,25 г, 12300 с, 11.09.2026..."
        className="w-full sm:max-w-xl"
      />

      {/* Desktop: 2-column grid when many suppliers, single column otherwise */}
      <div
        className={
          filteredData.suppliers.length >= 3
            ? "lg:grid lg:grid-cols-2 lg:gap-3 space-y-2 lg:space-y-0"
            : "space-y-2"
        }
      >
        <SupplierPayoutPanel
          data={filteredData}
          isAdmin={isAdmin}
          goodsBySupplier={goodsBySupplier}
          productsBySupplier={productsBySupplier}
          query={query}
        />
      </div>
    </div>
  )
}
