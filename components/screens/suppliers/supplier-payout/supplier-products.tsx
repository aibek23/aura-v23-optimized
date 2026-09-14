"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Pencil, Printer, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { deleteProduct } from "@/app/actions/products"
import type { Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

interface SupplierProductsProps {
  products: Product[]
  isAdmin: boolean
  highlightedProductId?: string | null
}

/**
 * Список товаров поставщика с виртуальной пагинацией (по 30 записей).
 * Найденный через поиск товар всегда отображается, даже если он за пределами первой страницы.
 */
export function SupplierProducts({
  products,
  isAdmin,
  highlightedProductId,
}: SupplierProductsProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [visibleCount, setVisibleCount] = useState(30)

  // Сброс пагинации при смене списка товаров
  useEffect(() => {
    setVisibleCount(30)
  }, [products])

  const onDelete = async (p: Product) => {
    if (!confirm(`Удалить «${p.name}»?`)) return
    try {
      await deleteProduct(p.id)
      toast.success("Товар удалён")
      startTransition(() => router.refresh())
    } catch {
      toast.error("Не удалось удалить")
    }
  }

  // Не создаём сотни DOM-узлов при раскрытии карточки.
  // Найденный товар добавляем отдельно, даже если он дальше первой страницы.
  const visibleProducts = useMemo(() => {
    const firstPage = products.slice(0, visibleCount)
    if (
      !highlightedProductId ||
      firstPage.some((p) => p.id === highlightedProductId)
    ) {
      return firstPage
    }
    const highlighted = products.find((p) => p.id === highlightedProductId)
    return highlighted ? [...firstPage, highlighted] : firstPage
  }, [highlightedProductId, products, visibleCount])

  if (products.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Нет товаров на складе
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {visibleProducts.map((p) => (
        <div
          key={p.id}
          data-product-id={p.id}
          className={cn(
            "flex items-center gap-3 rounded-lg border bg-background px-3 py-2",
            p.id === highlightedProductId
              ? "border-primary bg-primary/10 ring-1 ring-primary/40"
              : "border-border",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium">{p.name}</div>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {p.sku || "Без артикула"}
              </span>
              {p.id === highlightedProductId && (
                <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  найдено
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">
                {formatSom(p.sale_price)}
              </span>
              {p.metal && <span>· {p.metal}</span>}
              {p.weight > 0 && <span>· {formatWeight(p.weight)}</span>}
            </div>
            <div className="mt-0.5">
              <span
                className={cn(
                  "inline-block rounded px-1.5 py-0 text-[10px] font-medium leading-4",
                  p.status === "in_stock" &&
                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                  p.status === "sold" && "bg-muted text-muted-foreground",
                  p.status === "reserved" &&
                    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                  p.status === "archived" && "bg-muted text-muted-foreground",
                  p.status === "draft" &&
                    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                )}
              >
                {p.status === "in_stock"
                  ? "В наличии"
                  : p.status === "sold"
                    ? "Продан"
                    : p.status === "reserved"
                      ? "Резерв"
                      : p.status === "archived"
                        ? "Архив"
                        : "Черновик"}
              </span>
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Печать"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Printer className="h-3.5 w-3.5" />
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  title="Редактировать"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Удалить"
                  onClick={() => onDelete(p)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {/* Кнопка «Показать ещё» */}
      {visibleCount < products.length && (
        <button
          type="button"
          onClick={() =>
            setVisibleCount((count) => Math.min(count + 30, products.length))
          }
          className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Показать ещё ({products.length - visibleCount})
        </button>
      )}
    </div>
  )
}
