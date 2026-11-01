"use client"
// ---------------------------------------------------------------------------
// Панель «Формат данных» — появляется при выборе поля товара на этикетке.
// Позволяет перевести/заменить текст и добавить текст до/после значения.
// Изменения сохраняются вместе с шаблоном (кнопка «Сохранить шаблон»).
// ---------------------------------------------------------------------------
import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronUp } from "lucide-react"
import { PRICE_SOURCES, CURRENCIES, type PriceSource } from "../data/price"
import type { Canvas as FabricCanvas, Textbox } from "fabric"
import { refitTextbox } from "../canvas/text-fit"
import {
  isFormattable, getTbData, reapplyLiveFormat, type LiveFormat,
} from "../data/live-format"

const ROLE_NAMES: Record<string, string> = {
  metal: "Металл", weight: "Вес", size: "Размер",
  "price-label": "Подпись цены", price: "Цена",
}

export function LiveFormatPanel({
  fabricRef, ready, canSeePurchasePrice = false,
}: {
  fabricRef: React.RefObject<FabricCanvas | null>
  ready: boolean
  canSeePurchasePrice?: boolean
}) {
  const [tb, setTb]       = useState<Textbox | null>(null)
  const [open, setOpen]   = useState(false)
  const [fmt, setFmt]     = useState<LiveFormat>({})
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  // Окно позиционируется по экрану и никогда не выходит за его края.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      const vw = window.innerWidth
      const width = Math.min(vw - 16, 420)
      const left = Math.max(8, Math.min(r.right - width, vw - width - 8))
      setPos({ top: r.bottom + 4, left, width })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return
    const sync = () => {
      const obj = canvas.getActiveObject()
      if (obj && obj.type === "textbox" && isFormattable(obj)) {
        const t = obj as Textbox
        setTb(t)
        setFmt({ ...(getTbData(t).format ?? {}) })
      } else {
        setTb(null)
      }
    }
    canvas.on("selection:created", sync)
    canvas.on("selection:updated", sync)
    canvas.on("selection:cleared", sync)
    return () => {
      canvas.off("selection:created", sync)
      canvas.off("selection:updated", sync)
      canvas.off("selection:cleared", sync)
    }
  }, [fabricRef, ready])

  const triggerCls = "inline-flex h-8 w-full min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10px] font-medium transition-colors"
  // Кнопка всегда на месте в верхней строке — ничего не прыгает при выборе.
  if (!tb) return (
    <div className="relative min-w-0">
      <button type="button" disabled title="Выберите поле на этикетке" className={triggerCls + " cursor-default opacity-60"}>
        <span className="shrink-0 text-muted-foreground">Данные:</span>
        <span className="min-w-0 truncate">—</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>
    </div>
  )
  const role = getTbData(tb).role ?? ""
  const raw  = String(getTbData(tb).raw ?? tb.text ?? "")

  const isPerGram = !!PRICE_SOURCES.find((s) => s.key === (fmt.priceSource ?? "sale_price"))?.perGram
  const currency = CURRENCIES.find((c) => c.code === (fmt.currency ?? "SOM"))
  const isForeign = !!fmt.currency && fmt.currency !== "SOM"
  const update = (patch: Partial<LiveFormat>) => {
    const next = { ...fmt, ...patch }
    setFmt(next)
    getTbData(tb).format = next
    reapplyLiveFormat(tb)
    refitTextbox(tb)
    tb.setCoords()
    fabricRef.current?.fire("object:modified", { target: tb } as never)
    fabricRef.current?.requestRenderAll()
  }

  const labelText = String(tb.text ?? "")
  const currentCode = fmt.currency ?? "SOM"
  const rateValid = typeof fmt.somPerUsd === "number" && Number.isFinite(fmt.somPerUsd) && fmt.somPerUsd > 0

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`Формат данных: ${ROLE_NAMES[role] ?? role}`}
        className={triggerCls + " hover:bg-muted"}
      >
        <span className="shrink-0 text-muted-foreground">{ROLE_NAMES[role] ?? "Данные"}:</span>
        <span className="min-w-0 flex-1 truncate text-left font-mono text-primary sm:max-w-[200px]">{labelText || raw}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 10050 }} className="grid max-h-[60vh] grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto rounded-lg border border-border bg-background/95 p-2 text-xs shadow-xl backdrop-blur-md sm:grid-cols-3">
          {role === "price" && (
            <>
              <Field label="Какую цену показывать" wide>
                <select
                  value={fmt.priceSource ?? "sale_price"}
                  onChange={(e) => update({ priceSource: e.target.value as PriceSource })}
                  className={inputCls + " w-full"}
                >
                  {PRICE_SOURCES.filter((source) => canSeePurchasePrice || !source.purchase || source.key === fmt.priceSource).map((source) => (
                    <option key={source.key} value={source.key}>{source.label}</option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2 grid min-w-0 gap-1 sm:col-span-3">
                <button
                  type="button"
                  aria-expanded={currencyOpen}
                  onClick={() => setCurrencyOpen((o) => !o)}
                  className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1 text-left hover:border-primary"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-[11px] font-medium text-muted-foreground">Валюта: </span>
                    <span className="font-medium">{currency?.label ?? currentCode}{currency?.symbol ? ` ${currency.symbol}` : ""}</span>
                  </span>
                  <span aria-hidden="true" className={"shrink-0 text-muted-foreground transition-transform " + (currencyOpen ? "rotate-180" : "")}>⌄</span>
                </button>
                {currencyOpen && (
                  <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                    {CURRENCIES.map((c) => {
                      const active = currentCode === c.code
                      return (
                        <button key={c.code} type="button" title={c.label}
                          onClick={() => {
                            update({ currency: c.code, ...(c.code !== currentCode ? { somPerUsd: undefined } : {}) })
                            setCurrencyOpen(false)
                          }}
                          className={"truncate rounded border px-1 py-0.5 text-[10px] font-medium transition-colors " + (active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary hover:text-primary")}
                        >
                          {c.label}{c.symbol ? ` ${c.symbol}` : ""}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {isForeign && (
                <Field label={`Курс: сом за 1 ${currency?.symbol || currency?.label}`}>
                  <input type="number" min="0.000001" step="any" inputMode="decimal"
                    value={fmt.somPerUsd ?? ""}
                    placeholder="0"
                    onChange={(e) => update({ somPerUsd: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className={inputCls + " w-full"}
                  />
                </Field>
              )}
              {isForeign && !rateValid && (
                <p role="alert" className="col-span-2 self-end text-destructive sm:col-span-2">Укажите положительный курс</p>
              )}
              {isPerGram && (
                <>
                  <Field label="Знак вместо «/»">
                    <input value={fmt.perGramSeparator ?? "/"} placeholder="пусто"
                      onChange={(e) => update({ perGramSeparator: e.target.value })}
                      className={inputCls + " w-full text-center"} />
                  </Field>
                  <Field label="Единица вместо «г»">
                    <input value={fmt.perGramUnit ?? "г"} placeholder="пусто"
                      onChange={(e) => update({ perGramUnit: e.target.value })}
                      className={inputCls + " w-full text-center"} />
                  </Field>
                  <div className="flex items-end gap-1">
                    {[["/", "г"], ["за", "гр"], ["/", "g"]].map(([sep, unit]) => (
                      <button key={sep + unit} type="button"
                        onClick={() => update({ perGramSeparator: sep, perGramUnit: unit })}
                        className="rounded-full border bg-background px-2 py-0.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        {sep} {unit}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {role !== "price" && (
            <Field label="Замена (каждая строка: было = стало)" wide>
              <textarea rows={2} value={fmt.replace ?? ""}
                placeholder={"золото 585 = Gold 14k\nВес: = Weight:"}
                onChange={(e) => update({ replace: e.target.value })}
                className={inputCls + " w-full"} />
            </Field>
          )}
          <Field label="Текст перед">
            <input value={fmt.prefix ?? ""} onChange={(e) => update({ prefix: e.target.value })}
              className={inputCls + " w-full"} />
          </Field>
          <Field label="Текст после">
            <input value={fmt.suffix ?? ""} placeholder=" сом" onChange={(e) => update({ suffix: e.target.value })}
              className={inputCls + " w-full"} />
          </Field>
        </div>,
        document.body,
      )}
    </div>
  )
}

const inputCls = "rounded-md border bg-background px-2 py-1 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={"grid min-w-0 gap-1" + (wide ? " col-span-2 sm:col-span-3" : "")}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
