"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Product } from "@/lib/types"
import { CATEGORIES } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Eye, EyeOff, Search, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { updateProduct } from "@/app/actions/products"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

function galleryOf(p: Product): string[] {
  const list = (p.images ?? []).filter(Boolean)
  if (list.length) return list
  return p.image_url ? [p.image_url] : []
}

function isActive(p: Product) {
  return p.quantity > 0 && p.status !== "sold"
}

export function VitrinaScreen({
  products,
  canSeePurchasePrice,
  isAdmin,
}: {
  products: Product[]
  canSeePurchasePrice: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [selected, setSelected] = useState<Product | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    const rows = products.filter(
      (p) =>
        // Покупатель не видит скрытые товары; администратор видит все
        (isAdmin || !p.is_hidden) &&
        (category === "all" || p.category === category) &&
        (p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)),
    )
    return rows.slice().sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
  }, [products, query, category, isAdmin])

  const handleToggleVisibility = async (p: Product) => {
    setTogglingId(p.id)
    try {
      await updateProduct(p.id, { is_hidden: !p.is_hidden })
      toast.success(p.is_hidden ? `«${p.name}» теперь виден на витрине` : `«${p.name}» скрыт от покупателей`)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3">
        <div>
          <h1 className="font-serif text-2xl">Витрина</h1>
          <p className="text-sm text-muted-foreground">Каталог украшений магазина</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Поиск..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            <CategoryChip active={category === "all"} onClick={() => setCategory("all")}>
              Все
            </CategoryChip>
            {CATEGORIES.map((c) => (
              <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </CategoryChip>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
          Товары не найдены
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => {
            const margin = p.sale_price - p.purchase_price
            const photos = galleryOf(p)
            const active = isActive(p)
            const hidden = !!p.is_hidden
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                className={cn(
                  "group overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:border-primary/40 hover:shadow-xl",
                  !active && "opacity-70",
                  hidden && isAdmin && "ring-2 ring-amber-400/60",
                )}
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
                  {photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photos[0]}
                      alt={p.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <Sparkles className="h-10 w-10 text-muted-foreground/40" />
                  )}
                  {photos.length > 1 && (
                    <span className="absolute right-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium">
                      {photos.length} фото
                    </span>
                  )}
                  {!active && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <Badge variant="destructive">Продано</Badge>
                    </div>
                  )}
                  {/* Бейдж «Скрыт» виден только администратору */}
                  {hidden && isAdmin && (
                    <div className="absolute left-2 top-2">
                      <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700 text-[10px] dark:bg-amber-950 dark:text-amber-300">
                        <EyeOff className="mr-1 h-2.5 w-2.5" />
                        Скрыт
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-medium">{p.name}</h3>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{p.sku}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.metal} · {formatWeight(p.weight)}
                    {p.size ? ` · р.${p.size}` : ""}
                  </p>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="font-mono text-base font-semibold text-primary">{formatSom(p.sale_price)}</span>
                    {canSeePurchasePrice && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        закуп {formatSom(p.purchase_price)}
                      </span>
                    )}
                  </div>
                  {canSeePurchasePrice && <div className="text-[11px] text-success">маржа {formatSom(margin)}</div>}
                  {/* Переключатель видимости — только для администратора */}
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "mt-1 h-7 w-full gap-1 text-[11px]",
                        hidden
                          ? "border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
                          : "text-muted-foreground",
                      )}
                      disabled={togglingId === p.id}
                      onClick={(e) => { e.stopPropagation(); void handleToggleVisibility(p) }}
                    >
                      {hidden ? (
                        <><Eye className="h-3 w-3" /> Показать</>
                      ) : (
                        <><EyeOff className="h-3 w-3" /> Скрыть</>
                      )}
                    </Button>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <ProductOverlay
          product={selected}
          canSeePurchasePrice={canSeePurchasePrice}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onToggleVisibility={handleToggleVisibility}
          togglingId={togglingId}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------- полноэкранный просмотр */

function ProductOverlay({
  product,
  canSeePurchasePrice,
  isAdmin,
  onClose,
  onToggleVisibility,
  togglingId,
}: {
  product: Product
  canSeePurchasePrice: boolean
  isAdmin: boolean
  onClose: () => void
  onToggleVisibility: (p: Product) => void
  togglingId: string | null
}) {
  const photos = galleryOf(product)
  const active = isActive(product)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl p-4 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-4 top-4 z-10 rounded-full border border-border bg-background p-2 text-muted-foreground transition-colors hover:text-foreground md:right-8 md:top-8"
        >
          <X className="h-4 w-4" />
        </button>

        <Carousel photos={photos} alt={product.name} sold={!active} />

        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl">{product.name}</h2>
              <p className="text-sm text-muted-foreground">
                {product.category} · {product.metal}
                {product.purity ? ` · проба ${product.purity}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={active ? "secondary" : "destructive"}>{active ? "В наличии" : "Продано"}</Badge>
              {product.is_hidden && (
                <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <EyeOff className="mr-1 h-3 w-3" />Скрыт
                </Badge>
              )}
            </div>
          </div>

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5",
                product.is_hidden
                  ? "border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
              disabled={togglingId === product.id}
              onClick={() => onToggleVisibility(product)}
            >
              {product.is_hidden
                ? <><Eye className="h-3.5 w-3.5" /> Показать на витрине</>
                : <><EyeOff className="h-3.5 w-3.5" /> Скрыть от покупателей</>}
            </Button>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Артикул" value={product.sku || "—"} />
            <Info label="Вес" value={formatWeight(product.weight)} />
            <Info label="Размер" value={product.size || "—"} />
            <Info label="Остаток" value={String(product.quantity)} />
            <Info label="Цена" value={formatSom(product.sale_price)} accent />
            {canSeePurchasePrice && <Info label="Закупка" value={formatSom(product.purchase_price)} />}
            {canSeePurchasePrice && (
              <Info label="Маржа" value={formatSom(product.sale_price - product.purchase_price)} />
            )}
            {canSeePurchasePrice && product.supplier_name && (
              <Info label="Поставщик" value={product.supplier_name} />
            )}
            {canSeePurchasePrice && product.supplier_phone && (
              <Info label="Телефон" value={product.supplier_phone} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate font-mono text-sm font-medium", accent && "text-primary")}>{value}</div>
    </div>
  )
}

/* ------------------------------------------------------------- карусель */

function Carousel({ photos, alt, sold }: { photos: string[]; alt: string; sold: boolean }) {
  const [index, setIndex] = useState(0)
  const startX = useRef<number | null>(null)

  const count = photos.length
  const go = (next: number) => {
    if (count === 0) return
    setIndex(((next % count) + count) % count)
  }

  if (count === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-border bg-muted">
        <Sparkles className="h-12 w-12 text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted"
        onTouchStart={(e) => {
          startX.current = e.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(e) => {
          const x0 = startX.current
          const x1 = e.changedTouches[0]?.clientX ?? null
          startX.current = null
          if (x0 == null || x1 == null) return
          const dx = x1 - x0
          if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1))
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[index]} alt={`${alt} — фото ${index + 1}`} className="h-full w-full object-cover" />
        {sold && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Badge variant="destructive" className="text-sm">
              Продано
            </Badge>
          </div>
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Предыдущее фото"
              onClick={() => go(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 transition-colors hover:bg-background"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Следующее фото"
              onClick={() => go(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 transition-colors hover:bg-background"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {photos.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Фото ${i + 1}`}
              onClick={() => go(i)}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index ? "w-5 bg-primary" : "w-2 bg-muted-foreground/40 hover:bg-muted-foreground",
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
