"use client"

import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { Product } from "@/lib/types"
import { formatDate, formatSom, formatWeight } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil, Trash2, Printer } from "lucide-react"
import { cn } from "@/lib/utils"

interface VirtualizedSkladTableProps {
  products: Product[]
  canSeePurchasePrice: boolean
  isAdmin: boolean
  onPrint: (product: Product) => void
  onEdit: (product: Product) => void
  onDelete: (id: string) => void
}

/**
 * High-performance virtualized table component for 100,000+ items.
 * Only renders visible rows (~20 DOM elements), ensuring instant 60fps
 * scrolling on any device without memory exhaustion.
 */
export function VirtualizedSkladTable({
  products,
  canSeePurchasePrice,
  isAdmin,
  onPrint,
  onEdit,
  onDelete,
}: VirtualizedSkladTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52, // Estimated height per table row
    overscan: 5,
  })

  if (products.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Товары не найдены
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Sticky Table Header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-border text-xs font-semibold text-muted-foreground bg-muted/40 sticky top-0 z-10">
        <div className="col-span-3 sm:col-span-3">Товар / Артикул</div>
        <div className="col-span-2 sm:col-span-2">Категория</div>
        <div className="col-span-2 sm:col-span-2 text-right">Вес / Проба</div>
        <div className="col-span-2 sm:col-span-2 text-right">Цена продажи</div>
        {canSeePurchasePrice && (
          <div className="col-span-2 hidden sm:block text-right">Закупка</div>
        )}
        <div className={cn("text-right", canSeePurchasePrice ? "col-span-3 sm:col-span-1" : "col-span-3 sm:col-span-3")}>
          Действия
        </div>
      </div>

      {/* Virtualized Scrollable Area */}
      <div
        ref={parentRef}
        className="h-[550px] overflow-auto relative contain-strict"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const product = products[virtualRow.index]
            return (
              <div
                key={product.id || virtualRow.index}
                className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-border/50 text-sm hover:bg-muted/30 transition-colors absolute top-0 left-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* Product Name & SKU */}
                <div className="col-span-3 sm:col-span-3 min-w-0">
                  <div className="font-medium truncate text-foreground flex items-center gap-1.5">
                    {product.name}
                    {product.status === "reserved" && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-3.5">
                        Резерв
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {product.sku || "—"}
                  </div>
                </div>

                {/* Category */}
                <div className="col-span-2 sm:col-span-2 truncate text-muted-foreground text-xs sm:text-sm">
                  {product.category || "—"}
                </div>

                {/* Weight & Metal */}
                <div className="col-span-2 sm:col-span-2 text-right text-xs sm:text-sm">
                  <div>{formatWeight(product.weight)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {product.metal || ""}
                  </div>
                </div>

                {/* Sale Price */}
                <div className="col-span-2 sm:col-span-2 text-right font-semibold text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm">
                  {formatSom(product.sale_price)}
                </div>

                {/* Purchase Price */}
                {canSeePurchasePrice && (
                  <div className="col-span-2 hidden sm:block text-right text-xs text-muted-foreground">
                    {product.purchase_price ? formatSom(product.purchase_price) : "—"}
                  </div>
                )}

                {/* Actions */}
                <div
                  className={cn(
                    "flex items-center justify-end gap-1",
                    canSeePurchasePrice ? "col-span-3 sm:col-span-1" : "col-span-3 sm:col-span-3"
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                    onClick={() => onPrint(product)}
                    title="Печать этикетки"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(product)}
                    title="Редактировать"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(product.id)}
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border flex justify-between items-center bg-muted/20">
        <span>Всего в наличии: {products.length} позиций</span>
        <span>Виртуализация активна (~20 элементов в DOM)</span>
      </div>
    </div>
  )
}
