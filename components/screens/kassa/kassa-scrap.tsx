"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Plus, Recycle, AlertTriangle } from "lucide-react"
import { CATEGORIES, PAYMENT_METHODS } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { scrapRateOf, type RateMap } from "@/lib/rates"
import { useCalculator } from "@/hooks/useCalculator"
import { composeMetal, type MetalCondition } from "@/lib/metal"
import { MetalPicker } from "@/components/metal-picker"
import { createProduct } from "@/app/actions/products"
import { createCashOperation } from "@/app/actions/cash"
import type { CashBalances } from "@/lib/cash"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

export interface ScrapDraft {
  name: string
  metal: string
  weight: number
  pricePerGram: number
}

/**
 * Приём лома в модальном окне: форма изделия как на складе, выплата из кассы
 * наличными / переводом / смешанно. Если в кассе не хватает средств — просим
 * сначала провести внесение.
 */
export function KassaScrap({
  rates,
  balances,
  onAdd,
  onRequestDeposit,
}: {
  rates: RateMap
  /** Балансы кассы: из них выплачивается лом. */
  balances: CashBalances
  /** Быстрое добавление строки лома прямо в чек (без выплаты из кассы). */
  onAdd: (draft: ScrapDraft) => void
  /** Открыть окно «Внесение» при нехватке средств. */
  onRequestDeposit: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const calc = useCalculator()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shortage, setShortage] = useState<number | null>(null)

  const [condition, setCondition] = useState<MetalCondition>("secondary")
  const [base, setBase] = useState("Золото")
  const [purity, setPurity] = useState("585")
  const [category, setCategory] = useState<string>("Прочее")
  const [name, setName] = useState("")
  const [weight, setWeight] = useState("")
  const [perGram, setPerGram] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [salePerGram, setSalePerGram] = useState("")
  const [supplierName, setSupplierName] = useState("")
  const [supplierPhone, setSupplierPhone] = useState("")

  const [payment, setPayment] = useState("cash")
  const [payCash, setPayCash] = useState("")
  const [payElectronic, setPayElectronic] = useState("")

  const metal = useMemo(() => composeMetal(condition, base, purity), [condition, base, purity])
  const rate = useMemo(() => scrapRateOf(rates, metal), [rates, metal])
  const effectiveGram = calc.toNumber(perGram) > 0 ? calc.toNumber(perGram) : rate
  const total = calc.scrapTotal(weight, effectiveGram)
  const salePrice = calc.totalFromGram(calc.toNumber(weight), calc.toNumber(salePerGram))

  const mixedCash = Number(payCash) || 0
  const mixedElectronic = Number(payElectronic) || 0
  const availableFor = (method: string) =>
    method === "cash" ? balances.cash : method === "transfer" ? balances.electronic : balances.total

  const reset = () => {
    setName("")
    setWeight("")
    setPerGram("")
    setSalePerGram("")
    setPayCash("")
    setPayElectronic("")
    setSupplierName("")
    setSupplierPhone("")
    setQuantity("1")
  }

  const validate = (): string | null => {
    const w = calc.toNumber(weight)
    if (w <= 0) return "Укажите вес лома больше нуля"
    if (effectiveGram <= 0) return `Не задан курс лома для «${metal}» — укажите цену за грамм`
    if (payment === "mixed" && Math.abs(mixedCash + mixedElectronic - total) > 1) {
      return `Суммы оплаты должны в сумме давать ${formatSom(total)}`
    }
    return null
  }

  /** Быстрое добавление лома строкой в текущий чек. */
  const addToReceipt = () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    onAdd({ name: name.trim(), metal, weight: calc.toNumber(weight), pricePerGram: effectiveGram })
    reset()
    setOpen(false)
  }

  /** Оприходовать лом на склад и выплатить деньги из кассы. */
  const submit = async () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }

    // Проверка баланса кассы до любых записей.
    if (payment === "mixed") {
      const lackCash = mixedCash - balances.cash
      const lackEle = mixedElectronic - balances.electronic
      const lack = Math.max(0, lackCash) + Math.max(0, lackEle)
      if (lack > 0.5) {
        setShortage(lack)
        return
      }
    } else if (total - availableFor(payment) > 0.5) {
      setShortage(total - availableFor(payment))
      return
    }

    setSaving(true)
    try {
      const w = calc.toNumber(weight)
      const qty = Math.max(1, Number(quantity) || 1)
      await createProduct({
        name: name.trim() || `Лом · ${metal}`,
        category,
        metal,
        metal_color: null,
        // проба входит в строку metal (колонка purity удалена из БД)
        weight: w,
        size: "",
        sku: "",
        quantity: qty,
        purchase_price: total,
        price_per_gram_purchase: effectiveGram,
        price_per_gram_sale: calc.toNumber(salePerGram) || null,
        sale_price: salePrice || total,
        // is_secondary удалено из БД (v20); поле metal уже содержит "Вторичное …"
        supplier_name: supplierName.trim() || null,
        supplier_phone: supplierPhone.trim() || null,
        images: [],
      })

      await createCashOperation({
        type: "outcome",
        amount: total,
        source: payment === "cash" ? "cash" : payment === "transfer" ? "electronic" : "mixed",
        amount_cash: payment === "mixed" ? mixedCash : undefined,
        amount_electronic: payment === "mixed" ? mixedElectronic : undefined,
        reason: `Приём лома: ${name.trim() || metal} · ${w} г`,
        allowSeller: true,
      })

      toast.success(`Лом принят, выплачено ${formatSom(total)}`)
      reset()
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (e) {
      console.error("[kassa] scrap intake error:", e)
      toast.error(e instanceof Error ? e.message : "Не удалось провести приём лома")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
          <Recycle className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold tracking-tight">Приём лома</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          курс {rate > 0 ? `${formatSom(rate)}/г` : "не задан"}
        </span>
        <Button size="sm" className="ml-auto h-8 text-xs font-semibold" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Принять лом
        </Button>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Выплата за лом списывается из кассы: наличными, переводом или смешанно.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Приём лома</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="s-name">Название</Label>
              <Input
                id="s-name"
                placeholder="Цепочка, лом"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <MetalPicker
              condition={condition}
              base={base}
              purity={purity}
              onChange={(next) => {
                setCondition(next.condition)
                setBase(next.base)
                setPurity(next.purity)
              }}
            />

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Категория</Label>
                <Select value={category} onValueChange={(v) => setCategory(v ?? category)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="s-weight">Вес (г)</Label>
                <Input
                  id="s-weight"
                  type="number"
                  min={0}
                  step="0.01"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="s-qty">Кол-во</Label>
                <Input
                  id="s-qty"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-medium">Закупка лома</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="s-gram">За грамм (с)</Label>
                  <Input
                    id="s-gram"
                    type="number"
                    min={0}
                    placeholder={rate ? String(rate) : "0"}
                    value={perGram}
                    onChange={(e) => setPerGram(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Итого (с)</Label>
                  <Input readOnly value={total || ""} className="bg-muted/40 font-mono" />
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-medium">Цена продажи</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="s-gram-sale">За грамм (с)</Label>
                  <Input
                    id="s-gram-sale"
                    type="number"
                    min={0}
                    value={salePerGram}
                    onChange={(e) => setSalePerGram(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Итого (с)</Label>
                  <Input readOnly value={salePrice || ""} className="bg-muted/40 font-mono" />
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-medium">Источник лома</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="s-supplier">ФИО сдающего</Label>
                  <Input id="s-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="s-phone">Телефон</Label>
                  <Input
                    id="s-phone"
                    type="tel"
                    placeholder="+996 ..."
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Тип выплаты</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPayment(m.value)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                      payment === m.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Наличные: {formatSom(balances.cash)}</span>
                <span>Электронные: {formatSom(balances.electronic)}</span>
              </div>

              {payment === "mixed" && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 p-2">
                  <div className="grid gap-1">
                    <Label className="text-[10px] text-muted-foreground">Наличными (с)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={payCash}
                      onChange={(e) => setPayCash(e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[10px] text-muted-foreground">Переводом / картой (с)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={payElectronic}
                      onChange={(e) => setPayElectronic(e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                  <div
                    className={cn(
                      "col-span-2 text-[11px]",
                      Math.abs(mixedCash + mixedElectronic - total) > 1
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    Указано: {formatSom(mixedCash + mixedElectronic)} из {formatSom(total)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" className="text-xs text-muted-foreground" onClick={addToReceipt}>
              Добавить строкой в чек
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="bg-transparent" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? "Проводим…" : total > 0 ? `Выплатить ${formatSom(total)}` : "Провести"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shortage !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-semibold">Недостаточно средств в кассе</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Не хватает {formatSom(shortage)} для выплаты за лом. Перейти к внесению средств в кассу?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" className="bg-transparent" onClick={() => setShortage(null)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  setShortage(null)
                  setOpen(false)
                  onRequestDeposit()
                }}
              >
                Да
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
