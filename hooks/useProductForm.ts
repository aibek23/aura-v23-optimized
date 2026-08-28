"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { Product } from "@/lib/types"
import { parseMetal, type MetalCondition } from "@/lib/metal"
import { generateArticle } from "@/app/actions/article"
import { articlePrefix } from "@/lib/article"
import {
  clearDraft,
  pushNameHistory,
  readDraft,
  readNameHistory,
  removeNameHistory,
  saveDraft,
} from "@/lib/name-history"
import { useCalculator } from "@/hooks/useCalculator"
import { toast } from "sonner"

export type FormState = {
  name: string
  category: string
  metal: string
  metal_color: string
  purity: string
  weight: number
  size: string
  sku: string
  quantity: number
  purchase_price: number
  /** Переименовано из purchase_price_seller (v20). */
  purchase_price_visible: number
  price_per_gram_sale: number
  price_per_gram_purchase: number
  /** Переименовано из price_per_gram_purchase_seller (v20). */
  price_per_gram_purchase_visible: number
  stones: string
  description: string
  sale_price: number
  images: string[]
  supplier_name: string
  supplier_phone: string
}

export const EMPTY_FORM: FormState = {
  name: "",
  category: "Кольца",
  metal: "Золото 585",
  metal_color: "Жёлтое золото",
  purity: "",
  weight: 0,
  size: "",
  sku: "",
  quantity: 1,
  purchase_price: 0,
  purchase_price_visible: 0,
  price_per_gram_sale: 0,
  price_per_gram_purchase: 0,
  price_per_gram_purchase_visible: 0,
  stones: "",
  description: "",
  sale_price: 0,
  images: [],
  supplier_name: "",
  supplier_phone: "",
}

export function useProductForm(open: boolean, product: Product | null) {
  const calc = useCalculator()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [metalCondition, setMetalCondition] = useState<MetalCondition>("new")
  const [metalBase, setMetalBase] = useState("Золото")
  
  const [nameHistory, setNameHistory] = useState<string[]>([])
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuError, setSkuError] = useState<string | null>(null)
  
  const skuAuto = useRef(true)
  const draftRestored = useRef(false)

  // Инициализация при открытии
  useEffect(() => {
    if (!open) {
      draftRestored.current = false
      return
    }
    setNameHistory(readNameHistory())
    setSkuError(null)

    if (product) {
      skuAuto.current = false
      const parsed = parseMetal(product.metal)
      setMetalCondition(parsed.condition)
      setMetalBase(parsed.base)
      const gallery = product.images?.length
        ? product.images
        : product.image_url
        ? [product.image_url]
        : []

      setForm({
        name: product.name,
        category: product.category ?? "Кольца",
        metal: product.metal ?? "Золото 585",
        metal_color: product.metal_color ?? "",
        purity: product.purity ?? "",
        weight: product.weight,
        size: product.size ?? "",
        sku: product.sku ?? "",
        quantity: product.quantity,
        purchase_price: product.purchase_price,
        purchase_price_visible: product.purchase_price_visible ?? 0,
        price_per_gram_sale: product.price_per_gram_sale ?? 0,
        price_per_gram_purchase: product.price_per_gram_purchase ?? 0,
        price_per_gram_purchase_visible: product.price_per_gram_purchase_visible ?? 0,
        // is_secondary удалено из БД (v20) — вычисляется на лету из поля metal
        stones: product.stones ?? "",
        description: product.description ?? "",
        sale_price: product.sale_price,
        images: gallery,
        supplier_name: product.supplier_name ?? "",
        supplier_phone: product.supplier_phone ?? "",
      })
      return
    }

    skuAuto.current = true
    setMetalCondition("new")
    setMetalBase("Золото")
    
    if (draftRestored.current) return
    draftRestored.current = true
    const draft = readDraft<FormState>()
    if (draft && typeof draft === "object") {
      setForm({ ...EMPTY_FORM, ...draft })
      toast.info("Восстановлен черновик карточки", {
        action: {
          label: "Очистить",
          onClick: () => {
            clearDraft()
            setForm(EMPTY_FORM)
          },
        },
      })
    } else {
      setForm(EMPTY_FORM)
    }
  }, [product, open])

  // Автосохранение черновика
  useEffect(() => {
    if (!open || product) return
    if (form === EMPTY_FORM) return
    const id = setTimeout(() => saveDraft(form), 400)
    return () => clearTimeout(id)
  }, [form, open, product])

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  // Пересчеты цен за грамм / итого
  const changeWeight = (value: number) => {
    const weight = calc.toNumber(value)
    setForm((f) => ({
      ...f,
      weight,
      sale_price: f.price_per_gram_sale > 0 ? calc.totalFromGram(weight, f.price_per_gram_sale) : f.sale_price,
      purchase_price: f.price_per_gram_purchase > 0 ? calc.totalFromGram(weight, f.price_per_gram_purchase) : f.purchase_price,
      purchase_price_visible: f.price_per_gram_purchase_visible > 0 ? calc.totalFromGram(weight, f.price_per_gram_purchase_visible) : f.purchase_price_visible,
    }))
  }

  const changeGramSale = (value: number) => {
    const perGram = calc.toNumber(value)
    setForm((f) => ({ ...f, price_per_gram_sale: perGram, sale_price: calc.totalFromGram(f.weight, perGram) }))
  }

  const changeSalePrice = (value: number) => {
    const total = calc.toNumber(value)
    setForm((f) => ({ ...f, sale_price: total, price_per_gram_sale: calc.gramFromTotal(f.weight, total) }))
  }

  const changeGramPurchase = (value: number) => {
    const perGram = calc.toNumber(value)
    setForm((f) => ({ ...f, price_per_gram_purchase: perGram, purchase_price: calc.totalFromGram(f.weight, perGram) }))
  }

  const changePurchasePrice = (value: number) => {
    const total = calc.toNumber(value)
    setForm((f) => ({ ...f, purchase_price: total, price_per_gram_purchase: calc.gramFromTotal(f.weight, total) }))
  }

  const changeGramPurchaseVisible = (value: number) => {
    const perGram = calc.toNumber(value)
    setForm((f) => ({ ...f, price_per_gram_purchase_visible: perGram, purchase_price_visible: calc.totalFromGram(f.weight, perGram) }))
  }

  const changePurchasePriceVisible = (value: number) => {
    const total = calc.toNumber(value)
    setForm((f) => ({ ...f, purchase_price_visible: total, price_per_gram_purchase_visible: calc.gramFromTotal(f.weight, total) }))
  }

  const marginPercent = useMemo(
    () => calc.marginPercent(form.sale_price, form.purchase_price),
    [calc, form.sale_price, form.purchase_price],
  )

  const requestArticle = useCallback(
    async (category: string, metal: string, metalColor: string, force = false) => {
      if (product) return
      if (!force && !skuAuto.current) return
      const prefix = articlePrefix(category, metal, metalColor || null)
      if (!prefix) {
        setSkuError("Выберите категорию и металл")
        return
      }
      setSkuLoading(true)
      setSkuError(null)
      try {
        const { article } = await generateArticle(prefix)
        skuAuto.current = true
        setForm((f) => ({ ...f, sku: article }))
      } catch (e) {
        setSkuError(e instanceof Error ? e.message : "Не удалось получить артикул")
      } finally {
        setSkuLoading(false)
      }
    },
    [product]
  )

  return {
    form,
    setForm,
    setField,
    metalCondition,
    setMetalCondition,
    metalBase,
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
  }
}