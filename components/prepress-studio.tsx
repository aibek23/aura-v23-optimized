"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Bluetooth, CheckCircle2, Info, Printer, ScanLine } from "lucide-react"
import type { Product } from "@/lib/types"
import {
  getLabelSizeDef,
  getPrinterProfile,
  identifyPrinter,
  PRINTER_PROFILES,
  type JewelryLabelSizeKey,
  type PrinterProfile,
} from "@/lib/niimbot"
import { LabelEditor } from "@/components/screens/sklad/label/label-editor"

const DEMO_PRODUCT = {
  id: "prepress-demo",
  shop_id: "prepress-demo",
  shop_seq_id: 1,
  created_by: "prepress-demo",
  name: "Кольцо Aura",
  category: "Кольца",
  metal: "Золото 585",
  metal_color: "Жёлтый",
  weight: 2.4,
  size: "17",
  sku: "DEMO0000",
  article_seq: 1,
  is_hidden: false,
  purchase_price: 0,
  purchase_price_visible: 0,
  price_per_gram_purchase_visible: 0,
  price_per_gram_sale: 0,
  price_per_gram_purchase: 0,
  stones: null,
  description: "Демонстрационный макет",
  sale_price: 24500,
  image_url: null,
  images: [],
  supplier_name: null,
  supplier_phone: null,
  status: "in_stock",
  created_at: "2026-01-01T00:00:00.000Z",
} as Product

function bluetoothAvailable() {
  return typeof navigator !== "undefined" && "bluetooth" in navigator
}

export function PrepressStudio() {
  const [modelKey, setModelKey] = useState("b1")
  const [detectedProfile, setDetectedProfile] = useState<PrinterProfile | null>(null)
  const [printerStatus, setPrinterStatus] = useState("")
  const [isIdentifying, setIsIdentifying] = useState(false)
  const [copies, setCopies] = useState(1)
  const [density, setDensity] = useState(3)
  const [sizeKey, setSizeKey] = useState<JewelryLabelSizeKey>("T25x30_45")
  const [identifyError, setIdentifyError] = useState("")

  const selectedProfile = useMemo(
    () => detectedProfile?.key === modelKey ? detectedProfile : getPrinterProfile(modelKey),
    [detectedProfile, modelKey],
  )
  const sizeDef = getLabelSizeDef(sizeKey)
  const outputWidth = Math.round(sizeDef.w_px * selectedProfile.dpi / 203)
  const fitsPrinthead = outputWidth <= selectedProfile.printheadPx
  const fitPercent = Math.min(100, Math.round(selectedProfile.printheadPx / outputWidth * 100))

  async function handleIdentify() {
    setIsIdentifying(true)
    setIdentifyError("")
    setPrinterStatus("")
    try {
      const result = await identifyPrinter(selectedProfile.key)
      setDetectedProfile(result.profile)
      setModelKey(result.profile.key)
      setDensity(result.profile.density)
      setSizeKey(result.profile.defaultLabelKey)
      setPrinterStatus(`${result.profile.displayName} · ID ${result.printer.modelId} · ${result.printer.dpi ?? result.profile.dpi} dpi`)
    } catch (error) {
      setIdentifyError((error as Error)?.message || "Не удалось определить принтер.")
    } finally {
      setIsIdentifying(false)
    }
  }

  function handleModelChange(key: string) {
    const profile = getPrinterProfile(key)
    setModelKey(profile.key)
    setDetectedProfile(null)
    setPrinterStatus("")
    setIdentifyError("")
    setDensity(profile.density)
    setSizeKey(profile.defaultLabelKey)
  }

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background text-foreground lg:h-dvh lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="z-30 flex max-h-[38dvh] flex-col gap-4 overflow-y-auto border-b border-border bg-card p-4 lg:max-h-none lg:border-b-0 lg:border-r lg:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Printer className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">Niimbot Label Studio</p>
            <p className="text-xs text-muted-foreground">Подготовка и печать этикеток</p>
          </div>
        </div>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bluetooth className="h-4 w-4 text-primary" aria-hidden="true" />
            Принтер
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Модель</span>
            <select
              value={modelKey}
              onChange={(event) => handleModelChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {PRINTER_PROFILES.map((profile) => (
                <option key={profile.key} value={profile.key}>{profile.displayName}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleIdentify}
            disabled={isIdentifying || !bluetoothAvailable() || selectedProfile.supportsDirectBluetooth === false}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ScanLine className={`h-4 w-4 ${isIdentifying ? "animate-pulse" : ""}`} aria-hidden="true" />
            {isIdentifying ? "Определяем…" : "Определить по Bluetooth"}
          </button>
          {!bluetoothAvailable() && (
            <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">
              Для Bluetooth используйте Chrome или Edge на устройстве с Bluetooth.
            </p>
          )}
          {printerStatus && (
            <p className="flex items-start gap-2 text-xs leading-5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {printerStatus}
            </p>
          )}
          {identifyError && (
            <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {identifyError}
            </p>
          )}
          {selectedProfile.supportsDirectBluetooth === false ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              В этой версии BLE-драйвер не поддерживает B3S. Редактирование и экспорт PNG доступны; отправьте файл на печать через приложение Niimbot.
            </p>
          ) : !selectedProfile.driverDocumented && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Модель не указана в таблице драйвера; профиль экспериментальный. Перед тиражом подтвердите соединение и отпечаток на этом принтере.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ScanLine className="h-4 w-4 text-primary" aria-hidden="true" />
            Параметры печати
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Копии</span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={copies}
                onChange={(event) => setCopies(Math.min(99, Math.max(1, Number(event.target.value) || 1)))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Нагрев · 1–5</span>
              <select
                value={density}
                onChange={(event) => setDensity(Number(event.target.value))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-background/70 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            Предпечатная проверка
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Разрешение принтера</dt>
            <dd className="font-medium tabular-nums">{selectedProfile.dpi} dpi</dd>
            <dt className="text-muted-foreground">Формат</dt>
            <dd className="font-medium">{sizeDef.label}</dd>
            <dt className="text-muted-foreground">Ширина вывода</dt>
            <dd className="font-medium tabular-nums">{outputWidth} / {selectedProfile.printheadPx} px</dd>
            <dt className="text-muted-foreground">Копии · нагрев</dt>
            <dd className="font-medium tabular-nums">{copies} · {density}/5</dd>
          </dl>
          {selectedProfile.supportsDirectBluetooth === false ? (
            <p className="flex items-start gap-2 rounded-lg bg-sky-500/10 p-2 text-xs leading-5 text-sky-700 dark:text-sky-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Экспорт PNG: {outputWidth} × {Math.round(sizeDef.h_px * selectedProfile.dpi / 203)} px при {selectedProfile.dpi} dpi. В приложении Niimbot выберите соответствующий материал и не масштабируйте изображение.
            </p>
          ) : fitsPrinthead ? (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs leading-5 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Ширина помещается в печатающую головку. Макет будет подготовлен в нативном разрешении {selectedProfile.dpi} dpi.
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-xs leading-5 text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Макет шире головки. Печать заблокирована, чтобы не обрезать содержимое. Выберите узкий формат (помещается примерно на {fitPercent}%).
            </p>
          )}
        </section>

        <p className="px-1 text-[11px] leading-4 text-muted-foreground">
          Демо-QR содержит 1/DEMO0000. Для этикеток реальных товаров используйте склад. Профили сверены с таблицей драйвера, но физическая печать в этой среде не проверялась. Перед тиражом распечатайте одну этикетку.
        </p>
      </aside>

      <section className="h-[72dvh] min-h-[520px] min-w-0 overflow-hidden lg:h-full">
        <LabelEditor
          key={selectedProfile.key}
          product={DEMO_PRODUCT}
          printerProfile={selectedProfile}
          copies={copies}
          density={density}
          initialSizeKey={selectedProfile.defaultLabelKey}
          onSizeChange={setSizeKey}
        />
      </section>
    </main>
  )
}