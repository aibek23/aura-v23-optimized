"use client"

import { useEffect, useState, useTransition } from "react"
import type { Product } from "@/lib/types"
import { createProduct, updateProduct, type ProductInput } from "@/app/actions/products"
import { takeProductOnConsignment } from "@/app/actions/suppliers"
import { clearDraft, pushNameHistory } from "@/lib/name-history"
import { useProductForm } from "@/hooks/useProductForm"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductImages } from "@/components/screens/sklad/add-edit-Product/product-images"
import { ProductGeneralInfo } from "@/components/screens/sklad/add-edit-Product/product-general-info"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { InlineLoader } from "@/components/ui/page-loader"
import { CheckCircle2 } from "lucide-react"
import { formatSom } from "@/lib/format"

export function ProductDialog({
  open,
  onOpenChange,
  product,
  canSeePurchasePrice,
  onPrintLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: Product | null
  canSeePurchasePrice: boolean
  /** Переиспользует печать этикеток из списка товаров (см. SkladScreen). */
  onPrintLabel?: (product: Product) => void | Promise<void>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  /** Подтверждение печати после успешного сохранения. */
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false)
  const [savedProduct, setSavedProduct] = useState<Product | null>(null)
  const [consignmentChecked, setConsignmentChecked] = useState(
    Boolean(product?.consignment_operation_id),
  )

  const {
    form,
    setField,
    metalCondition,
    metalBase,
    setMetalCondition,
    setMetalBase,
    nameHistory,
    setNameHistory,
    skuLoading,
    skuError,
    skuAuto,
    marginPercent,
    changeWeight,
    changeGramSale,
    changeSalePrice,
    changeGramPurchase,
    changePurchasePrice,
    changeGramPurchaseVisible,
    changePurchasePriceVisible,
    requestArticle,
  } = useProductForm(open, product)

  useEffect(() => {
    if (open) {
      setConsignmentChecked(Boolean(product?.consignment_operation_id))
    }
  }, [open, product])

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название")
      return
    }
    if (consignmentChecked) {
      if (!(form.purchase_price > 0)) {
        toast.error("Укажите оптовую цену — долг поставщику считается от неё")
        return
      }
    }
    setSaving(true)
    try {
      // purity — только UI-состояние: в БД колонки нет, проба живёт внутри metal.
      const { purity: _purity, ...formData } = form
      const payload: ProductInput = {
        ...formData,
        name: form.name.trim(),
        metal_color: form.metal_color || null,
        purchase_price_visible: form.purchase_price_visible || null,
        price_per_gram_sale: form.price_per_gram_sale || null,
        price_per_gram_purchase: form.price_per_gram_purchase || null,
        price_per_gram_purchase_visible: form.price_per_gram_purchase_visible || null,
        stones: form.stones.trim() || null,
        description: form.description.trim() || null,
        image_url: form.images[0] ?? null,
        supplier_name: form.supplier_name.trim() || null,
        supplier_phone: form.supplier_phone.trim() || null,
      }

      // 1) Сначала сохраняем в БД и получаем реальную строку товара
      //    (с id / sku / shop_id / shop_seq_id) — именно она нужна для QR-кода.
      let saved: Product
      try {
        if (!navigator.onLine) throw new Error("Offline")
        if (product) {
          saved = await updateProduct(product.id, payload)
          toast.success("Товар обновлён")
        } else {
          saved = await createProduct(payload)
          clearDraft()
          toast.success("Товар добавлен")
        }
      } catch (saveErr) {
        // Offline fallback: save locally to SQLite / IndexedDB and queue in Outbox
        const { bulkPut } = await import("@/lib/local-db/db")
        const { enqueueOutbox } = await import("@/lib/local-db/outbox")
        const clientOpId = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).substring(2)
        const nowIso = new Date().toISOString()
        const prodId = product?.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).substring(2))

        saved = {
          ...product,
          ...payload,
          id: prodId,
          sku: product?.sku || payload.sku || `OFF-${Math.floor(1000 + Math.random() * 9000)}`,
          status: product?.status || "in_stock",
          created_at: product?.created_at || nowIso,
          updated_at: nowIso,
        } as Product

        await bulkPut("products", [saved])
        await enqueueOutbox({
          client_op_id: clientOpId,
          shop_id: saved.shop_id || "",
          entity: "products",
          op_type: product ? "product_update" : "product_add",
          payload: {
            ...saved,
            original_updated_at: product?.updated_at || null,
          },
        })

        if (!product) clearDraft()
        toast.success(product ? "Товар обновлён (локально)" : "Товар добавлен (локально)", {
          description: "Операция сохранена в очереди и будет синхронизирована при появлении сети",
        })
      }

      setNameHistory(pushNameHistory(form.name))

      // Отметка «Взято на реализацию» фиксируется только общей кнопкой «Сохранить».
      // Для уже отмеченного товара повторно создавать операцию нельзя.
      if (consignmentChecked && !product?.consignment_operation_id) {
        try {
          await takeProductOnConsignment(saved.id)
          toast.success(
            `Взято на реализацию: долг поставщику ${formatSom(saved.purchase_price)}`
          )
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Товар сохранён, но взять на реализацию не удалось")
        }
      }
      startTransition(() => router.refresh())

      // 2) Данные уже в БД — спрашиваем про печать этикетки.
      if (onPrintLabel) {
        setSavedProduct(saved)
        setPrintConfirmOpen(true)
      } else {
        onOpenChange(false)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  const closeAll = () => {
    setPrintConfirmOpen(false)
    setSavedProduct(null)
    onOpenChange(false)
  }

  const confirmPrint = async () => {
    const target = savedProduct
    setPrintConfirmOpen(false)
    setSavedProduct(null)
    onOpenChange(false)
    if (target) await onPrintLabel?.(target)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Редактировать товар" : "Новый товар"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <ProductGeneralInfo
            form={form}
            setField={setField}
            nameHistory={nameHistory}
            setNameHistory={setNameHistory}
            metalCondition={metalCondition}
            metalBase={metalBase}
            setMetalCondition={setMetalCondition}
            setMetalBase={setMetalBase}
            skuLoading={skuLoading}
            skuError={skuError}
            skuAutoRef={skuAuto}
            onRefreshArticle={() => void requestArticle(form.category, form.metal, form.metal_color, true)}
          />

          {/* Вес и размер: одна строка — одна физическая единица. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-weight">Вес (г)</Label>
              <Input
                id="p-weight"
                type="number"
                min={0}
                step="0.01"
                value={form.weight || ""}
                onChange={(e) => changeWeight(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-size">Размер</Label>
              <Input id="p-size" value={form.size} onChange={(e) => setField("size", e.target.value)} />
            </div>
          </div>

          {/* Цена продажи */}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium">Цена на этикетку</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="p-gram-sale">За грамм (с)</Label>
                <Input
                  id="p-gram-sale"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price_per_gram_sale || ""}
                  onChange={(e) => changeGramSale(Number(e.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-sell">Итого (с)</Label>
                <Input
                  id="p-sell"
                  type="number"
                  min={0}
                  value={form.sale_price || ""}
                  onChange={(e) => changeSalePrice(Number(e.target.value))}
                />
              </div>
            </div>
            {consignmentChecked && !form.supplier_name.trim() && (
              <p className="text-[11px] text-muted-foreground">
                Если поставщик не указан, при сохранении им будет назначен пользователь, который оформил операцию.
              </p>
            )}
          </div>

          {/* Закупка */}
          {canSeePurchasePrice && (
            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Оптовая цена</div>
                {form.sale_price > 0 && (
                  <span className={cn("font-mono text-xs", marginPercent < 0 ? "text-destructive" : "text-muted-foreground")}>
                    маржа {marginPercent}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="p-gram-buy">За грамм (с)</Label>
                  <Input
                    id="p-gram-buy"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.price_per_gram_purchase || ""}
                    onChange={(e) => changeGramPurchase(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-buy">Итого (с)</Label>
                  <Input
                    id="p-buy"
                    type="number"
                    min={0}
                    value={form.purchase_price || ""}
                    onChange={(e) => changePurchasePrice(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Закупочная цена, видимая продавцу */}
              <div className="grid gap-2">
                <div className="text-xs font-medium text-muted-foreground">Закупочная цена, видимая продавцу</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="p-gram-buy-vis">За грамм (с)</Label>
                    <Input
                      id="p-gram-buy-vis"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.price_per_gram_purchase_visible || ""}
                      onChange={(e) => changeGramPurchaseVisible(Number(e.target.value))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="p-buy-vis">Итого (с)</Label>
                    <Input
                      id="p-buy-vis"
                      type="number"
                      min={0}
                      value={form.purchase_price_visible || ""}
                      onChange={(e) => changePurchasePriceVisible(Number(e.target.value))}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Продавец видит только эту закупочную цену; реальная закупка доступна администратору.
                </p>
              </div>
            </div>
          )}

          {/* Вставки и Описание */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-stones">Вставки / камни</Label>
              <Input id="p-stones" value={form.stones} onChange={(e) => setField("stones", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-desc">Описание</Label>
              <Input id="p-desc" value={form.description} onChange={(e) => setField("description", e.target.value)} />
            </div>
          </div>

          {/* Поставщик */}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Поставщик</div>
              <label
                className={cn(
                  "inline-flex items-center gap-2 text-xs font-medium",
                  product?.consignment_operation_id
                    ? "cursor-not-allowed text-emerald-600"
                    : "cursor-pointer text-primary",
                )}
                title={
                  product?.consignment_operation_id
                    ? "Операция уже записана и не может быть отменена"
                    : "Операция будет записана после нажатия «Сохранить»"
                }
              >
                <input
                  type="checkbox"
                  checked={consignmentChecked}
                  disabled={saving || Boolean(product?.consignment_operation_id)}
                  onChange={(e) => setConsignmentChecked(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="inline-flex items-center gap-1">
                  {product?.consignment_operation_id && <CheckCircle2 className="h-3.5 w-3.5" />}
                  Взято на реализацию
                </span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="p-supplier-name">Имя / компания</Label>
                <Input
                  id="p-supplier-name"
                  placeholder="Иванов И.И."
                  value={form.supplier_name ?? ""}
                  onChange={(e) => setField("supplier_name", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-supplier-phone">Телефон</Label>
                <Input
                  id="p-supplier-phone"
                  placeholder="+996 700 000 000"
                  value={form.supplier_phone ?? ""}
                  onChange={(e) => setField("supplier_phone", e.target.value)}
                />
              </div>
            </div>
          </div>

          <ProductImages images={form.images} onChange={(next) => setField("images", next)}  />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {!product && (
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-muted-foreground"
              onClick={() => {
                clearDraft()
                onOpenChange(false)
              }}
            >
              Очистить черновик
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? (
                <span className="flex items-center gap-2">
                  <InlineLoader />
                  Сохранение...
                </span>
              ) : (
                "Сохранить"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Подтверждение печати — показывается ТОЛЬКО после успешного сохранения */}
    <Dialog open={printConfirmOpen} onOpenChange={(v) => { if (!v) closeAll() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Печать этикетки</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Товар сохранён. Хотите распечатать этикетку сейчас?
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={closeAll}>
            Нет
          </Button>
          <Button onClick={() => void confirmPrint()}>Да, печатать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
