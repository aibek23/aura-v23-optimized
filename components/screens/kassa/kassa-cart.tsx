"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Minus, 
  Plus, 
  RefreshCw, 
  ShoppingCart, 
  Recycle,
  Trash2,
  User,
  Phone,
  Gift,
  CreditCard
} from "lucide-react"
import { PAYMENT_METHODS, type Customer, type Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ExtendedSaleItem } from "./index" // или ваш файл типов

interface KassaCartProps {
  cart: ExtendedSaleItem[]
  isMobile: boolean
  isCartOpenMobile: boolean
  setIsCartOpenMobile: (open: boolean) => void
  hasLoss: boolean
  lossAmount: number
  lossItems: ExtendedSaleItem[]
  stockOf: (id: string) => number
  removeItem: (lineId: string) => void
  addToCart: (p: Product) => void
  products: Product[]
  changeItemPricePerGram: (lineId: string, val: number) => void
  changeItemWeight: (lineId: string, val: number) => void
  scrapRateOf: (metal: string) => number
  changeItemDiscountSom: (lineId: string, val: number) => void
  changeItemDiscountPercent: (lineId: string, val: number) => void
  applyDiscountToAll: (item: ExtendedSaleItem) => void
  customerName: string
  setCustomerName: (name: string) => void
  customerPhone: string
  setCustomerPhone: (phone: string) => void
  /** Список клиентов магазина для автодополнения */
  customers?: Customer[]
  showBonus: boolean
  bonusUsed: string
  setBonusUsed: (bonus: string) => void
  payment: string
  setPayment: (payment: string | null) => void
  /** Смешанная оплата: наличная и безналичная части. */
  payCash: string
  setPayCash: (v: string) => void
  payElectronic: string
  setPayElectronic: (v: string) => void
  /** Админ видит реальную закупку, продавец — только закупку для продавца. */
  isAdmin: boolean
  subtotal: number
  totalDiscountAmount: number
  overallDiscountPercent: number
  bonusNum: number
  total: number
  bonusEarned: number
  submitting: boolean
  submit: () => void
  handleReset: () => void
}

export function KassaCart({
  cart,
  isMobile,
  isCartOpenMobile,
  setIsCartOpenMobile,
  hasLoss,
  lossAmount,
  lossItems,
  stockOf,
  removeItem,
  addToCart,
  products,
  changeItemPricePerGram,
  changeItemWeight,
  scrapRateOf,
  changeItemDiscountSom,
  changeItemDiscountPercent,
  applyDiscountToAll,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customers = [],
  showBonus,
  bonusUsed,
  setBonusUsed,
  payment,
  setPayment,
  payCash,
  setPayCash,
  payElectronic,
  setPayElectronic,
  isAdmin,
  subtotal,
  totalDiscountAmount,
  overallDiscountPercent,
  bonusNum,
  total,
  bonusEarned,
  submitting,
  submit,
  handleReset,
}: KassaCartProps) {
  // Автодополнение клиента
  const [showSuggestions, setShowSuggestions] = useState(false)
  const autocompleteRef = useRef<HTMLDivElement>(null)

  const filteredCustomers = customerName.trim().length >= 1
    ? customers.filter((c) =>
        (c.name ?? "").toLowerCase().includes(customerName.toLowerCase()) ||
        (c.phone ?? "").includes(customerName)
      ).slice(0, 8)
    : []

  // Клиент, выбранный из автодополнения (для показа счётчика покупок)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const handleSelectCustomer = (c: Customer) => {
    setCustomerName(c.name ?? "")
    setCustomerPhone(c.phone ?? "")
    setSelectedCustomer(c)
    setShowSuggestions(false)
  }

  // Сбрасываем выбранного клиента если имя очищено вручную
  useEffect(() => {
    if (!customerName.trim()) setSelectedCustomer(null)
  }, [customerName])

  // Закрыть список при клике вне
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-card/90 backdrop-blur shadow-xl overflow-hidden">
      <div 
        className="flex items-center justify-between border-b border-border/80 px-4 py-3.5 bg-muted/20 cursor-pointer lg:cursor-default"
        onClick={() => isMobile && setIsCartOpenMobile(!isCartOpenMobile)}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <h2 className="font-semibold text-sm tracking-tight">Чек / Корзина</h2>
          {cart.length > 0 && (
            <Badge variant="secondary" className="px-2 py-0.5 text-xs font-mono font-bold bg-primary/15 text-primary border-primary/20">
              {cart.length}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {cart.length > 0 && !isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); handleReset(); }}
              className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors px-2"
              title="Очистить чек и сбросить данные"
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Сброс
            </Button>
          )}
          {isMobile && (
            <Button variant="ghost" size="icon" className="h-7 w-7">
              {isCartOpenMobile ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className={cn("flex-col", isMobile && !isCartOpenMobile ? "hidden" : "flex")}>
        {hasLoss && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span>⚠️ Товар продаётся в убыток! Убыток: −{formatSom(lossAmount)}</span>
              <span className="mt-0.5 block text-[10px] font-normal opacity-90">{lossItems.map((i) => i.name).join(", ")}</span>
            </div>
          </div>
        )}

        <div className="max-h-[35vh] lg:max-h-[40vh] overflow-y-auto px-4 py-2 scrollbar-thin">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <ShoppingCart className="h-8 w-8 stroke-1 text-muted-foreground/30" />
              <p>Добавьте товары из поиска в чек</p>
            </div>
          ) : (
            cart.map((i) => {
              const isScrap = i.kind === "scrap"
              const stock = isScrap ? 0 : stockOf(i.product_id ?? "")
              const sameProduct = isScrap ? [i] : cart.filter((c) => c.product_id === i.product_id)
              const unitNo = sameProduct.findIndex((c) => c.lineId === i.lineId) + 1
              const canAddMore = !isScrap && sameProduct.length < stock
              const discountVal = i.discountSom ?? ((i.price * (i.discountPercent || 0)) / 100)
              const effectiveUnitPrice = Math.max(0, i.price - discountVal)
              const itemLoss = !isScrap && effectiveUnitPrice < i.cost
              const product = products.find((p) => p.id === i.product_id)
              const marketRate = isScrap ? scrapRateOf(i.metal ?? "") : 0
              const offMarket = isScrap && marketRate > 0 && Math.abs((i.price_per_gram ?? 0) - marketRate) / marketRate > 0.15

              return (
                <div key={i.lineId} className="flex flex-col border-b border-border/50 py-3 last:border-0 gap-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-xs font-semibold">
                        {isScrap && <Recycle className="mr-1 inline h-3 w-3 text-primary" />}
                        {i.name}
                        {!isScrap && sameProduct.length > 1 && (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                            ед. {unitNo} из {sameProduct.length}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                        {discountVal > 0 ? (
                          <>
                            <span className="line-through mr-1 opacity-60 text-[10px]">{formatSom(i.price)}</span>
                            <span className="text-primary font-semibold">{formatSom(effectiveUnitPrice)}</span>
                          </>
                        ) : (
                          formatSom(i.price)
                        )}{" "}
                        <span className="text-[10px] opacity-70">
                          {isScrap ? `· ${formatWeight(i.weight)} лома` : `· остаток ${stock} шт.`}
                        </span>
                      </div>
                      {product && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          закупка{isAdmin ? "" : " (с)"}:{" "}
                          {formatSom(
                            isAdmin
                              ? product.purchase_price
                              : (product.purchase_price_visible ?? product.purchase_price),
                          )}
                          {isAdmin && product.purchase_price_visible != null && (
                            <span className="ml-1 opacity-70">
                              · для продавца {formatSom(product.purchase_price_visible)}
                            </span>
                          )}
                        </div>
                      )}
                      {itemLoss && (
                        <div className="font-mono text-[10px] font-semibold text-destructive mt-0.5">
                          убыток −{formatSom(i.cost - effectiveUnitPrice)}
                        </div>
                      )}
                    </div>
                    
                    {!isScrap && (
                    <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5 border border-border/40">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md hover:bg-background"
                        title="Убрать единицу"
                        onClick={() => removeItem(i.lineId)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center text-xs font-mono font-medium tabular-nums">1</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md hover:bg-background"
                        disabled={!canAddMore || !product}
                        title={canAddMore ? "Добавить ещё единицу" : `Остаток: ${stock} шт.`}
                        onClick={() => product && addToCart(product)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      onClick={() => removeItem(i.lineId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Пересчёт по граммам прямо в чеке */}
                  {(isScrap || i.weight > 0) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/30 bg-muted/30 p-1.5 text-[10px]">
                      <span className="font-medium text-muted-foreground">По граммам:</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0"
                            value={i.weight || ""}
                            disabled={!isScrap}
                            onChange={(e) => changeItemWeight(i.lineId, parseFloat(e.target.value))}
                            className="h-6 w-16 bg-background px-1 text-center font-mono text-[11px]"
                            title={isScrap ? "Вес лома" : "Вес изделия берётся из карточки"}
                          />
                          <span className="text-[10px] text-muted-foreground">г</span>
                        </div>
                        <span className="text-muted-foreground">×</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            placeholder="0"
                            value={i.price_per_gram || ""}
                            onChange={(e) => changeItemPricePerGram(i.lineId, parseFloat(e.target.value))}
                            className={cn(
                              "h-6 w-20 bg-background px-1 text-center font-mono text-[11px]",
                              offMarket && "border-destructive text-destructive",
                            )}
                          />
                          <span className="text-[10px] text-muted-foreground">с/г</span>
                        </div>
                        <span className="font-mono font-semibold text-primary">{formatSom(i.price)}</span>
                      </div>
                      {isScrap && marketRate > 0 && (
                        <span className="w-full text-[9px] text-muted-foreground">
                          курс магазина {formatSom(marketRate)}/г
                          {offMarket ? " — цена сильно отличается" : ""}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between text-[10px] bg-muted/30 p-1.5 rounded-lg border border-border/30 gap-2">
                    <span className="text-muted-foreground font-medium">Скидка на ед:</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={i.discountSom || ""}
                          onChange={(e) => changeItemDiscountSom(i.lineId, parseFloat(e.target.value))}
                          className="h-6 w-14 text-center px-1 text-[11px] font-mono bg-background"
                        />
                        <span className="text-[10px] text-muted-foreground">с</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0"
                          value={i.discountPercent || ""}
                          onChange={(e) => changeItemDiscountPercent(i.lineId, parseFloat(e.target.value))}
                          className="h-6 w-12 text-center px-1 text-[11px] font-mono bg-background"
                        />
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </div>
                      {sameProduct.length > 1 && (
                        <button
                          onClick={() => applyDiscountToAll(i)}
                          className="rounded border border-border/80 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                        >
                          Ко всем
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="space-y-3 border-t border-border/80 p-4 bg-muted/20">
          <div className="grid grid-cols-2 gap-2">
            {/* Поле клиента с автодополнением */}
            <div className="relative" ref={autocompleteRef}>
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
              <Input
                placeholder="Клиент"
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setShowSuggestions(true) }}
                onFocus={() => setShowSuggestions(true)}
                className="h-8 pl-8 text-xs bg-background"
                autoComplete="off"
              />
              {showSuggestions && filteredCustomers.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(c) }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-medium block truncate">{c.name ?? "—"}</span>
                        {c.phone && <span className="text-[10px] text-muted-foreground font-mono">{c.phone}</span>}
                      </div>
                      {(c.purchase_count ?? 0) > 0 && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {c.purchase_count} поку{(c.purchase_count ?? 0) === 1 ? "пка" : (c.purchase_count ?? 0) <= 4 ? "пки" : "пок"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* Индикатор покупок под полем после выбора клиента */}
              {selectedCustomer && !showSuggestions && (selectedCustomer.purchase_count ?? 0) > 0 && (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5">
                  <span className="text-[10px] text-primary font-medium">
                    {selectedCustomer.purchase_count} покупок в истории
                  </span>
                  {(selectedCustomer.is_blacklisted) && (
                    <span className="ml-auto rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive">ЧС</span>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input 
                placeholder="Телефон" 
                value={customerPhone} 
                onChange={(e) => setCustomerPhone(e.target.value)} 
                className="h-8 pl-8 text-xs bg-background" 
              />
            </div>
          </div>

          <div className={cn("grid gap-2", showBonus ? "grid-cols-2" : "grid-cols-1")}>
            {showBonus && (
              <div className="grid gap-1">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Gift className="h-3 w-3 text-primary" /> Бонусами (с)
                </Label>
                <Input type="number" min={0} value={bonusUsed} onChange={(e) => setBonusUsed(e.target.value)} className="h-8 text-xs font-mono bg-background" />
              </div>
            )}
            
            {cart.length > 0 && isMobile && (
              <div className="flex items-end justify-end">
                <Button variant="outline" size="sm" onClick={handleReset} className="h-8 text-xs w-full text-muted-foreground bg-background">
                  <RefreshCw className="mr-1 h-3 w-3" /> Очистить
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <CreditCard className="h-3 w-3" /> Способ оплаты
            </Label>
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

            {payment === "mixed" && (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/50 bg-background/80 p-2">
                <div className="grid gap-1">
                  <Label className="text-[10px] text-muted-foreground">Наличными (с)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={payCash}
                    onChange={(e) => setPayCash(e.target.value)}
                    className="h-8 bg-background text-xs font-mono"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-muted-foreground">Переводом / картой (с)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={payElectronic}
                    onChange={(e) => setPayElectronic(e.target.value)}
                    className="h-8 bg-background text-xs font-mono"
                  />
                </div>
                <div
                  className={cn(
                    "col-span-2 text-[10px]",
                    Math.abs((Number(payCash) || 0) + (Number(payElectronic) || 0) - total) > 1
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  Внесено: {formatSom((Number(payCash) || 0) + (Number(payElectronic) || 0))} из {formatSom(total)}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5 rounded-xl bg-background/80 border border-border/50 p-3 text-xs shadow-inner">
            <div className="flex justify-between text-muted-foreground">
              <span>Подытог</span>
              <span className="font-mono">{formatSom(subtotal)}</span>
            </div>
            {totalDiscountAmount > 0 && (
              <div className="flex justify-between text-destructive font-medium">
                <span>Скидка ({overallDiscountPercent.toFixed(1)}%)</span>
                <span className="font-mono">−{formatSom(totalDiscountAmount)}</span>
              </div>
            )}
            {bonusNum > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Бонусами</span>
                <span className="font-mono">−{formatSom(bonusNum)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 text-sm font-bold border-t border-border/60">
              <span>Итого</span>
              <span className="font-mono text-primary text-base">{formatSom(total)}</span>
            </div>
            {showBonus && total > 0 && (
              <div className="flex items-center justify-between pt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                <span>Начислится бонусов</span>
                <span className="font-mono font-bold">+{bonusEarned}</span>
              </div>
            )}
          </div>

          <Button 
            className="w-full text-xs font-bold shadow-md h-10 transition-transform active:scale-[0.99]" 
            size="default" 
            disabled={cart.length === 0 || submitting} 
            onClick={submit}
          >
            {submitting ? "Оформление..." : `Оформить · ${formatSom(total)}`}
          </Button>
        </div>
      </div>
    </div>
  )
}