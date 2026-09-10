"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, PackageSearch, Plus, Camera, Clock, X } from "lucide-react"
import { formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { Product } from "@/lib/types"
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal"

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

function extractSkuFromScan(raw: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://aura-gold.kg").replace(/\/$/, "")
  if (!raw.includes(base)) return raw
  try {
    const url = new URL(raw)
    const segments = url.pathname.split("/").filter(Boolean)
    if (segments[0] === "q" && segments.length >= 3) {
      return decodeURIComponent(segments[2]).toUpperCase()
    }
    const productIdx = segments.lastIndexOf("product")
    if (productIdx !== -1 && segments[productIdx + 1]) {
      return decodeURIComponent(segments[productIdx + 1]).toUpperCase()
    }
  } catch {
    const parts = raw.split("/").filter(Boolean)
    if (parts.length) return decodeURIComponent(parts[parts.length - 1]).toUpperCase()
  }
  return raw
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
          <span className={cn(p.quantity <= 1 && "text-amber-600 font-medium")}>
            {p.quantity} шт.
          </span>
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
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  const isSearching = query.trim().length >= minQuery
  const isTooShort = query.trim().length > 0 && query.trim().length < minQuery
  const showRecent = query.trim().length === 0 && recent.length > 0

  return (
    <div className="w-full space-y-3 min-w-0 max-w-full">
      {/* Поисковая панель */}
      <div className="flex items-center gap-2">
        <div className="relative group flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input
            placeholder="Поиск: артикул, название..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-8 h-11 text-sm bg-card backdrop-blur border-border/80 rounded-xl focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Button
          variant="outline"
          className="h-11 px-3.5 shrink-0 bg-card border-border/80 rounded-xl shadow-sm"
          onClick={() => setIsScannerOpen(true)}
          title="Сканировать QR"
        >
          <Camera className="h-4 w-4 text-primary sm:mr-1.5" />
          <span className="hidden sm:inline text-xs font-medium">Сканер</span>
        </Button>
      </div>

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
          debounced.length < minQuery ? null : results.length === 0 ? (
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

      {isScannerOpen && (
        <BarcodeScannerModal
          onClose={() => setIsScannerOpen(false)}
          onScan={(raw) => {
            const sku = extractSkuFromScan(raw)
            setQuery(sku)
            toast.success(`Код считан: ${sku}`)
          }}
        />
      )}
    </div>
  )
}