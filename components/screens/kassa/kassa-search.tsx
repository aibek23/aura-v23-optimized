"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PackageSearch, Plus, Clock } from "lucide-react"
import { formatDate, formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Product } from "@/lib/types"
import { ProductSearch } from "@/components/product-search"
import { isSearchReady } from "@/lib/product-search"

interface KassaSearchProps {
  query: string
  setQuery: (q: string) => void
  debounced: string
  results: Product[]
  visible: number
  setVisible: React.Dispatch<React.SetStateAction<number>>
  pageSize: number
  trackRef: React.RefObject<HTMLDivElement | null>
  onTrackScroll: () => void
  qtyInCart: (id: string) => number
  addToCart: (p: Product) => void
  minQuery: number
  recent?: Product[]
}

// Компактная карточка-строка для быстрого поиска и работы без изображений
function ProductRow({
  p,
  inCart,
  full,
  isLoss,
  addToCart,
}: {
  p: Product
  inCart: number
  full: boolean
  isLoss: boolean
  addToCart: (p: Product) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-2.5 transition-all bg-card/90 hover:border-primary/50 shadow-sm",
        isLoss ? "border-destructive/40 bg-destructive/5" : "border-border/60"
      )}
    >
      {/* Отображаем картинку только если она реально есть */}
      {p.image_url && (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/50">
          <img
            src={p.image_url}
            alt={p.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Основная инфо о товаре */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-xs font-bold text-primary truncate">
            {p.sku || "Без Арт."}
          </span>
          {inCart > 0 && (
            <Badge className="bg-primary text-primary-foreground font-mono text-[9px] px-1 py-0 h-4">
              {inCart} в чеке
            </Badge>
          )}
        </div>

        <p className="text-xs font-medium text-foreground truncate leading-snug">
          {p.name}
        </p>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
          <span>{p.metal}</span>
          <span>•</span>
          <span>{formatWeight(p.weight)}</span>
          <span>•</span>
          <span className="truncate">{p.supplier_name || "Без поставщика"}</span>
          <span>•</span>
          <span>{formatDate(p.created_at)}</span>
        </div>
      </div>

      {/* Правая часть: Цена и Кнопка */}
      <div className="flex items-center gap-2 shrink-0 pl-1 border-l border-border/40">
        <div className="text-right">
          <span className="block font-mono text-xs sm:text-sm font-bold text-foreground">
            {formatSom(p.sale_price)}
          </span>
        </div>

        <Button
          size="sm"
          className={cn(
            "h-9 px-3 text-xs font-medium transition-transform active:scale-95 rounded-lg",
            full ? "opacity-50" : "shadow-sm"
          )}
          variant={full ? "secondary" : "default"}
          disabled={full}
          onClick={() => addToCart(p)}
        >
          <Plus className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{full ? "Макс" : "В чек"}</span>
        </Button>
      </div>
    </div>
  )
}

export function KassaSearch({
  query,
  setQuery,
  debounced,
  results,
  visible,
  setVisible,
  pageSize,
  trackRef,
  onTrackScroll,
  qtyInCart,
  addToCart,
  minQuery,
  recent = [],
}: KassaSearchProps) {
  const isSearching = isSearchReady(query, minQuery)
  const isTooShort = query.trim().length > 0 && query.trim().length < minQuery && !isSearchReady(query, minQuery)
  const showRecent = query.trim().length === 0 && recent.length > 0

  return (
    <div className="w-full space-y-3 min-w-0 max-w-full">
      {/* Поисковая панель */}
      <ProductSearch
        value={query}
        onChange={setQuery}
        placeholder="Артикул, название, 1,25 г, 12300 с, 11.09.2026..."
        className="w-full"
        inputClassName="h-11 rounded-xl bg-card text-sm shadow-sm"
      />

      {isTooShort && (
        <p className="text-center text-xs text-muted-foreground py-1">
          Введите от <span className="font-semibold text-foreground">{minQuery}</span> символов
        </p>
      )}

      {/* Основной список результатов */}
      <div className="relative w-full">
        {query.trim().length === 0 && recent.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 py-8 text-center bg-card/30">
            <PackageSearch className="mx-auto h-7 w-7 text-muted-foreground/40 mb-1.5" />
            <p className="text-xs text-muted-foreground">Введите артикул или название товара</p>
          </div>
        )}

        {showRecent && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground px-1">
              <Clock className="h-3.5 w-3.5" />
              Недавно добавленные
            </div>
            <div className="flex flex-col gap-2">
              {recent.map((p) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  inCart={qtyInCart(p.id)}
                  full={qtyInCart(p.id) >= p.quantity}
                  isLoss={p.sale_price < p.purchase_price}
                  addToCart={addToCart}
                />
              ))}
            </div>
          </div>
        )}

        {isSearching && (
          !isSearchReady(debounced, minQuery) ? null : results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 py-8 text-center bg-card/30">
              <p className="text-xs font-medium text-muted-foreground">Ничего не найдено</p>
            </div>
          ) : (
            <div
              ref={trackRef}
              onScroll={onTrackScroll}
              className="flex flex-col gap-2 max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin"
            >
              {results.slice(0, visible).map((p) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  inCart={qtyInCart(p.id)}
                  full={qtyInCart(p.id) >= p.quantity}
                  isLoss={p.sale_price < p.purchase_price}
                  addToCart={addToCart}
                />
              ))}

              {visible < results.length && (
                <Button
                  variant="ghost"
                  onClick={() => setVisible((v) => Math.min(v + pageSize, results.length))}
                  className="w-full text-xs text-muted-foreground mt-1"
                >
                  Показать ещё
                </Button>
              )}
            </div>
          )
        )}
      </div>

    </div>
  )
}
