"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MetalPicker } from "@/components/metal-picker"
import { CATEGORIES, METAL_COLORS } from "@/lib/types"
import { cn } from "@/lib/utils"
import { RefreshCw, X } from "lucide-react"
import type { FormState } from "@/hooks/useProductForm"

type Props = {
  form: FormState
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  nameHistory: string[]
  setNameHistory: (history: string[]) => void
  metalCondition: any
  metalBase: string
  setMetalCondition: (c: any) => void
  setMetalBase: (b: string) => void
  skuLoading: boolean
  skuError: string | null
  onRefreshArticle: () => void
  skuAutoRef: React.MutableRefObject<boolean>
}

export function ProductGeneralInfo({
  form,
  setField,
  nameHistory,
  setNameHistory,
  metalCondition,
  metalBase,
  setMetalCondition,
  setMetalBase,
  skuLoading,
  skuError,
  onRefreshArticle,
  skuAutoRef,
}: Props) {
  const [nameOpen, setNameOpen] = useState(false)

  const nameSuggestions = nameHistory
    .filter((n) => n.toLowerCase().includes(form.name.trim().toLowerCase()) && n.toLowerCase() !== form.name.toLowerCase())
    .slice(0, 6)

  return (
    <>
      {/* Название */}
      <div className="grid gap-2">
        <Label htmlFor="p-name">Название</Label>
        <div className="relative">
          <Input
            id="p-name"
            autoComplete="off"
            value={form.name}
            onChange={(e) => {
              setField("name", e.target.value)
              setNameOpen(true)
            }}
            onFocus={() => setNameOpen(true)}
            onBlur={() => setTimeout(() => setNameOpen(false), 120)}
          />
          {nameOpen && nameSuggestions.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
              {nameSuggestions.map((n) => (
                <li key={n} className="flex items-center">
                  <button
                    type="button"
                    className="flex-1 px-3 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setField("name", n)
                      setNameOpen(false)
                    }}
                  >
                    {n}
                  </button>
                  <button
                    type="button"
                    className="px-2 text-muted-foreground hover:text-destructive"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setNameHistory(nameHistory.filter((item) => item !== n))
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <MetalPicker
        condition={metalCondition}
        base={metalBase}
        purity={form.purity}
        onChange={({ condition, base, purity, metal }) => {
          skuAutoRef.current = true
          setMetalCondition(condition)
          setMetalBase(base)
          setField("purity", purity)
          setField("metal", metal)
          // is_secondary удалено из БД (v20); вычисляется из metal через /^вторичн/i
        }}
      />

      {/* Цвет металла */}
      <div className="grid gap-2">
        <Label>Цвет металла</Label>
        <div className="flex flex-wrap gap-1.5">
          {METAL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                skuAutoRef.current = true
                setField("metal_color", form.metal_color === c ? "" : c)
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                form.metal_color === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Категория и Проба */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Категория</Label>
          <Select
            value={form.category}
            onValueChange={(v) => {
              skuAutoRef.current = true
              setField("category", v ?? "")
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Проба</Label>
          <Input value={form.purity || "—"} readOnly className="bg-muted/40 font-mono" />
        </div>
      </div>

      {/* Артикул */}
      <div className="grid gap-2">
        <Label htmlFor="p-sku">Артикул</Label>
        <div className="flex gap-2">
          <Input
            id="p-sku"
            value={form.sku}
            placeholder={skuLoading ? "Генерируем…" : "КЖ50001"}
            onChange={(e) => {
              skuAutoRef.current = false
              setField("sku", e.target.value.toUpperCase())
            }}
            className={cn("font-mono tracking-wide", skuError && "border-destructive")}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={skuLoading}
            onClick={onRefreshArticle}
          >
            <RefreshCw className={cn("size-4", skuLoading && "animate-spin")} />
          </Button>
        </div>
        {skuError ? <p className="text-xs text-destructive">{skuError}</p> : null}
      </div>
    </>
  )
}