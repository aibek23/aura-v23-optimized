"use client"

import type { SupplierDebtData } from "@/app/actions/suppliers"
import { SupplierPayoutPanel } from "../suppliers/supplier-payout-panel"

export function SuppliersScreen({
  supplierDebts,
  isAdmin,
}: {
  supplierDebts: SupplierDebtData
  isAdmin: boolean
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl">Поставщики</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Долги перед поставщиками, выплаты и журнал операций.
        </p>
      </div>
      <SupplierPayoutPanel data={supplierDebts} isAdmin={isAdmin} />
    </div>
  )
}
