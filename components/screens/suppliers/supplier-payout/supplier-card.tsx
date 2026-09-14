"use client"

import { useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  History,
  Minus,
  Package,
  Plus,
} from "lucide-react"
import type { SupplierDebtData } from "@/app/actions/suppliers"
import type { Product } from "@/lib/types"
import { formatWeight } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatSom } from "@/lib/format"
import { type ActiveForm, type GoodsSummary } from "./types"
import { HistorySheet } from "./history-sheet"
import { PayForm } from "./pay-form"
import { DebtForm } from "./debt-form"
import { SupplierProducts } from "./supplier-products"

interface SupplierCardProps {
  supplier: SupplierDebtData["suppliers"][number]
  isOpen: boolean
  onToggle: () => void
  isAdmin: boolean
  goods?: GoodsSummary
  products: Product[]
  operations: SupplierDebtData["operations"]
  highlightedProductId?: string | null
}

/**
 * Аккордеон-карточка отдельного поставщика.
 * В свёрнутом виде показывает имя, количество позиций и баланс долга.
 * В развёрнутом — кнопки действий, формы выплаты/долга, металлы и список товаров.
 */
export function SupplierCard({
  supplier,
  isOpen,
  onToggle,
  isAdmin,
  goods,
  products,
  operations,
  highlightedProductId,
}: SupplierCardProps) {
  const [activeForm, setActiveForm] = useState<ActiveForm>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const toggleForm = (form: ActiveForm) => {
    setActiveForm((prev) => (prev === form ? null : form))
  }

  // Сброс форм при сворачивании карточки;
  // авто-открытие товаров если есть подсвеченный продукт
  useEffect(() => {
    if (!isOpen) {
      setActiveForm(null)
      setShowProducts(false)
    } else if (highlightedProductId) {
      setShowProducts(true)
    }
  }, [highlightedProductId, isOpen])

  const hasDebt = supplier.balance > 0

  return (
    <>
      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        supplierName={supplier.supplier_name}
        supplierPhone={supplier.supplier_phone}
        operations={operations}
      />

      <div
        className={cn(
          "rounded-2xl border bg-card transition-shadow duration-200",
          isOpen
            ? "border-primary/40 shadow-sm ring-1 ring-primary/10"
            : "border-border hover:border-border/80 hover:shadow-sm",
        )}
      >
        {/* ── Свёрнутый заголовок (всегда виден) ── */}
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold">
                {supplier.supplier_name}
              </span>
              {supplier.supplier_phone && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {supplier.supplier_phone}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {goods
                ? `${goods.count} поз. · ${goods.quantity} шт · ${formatWeight(goods.totalWeight)}`
                : "нет товаров"}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div
              className={cn(
                "font-mono text-base font-bold",
                hasDebt
                  ? "text-[#B57C1B] dark:text-[#E5AC4C]"
                  : "text-muted-foreground",
              )}
            >
              {hasDebt ? formatSom(supplier.balance) : "Без долга"}
            </div>
          </div>

          <ChevronDown
            className={cn(
              "ml-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {/* ── Развёрнутое тело ── */}
        {isOpen && (
          <div className="border-t border-border/60 px-4 pb-4 pt-3">

            {/* Кнопки действий (только для администратора) */}
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={activeForm === "pay" ? "secondary" : "default"}
                  disabled={!hasDebt}
                  onClick={() => toggleForm("pay")}
                  className="gap-1.5"
                >
                  <Minus className="h-3.5 w-3.5" />
                  Рассчитаться
                </Button>
                <Button
                  size="sm"
                  variant={activeForm === "debt" ? "secondary" : "outline"}
                  onClick={() => toggleForm("debt")}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Долг
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHistoryOpen(true)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <History className="h-3.5 w-3.5" />
                  История
                </Button>
              </div>
            )}

            {/* Форма выплаты */}
            {activeForm === "pay" && isAdmin && (
              <PayForm
                supplierName={supplier.supplier_name}
                supplierPhone={supplier.supplier_phone}
                balance={supplier.balance}
                onSuccess={() => setActiveForm(null)}
                onCancel={() => setActiveForm(null)}
              />
            )}

            {/* Форма изменения долга */}
            {activeForm === "debt" && isAdmin && (
              <DebtForm
                supplierName={supplier.supplier_name}
                supplierPhone={supplier.supplier_phone}
                onSuccess={() => setActiveForm(null)}
                onCancel={() => setActiveForm(null)}
              />
            )}

            {/* Остатки по металлам */}
            {goods && (
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Остатки по металлам
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(goods.byMetal).map(([metal, stats]) => (
                    <div
                      key={metal}
                      className="flex min-w-0 justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate text-muted-foreground">{metal}</span>
                      <span className="shrink-0 font-mono text-foreground">
                        {stats.quantity} шт · {formatWeight(stats.weight)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Переключатель списка товаров */}
            <button
              type="button"
              onClick={() => setShowProducts((v) => !v)}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Package className="h-3.5 w-3.5" />
              Товары
              {goods ? ` (${goods.quantity} шт)` : ""}
              {showProducts ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {showProducts && (
              <div className="mt-2">
                <SupplierProducts
                  products={products}
                  isAdmin={isAdmin}
                  highlightedProductId={highlightedProductId}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
