"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import type { MetalRate, Product, Profile, Role, Sale, SaleItem, Customer } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { buildRateMap, scrapRateOf } from "@/lib/rates"
import { round, toNumber } from "@/hooks/useCalculator"
import { checkout } from "@/app/actions/sales"
import { SalesHistory } from "@/components/sales-history"
import { CashPanel, OPEN_CASH_INCOME_EVENT } from "@/components/screens/kassa/cash-panel"
import { computeBalances } from "@/lib/cash"
import type { CashData } from "@/app/actions/cash"
import { Button } from "@/components/ui/button"
import { ArrowUp } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { PageLoader } from "@/components/ui/page-loader"

import { KassaSearch } from "./kassa-search"
import { KassaCart } from "./kassa-cart"
import { KassaLossModal } from "./kassa-loss-modal"
import { KassaScrap, type ScrapDraft } from "./kassa-scrap"

export interface ExtendedSaleItem extends SaleItem {
  lineId: string
  discountPercent?: number
  discountSom?: number
}

const DEBOUNCE_MS = 350
const MIN_QUERY = 3
const LOCAL_STORAGE_KEY = "kassa_cart_state_v2"

export function KassaScreen({
  products,
  profile,
  viewRole,
  sales,
  cash,
  rates = [],
  clients = [],
}: {
  products: Product[]
  profile: Profile
  viewRole: Role
  sales: Sale[]
  cash: CashData
  rates?: MetalRate[]
  clients?: Customer[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  
  const [cart, setCart] = useState<ExtendedSaleItem[]>([])
  const [bonusUsed, setBonusUsed] = useState("")
  const [payment, setPayment] = useState("cash")
  const [payCash, setPayCash] = useState("")
  const [payElectronic, setPayElectronic] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  
  const [submitting, setSubmitting] = useState(false)
  const [confirmLoss, setConfirmLoss] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const [showScrollTop, setShowScrollTop] = useState(false)
  const [isCartOpenMobile, setIsCartOpenMobile] = useState(true)

  const showBonus = viewRole === "seller"
  const canSeeProfit = viewRole !== "seller"
  const isAdmin = viewRole !== "seller"

  const rateMap = useMemo(() => buildRateMap(rates), [rates])

  const sellers = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sales) map.set(s.seller_id, s.seller_name || "Без имени")
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [sales])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed.cart)) setCart(parsed.cart)
        if (parsed.bonusUsed !== undefined) setBonusUsed(parsed.bonusUsed)
        if (parsed.payment !== undefined) setPayment(parsed.payment)
        if (parsed.customerName !== undefined) setCustomerName(parsed.customerName)
        if (parsed.customerPhone !== undefined) setCustomerPhone(parsed.customerPhone)
      }
    } catch (e) {
      console.error("[kassa] Error reading localStorage:", e)
    } finally {
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({ cart, bonusUsed, payment, customerName, customerPhone })
      )
    } catch (e) {
      console.error("[kassa] Error saving to localStorage:", e)
    }
  }, [cart, bonusUsed, payment, customerName, customerPhone, isLoaded])

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)")
    const sync = () => setIsMobile(mql.matches)
    sync()
    mql.addEventListener("change", sync)

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | Document
      let scrollTop = 0
      if (target instanceof Document) {
        scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
      } else if (target instanceof HTMLElement) {
        scrollTop = target.scrollTop
      }
      setShowScrollTop(scrollTop > 200)
    }

    window.addEventListener("scroll", handleScroll, true)
    return () => {
      mql.removeEventListener("change", sync)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [])

  const pageSize = isMobile ? 8 : 12
  const [visible, setVisible] = useState(pageSize)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Три последних добавленных изделия — для пустого состояния поиска.
  const recentProducts = useMemo(
    () =>
      [...products]
        .filter((p) => p.status !== "sold" && p.quantity > 0 && !p.is_hidden)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3),
    [products],
  )

  const stockOf = (id: string) => products.find((p) => p.id === id)?.quantity ?? 0
  const qtyInCart = (id: string) => cart.filter((i) => i.product_id === id).length

  const results = useMemo(() => {
    if (debounced.length < MIN_QUERY) return []
    const q = debounced.toLowerCase()
    return products.filter(
      (p) =>
        p.quantity > 0 &&
        p.status !== "sold" &&
        !p.is_hidden &&           // скрытые товары не отображаются в поиске кассы
        (p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.metal ?? "").toLowerCase().includes(q)),
    )
  }, [products, debounced])

  useEffect(() => setVisible(pageSize), [debounced, pageSize])

  const trackRef = useRef<HTMLDivElement | null>(null)
  const onTrackScroll = () => {
    const el = trackRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisible((v) => Math.min(v + pageSize, results.length))
    }
  }

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const already = prev.filter((i) => i.product_id === p.id).length
      if (already >= p.quantity) {
        toast.error(`Достигнуто максимальное количество товара в наличии (Остаток: ${p.quantity} шт.)`)
        return prev
      }
      if (p.sale_price < p.purchase_price) {
        toast.warning(`«${p.name}» продаётся ниже закупочной цены`)
      }
      const line: ExtendedSaleItem = {
        lineId: `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        product_id: p.id,
        name: p.name,
        weight: p.weight,
        metal: p.metal,
        kind: "product",
        price_per_gram:
          p.price_per_gram_sale ?? (p.weight > 0 ? round(p.sale_price / p.weight, 2) : null),
        quantity: 1,
        price: p.sale_price,
        cost: p.purchase_price,
        discountPercent: 0,
        discountSom: 0,
      }
      const lastIdx = prev.map((i) => i.product_id).lastIndexOf(p.id)
      if (lastIdx === -1) return [...prev, line]
      return [...prev.slice(0, lastIdx + 1), line, ...prev.slice(lastIdx + 1)]
    })
  }

  /** Лом попадает в чек отдельной строкой: склада он не касается. */
  const addScrap = ({ name, metal, weight, pricePerGram }: ScrapDraft) => {
    const price = round(weight * pricePerGram)
    setCart((prev) => [
      ...prev,
      {
        lineId: `scrap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        product_id: null,
        kind: "scrap",
        name: name || `Лом · ${metal}`,
        weight,
        metal,
        price_per_gram: pricePerGram,
        quantity: 1,
        // Лом покупается по курсу — прибыли в нём нет, поэтому cost === price.
        price,
        cost: price,
        discountPercent: 0,
        discountSom: 0,
      },
    ])
    toast.success(`Лом добавлен: ${formatSom(price)}`)
  }

  /** Пересчёт строки чека по цене за грамм. */
  const changeItemPricePerGram = (lineId: string, value: number) => {
    const perGram = Math.max(0, toNumber(value))
    setCart((prev) =>
      prev.map((i) => {
        if (i.lineId !== lineId) return i
        const price = round(i.weight * perGram)
        const isScrap = i.kind === "scrap"
        return {
          ...i,
          price_per_gram: perGram,
          price,
          cost: isScrap ? price : i.cost,
          // цена пересчитана заново — прежняя скидка к ней уже не относится
          discountSom: 0,
          discountPercent: 0,
        }
      }),
    )
  }

  /** Изменение веса строки: имеет смысл для лома. */
  const changeItemWeight = (lineId: string, value: number) => {
    const weight = Math.max(0, toNumber(value))
    setCart((prev) =>
      prev.map((i) => {
        if (i.lineId !== lineId) return i
        const perGram = toNumber(i.price_per_gram)
        const price = perGram > 0 ? round(weight * perGram) : i.price
        const isScrap = i.kind === "scrap"
        return { ...i, weight, price, cost: isScrap ? price : i.cost }
      }),
    )
  }

  const changeItemDiscountPercent = (lineId: string, percentVal: number) => {
    const validPct = Math.min(100, Math.max(0, percentVal || 0))
    setCart((prev) =>
      prev.map((i) => {
        if (i.lineId !== lineId) return i
        const discountInSom = (i.price * validPct) / 100
        return { ...i, discountPercent: validPct, discountSom: Math.round(discountInSom) }
      }),
    )
  }

  const changeItemDiscountSom = (lineId: string, somVal: number) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.lineId !== lineId) return i
        const validSom = Math.min(i.price, Math.max(0, somVal || 0))
        const pct = i.price > 0 ? (validSom / i.price) * 100 : 0
        return { ...i, discountSom: validSom, discountPercent: Number(pct.toFixed(1)) }
      }),
    )
  }

  const applyDiscountToAll = (line: ExtendedSaleItem) => {
    setCart((prev) =>
      prev.map((i) =>
        i.product_id === line.product_id
          ? { ...i, discountSom: line.discountSom ?? 0, discountPercent: line.discountPercent ?? 0 }
          : i,
      ),
    )
    toast.success("Скидка применена ко всем единицам товара")
  }

  const removeItem = (lineId: string) => setCart((prev) => prev.filter((i) => i.lineId !== lineId))

  const handleReset = () => {
    setCart([])
    setBonusUsed("")
    setCustomerName("")
    setCustomerPhone("")
    setPayment("cash")
    setQuery("")
    localStorage.removeItem(LOCAL_STORAGE_KEY)
    toast.info("Чек полностью сброшен")
  }

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  
  const itemsSubtotalAfterItemDiscounts = cart.reduce((s, i) => {
    const discountPerItem = i.discountSom ?? ((i.price * (i.discountPercent || 0)) / 100)
    const effectiveUnitPrice = Math.max(0, i.price - discountPerItem)
    return s + effectiveUnitPrice * i.quantity
  }, 0)

  const totalDiscountAmount = subtotal - itemsSubtotalAfterItemDiscounts
  const overallDiscountPercent = subtotal > 0 ? (totalDiscountAmount / subtotal) * 100 : 0

  const bonusNum = showBonus ? Math.min(Number(bonusUsed) || 0, itemsSubtotalAfterItemDiscounts) : 0
  const total = Math.max(0, itemsSubtotalAfterItemDiscounts - bonusNum)
  const cartCost = cart.reduce((s, i) => s + i.cost * i.quantity, 0)
  const bonusEarned = Math.round(Math.max(0, total - cartCost) * (Number(profile.bonus_rate ?? 2) / 100))

  const lossItems = cart.filter((i) => {
    if (i.kind === "scrap") return false
    const disc = i.discountSom ?? ((i.price * (i.discountPercent || 0)) / 100)
    const eff = i.price - disc
    return eff < i.cost
  })
  
  const lossAmount = cart.reduce((s, i) => {
    if (i.kind === "scrap") return s
    const disc = i.discountSom ?? ((i.price * (i.discountPercent || 0)) / 100)
    const eff = i.price - disc
    return eff < i.cost ? s + (i.cost - eff) * i.quantity : s
  }, 0) + (total < cartCost ? cartCost - total : 0)
  
  const hasLoss = lossAmount > 0

  const doCheckout = async () => {
    setConfirmLoss(false)
    setSubmitting(true)
    try {
      const res = await checkout({
        items: cart.map((item) => {
          const disc = item.discountSom ?? ((item.price * (item.discountPercent || 0)) / 100)
          const { lineId: _lineId, discountPercent: _dp, discountSom: _ds, ...rest } = item
          return { ...rest, price: Math.max(0, item.price - disc) }
        }),
        discount: totalDiscountAmount,
        bonus_used: bonusNum,
        payment_method: payment,
        amount_cash: payment === "mixed" ? Number(payCash) || 0 : undefined,
        amount_electronic: payment === "mixed" ? Number(payElectronic) || 0 : undefined,
        customer_name: customerName,
        customer_phone: customerPhone,
      })
      toast.success(`Продажа оформлена: ${formatSom(res.total)}`, {
        description: showBonus ? `Начислено ${res.bonusEarned} бонусов` : undefined,
      })
      handleReset()
      startTransition(() => router.refresh())
    } catch (e) {
      console.error("[kassa] checkout error:", e)
      toast.error(e instanceof Error ? e.message : "Ошибка оформления продажи")
    } finally {
      setSubmitting(false)
    }
  }

  const submit = () => {
    if (cart.length === 0) return
    // Смешанная оплата: две суммы должны закрывать чек.
    if (payment === "mixed") {
      const paid = (Number(payCash) || 0) + (Number(payElectronic) || 0)
      if (Math.abs(paid - total) > 1) {
        toast.error(`Суммы оплаты должны давать ${formatSom(total)}`)
        return
      }
    }
    if (hasLoss) {
      setConfirmLoss(true)
      return
    }
    void doCheckout()
  }

  /** Текущие балансы кассы: из них выплачивается лом. */
  const cashBalances = useMemo(() => computeBalances(sales, cash.operations), [sales, cash.operations])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" })
    document.body.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="relative w-full max-w-full overflow-x-hidden pb-12">
      {/* Лоадер при оформлении продажи */}
      {submitting && <PageLoader />}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] gap-6 items-start">
        
        <div className="flex flex-col gap-6 order-1 min-w-0 w-full">
          <CashPanel sales={sales} operations={cash.operations} presets={cash.presets} isAdmin={isAdmin} />
          
          <KassaScrap
            rates={rateMap}
            balances={cashBalances}
            onAdd={addScrap}
            onRequestDeposit={() => window.dispatchEvent(new Event(OPEN_CASH_INCOME_EVENT))}
          />

          <KassaSearch
            query={query}
            setQuery={setQuery}
            debounced={debounced}
            results={results}
            visible={visible}
            setVisible={setVisible}
            pageSize={pageSize}
            trackRef={trackRef}
            onTrackScroll={onTrackScroll}
            qtyInCart={qtyInCart}
            addToCart={addToCart}
            minQuery={MIN_QUERY}
            recent={recentProducts}
          />
          
          <div className="hidden lg:block">
             <SalesHistory sales={sales} canSeeProfit={canSeeProfit} sellers={sellers} />
          </div>
        </div>
        
        <div className="order-2 w-full lg:sticky lg:top-4 z-10 min-w-0">
          <KassaCart
            cart={cart}
            isMobile={isMobile}
            isCartOpenMobile={isCartOpenMobile}
            setIsCartOpenMobile={setIsCartOpenMobile}
            hasLoss={hasLoss}
            lossAmount={lossAmount}
            lossItems={lossItems}
            stockOf={stockOf}
            removeItem={removeItem}
            addToCart={addToCart}
            products={products}
            changeItemPricePerGram={changeItemPricePerGram}
            changeItemWeight={changeItemWeight}
            scrapRateOf={(metal: string) => scrapRateOf(rateMap, metal)}
            changeItemDiscountSom={changeItemDiscountSom}
            changeItemDiscountPercent={changeItemDiscountPercent}
            applyDiscountToAll={applyDiscountToAll}
            customers={clients}
            customerName={customerName}
            setCustomerName={setCustomerName}
            customerPhone={customerPhone}
            setCustomerPhone={setCustomerPhone}
            showBonus={showBonus}
            bonusUsed={bonusUsed}
            setBonusUsed={setBonusUsed}
            payment={payment}
            payCash={payCash}
            setPayCash={setPayCash}
            payElectronic={payElectronic}
            setPayElectronic={setPayElectronic}
            isAdmin={isAdmin}
            setPayment={(v) => setPayment(v ?? "")}
            subtotal={subtotal}
            totalDiscountAmount={totalDiscountAmount}
            overallDiscountPercent={overallDiscountPercent}
            bonusNum={bonusNum}
            total={total}
            bonusEarned={bonusEarned}
            submitting={submitting}
            submit={submit}
            handleReset={handleReset}
          />
        </div>

        <div className="order-3 lg:hidden w-full min-w-0 mt-2">
           <SalesHistory sales={sales} canSeeProfit={canSeeProfit} sellers={sellers} />
        </div>
      </div>

      <KassaLossModal
        isOpen={confirmLoss}
        lossAmount={lossAmount}
        onClose={() => setConfirmLoss(false)}
        onConfirm={() => void doCheckout()}
      />

      {showScrollTop && (
        <Button
          onClick={scrollToTop}
          size="icon"
          className="fixed bottom-6 right-6 z-[50] h-10 w-10 rounded-full shadow-2xl transition-all duration-300 animate-in fade-in zoom-in-75 active:scale-90"
          aria-label="Наверх"
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  )
}