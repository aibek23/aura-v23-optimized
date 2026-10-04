"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { 
  AlertTriangle, 
  RefreshCw, 
  ShoppingCart, 
  Recycle,
  Trash2,
  User,
  Phone,
  Gift,
  CreditCard,
  Tag,
  ChevronDown
} from "lucide-react"
import { PAYMENT_METHODS, type Customer, type Product } from "@/lib/types"
import { formatSom, formatWeight } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ExtendedSaleItem } from "./index"

interface KassaCartProps {
  cart: ExtendedSaleItem[]
  isMobile: boolean
  isCartOpenMobile: boolean
  setIsCartOpenMobile: (open: boolean) => void
  hasLoss: boolean
  lossAmount: number
  lossItems: ExtendedSaleItem[]
  removeItem: (lineId: string) => void
  products: Product[]
  changeItemPricePerGram: (lineId: string, val: number) => void
  changeItemWeight: (lineId: string, val: number) => void
  scrapRateOf: (metal: string) => number
  changeItemDiscountSom: (lineId: string, val: number) => void
  changeItemDiscountPercent: (lineId: string, val: number) => void
  customerName: string
  setCustomerName: (name: string) => void
  customerPhone: string
  setCustomerPhone: (phone: string) => void
  customers?: Customer[]
  showBonus: boolean
  bonusUsed: string
  setBonusUsed: (bonus: string) => void
  payment: string
  setPayment: (payment: string | null) => void
  payCash: string
  setPayCash: (v: string) => void
  payElectronic: string
  setPayElectronic: (v: string) => void
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
  removeItem,
  products,
  changeItemPricePerGram,
  changeItemWeight,
  scrapRateOf,
  changeItemDiscountSom,
  changeItemDiscountPercent,
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
  const [showSuggestions, setShowSuggestions] = useState(false)
  const autocompleteRef = useRef<HTMLDivElement>(null)
  // Блок клиента по умолчанию свёрнут при первом открытии
  const [isCustomerOpen, setIsCustomerOpen] = useState(false)

  // Локальное состояние для плавного ввода "Своей цены" без багов ререндера
  const [customPriceInputs, setCustomPriceInputs] = useState<Record<string, string>>({})

  // Оптимизация: быстрый словарь для поиска товаров за O(1)
  const productsMap = useMemo(() => {
    return new Map(products.map((p) => [p.id, p]))
  }, [products])

  // Оптимизация: мемоизация фильтрации клиентов
  const filteredCustomers = useMemo(() => {
    const q = customerName.trim().toLowerCase()
    if (q.length < 1) return []
    return customers
      .filter((c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q)
      )
      .slice(0, 8)
  }, [customerName, customers])

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const handleSelectCustomer = (c: Customer) => {
    setCustomerName(c.name ?? "")
    setCustomerPhone(c.phone ?? "")
    setSelectedCustomer(c)
    setShowSuggestions(false)
  }

  useEffect(() => {
    if (!customerName.trim()) setSelectedCustomer(null)
  }, [customerName])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const cartCost = cart.reduce((sum, item) => sum + item.cost * item.quantity, 0)
  const expectedProfit = total - cartCost

  // Обработчик ручного ввода "Своей цены" без потери точности при округлении
  const handleCustomPriceInputChange = (item: ExtendedSaleItem, rawVal: string) => {
    setCustomPriceInputs((prev) => ({ ...prev, [item.lineId]: rawVal }))

    if (rawVal === "") {
      changeItemDiscountSom(item.lineId, 0)
      changeItemDiscountPercent(item.lineId, 0)
      return
    }

    const customPriceVal = parseFloat(rawVal)
    if (isNaN(customPriceVal) || customPriceVal < 0) return

    const basePrice = item.price

    // Точная фиксация скидки в сомах (округление до целого сома)
    const discountSom = Math.max(0, Math.round(basePrice - customPriceVal))
    // Процент рассчитывается без грубого округления до 2 знаков, исключая накопительную ошибку
    const discountPercent = basePrice > 0 ? (discountSom / basePrice) * 100 : 0

    changeItemDiscountSom(item.lineId, discountSom)
    changeItemDiscountPercent(item.lineId, Math.min(100, discountPercent))
  }

  const cartPanel = (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl">
      <div 
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/80 bg-muted/20 px-4 py-3.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <h2 className="truncate text-sm font-semibold">Чек / Корзина</h2>
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
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {hasLoss && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span>⚠️ Товар продаётся в убыток! Убыток: −{formatSom(lossAmount)}</span>
              <span className="mt-0.5 block text-[10px] font-normal opacity-90">{lossItems.map((i) => i.id).join(", ")}</span>
            </div>
          </div>
        )}

        <div className="max-h-[34vh] overflow-y-auto px-4 py-2 scrollbar-thin lg:max-h-[40vh]">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <ShoppingCart className="h-8 w-8 stroke-1 text-muted-foreground/30" />
              <p>Добавьте товары из поиска в чек</p>
            </div>
          ) : (
            cart.map((i) => {
              const isScrap = i.kind === "scrap"
              const discountVal = i.discountSom ?? ((i.price * (i.discountPercent || 0)) / 100)
              const effectiveUnitPrice = Math.max(0, i.price - discountVal)
              const itemLoss = !isScrap && effectiveUnitPrice < i.cost
              
              const product = productsMap.get(i.product_id!)  
              const sellerPerGram = product?.price_per_gram_purchase_visible ?? (
                product && product.weight > 0 && product.purchase_price_visible != null
                  ? product.purchase_price_visible / product.weight
                  : null
              )
              
              const marketRate = isScrap ? scrapRateOf(i.metal ?? "") : 0
              const offMarket = isScrap && marketRate > 0 && Math.abs((i.price_per_gram ?? 0) - marketRate) / marketRate > 0.15

              const customPriceInputValue = customPriceInputs[i.lineId] !== undefined 
                ? customPriceInputs[i.lineId] 
                : (discountVal > 0 ? String(effectiveUnitPrice) : "")

              return (
                <div key={i.lineId} className="flex flex-col border-b border-border/50 py-3 last:border-0 gap-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-xs font-semibold">
                        {isScrap && <Recycle className="mr-1 inline h-3 w-3 text-primary" />}
                        {i.name}
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
                          {isScrap ? `· ${formatWeight(i.weight)} лома` : "· 1 ед."}
                        </span>
                      </div>
                      {isAdmin && (
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm font-semibold">
                          <span className="font-sans font-medium text-muted-foreground">
                            Себестоимость:
                          </span>
                          {formatSom(i.cost)}
                        </div>
                      )}
                      {product?.purchase_price_visible != null && (
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm">
                          <span className="font-sans font-medium text-muted-foreground">
                            Цена продажи:
                          </span>
                          <strong className="font-mono text-foreground">
                            {formatSom(product.purchase_price_visible)}
                          </strong>
                          {sellerPerGram != null && (
                            <span className="font-mono ml-1">
                              ({formatSom(sellerPerGram)}/г)
                            </span>
                          )}
                        </div>
                      )}
                      {isAdmin && itemLoss && (
                        <div className="font-mono text-[10px] font-semibold text-destructive mt-0.5">
                          убыток −{formatSom(i.cost - effectiveUnitPrice)}
                        </div>
                      )}
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeItem(i.lineId)}
                      aria-label={`Удалить ${i.name} из чека`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

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
                            onChange={(e) => changeItemWeight(i.lineId, parseFloat(e.target.value) || 0)}
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
                            onChange={(e) => changeItemPricePerGram(i.lineId, parseFloat(e.target.value) || 0)}
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

                    {/* Блок «Своя цена» и «Скидка» (увеличен инпут и цифры для Своя цена) */}
                <div className="grid grid-cols-1 gap-2 bg-muted/40 p-2 rounded-xl border border-border/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-primary" /> Своя цена:
                    </span>
                    <Input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      placeholder={formatSom(i.price)}
                      value={customPriceInputValue}
                      onChange={(e) => handleCustomPriceInputChange(i, e.target.value)}
                      onBlur={() => {
                        setCustomPriceInputs((prev) => {
                          const next = { ...prev }
                          delete next[i.lineId]
                          return next
                        })
                      }}
                      className="h-9 w-32 text-center px-2 text-sm font-mono font-bold text-primary bg-background border-primary/40 focus:border-primary shadow-sm placeholder:text-muted-foreground placeholder:opacity-50"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/20 text-[10px]">
                    <span className="text-muted-foreground font-medium">Скидка:</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={i.discountSom || ""}
                          onChange={(e) => {
                            const val = Math.max(0, Math.round(parseFloat(e.target.value) || 0))
                            changeItemDiscountSom(i.lineId, val)
                            if (i.price > 0) {
                              changeItemDiscountPercent(i.lineId, (val / i.price) * 100)
                            }
                        }}
                        className="h-6 w-16 text-center px-1 text-[11px] font-mono bg-background"
                      />
                      <span className="text-[10px] text-muted-foreground">с</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="0"
                        value={i.discountPercent ? Math.round(i.discountPercent * 100) / 100 : ""}
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                          changeItemDiscountPercent(i.lineId, val)
                          changeItemDiscountSom(i.lineId, Math.round((i.price * val) / 100))
                        }}
                        className="h-6 w-12 text-center px-1 text-[11px] font-mono bg-background"
                      />
                      <span className="text-[10px] text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
                </div>
        
                </div>
              )
            })
          )}
        </div>

        <div className="space-y-3 border-t border-border/80 bg-muted/20 p-4">
          {/* Сворачиваемый блок клиента (по умолчанию закрыт) */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background/70 shadow-sm transition-all">
            <button
              type="button"
              onClick={() => setIsCustomerOpen((prev) => !prev)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              aria-expanded={isCustomerOpen}
              aria-label={isCustomerOpen ? "Свернуть блок клиента" : "Развернуть блок клиента"}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <User className="h-3 w-3" />
                </span>
                <span className="text-xs font-semibold text-foreground">Клиент</span>
                {customerName.trim() || customerPhone.trim() ? (
                  <span className="max-w-[150px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {customerName.trim() || customerPhone.trim()}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">(не указан)</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="hidden sm:inline">{isCustomerOpen ? "Скрыть" : "Выбрать"}</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    isCustomerOpen && "rotate-180 text-primary"
                  )}
                />
              </div>
            </button>

            {isCustomerOpen && (
              <div className="space-y-2 border-t border-border/40 p-2.5 pt-2">
                <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                  <div className="relative" ref={autocompleteRef}>
                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
                    <Input
                      placeholder="Имя клиента"
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
              </div>
            )}
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

          <div className="space-y-2 rounded-xl bg-background/80 border border-border/50 p-3 text-sm shadow-inner">
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
            {isAdmin && cart.length > 0 && (
              <>
                <div className="flex justify-between gap-3 border-t border-border/60 pt-2 text-muted-foreground">
                  <span>Себестоимость</span>
                  <span className="font-mono font-semibold text-foreground">{formatSom(cartCost)}</span>
                </div>
                <div
                  className={cn(
                    "flex justify-between gap-3 font-semibold",
                    expectedProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
                  )}
                >
                  <span>Прибыль после скидок</span>
                  <span className="font-mono">{formatSom(expectedProfit)}</span>
                </div>
              </>
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
            {submitting ? "Оформить..." : `Оформить · ${formatSom(total)}`}
          </Button>
        </div>
      </div>
    </div>
  )

  if (!isMobile) return cartPanel

  return (
    <>
      <Button
        type="button"
        onClick={() => setIsCartOpenMobile(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 h-16 max-w-[calc(100vw-2rem)] gap-3 rounded-2xl px-4 shadow-xl"
        aria-label={`Открыть чек: ${cart.length} товаров, итог ${formatSom(total)}`}
      >
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-foreground/15">
          <ShoppingCart className="h-6 w-6" />
          {cart.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full border-2 border-primary bg-primary-foreground px-1 font-mono text-xs font-bold text-primary">
              {cart.length}
            </span>
          )}
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-xs font-medium opacity-80">Чек · {cart.length} шт.</span>
          <span className="block truncate font-mono text-base font-bold">{formatSom(total)}</span>
        </span>
      </Button>

      <Dialog open={isCartOpenMobile} onOpenChange={setIsCartOpenMobile}>
        <DialogContent
          className="top-auto bottom-0 left-0 max-h-[calc(100dvh-0.5rem)] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">Чек</DialogTitle>
          <DialogDescription className="sr-only">Товары, скидки, оплата и итоговая сумма продажи</DialogDescription>
          {cartPanel}
        </DialogContent>
      </Dialog>
    </>
  )
}