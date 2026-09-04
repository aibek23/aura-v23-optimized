"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { X, Printer, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { LABEL_SIZES, DEFAULT_SIZE_KEY, printCanvas } from "@/lib/niimbot"
import type { LabelSizeDef } from "@/lib/niimbot"
import type { JewelryLabelSizeKey } from "@/lib/niimbot"

type Props = {
  open: boolean
  onClose: () => void
  article: string
  name: string
  weight: string
  price: string
  purity?: string
}

const SIZE_KEYS = Object.keys(LABEL_SIZES) as JewelryLabelSizeKey[]

export function LabelPrintModal({ open, onClose, article, name, weight, price, purity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sizeKey, setSizeKey] = useState<JewelryLabelSizeKey>(DEFAULT_SIZE_KEY)
  const [copies, setCopies] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const sizeDef: LabelSizeDef = LABEL_SIZES[sizeKey]

  // Закрытие по Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  // Рисуем превью этикетки на canvas
  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w_px, h_px } = sizeDef
    canvas.width = w_px
    canvas.height = h_px
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w_px, h_px)

    ctx.fillStyle = "#000000"
    ctx.font = `bold ${Math.round(h_px * 0.07)}px monospace`
    ctx.textAlign = "center"
    ctx.fillText(article, w_px / 2, h_px * 0.2)

    ctx.font = `${Math.round(h_px * 0.055)}px sans-serif`
    ctx.fillText(name.length > 18 ? name.slice(0, 18) + "…" : name, w_px / 2, h_px * 0.35)

    ctx.font = `${Math.round(h_px * 0.05)}px sans-serif`
    ctx.fillText(`${weight}  ${purity ?? ""}`, w_px / 2, h_px * 0.5)
    ctx.fillText(price, w_px / 2, h_px * 0.65)
  }, [sizeDef, article, name, weight, price, purity])

  useEffect(() => { if (open) drawPreview() }, [open, drawPreview])

  async function handlePrint() {
    const canvas = canvasRef.current
    if (!canvas || isPrinting) return
    setIsPrinting(true)
    setStatus("Подключение к Niimbot B1…")
    try {
      await printCanvas(canvas, sizeDef, {
        copies,
        onProgress: (s) => setStatus(s),
      })
      setStatus("Печать завершена ✓")
    } catch (err) {
      setStatus(`Ошибка: ${(err as Error).message}`)
    } finally {
      setIsPrinting(false)
    }
  }

  if (!open) return null

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-xl">

        {/* Заголовок + единственная кнопка закрытия */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Печать бирки</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Превью */}
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="rounded border border-border bg-white"
            style={{ maxWidth: "100%", height: "auto", maxHeight: 200 }}
          />
        </div>

        {/* Размер бирки */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Размер бирки</label>
          <div className="flex gap-2 flex-wrap">
            {SIZE_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setSizeKey(k)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  k === sizeKey
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {LABEL_SIZES[k].label}
              </button>
            ))}
          </div>
        </div>

        {/* Количество копий */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-muted-foreground">Копий</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCopies((c) => Math.max(1, c - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-sm hover:bg-muted"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-medium">{copies}</span>
            <button
              onClick={() => setCopies((c) => Math.min(10, c + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-sm hover:bg-muted"
            >
              +
            </button>
          </div>
          <button
            onClick={drawPreview}
            title="Обновить превью"
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" />
            Превью
          </button>
        </div>

        {/* Статус */}
        {status && (
          <p className={cn(
            "rounded-lg px-3 py-2 text-xs",
            status.startsWith("Ошибка")
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}>
            {status}
          </p>
        )}

        {/* Кнопка печати */}
        <button
          onClick={handlePrint}
          disabled={isPrinting}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPrinting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Печать…</>
            : <><Printer className="h-4 w-4" /> Напечатать</>
          }
        </button>

      </div>
    </div>
  )
}
