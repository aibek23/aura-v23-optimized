"use client"

import { useState } from "react"
import { Camera, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal"
import { cn } from "@/lib/utils"
import { parseProductSearchQuery } from "@/lib/product-search"

export function extractSearchValue(raw: string): string {
  const clean = raw.trim()
  if (!clean) return ""

  try {
    const url = new URL(clean)
    const segments = url.pathname.split("/").filter(Boolean)
    const qIndex = segments.indexOf("q")
    if (qIndex >= 0 && segments[qIndex + 2]) {
      return decodeURIComponent(segments[qIndex + 2]).toUpperCase()
    }
    const productIndex = segments.lastIndexOf("product")
    if (productIndex >= 0 && segments[productIndex + 1]) {
      return decodeURIComponent(segments[productIndex + 1]).toUpperCase()
    }
    const skuFromQuery = url.searchParams.get("sku") ?? url.searchParams.get("article")
    if (skuFromQuery) return skuFromQuery.toUpperCase()
  } catch {
    // Обычный штрихкод/артикул — это не URL.
  }

  return clean
}

type ProductSearchProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  showScanner?: boolean
  className?: string
  inputClassName?: string
}

export function ProductSearch({
  value,
  onChange,
  placeholder = "Поиск по названию, артикулу, весу, цене или дате...",
  showScanner = true,
  className,
  inputClassName,
}: ProductSearchProps) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const parsed = parseProductSearchQuery(value)
  const hint =
    parsed.kind === "weight"
      ? `Вес: ${parsed.value.toLocaleString("ru-RU")} г`
      : parsed.kind === "price"
        ? `Цена на этикетке: ${Math.round(parsed.value).toLocaleString("ru-RU")} с`
        : parsed.kind === "date"
          ? `Дата создания: ${value.trim()}`
          : null

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label="Поиск товаров"
            className={cn("h-10 pl-9 pr-9", inputClassName)}
          />
          {value && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {showScanner && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            title="Сканировать QR или штрихкод"
            aria-label="Сканировать QR или штрихкод"
            onClick={() => setScannerOpen(true)}
          >
            <Camera className="h-4 w-4 text-primary" />
          </Button>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-primary">{hint}</p>}
      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={(raw) => onChange(extractSearchValue(raw))}
        />
      )}
    </>
  )
}
