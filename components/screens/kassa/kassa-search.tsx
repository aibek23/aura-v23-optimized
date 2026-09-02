"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, PackageSearch, Sparkles, Plus, Camera, Clock } from "lucide-react"
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
  /** Последние добавленные изделия — показываем в пустом состоянии. */
  recent?: Product[]
}

/**
 * Извлекает SKU из QR-URL.
 *
 * Поддерживаемые форматы:
 *   • Новый:    https://aura-gold.kg/q/{shopSeqId}/{SKU}
 *   • Старый:   https://aura-gold.kg/{store_id}/product/{sku}
 *   • Без домена (штрихкод / произвольная строка) → возвращается как есть.
 */
function extractSkuFromScan(raw: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://aura-gold.kg").replace(/\/$/, "")
  if (!raw.includes(base)) return raw
  try {
    const url = new URL(raw)
    const segments = url.pathname.split("/").filter(Boolean)
    // Новый маршрут: /q/{shopId}/{SKU}
    if (segments[0] === "q" && segments.length >= 3) {
      return decodeURIComponent(segments[2]).toUpperCase()
    }
    // Старый маршрут: …/product/{sku}
    const productIdx = segments.lastIndexOf("product")
    if (productIdx !== -1 && segments[productIdx + 1]) {
      return decodeURIComponent(segments[productIdx + 1]).toUpperCase()
    }
  } catch {
    // не валидный URL — берём последний сегмент пути как fallback
    const parts = raw.split("/").filter(Boolean)
    if (parts.length) return decodeURIComponent(parts[parts.length - 1]).toUpperCase()
  }
  return raw
}

// Карточка товара — единый компонент для списка результатов и «недавних».
function ProductCard({
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
        "flex flex-col h-full w-full rounded-xl border bg-card/80 backdrop-blur p-3 transition-all duration-200 hover:shadow-lg hover:border-primary/40 hover:-translate-y-0.5",
        isLoss ? "border-destructive/50 bg-destructive/5" : "border-border/80",
      )}
    >
      <div className="relative mb-2.5 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted/60 shrink-0 group">
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <Sparkles className="h-7 w-7 text-muted-foreground/30" />
        )}
        {inCart > 0 && (
          <Badge className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground font-mono text-[10px] px-1.5 py-0.2 shadow-sm">
            {inCart} в чеке
          </Badge>
        )}
      </div>

      <span className="line-clamp-2 text-xs font-semibold leading-tight min-h-[2rem]" title={p.name}>
        {p.name}
      </span>

      <div className="mt-2 space-y-0.5 text-[11px]">
        <div className="font-mono font-medium text-primary/90 truncate">Арт: {p.sku || "—"}</div>
        <div className="text-muted-foreground truncate text-[10px]">
          {p.metal} · {formatWeight(p.weight)}
        </div>
        <div className="text-muted-foreground text-[10px]">
          В наличии: <span className="font-medium text-foreground">{p.quantity} шт.</span>
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-border/40">
        <span className="block font-mono text-sm font-bold text-primary mb-2">{formatSom(p.sale_price)}</span>
        <Button
          size="sm"
          className={cn("h-8 text-xs w-full font-medium transition-all", full ? "opacity-60" : "shadow-sm")}
          variant={full ? "secondary" : "default"}
          disabled={full}
          onClick={() => addToCart(p)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {full ? "Макс." : "В чек"}
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

  // true — идёт активный поиск (строка непустая и достаточно символов)
  const isSearching = query.trim().length >= minQuery
  // true — введено что-то, но меньше minQuery символов
  const isTooShort = query.trim().length > 0 && query.trim().length < minQuery
  // показываем «недавние» только когда строка пуста
  const showRecent = query.trim().length === 0 && recent.length > 0

  return (
    <div className="w-full space-y-3 min-w-0 max-w-full">
      {/* Строка поиска и кнопка сканирования */}
      <div className="flex items-center gap-2">
        <div className="relative group flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input
            placeholder="Поиск: название, артикул, металл (от 3 символов)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 h-11 text-sm bg-card/60 backdrop-blur border-border/80 rounded-xl focus-visible:ring-1 focus-visible:ring-primary shadow-sm transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted rounded-md px-1.5 py-0.5"
            >
              Очистить
            </button>
          )}
        </div>

        <Button
          variant="outline"
          className="h-11 px-3.5 shrink-0 bg-card/60 backdrop-blur border-border/80 text-foreground hover:bg-muted rounded-xl shadow-sm"
          onClick={() => setIsScannerOpen(true)}
          title="Быстрое сканирование QR / Штрихкод"
        >
          <Camera className="h-4 w-4 text-primary sm:mr-1.5" />
          <span className="hidden sm:inline text-xs font-medium">Сканировать QR / Штрихкод</span>
        </Button>
      </div>

      {/* Подсказка «введите минимум N символов» */}
      {isTooShort && (
        <div className="rounded-xl border border-border/50 bg-muted/20 p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Введите минимум <span className="font-semibold text-foreground">{minQuery}</span> символа для начала поиска
          </p>
        </div>
      )}

      {/* Область результатов / недавних — единый контейнер */}
      <div className="relative w-full overflow-hidden">
        {/* Пустое состояние: строка пуста, недавних нет */}
        {query.trim().length === 0 && recent.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center bg-card/20">
            <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs font-medium text-muted-foreground">
              Введите артикул или название ювелирного изделия
            </p>
          </div>
        )}

        {/* Недавно добавленные — показываются по умолчанию, скрываются при поиске */}
        {showRecent && (
          <div className="rounded-2xl border border-border/70 bg-card/50 p-3">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Последние добавленные изделия
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            >
              {recent.map((p) => (
                <ProductCard
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

        {/* Результаты поиска */}
        {isSearching &&
          (debounced.length < minQuery ? null : results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 py-10 text-center text-sm text-muted-foreground bg-card/30">
              <p className="font-medium">Ничего не найдено</p>
              <p className="text-xs text-muted-foreground/80 mt-1">Проверьте правильность запроса</p>
            </div>
          ) : (
            <div
              ref={trackRef}
              onScroll={onTrackScroll}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[58vh] overflow-y-auto p-1 pr-2 scrollbar-thin shadow-inner rounded-xl"
            >
              {results.slice(0, visible).map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  inCart={qtyInCart(p.id)}
                  full={qtyInCart(p.id) >= p.quantity}
                  isLoss={p.sale_price < p.purchase_price}
                  addToCart={addToCart}
                />
              ))}

              {visible < results.length && (
                <button
                  onClick={() => setVisible((v) => Math.min(v + pageSize, results.length))}
                  className="flex w-full min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 text-xs text-muted-foreground transition-all hover:bg-muted/50 hover:border-primary/50"
                >
                  <Plus className="h-5 w-5 mb-1 opacity-70" />
                  Показать ещё
                </button>
              )}
            </div>
          ))}
      </div>

      {/* Модальное окно сканера */}
      {isScannerOpen && (
        <BarcodeScannerModal
          onClose={() => setIsScannerOpen(false)}
          onScan={(raw) => {
            // Если QR содержит URL нашего домена — извлекаем SKU из пути.
            const sku = extractSkuFromScan(raw)
            setQuery(sku)
            toast.success(`Код успешно считан: ${sku}`)
          }}
        />
      )}
    </div>
  )
}