"use client"

import { useState } from "react"
import { Camera, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal"
import { cn } from "@/lib/utils"
import { parseProductSearchQuery } from "@/lib/product-search"
import { parseQrCode } from "@/lib/qr-code"
import { checkQrShop } from "@/app/actions/qr"
import { toast } from "sonner"

/**
 * Из содержимого QR/штрихкода извлекает значение для строки поиска (SKU).
 * Формат QR на этикетке: "{ID магазина}/{SKU}", например "1/RY00042" —
 * цифры до "/" это seq_id магазина, после — артикул.
 */
export function extractSearchValue(raw: string): string {
  return parseQrCode(raw).sku
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

  const handleScan = (raw: string) => {
    const parsed = parseQrCode(raw)
    if (!parsed.sku) return

    // 1. Сразу запускаем поиск по артикулу — без ожидания проверки магазина.
    onChange(parsed.sku)

    // 2. Проверку магазина выполняем в фоне — не блокируем поиск.
    if (parsed.shopSeqId !== null) {
      checkQrShop(parsed.shopSeqId)
        .then((check) => {
          if (!check.ok && check.reason === "foreign_shop") {
            const own = check.ownShopName
              ? `${check.ownShopName}, ID ${check.ownSeqId}`
              : `ID ${check.ownSeqId}`
            toast.error(
              `Ошибка: QR-код принадлежит другому магазину (ID ${check.scannedSeqId}). Ваш магазин (${own})`,
              { duration: 6000 },
            )
          }
        })
        .catch((e) => {
          console.error("[product-search] checkQrShop error:", e)
        })
    }
  }
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
          onScan={handleScan}
        />
      )}
    </>
  )
}
