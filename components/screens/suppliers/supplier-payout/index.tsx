"use client"

import { useEffect, useMemo, useState } from "react"
import { WalletCards } from "lucide-react"
import type { SupplierDebtData } from "@/app/actions/suppliers"
import type { Product } from "@/lib/types"
import { matchesParsedProduct, parseProductSearchQuery } from "@/lib/product-search"
import { type GoodsSummary, type SearchMatch, supplierKey } from "./types"
import { SupplierCard } from "./supplier-card"

interface SupplierPayoutPanelProps {
  data: SupplierDebtData
  isAdmin: boolean
  goodsBySupplier?: Map<string, GoodsSummary>
  productsBySupplier?: Map<string, Product[]>
  query?: string
}

export function SupplierPayoutPanel({
  data,
  isAdmin,
  goodsBySupplier,
  productsBySupplier,
  query,
}: SupplierPayoutPanelProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)

  // 1. Поиск совпадений (Хук #1)
  const searchMatch = useMemo<SearchMatch | null>(() => {
    const normalizedQuery = query?.trim()
    if (!normalizedQuery || !productsBySupplier) return null
    const parsed = parseProductSearchQuery(normalizedQuery)

    for (const supplier of data.suppliers) {
      const key = supplierKey(supplier.supplier_name, supplier.supplier_phone)
      const products = productsBySupplier.get(key) ?? []
      const supplierText = [supplier.supplier_name, supplier.supplier_phone]
        .map((value) =>
          String(value ?? "")
            .toLocaleLowerCase("ru-RU")
            .replaceAll("ё", "е"),
        )
        .join("\u0000")

      if (parsed.kind === "text" && supplierText.includes(parsed.value)) {
        return { key, productId: null }
      }
      const product = products.find((item) => matchesParsedProduct(item, parsed))
      if (product) return { key, productId: product.id }
    }
    return null
  }, [data.suppliers, productsBySupplier, query])

  // 2. Сортировка поставщиков (Хук #2 — ПЕРЕНЕСЕН ВВЕРХ)
  const orderedSuppliers = useMemo(() => {
    if (!searchMatch) return data.suppliers
    return [...data.suppliers].sort((a, b) => {
      const aKey = supplierKey(a.supplier_name, a.supplier_phone)
      const bKey = supplierKey(b.supplier_name, b.supplier_phone)
      return aKey === searchMatch.key ? -1 : bKey === searchMatch.key ? 1 : 0
    })
  }, [data.suppliers, searchMatch])

  // 3. Эффект для раскрытия найденной карточки (Хук #3)
  useEffect(() => {
    if (searchMatch) setOpenKey(searchMatch.key)
  }, [searchMatch])

  const toggle = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key))
  }

  // ✅ Теперь ВСЕ хуки вызваны выше. Ранний return абсолютно безопасен!
  if (data.suppliers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
        <WalletCards className="mx-auto mb-3 h-8 w-8 opacity-30" />
        {query
          ? "По заданным параметрам поставщики и товары не найдены."
          : "Пока нет поставщиков или товаров с указанным поставщиком."}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {orderedSuppliers.map((supplier) => {
        const key = supplierKey(supplier.supplier_name, supplier.supplier_phone)
        return (
          <SupplierCard
            key={key}
            supplier={supplier}
            isOpen={openKey === key}
            onToggle={() => toggle(key)}
            isAdmin={isAdmin}
            goods={goodsBySupplier?.get(key)}
            products={productsBySupplier?.get(key) ?? []}
            operations={data.operations}
            highlightedProductId={
              searchMatch?.key === key ? searchMatch.productId : null
            }
          />
        )
      })}
    </div>
  )
}