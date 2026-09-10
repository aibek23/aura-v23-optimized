"use client"
// ---------------------------------------------------------------------------
// LabelEditorToolbar — ИСПРАВЛЕННАЯ ВЕРСИЯ:
//   • Header: убраны дублирующие кнопки Рука/ZoomIn/ZoomOut (они есть в ZoomCorner)
//             Добавлены кнопки загрузки SVG-рамки и сохранения в файл
//   • Bottom: добавлены кнопки масштаба элементов (+/-)
//   • Rotate: кнопка 90° работает через handleRotateCanvas в label-editor.tsx
// ---------------------------------------------------------------------------
import React, { memo, useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Printer, Save, RefreshCw, Trash2, Type, Square,
  ChevronDown, ChevronUp, RotateCw, Maximize2,
  ZoomIn, ZoomOut, Upload, Download,
} from "lucide-react"
import { Button }    from "@/components/ui/button"
import { Switch }    from "@/components/ui/switch"
import { Slider }    from "@/components/ui/slider"
import { Label }     from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { LABEL_SIZES } from "@/lib/niimbot"
import type { JewelryLabelSizeKey, LabelSizeDef } from "@/lib/niimbot"
import {
  FONTS, BORDER_STYLES, FIT_RATIO_MIN, FIT_RATIO_MAX,
} from "../constants"
import type { BorderStyleKey } from "../constants"

// ── Пропсы ────────────────────────────────────────────────────────────────────
export interface LabelEditorToolbarProps {
  zone:         "header" | "bottom"
  sizeKey:      JewelryLabelSizeKey
  sizeDef:      LabelSizeDef
  font:         string
  fontSize:     number
  isPrinting:   boolean
  status:       string
  autoFit:      boolean
  fitRatio:     number
  zoom:         number
  isPanMode:    boolean
  collapsed?:   boolean
  onSizeChange:       (key: JewelryLabelSizeKey) => void
  onAddText:          () => void
  onAddBorder:        (style: BorderStyleKey) => void
  onRemoveSelected:   () => void
  onSaveTemplate:     () => void
  onResetTemplate:    () => void
  onFontChange:       (font: string) => void
  onFontSizeChange:   (size: number) => void
  onAutoFitChange:    (on: boolean) => void
  onFitRatioChange:   (ratio: number) => void
  onZoomTo:           (z: number) => void
  onZoomReset:        () => void
  onTogglePanMode:    () => void
  onRotateCanvas:     () => void
  onPrint:            () => void
  onToggleCollapse?:  () => void
  // Масштаб элементов
  onScaleUp?:         () => void
  onScaleDown?:       () => void
  // SVG рамка
  onLoadSvgFrame?:    (svgText: string, filename: string) => void
  onSaveToFile?:      () => void
}

// ── Диспетчер зон ─────────────────────────────────────────────────────────────
export const LabelEditorToolbar = memo(function LabelEditorToolbar(
  props: LabelEditorToolbarProps,
) {
  return props.zone === "header"
    ? <HeaderZone {...props} />
    : <BottomZone {...props} />
})

// ── Header Zone ───────────────────────────────────────────────────────────────
// Кнопка поворота удалена. Кнопка SVG-рамки перенесена в BottomZone.
// Остались: выбор формата, Сохранить, Сброс, Экспорт в файл.
function HeaderZone({
  sizeKey,
  onSizeChange, onSaveTemplate, onResetTemplate, onSaveToFile,
}: LabelEditorToolbarProps) {
  const [expanded, setExpanded] = useState(false)
  const allKeys = Object.keys(LABEL_SIZES) as (keyof typeof LABEL_SIZES)[]

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 pt-0.5">
      <div className="flex flex-wrap items-center gap-2">

        {/* Гармошка форматов */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-medium hover:bg-muted transition-colors"
          title={expanded ? "Скрыть форматы" : "Выбрать формат"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span>Формат: <span className="text-primary font-mono">{LABEL_SIZES[sizeKey]?.label ?? sizeKey}</span></span>
        </button>

        {/* Сохранить */}
        <button
          type="button"
          onClick={onSaveTemplate}
          className="shrink-0 flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted transition-colors"
          title="Сохранить расположение"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Сохранить</span>
        </button>

        {/* Сброс */}
        <button
          type="button"
          onClick={onResetTemplate}
          className="shrink-0 flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
          title="Сбросить шаблон"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Сброс</span>
        </button>

        {/* Экспорт в файл */}
        {onSaveToFile && (
          <button
            type="button"
            onClick={onSaveToFile}
            className="shrink-0 flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            title="Сохранить работу в файл (.json)"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Экспорт</span>
          </button>
        )}
      </div>

      {/* Выпадающий список форматов */}
      {expanded && (
        <div
          className="overflow-x-auto rounded-md border border-border bg-background/95 shadow-md p-1.5"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="flex gap-1.5 whitespace-nowrap">
            {allKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => { onSizeChange(key); setExpanded(false) }}
                className={[
                  "rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors shrink-0",
                  key === sizeKey
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted",
                ].join(" ")}
              >
                {LABEL_SIZES[key].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Bottom Zone ───────────────────────────────────────────────────────────────
function BottomZone({
  sizeDef, font, fontSize, isPrinting, status,
  autoFit, fitRatio,
  onAddText, onAddBorder, onRemoveSelected, onRotateCanvas,
  onFontChange, onFontSizeChange,
  onAutoFitChange, onFitRatioChange,
  onScaleUp, onScaleDown,
  onLoadSvgFrame,
  onPrint, collapsed = false, onToggleCollapse,
}: LabelEditorToolbarProps) {
  const [borderMenuOpen, setBorderMenuOpen] = useState(false)
  const borderBtnRef = useRef<HTMLDivElement>(null)
  const [borderMenuPos, setBorderMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const svgInputRef = useRef<HTMLInputElement>(null)

  const handleSvgFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === "string") onLoadSvgFrame?.(text, file.name)
    }
    reader.readAsText(file)
    e.target.value = ""
  }, [onLoadSvgFrame])

  const updateBorderMenuPos = useCallback(() => {
    const el = borderBtnRef.current
    if (!el) return
    const r        = el.getBoundingClientRect()
    const menuWidth = 170
    const left      = Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8))
    setBorderMenuPos({ left, bottom: Math.max(8, window.innerHeight - r.top + 6) })
  }, [])

  const toggleBorderMenu = useCallback(() => {
    setBorderMenuOpen((v) => {
      if (!v) updateBorderMenuPos()
      return !v
    })
  }, [updateBorderMenuPos])

  useEffect(() => {
    if (!borderMenuOpen) return
    const onDocDown = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("[data-border-menu]") || t?.closest("[data-border-menu-btn]")) return
      setBorderMenuOpen(false)
    }
    const onKey    = (e: KeyboardEvent) => { if (e.key === "Escape") setBorderMenuOpen(false) }
    const onReflow = () => updateBorderMenuPos()
    document.addEventListener("pointerdown", onDocDown, true)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onReflow)
    window.addEventListener("scroll", onReflow, true)
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onReflow)
      window.removeEventListener("scroll", onReflow, true)
    }
  }, [borderMenuOpen, updateBorderMenuPos])

  // ── Свёрнутый режим ──────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="pointer-events-auto px-3 pb-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div
          role="button" tabIndex={0}
          onClick={onToggleCollapse}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggleCollapse?.() }}
          className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/80 px-3 py-2 shadow-lg backdrop-blur-md hover:bg-background/90 cursor-pointer"
        >
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-[12px] font-medium text-muted-foreground">
            {status || `Настройки · ${sizeDef.label}`}
          </span>
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); onPrint() }}
            disabled={isPrinting}
            className="h-8 gap-1.5 rounded-xl px-3 text-[12px] font-semibold"
          >
            <Printer className="h-4 w-4" />
            {isPrinting ? "Печать…" : "Распечатать"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-auto shrink-0 border-t bg-background/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", zIndex: 9990, position: "relative" }}
    >
      {/* hidden SVG file input (перенесён из HeaderZone) */}
      {onLoadSvgFrame && (
        <input
          ref={svgInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={handleSvgFileChange}
        />
      )}

      {/* ── Строка 1: Основные инструменты (адаптивный flex-wrap, без scroll) ── */}
      <div className="flex flex-wrap items-start gap-1.5 px-3 pt-2 pb-1">

        <ToolBtn onClick={onAddText} title="Добавить текст">
          <Type className="h-4 w-4" /><span className="text-[11px]">Текст</span>
        </ToolBtn>

        <div className="relative shrink-0" ref={borderBtnRef} data-border-menu-btn>
          <ToolBtn onClick={toggleBorderMenu} title="Добавить рамку">
            <Square className="h-4 w-4" />
            <span className="text-[11px]">Рамка {borderMenuOpen ? "▴" : "▾"}</span>
          </ToolBtn>
        </div>

        {borderMenuOpen && borderMenuPos && typeof document !== "undefined" &&
          createPortal(
            <div
              data-border-menu
              className="fixed min-w-[170px] max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-background shadow-xl py-1"
              style={{ left: borderMenuPos.left, bottom: borderMenuPos.bottom, zIndex: 10000 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {BORDER_STYLES.map((bs) => (
                <button
                  key={bs.key}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted transition-colors"
                  onClick={() => { onAddBorder(bs.key); setBorderMenuOpen(false) }}
                >
                  <BorderPreview style={bs} />
                  {bs.label}
                </button>
              ))}
            </div>,
            document.body,
          )}

        {/* SVG-рамка (перенесена из header) */}
        {onLoadSvgFrame && (
          <ToolBtn onClick={() => svgInputRef.current?.click()} title="Загрузить SVG-рамку из файла">
            <Upload className="h-4 w-4" /><span className="text-[11px]">SVG-рамка</span>
          </ToolBtn>
        )}

        <ToolBtn onClick={onRotateCanvas} title="Повернуть холст на 90°">
          <RotateCw className="h-4 w-4" /><span className="text-[11px]">Повернуть</span>
        </ToolBtn>

        <ToolBtn onClick={onRemoveSelected} title="Удалить выделенное" destructive>
          <Trash2 className="h-4 w-4" /><span className="text-[11px]">Удалить</span>
        </ToolBtn>

        {/* Масштаб элементов (+/-) */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Масштаб эл.</span>
          <div className="flex h-7 items-center gap-1">
            <button
              type="button"
              onClick={onScaleDown}
              disabled={!onScaleDown}
              className="flex items-center justify-center h-7 w-7 rounded border border-border bg-background hover:bg-muted transition-colors disabled:opacity-40"
              title="Уменьшить выделенный элемент"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onScaleUp}
              disabled={!onScaleUp}
              className="flex items-center justify-center h-7 w-7 rounded border border-border bg-background hover:bg-muted transition-colors disabled:opacity-40"
              title="Увеличить выделенный элемент"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Шрифт */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Шрифт</span>
          <Select value={font} onValueChange={onFontChange}>
            <SelectTrigger className="h-7 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FONTS.map((f) => (
                <SelectItem key={f} value={f} style={{ fontFamily: f }} className="text-[11px]">{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Размер шрифта */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Размер</span>
          <input
            type="number" min={8} max={64} disabled={autoFit}
            title={autoFit ? "Размер задаётся автоматически" : "Размер шрифта"}
            className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-[11px] disabled:opacity-40"
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value) || 16)}
          />
        </div>

        {/* Авторазмер */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Авторазмер</span>
          <div className="flex h-7 items-center gap-1.5">
            <Switch id="autofit-sw" checked={autoFit} onCheckedChange={onAutoFitChange} />
            <Label htmlFor="autofit-sw" className="text-[11px] cursor-pointer select-none">
              {autoFit ? "Вкл" : "Выкл"}
            </Label>
          </div>
        </div>

        {/* Слайдер масштаба текста */}
        {autoFit && (
          <div className="flex flex-col gap-0.5 shrink-0">
            <span className="text-[9px] text-muted-foreground leading-none px-0.5">
              Масштаб · {Math.round(fitRatio * 100)}%
            </span>
            <div className="flex h-7 items-center gap-1.5">
              <Slider
                min={FIT_RATIO_MIN}
                max={FIT_RATIO_MAX}
                step={0.02}
                value={[fitRatio]}
                onValueChange={([v]) => onFitRatioChange(v ?? fitRatio)}
                className="w-[80px]"
              />
              <button
                type="button"
                onClick={() => onFitRatioChange(1)}
                className="rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-muted"
                title="100%"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Строка 2: Легенда ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1 text-[9px] text-muted-foreground">
        <span className="font-medium text-foreground/60">Линии:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-blue-500" />печать
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-red-500" />обрез
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-gray-400" />перфорация
        </span>
      </div>

      {/* ── Строка 3: Кнопка печати ── */}
      <div className="px-3 pb-2 pt-1">
        {status && (
          <p className="mb-1 animate-pulse text-xs font-medium text-blue-600">{status}</p>
        )}
        <Button
          onClick={onPrint}
          disabled={isPrinting}
          className="w-full gap-2 h-10 text-sm font-semibold"
        >
          <Printer className="h-4 w-4" />
          {isPrinting ? "Печать…" : `Печать · ${sizeDef.label}`}
        </Button>
      </div>

      {/* ── Строка 4: Свернуть ── */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 py-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <ChevronDown className="h-4 w-4" />
          Свернуть
        </button>
      )}
    </div>
  )
}

// ── BorderPreview ─────────────────────────────────────────────────────────────
function BorderPreview({ style }: { style: typeof BORDER_STYLES[number] }) {
  const dash = style.strokeDashArray
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" className="shrink-0">
      {style.key === "double" ? (
        <>
          <rect x="1" y="1" width="26" height="14" rx={style.rx}
            stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="3" y="3" width="22" height="10" rx={Math.max(0, style.rx - 2)}
            stroke="currentColor" strokeWidth="1" fill="none" />
        </>
      ) : (
        <rect x="1" y="1" width="26" height="14" rx={style.rx}
          stroke="currentColor"
          strokeWidth={Math.min(style.strokeWidth, 2)}
          strokeDasharray={dash ? dash.join(" ") : undefined}
          fill="none"
        />
      )}
    </svg>
  )
}

// ── ToolBtn ───────────────────────────────────────────────────────────────────
function ToolBtn({
  children, onClick, title, destructive = false,
}: {
  children:     React.ReactNode
  onClick:      () => void
  title?:       string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
        destructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border bg-background hover:bg-muted",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
