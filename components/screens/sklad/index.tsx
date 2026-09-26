"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import dynamic from "next/dynamic"
import type { Product, Sale } from "@/lib/types"
import { DEFAULT_SIZE_KEY, getLabelSizeDef, getPrinterProfile, PRINTER_PROFILES, type JewelryLabelSizeKey } from "@/lib/niimbot"
import { formatDate, formatSom, formatWeight } from "@/lib/format"
import { deleteProduct, getShopSeqIdForLabel } from "@/app/actions/products"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Pencil, Trash2, Sparkles, PackageX, Printer, Plus, ChevronLeft, ChevronRight, CheckCircle2, Layers } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { ProductDialog } from "@/components/screens/sklad/add-edit-Product/product-dialog"
import { SkladStats } from "./sklad-stats"
import { cn } from "@/lib/utils"
import { filterProducts } from "@/lib/product-search"
import { ProductSearch } from "@/components/product-search"
import { VirtualizedSkladTable } from "./virtualized-sklad-table"

// Загружаем LabelEditor строго на клиенте для корректного связывания пакетов Bluetooth
const LabelEditor = dynamic(
  () => import("./label/label-editor").then((mod) => mod.LabelEditor),
  { ssr: false }
)

const PAGE_SIZE = 20
const MODEL_STORAGE_KEY = "sklad:printer-model"

const isValidShopSeqId = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0

export function SkladScreen({
  products,
  sales = [],
  canSeePurchasePrice,
  isAdmin,
  title = "Склад",
  subtitle = "Учёт товарных остатков",
  showStats = true,
  showAdd = true,
}: {
  products: Product[]
  sales?: Sale[]
  canSeePurchasePrice: boolean
  isAdmin: boolean
  title?: string
  subtitle?: string
  showStats?: boolean
  showAdd?: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [labelProduct, setLabelProduct] = useState<Product | null>(null)
  const [labelDialogOpen, setLabelDialogOpen] = useState(false)
  const [labelAutoPrint, setLabelAutoPrint] = useState(false)
  const [labelSizeKey, setLabelSizeKey] = useState<JewelryLabelSizeKey>(DEFAULT_SIZE_KEY)
  const [printerKey, setPrinterKey] = useState("b1")
  const [virtualMode, setVirtualMode] = useState(false)

  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const printerProfile = getPrinterProfile(printerKey)
  const nativeWidth = Math.round(getLabelSizeDef(labelSizeKey).w_px * printerProfile.dpi / 203)
  const fitsPrinthead = nativeWidth <= printerProfile.printheadPx

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY)
      if (saved && PRINTER_PROFILES.some((profile) => profile.key === saved)) setPrinterKey(saved)
    } catch {
      // Если хранение недоступно, используем B1.
    }
  }, [])

  const filtered = useMemo(() => {
    return filterProducts(products, query)
  }, [products, query])

  // Сбрасываем страницу при смене фильтра
  const handleQueryChange = (v: string) => {
    setQuery(v)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const salesByProduct = useMemo(() => {
    const map = new Map<string, ActualSaleSummary>()
    for (const sale of sales) {
      for (const item of sale.items ?? []) {
        if (item.kind === "scrap" || !item.product_id) continue
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1))
        const price = Number(item.price) || 0
        const cost = Number(item.cost) || 0
        const current = map.get(item.product_id) ?? {
          units: 0,
          revenue: 0,
          cost: 0,
          prices: [],
        }
        current.units += quantity
        current.revenue += price * quantity
        current.cost += cost * quantity
        current.prices.push(price)
        map.set(item.product_id, current)
      }
    }
    return map
  }, [sales])

  const openLabel = async (p: Product, autoPrint: boolean) => {
    try {
      const cachedSeqId = isValidShopSeqId(p.shop_seq_id)
        ? p.shop_seq_id
        : products.find((row) => row.shop_id === p.shop_id && isValidShopSeqId(row.shop_seq_id))?.shop_seq_id
      const shopSeqId = isValidShopSeqId(cachedSeqId)
        ? cachedSeqId
        : await getShopSeqIdForLabel(p.shop_id)
      setLabelProduct({ ...p, shop_seq_id: shopSeqId })
      setLabelAutoPrint(autoPrint)
      setLabelSizeKey(printerProfile.defaultLabelKey)
      setLabelDialogOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подготовить QR-код для этикетки")
    }
  }

  const onPrintLabel = (p: Product) => {
    void openLabel(p, false)
  }

  /** Автопечать при сохранении товара из модального окна. */
  const onAutoPrintLabel = (p: Product) => {
    void openLabel(p, true)
  }

  const onAdd = () => {
    setEditing(null)
    setProductDialogOpen(true)
  }

  const onEdit = (p: Product) => {
    setEditing(p)
    setProductDialogOpen(true)
  }

  const onDelete = async (p: Product) => {
    if (!confirm(`Удалить «${p.name}»?`)) return
    try {
      await deleteProduct(p.id)
      toast.success("Товар удалён")
      startTransition(() => router.refresh())
    } catch (e) {
      console.error("[sklad] delete error:", e)
      toast.error("Не удалось удалить")
    }
  }

  return (
    <div className="min-w-0">
      {/* Заголовок */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {showAdd && (
          <Button onClick={onAdd} className="gap-1.5 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Добавить товар
          </Button>
        )}
      </div>

      {/* Блок аналитики */}
      {showStats && (
        <SkladStats
          products={products}
          canSeePurchasePrice={canSeePurchasePrice}
          isAdmin={isAdmin}
        />
      )}

      {/* Поиск и переключение вида */}
      <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="w-full sm:max-w-xl">
          <ProductSearch
            value={query}
            onChange={handleQueryChange}
            placeholder="Название, артикул, металл, 1,25 г, 12300 с, 11.09.2026..."
          />
        </div>
        <Button
          variant={virtualMode ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5 text-xs shrink-0 self-start sm:self-auto"
          onClick={() => setVirtualMode((v) => !v)}
          title="Режим виртуализации для 100 000+ товаров"
        >
          <Layers className="h-3.5 w-3.5" />
          {virtualMode ? "Виртуализация вкл (~20 строк)" : "Обычная таблица"}
        </Button>
      </div>

      {virtualMode ? (
        <VirtualizedSkladTable
          products={filtered}
          canSeePurchasePrice={canSeePurchasePrice}
          isAdmin={isAdmin}
          onPrint={onPrintLabel}
          onEdit={onEdit}
          onDelete={(id) => {
            const p = products.find((item) => item.id === id)
            if (p) onDelete(p)
          }}
        />
      ) : (
        <>
          {/* ===== DESKTOP: полноценная таблица (md+) ===== */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Товар</TableHead>
              <TableHead>Металл</TableHead>
              <TableHead>Вес</TableHead>
              <TableHead>Дата создания</TableHead>
              <TableHead className="text-right">Кол-во</TableHead>
              {canSeePurchasePrice && <TableHead className="hidden text-right lg:table-cell">Закуп</TableHead>}
              <TableHead className="text-right">Цена / факт</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canSeePurchasePrice ? 8 : 7} className="py-16 text-center text-sm text-muted-foreground">
                  <PackageX className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Нет товаров
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="line-clamp-1 text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.sku || p.category}</div>
                         <SupplierMark product={p} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.metal}</TableCell>
                  <TableCell className="text-sm">{formatWeight(p.weight)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(p.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <QtyBadge status={p.status} />
                  </TableCell>
                  {canSeePurchasePrice && (
                    <TableCell className="hidden text-right font-mono text-sm text-muted-foreground lg:table-cell">
                      {formatSom(p.purchase_price)}
                    </TableCell>
                  )}
                   <TableCell className="text-right font-mono text-sm font-medium text-primary">
                     <div>{formatSom(p.sale_price)}</div>
                     <ActualSaleSummary
                       sale={salesByProduct.get(p.id)}
                       canSeeProfit={canSeePurchasePrice}
                       sold={p.status !== "in_stock"}
                     />
                  </TableCell>
                  <TableCell>
                    <ActionButtons
                      p={p}
                      isAdmin={isAdmin}
                      onPrint={onPrintLabel}
                      onEdit={onEdit}
                       onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ===== MOBILE: карточный вид (< md) ===== */}
      <div className="md:hidden space-y-2">
        {paginated.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            <PackageX className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Нет товаров
          </div>
        ) : (
          paginated.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-card p-3 space-y-2"
            >
              {/* Строка 1: фото + название + артикул */}
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Sparkles className="h-5 w-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm leading-tight line-clamp-2">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.sku && <span className="font-mono">{p.sku}</span>}
                    {p.sku && p.category && <span className="mx-1">·</span>}
                    {p.category}
                  </div>
                   <SupplierMark product={p} />
                </div>
                <div className="shrink-0 text-right">
                   <div className="font-mono text-sm font-semibold text-primary">{formatSom(p.sale_price)}</div>
                   <ActualSaleSummary
                     sale={salesByProduct.get(p.id)}
                     canSeeProfit={canSeePurchasePrice}
                      sold={p.status !== "in_stock"}
                   />
                  {canSeePurchasePrice && (
                    <div className="font-mono text-xs text-muted-foreground">{formatSom(p.purchase_price)}</div>
                  )}
                </div>
              </div>

              {/* Строка 2: металл / вес / кол-во */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {p.metal && (
                  <span className="flex items-center gap-1">
                    <span className="font-medium text-foreground/70">Металл:</span> {p.metal}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="font-medium text-foreground/70">Вес:</span> {formatWeight(p.weight)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium text-foreground/70">Кол-во:</span> <QtyBadge status={p.status} />
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium text-foreground/70">Дата:</span> {formatDate(p.created_at)}
                </span>
              </div>

              {/* Строка 3: кнопки действий */}
              <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                  onClick={() => onPrintLabel(p)}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Этикетка
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-primary"
                  onClick={() => onEdit(p)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Изменить
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive ml-auto"
                    onClick={() => onDelete(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {filtered.length} товаров · стр. {currentPage}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={currentPage === 1}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
              .map((n, idx, arr) => (
                <span key={n} className="flex items-center">
                  {idx > 0 && arr[idx - 1] !== n - 1 && (
                    <span className="px-1 text-xs text-muted-foreground">…</span>
                  )}
                  <Button
                    variant={n === currentPage ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 text-xs"
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </Button>
                </span>
              ))}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={currentPage === totalPages}
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
        </>
      )}

      {/* Диалог этикетки — корректные размеры на десктопе и full-screen на мобильных */}
      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent
          showCloseButton={false}
          className={[
            "flex flex-col p-0 gap-0",
            // Мобильные: во весь экран
            "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0",
            "max-sm:w-screen max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none",
            // Десктоп: фиксированная ширина + высота по экрану
            "sm:max-w-[500px] sm:h-[90vh] sm:max-h-[90vh] sm:rounded-xl",
          ].join(" ")}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Этикетка: {labelProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <label htmlFor="inventory-printer-model" className="shrink-0 text-xs font-medium">Принтер</label>
            <select
              id="inventory-printer-model"
              value={printerKey}
              onChange={(event) => {
                const profile = getPrinterProfile(event.target.value)
                setPrinterKey(profile.key)
                setLabelSizeKey(profile.defaultLabelKey)
                setLabelAutoPrint(false)
                try { localStorage.setItem(MODEL_STORAGE_KEY, profile.key) } catch { /* ignore */ }
              }}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              {PRINTER_PROFILES.map((profile) => (
                <option key={profile.key} value={profile.key}>{profile.displayName}</option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{printerProfile.dpi} dpi</span>
          </div>
          {labelProduct && (printerProfile.supportsDirectBluetooth === false || !fitsPrinthead) && (
            <p role="status" className="shrink-0 border-b bg-amber-500/10 px-3 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
              {!fitsPrinthead
                ? `Ширина ${nativeWidth} px превышает ${printerProfile.printheadPx} px. Выберите другой формат этикетки.`
                : `B3S: прямой Bluetooth недоступен. Скачайте PNG и напечатайте через приложение Niimbot без масштабирования.`}
            </p>
          )}
          {labelProduct && (
            <div className="min-h-0 flex-1">
              <LabelEditor
                key={`${labelProduct.id}:${printerProfile.key}`}
                product={labelProduct}
                autoPrint={labelAutoPrint}
                initialSizeKey={labelSizeKey}
                printerProfile={printerProfile}
                onSizeChange={setLabelSizeKey}
                onClose={() => setLabelDialogOpen(false)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ProductDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        product={editing}
        canSeePurchasePrice={canSeePurchasePrice}
        onPrintLabel={onAutoPrintLabel}
      />
    </div>
  )
}

function QtyBadge({ status }: { status: Product["status"] }) {
  if (status !== "in_stock") return <Badge variant="destructive" className="text-[10px]">Нет</Badge>
  return <Badge variant="secondary" className="text-[10px]">1</Badge>
}

function ActionButtons({
  p, isAdmin, onPrint, onEdit, onDelete,
}: {
  p: Product
  isAdmin: boolean
  onPrint: (p: Product) => void
  onEdit: (p: Product) => void
  onDelete: (p: Product) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        title="Печать этикетки"
        onClick={() => onPrint(p)}
      >
        <Printer className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-primary"
        title="Редактировать"
        onClick={() => onEdit(p)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      {isAdmin && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(p)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

function SupplierMark({
  product,
}: {
  product: Product
}) {
  if (!product.supplier_name) {
    return <div className="mt-1 text-[11px] text-muted-foreground/70">Поставщик не указан</div>
  }
  if (product.consignment_operation_id) {
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> Взято на реализацию
      </div>
    )
  }
  return <div className="mt-1 text-[11px] text-muted-foreground">Поставщик: {product.supplier_name}</div>
}

type ActualSaleSummary = {
  units: number
  revenue: number
  cost: number
  prices: number[]
}

function ActualSaleSummary({
  sale,
  canSeeProfit,
  sold,
}: {
  sale?: ActualSaleSummary
  canSeeProfit: boolean
  sold: boolean
}) {
  if (!sale || sale.units <= 0) return null
  const profit = sale.revenue - sale.cost
  const prices = [...new Set(sale.prices.map((price) => Math.round(price)))]
  const priceText = prices.length === 1
    ? formatSom(prices[0])
    : prices.map((price) => formatSom(price)).join(" / ")

  return (
    <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
      <div>{sold ? "Продано · " : "Факт: "}{priceText}{sale.units > 1 ? ` · ${sale.units} шт` : ""}</div>
      {canSeeProfit && (
        <div className={profit < 0 ? "text-destructive" : "text-success"}>
          {profit < 0 ? "Убыток " : "Прибыль +"}{formatSom(Math.abs(profit))}
        </div>
      )}
    </div>
  )
}
