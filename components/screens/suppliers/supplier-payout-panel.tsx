"use client"

import { useEffect, useState, useTransition } from "react"
import {
  ChevronDown,
  ChevronUp,
  History,
  Minus,
  Package,
  Pencil,
  Plus,
  Printer,
  Trash2,
  WalletCards,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { adjustSupplierDebt, paySupplierDebt, type SupplierDebtData } from "@/app/actions/suppliers"
import { deleteProduct } from "@/app/actions/products"
import type { CashSource, Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

// ─── helpers ───────────────────────────────────────────────────────────────

function supplierKey(name: string, phone: string | null) {
  return `${name}\u0000${phone ?? ""}`
}

function operationLabel(type: string) {
  if (type === "consignment") return "Взято на реализацию"
  if (type === "adjustment") return "Увеличение долга"
  return "Выплата поставщику"
}

// ─── History bottom-sheet / desktop modal ──────────────────────────────────

function HistorySheet({
  open,
  onClose,
  supplierName,
  supplierPhone,
  operations,
}: {
  open: boolean
  onClose: () => void
  supplierName: string
  supplierPhone: string | null
  operations: SupplierDebtData["operations"]
}) {
  // Закрытие по Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const filtered = operations.filter(
    (op) => op.supplier_name === supplierName && (op.supplier_phone ?? null) === supplierPhone,
  )

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet — снизу на mobile, справа/по центру на desktop */}
      <div
        role="dialog"
        aria-modal
        aria-label="История транзакций"
        className={cn(
          "fixed z-50 flex flex-col bg-background shadow-xl",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl",
          // desktop: centered modal
          "lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
          "lg:w-[480px] lg:max-h-[70vh] lg:rounded-2xl",
        )}
      >
        {/* Drag handle (mobile only) */}
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <div>
            <h3 className="font-semibold">История транзакций</h3>
            <p className="text-xs text-muted-foreground">{supplierName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divider h-px bg-border" />

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Нет операций</p>
          ) : (
            filtered.map((op) => (
              <div
                key={op.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{operationLabel(op.operation_type)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(op.created_at).toLocaleString("ru-RU")} · {op.author_name ?? "—"}
                  </div>
                  {op.reason && (
                    <div className="text-[11px] text-muted-foreground truncate">{op.reason}</div>
                  )}
                </div>
                <div className="shrink-0 text-right font-mono text-sm">
                  <div
                    className={cn(
                      "font-semibold",
                      op.operation_type === "payment" ? "text-emerald-600 dark:text-emerald-400" : "text-[#B57C1B]",
                    )}
                  >
                    {op.operation_type === "payment" ? "−" : "+"}{formatSom(op.amount)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{formatSom(op.balance_after)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </>
  )
}

// ─── Inline pay form ────────────────────────────────────────────────────────

function PayForm({
  supplierName,
  supplierPhone,
  balance,
  onSuccess,
  onCancel,
}: {
  supplierName: string
  supplierPhone: string | null
  balance: number
  onSuccess: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(Math.round(balance)))
  const [source, setSource] = useState<CashSource>("cash")
  const [cashPart, setCashPart] = useState("")
  const [electronicPart, setElectronicPart] = useState("")
  const [showComment, setShowComment] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  const paymentAmount = Number(amount) || 0
  const splitTotal = (Number(cashPart) || 0) + (Number(electronicPart) || 0)
  const canPay =
    paymentAmount > 0 &&
    paymentAmount <= balance + 0.01 &&
    (source !== "mixed" || Math.abs(splitTotal - paymentAmount) < 0.01)

  const submit = () => {
    if (!canPay) return
    startTransition(async () => {
      try {
        await paySupplierDebt({
          supplierName,
          supplierPhone,
          amount: paymentAmount,
          source,
          amountCash: source === "mixed" ? Number(cashPart) || 0 : undefined,
          amountElectronic: source === "mixed" ? Number(electronicPart) || 0 : undefined,
          reason: reason || "Выплата поставщику",
        })
        toast.success("Выплата проведена")
        onSuccess()
        window.location.reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось провести выплату")
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
      <div className="text-xs text-muted-foreground">Доступно к выплате: <span className="font-mono font-semibold text-foreground">{formatSom(balance)}</span></div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Сумма</Label>
        <Input
          type="number"
          min={1}
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Источник оплаты</Label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as CashSource)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="cash">Наличные</option>
          <option value="electronic">Электронные</option>
          <option value="mixed">Смешанный</option>
        </select>
      </div>

      {source === "mixed" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Наличные</Label>
            <Input type="number" min={0} value={cashPart} onChange={(e) => setCashPart(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Электронные</Label>
            <Input type="number" min={0} value={electronicPart} onChange={(e) => setElectronicPart(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
      )}

      {!showComment ? (
        <button
          type="button"
          onClick={() => setShowComment(true)}
          className="text-xs text-primary hover:underline"
        >
          + Добавить комментарий
        </button>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs">Комментарий</Label>
          <Input
            placeholder="Например: частичная выплата"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          disabled={!canPay || pending}
          onClick={submit}
          className="flex-1 font-semibold"
          size="sm"
        >
          {pending ? "Проведение..." : `Оплатить ${paymentAmount > 0 ? formatSom(paymentAmount) : ""}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="px-3">
          Отмена
        </Button>
      </div>
    </div>
  )
}

// ─── Inline debt form ───────────────────────────────────────────────────────

function DebtForm({
  supplierName,
  supplierPhone,
  onSuccess,
  onCancel,
}: {
  supplierName: string
  supplierPhone: string | null
  onSuccess: () => void
  onCancel: () => void
}) {
  const [adjustment, setAdjustment] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [pending, startTransition] = useTransition()

  const canSave = Number(adjustment) > 0 && adjustmentReason.trim().length > 0

  const submit = () => {
    if (!canSave) return
    startTransition(async () => {
      try {
        await adjustSupplierDebt({
          supplierName,
          supplierPhone,
          amount: Number(adjustment),
          reason: adjustmentReason,
        })
        toast.success("Изменение долга записано")
        onSuccess()
        window.location.reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось изменить долг")
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Сумма</Label>
        <Input
          type="number"
          min={1}
          value={adjustment}
          onChange={(e) => setAdjustment(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Причина</Label>
        <Input
          placeholder="Рост цены золота"
          value={adjustmentReason}
          onChange={(e) => setAdjustmentReason(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          disabled={!canSave || pending}
          onClick={submit}
          className="flex-1"
          size="sm"
        >
          {pending ? "Сохранение..." : "Сохранить"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="px-3">
          Отмена
        </Button>
      </div>
    </div>
  )
}

// ─── Products mini-list ─────────────────────────────────────────────────────

function SupplierProducts({
  products,
  isAdmin,
}: {
  products: Product[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

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

  if (products.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">Нет товаров на складе</p>
    )
  }

  return (
    <div className="space-y-1.5">
      {products.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{p.name}</div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{formatSom(p.sale_price)}</span>
              {p.metal && <span>· {p.metal}</span>}
              {p.weight > 0 && <span>· {formatWeight(p.weight)}</span>}
            </div>
            <div className="mt-0.5">
              <span
                className={cn(
                  "inline-block rounded px-1.5 py-0 text-[10px] font-medium leading-4",
                  p.status === "in_stock" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                  p.status === "sold" && "bg-muted text-muted-foreground",
                  p.status === "reserved" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                  p.status === "archived" && "bg-muted text-muted-foreground",
                  p.status === "draft" && "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                )}
              >
                {p.status === "in_stock" ? "В наличии"
                  : p.status === "sold" ? "Продан"
                  : p.status === "reserved" ? "Резерв"
                  : p.status === "archived" ? "Архив"
                  : "Черновик"}
              </span>
            </div>
          </div>

          {/* Icon actions */}
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
    </div>
  )
}

// ─── Single supplier accordion card ────────────────────────────────────────

type ActiveForm = "pay" | "debt" | null

function SupplierCard({
  supplier,
  isOpen,
  onToggle,
  isAdmin,
  goods,
  products,
  operations,
}: {
  supplier: SupplierDebtData["suppliers"][number]
  isOpen: boolean
  onToggle: () => void
  isAdmin: boolean
  goods?: {
    count: number
    quantity: number
    totalWeight: number
    byMetal: Record<string, { quantity: number; weight: number }>
  }
  products: Product[]
  operations: SupplierDebtData["operations"]
}) {
  const [activeForm, setActiveForm] = useState<ActiveForm>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const toggleForm = (form: ActiveForm) => {
    setActiveForm((prev) => (prev === form ? null : form))
  }

  // Close forms when card collapses
  useEffect(() => {
    if (!isOpen) {
      setActiveForm(null)
      setShowProducts(false)
    }
  }, [isOpen])

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
        {/* ── Collapsed header (always visible) ── */}
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold">{supplier.supplier_name}</span>
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
                hasDebt ? "text-[#B57C1B] dark:text-[#E5AC4C]" : "text-muted-foreground",
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

        {/* ── Expanded body ── */}
        {isOpen && (
          <div className="border-t border-border/60 px-4 pb-4 pt-3">

            {/* Action buttons row */}
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

            {/* Contextual forms */}
            {activeForm === "pay" && isAdmin && (
              <PayForm
                supplierName={supplier.supplier_name}
                supplierPhone={supplier.supplier_phone}
                balance={supplier.balance}
                onSuccess={() => setActiveForm(null)}
                onCancel={() => setActiveForm(null)}
              />
            )}

            {activeForm === "debt" && isAdmin && (
              <DebtForm
                supplierName={supplier.supplier_name}
                supplierPhone={supplier.supplier_phone}
                onSuccess={() => setActiveForm(null)}
                onCancel={() => setActiveForm(null)}
              />
            )}

            {goods && (
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Остатки по металлам
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(goods.byMetal).map(([metal, stats]) => (
                    <div key={metal} className="flex min-w-0 justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">{metal}</span>
                      <span className="shrink-0 font-mono text-foreground">
                        {stats.quantity} шт · {formatWeight(stats.weight)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Products toggle */}
            <button
              type="button"
              onClick={() => setShowProducts((v) => !v)}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Package className="h-3.5 w-3.5" />
              Товары
              {goods ? ` (${goods.quantity} шт)` : ""}
              {showProducts
                ? <ChevronUp className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showProducts && (
              <div className="mt-2">
                <SupplierProducts products={products} isAdmin={isAdmin} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main exported component ────────────────────────────────────────────────

export function SupplierPayoutPanel({
  data,
  isAdmin,
  goodsBySupplier,
  productsBySupplier,
  query,
}: {
  data: SupplierDebtData
  isAdmin: boolean
  goodsBySupplier?: Map<string, {
    count: number
    quantity: number
    totalWeight: number
    byMetal: Record<string, { quantity: number; weight: number }>
  }>
  productsBySupplier?: Map<string, Product[]>
  query?: string
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    const normalizedQuery = query?.trim().toLocaleLowerCase("ru-RU")
    if (!normalizedQuery || !productsBySupplier) return

    const matchingEntry = Array.from(productsBySupplier.entries()).find(([, products]) =>
      products.some((product) => [product.name, product.sku, product.category]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ru-RU").includes(normalizedQuery)))
    )

    if (matchingEntry) setOpenKey(matchingEntry[0])
  }, [query, productsBySupplier])

  const toggle = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key))
  }

  if (data.suppliers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
        <WalletCards className="mx-auto mb-3 h-8 w-8 opacity-30" />
        {query
          ? "По заданным параметрам поставщики и товары не найдены."
          : "Пока нет поставщиков или товаров с указанным поставщиком."}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {data.suppliers.map((supplier) => {
        const key = supplierKey(supplier.supplier_name, supplier.supplier_phone)
        return (
          <SupplierCard
            key={key}
            supplier={supplier}
            isOpen={openKey === key}
            onToggle={() => toggle(key)}
            isAdmin={isAdmin}
            goods={goodsBySupplier?.get(key)}
            products={productsBySupplier?.get(key) ?? []}
            operations={data.operations}
          />
        )
      })}
    </div>
  )
}
