"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  History,
  Loader2,
  Minus,
  Package,
  Plus,
  Trash2,
  Truck,
} from "lucide-react"
import {
  deleteSupplierProfile,
  saveSupplierProfilePhoto,
  type SupplierDebtData,
  type SupplierProfile,
} from "@/app/actions/suppliers"
import type { Product } from "@/lib/types"
import { compressToWebp } from "@/lib/image"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { formatWeight } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  profile: SupplierProfile | null
  onProfileUpdated: (profile: SupplierProfile) => void
  onOpenProduct: (product: Product) => void
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
  profile,
  onProfileUpdated,
  onOpenProduct,
}: SupplierCardProps) {
  const [activeForm, setActiveForm] = useState<ActiveForm>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)

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
  const photoUrl = useMemo(
    () => profile?.photo_path
      ? createClient().storage.from("product-images").getPublicUrl(profile.photo_path).data.publicUrl
      : null,
    [profile?.photo_path],
  )

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите файл изображения")
      return
    }
    setUploadingPhoto(true)
    let uploadedPath: string | null = null
    try {
      const supabase = createClient()
      const { data: shopId, error: shopError } = await supabase.rpc("current_shop_id")
      if (shopError || typeof shopId !== "string" || !shopId) {
        throw new Error("Не удалось определить магазин")
      }
      const compressed = await compressToWebp(file)
      uploadedPath = `${shopId}/supplier-profiles/${Date.now()}-${crypto.randomUUID()}.webp`
      const { error: uploadError } = await supabase.storage.from("product-images").upload(uploadedPath, compressed, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      })
      if (uploadError) throw uploadError
      const saved = await saveSupplierProfilePhoto({
        supplierName: supplier.supplier_name,
        supplierPhone: supplier.supplier_phone,
        photoPath: uploadedPath,
      })
      onProfileUpdated(saved)
      if (profile?.photo_path && profile.photo_path !== uploadedPath) {
        const { error: removeError } = await supabase.storage.from("product-images").remove([profile.photo_path])
        if (removeError) {
          toast.warning("Фото обновлено, но старый файл не удалось удалить")
          uploadedPath = null
          return
        }
      }
      toast.success("Фото поставщика сохранено")
      uploadedPath = null
    } catch (error) {
      if (uploadedPath) {
        await createClient().storage.from("product-images").remove([uploadedPath]).catch(() => undefined)
      }
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографию")
    } finally {
      setUploadingPhoto(false)
      if (photoInput.current) photoInput.current.value = ""
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const deleted = await deleteSupplierProfile({
        supplierName: supplier.supplier_name,
        supplierPhone: supplier.supplier_phone,
      })
      onProfileUpdated(deleted)
      setDeleteOpen(false)
      toast.success("Поставщик и его фото удалены")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить поставщика")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить поставщика?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            «{supplier.supplier_name}» будет скрыт из списка, а его фотография удалена.
            Товары и история расчётов останутся. При наличии долга удаление невозможно.
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={deleting || hasDebt} onClick={() => void handleDelete()}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handlePhoto(event.target.files?.[0])}
      />
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
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Truck className="h-5 w-5" />
            )}
          </div>
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
                  ? "text-primary"
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
                  variant="outline"
                  disabled={uploadingPhoto}
                  onClick={() => photoInput.current?.click()}
                  className="gap-1.5"
                >
                  {uploadingPhoto
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ImagePlus className="h-3.5 w-3.5" />}
                  {profile?.photo_path ? "Изменить фото" : "Добавить фото"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={hasDebt}
                  onClick={() => setDeleteOpen(true)}
                  title={hasDebt ? "Сначала погасите долг поставщику" : "Удалить поставщика"}
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {hasDebt ? "Есть долг" : "Удалить"}
                </Button>
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
                  highlightedProductId={highlightedProductId}
                  onOpenProduct={onOpenProduct}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
