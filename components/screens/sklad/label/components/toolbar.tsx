"use client"
// ---------------------------------------------------------------------------
// LabelEditorToolbar — ИСПРАВЛЕННАЯ ВЕРСИЯ:
//   • Header: формат и действия с шаблоном собраны в компактном меню
//   • Bottom: основные инструменты, масштаб холста, масштаб объектов и печать
//   • Настройки текста и списка форматов раскрываются по запросу
// ---------------------------------------------------------------------------
import React, { memo, useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Printer, Save, RefreshCw, Trash2, Type, Square,
  ChevronDown, ChevronUp, RotateCw, Maximize2,
  ZoomIn, ZoomOut, Upload, Download,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, SlidersHorizontal,
} from "lucide-react"
import { Button }    from "@/components/ui/button"
import { Switch }    from "@/components/ui/switch"
import { Slider }    from "@/components/ui/slider"
import { Label }     from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { LABEL_SIZES, LABEL_SIZE_SELECT_KEYS } from "@/lib/niimbot"
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
  canPrint?:    boolean
  backgroundCalibration?: { offsetXmm: number; offsetYmm: number; widthPercent: number; heightPercent: number }
  backgroundCalibrationOpen?: boolean
  onToggleBackgroundCalibration?: () => void
  onUpdateBackgroundCalibration?: (key: "offsetXmm" | "offsetYmm" | "widthPercent" | "heightPercent", value: number) => void
  onResetBackgroundCalibration?: () => void
  canExportPng?: boolean
  exportPngTitle?: string
  status:       string
  autoFit:      boolean
  fitRatio:     number
  zoom:         number
  isPanMode:    boolean
  onSizeChange:       (key: JewelryLabelSizeKey) => void
  onAddText:          () => void
  onAddBorder:        (style: BorderStyleKey) => void
  onRemoveSelected:   () => void
  onSaveTemplate:     () => void
  onReloadTemplate:   () => void
  onFontChange:       (font: string) => void
  onFontSizeChange:   (size: number) => void
  onAutoFitChange:    (on: boolean) => void
  onFitRatioChange:   (ratio: number) => void
  onZoomTo:           (z: number) => void
  onZoomReset:        () => void
  onTogglePanMode:    () => void
  onRotateCanvas:     () => void
  onPrint:            () => void
  // Масштаб элементов
  onScaleUp?:         () => void
  onScaleDown?:       () => void
  // SVG рамка
  onLoadSvgFrame?:    (svgText: string, filename: string) => void
  onSaveToFile?:      () => void
  onExportPng?:       () => void
  // Форматирование текста
  isBold?:             boolean
  isItalic?:           boolean
  isUnderline?:        boolean
  isLinethrough?:      boolean
  textAlign?:          "left" | "center" | "right"
  charSpacing?:        number
  lineHeight?:         number
  onToggleBold?:       () => void
  onToggleItalic?:     () => void
  onToggleUnderline?:  () => void
  onToggleLinethrough?:() => void
  onTextAlignChange?:  (align: "left" | "center" | "right") => void
  onCharSpacingChange?:(spacing: number) => void
  onLineHeightChange?: (lh: number) => void
}

// ── Диспетчер зон ─────────────────────────────────────────────────────────────
export const LabelEditorToolbar = memo(function LabelEditorToolbar(
  props: LabelEditorToolbarProps,
) {
  return props.zone === "header"
    ? <HeaderZone {...props} />
    : <BottomZone {...props} />
})

export function LabelBackgroundControls({
  backgroundCalibration, backgroundCalibrationOpen = false,
  onToggleBackgroundCalibration, onUpdateBackgroundCalibration, onResetBackgroundCalibration,
}: Pick<LabelEditorToolbarProps, "backgroundCalibration" | "backgroundCalibrationOpen" | "onToggleBackgroundCalibration" | "onUpdateBackgroundCalibration" | "onResetBackgroundCalibration">) {
  return (
    <>
          {onToggleBackgroundCalibration && (
            <div className="rounded-md border border-border bg-background p-2">
              <button
                type="button"
                onClick={onToggleBackgroundCalibration}
                aria-expanded={backgroundCalibrationOpen}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[11px] font-medium hover:bg-muted"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                <span className="flex-1 text-left">Фон</span>
                {backgroundCalibrationOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {backgroundCalibrationOpen && backgroundCalibration && onUpdateBackgroundCalibration && (
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
                  <label className="grid gap-1 text-[10px] text-muted-foreground">Смещение X, мм<input type="number" min={-20} max={20} step={0.1} value={backgroundCalibration.offsetXmm} onChange={(e) => onUpdateBackgroundCalibration("offsetXmm", Number(e.target.value))} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" /></label>
                  <label className="grid gap-1 text-[10px] text-muted-foreground">Смещение Y, мм<input type="number" min={-20} max={20} step={0.1} value={backgroundCalibration.offsetYmm} onChange={(e) => onUpdateBackgroundCalibration("offsetYmm", Number(e.target.value))} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" /></label>
                  <label className="grid gap-1 text-[10px] text-muted-foreground">Ширина, %<input type="number" min={50} max={150} step={0.1} value={backgroundCalibration.widthPercent} onChange={(e) => onUpdateBackgroundCalibration("widthPercent", Number(e.target.value))} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" /></label>
                  <label className="grid gap-1 text-[10px] text-muted-foreground">Высота, %<input type="number" min={50} max={150} step={0.1} value={backgroundCalibration.heightPercent} onChange={(e) => onUpdateBackgroundCalibration("heightPercent", Number(e.target.value))} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" /></label>
                  <div className="col-span-2 flex justify-end">
                    <button type="button" onClick={onResetBackgroundCalibration} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted">Сброс</button>
                  </div>
                </div>
              )}
            </div>
          )}
    </>
  )
}

function LabelFormatThumbnail({
  sizeKey,
  variant = "trigger",
}: {
  sizeKey: JewelryLabelSizeKey
  variant?: "trigger" | "option"
}) {
  const horizontal = sizeKey === "T25x30_horizontal" || sizeKey === "T30x25_horizontal"
  const body = sizeKey === "T25x30_45"
    ? { width: 25.12487, height: 30.02, tail: 44.925435 }
    : sizeKey === "T30x25_45"
      ? { width: 30, height: 25, tail: 45 }
      : sizeKey === "T30x25_50"
        ? { width: 30, height: 25, tail: 50 }
        : sizeKey === "T25x30_horizontal"
          ? { width: 30.02, height: 25.12487, tail: 44.925435 }
          : { width: 25, height: 30, tail: 45 }
  const tailInFirstHalf = sizeKey === "T30x25_45" || sizeKey === "T30x25_horizontal"
  const tailCenter = horizontal
    ? body.height * (tailInFirstHalf ? 0.25 : 0.5)
    : body.width * (tailInFirstHalf ? 0.25 : 0.5)
  const tailThickness = 3
  const totalWidth = body.width + (horizontal ? body.tail : 0)
  const totalHeight = body.height + (horizontal ? 0 : body.tail)
  const hasHorizontalSeam = sizeKey === "T25x30_45" || sizeKey === "T30x25_horizontal"
  const previewWidth = variant === "option" ? 46 : 38
  const previewHeight = variant === "option" ? 32 : 22
  const inset = 1.4

  return (
    <svg
      aria-hidden="true"
      width={previewWidth}
      height={previewHeight}
      viewBox={"0 0 " + totalWidth + " " + totalHeight}
      preserveAspectRatio="xMidYMid meet"
      className="block shrink-0 overflow-visible"
    >
      {horizontal ? (
        <rect
          x={body.width - 0.4}
          y={tailCenter - tailThickness / 2}
          width={body.tail + 0.4}
          height={tailThickness}
          rx={1.2}
          fill="var(--muted)"
          stroke="var(--foreground)"
          strokeOpacity={0.5}
          strokeWidth={0.5}
        />
      ) : (
        <rect
          x={tailCenter - tailThickness / 2}
          y={body.height - 0.4}
          width={tailThickness}
          height={body.tail + 0.4}
          rx={1.2}
          fill="var(--muted)"
          stroke="var(--foreground)"
          strokeOpacity={0.5}
          strokeWidth={0.5}
        />
      )}
      <rect
        x={0}
        y={0}
        width={body.width}
        height={body.height}
        rx={2.4}
        fill="var(--muted)"
        stroke="var(--foreground)"
        strokeOpacity={0.5}
        strokeWidth={0.6}
      />
      <rect
        x={inset}
        y={inset}
        width={body.width - inset * 2}
        height={body.height - inset * 2}
        rx={1.5}
        fill="none"
        stroke="var(--primary)"
        strokeOpacity={0.72}
        strokeWidth={0.45}
        strokeDasharray="2 1.5"
      />
      <rect
        x={inset + 1}
        y={inset + 1}
        width={body.width - (inset + 1) * 2}
        height={body.height - (inset + 1) * 2}
        rx={1.2}
        fill="none"
        stroke="var(--destructive)"
        strokeOpacity={0.72}
        strokeWidth={0.4}
        strokeDasharray="2 1.5"
      />
      {hasHorizontalSeam ? (
        <line
          x1={inset}
          y1={body.height / 2}
          x2={body.width - inset}
          y2={body.height / 2}
          stroke="var(--foreground)"
          strokeOpacity={0.38}
          strokeWidth={0.5}
          strokeDasharray="1.5 1.5"
        />
      ) : (
        <line
          x1={body.width / 2}
          y1={inset}
          x2={body.width / 2}
          y2={body.height - inset}
          stroke="var(--foreground)"
          strokeOpacity={0.38}
          strokeWidth={0.5}
          strokeDasharray="1.5 1.5"
        />
      )}
    </svg>
  )
}

// ── Header Zone ───────────────────────────────────────────────────────────────
// Кнопка поворота удалена. Кнопка SVG-рамки перенесена в BottomZone.
// Остались: выбор формата, Сохранить, Сброс, Экспорт в файл.
function HeaderZone({
  sizeKey,
  onSizeChange, onSaveTemplate, onReloadTemplate, onSaveToFile,
  backgroundCalibration, backgroundCalibrationOpen = false,
  onToggleBackgroundCalibration, onUpdateBackgroundCalibration, onResetBackgroundCalibration,
}: LabelEditorToolbarProps) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(380, window.innerWidth - 16)
      const maxHeight = Math.min(480, Math.floor(window.innerHeight * 0.72))
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - maxHeight - 8))
      setMenuPosition({ top, left, width, maxHeight })
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    document.addEventListener("pointerdown", handleOutsidePointerDown, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true)
    }
  }, [open])

  return (
    <div className="relative min-w-0 max-w-[74vw] shrink sm:max-w-none">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10px] font-medium hover:bg-muted transition-colors"
        title="Формат этикетки и действия с шаблоном"
      >
        <LabelFormatThumbnail sizeKey={sizeKey} />
        <span className="shrink-0 text-muted-foreground">Формат:</span>
        <span title={LABEL_SIZES[sizeKey]?.label ?? sizeKey} className="min-w-0 truncate font-mono text-primary">{LABEL_SIZES[sizeKey]?.label ?? sizeKey}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {open && menuPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed flex flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur-md"
          style={{ ...menuPosition, zIndex: 10050 }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onSaveTemplate}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted transition-colors"
              title="Сохранить расположение"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Сохранить</span>
            </button>
            <button
              type="button"
              onClick={onReloadTemplate}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
              title="Загрузить шаблон из базы данных"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Сброс</span>
            </button>
            {onSaveToFile && (
              <button
                type="button"
                onClick={onSaveToFile}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                title="Сохранить работу в файл (.json)"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Файл</span>
              </button>
            )}
          </div>
          <div className="rounded-md border border-border bg-background p-1.5">
            <div className="flex flex-col gap-1">
              {LABEL_SIZE_SELECT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={() => { onSizeChange(key); setOpen(false) }}
                  className={[
                    "flex min-h-9 w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-[11px] font-mono transition-colors",
                    key === sizeKey
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <LabelFormatThumbnail sizeKey={key} variant="option" />
                  <span className="min-w-0 truncate">{LABEL_SIZES[key].label}</span>
                </button>
              ))}
            </div>
          </div>
          <LabelBackgroundControls
            backgroundCalibration={backgroundCalibration}
            backgroundCalibrationOpen={backgroundCalibrationOpen}
            onToggleBackgroundCalibration={onToggleBackgroundCalibration}
            onUpdateBackgroundCalibration={onUpdateBackgroundCalibration}
            onResetBackgroundCalibration={onResetBackgroundCalibration}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Bottom Zone ───────────────────────────────────────────────────────────────
function BottomZone({
  sizeDef, font, fontSize, isPrinting, canPrint = true, status,
  onExportPng, canExportPng = true, exportPngTitle,
  autoFit, fitRatio,
  isBold = false, isItalic = false, isUnderline = false, isLinethrough = false,
  textAlign = "left", charSpacing = 0, lineHeight = 1.16,
  onAddText, onAddBorder, onRemoveSelected, onRotateCanvas,
  onFontChange, onFontSizeChange,
  onAutoFitChange, onFitRatioChange,
  onToggleBold, onToggleItalic, onToggleUnderline, onToggleLinethrough,
  onTextAlignChange, onCharSpacingChange, onLineHeightChange,
  onScaleUp, onScaleDown,
  onLoadSvgFrame,
  onPrint,
}: LabelEditorToolbarProps) {
  const [borderMenuOpen, setBorderMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

      {/* Компактный ряд: инструменты прокручиваются, печать всегда остаётся видимой. */}
      <div className="flex items-center gap-1 px-2 py-1">
        <div className="grid min-w-0 flex-1 grid-cols-5 gap-1">
          <ToolBtn onClick={onAddText} title="Добавить текст" stretch>
            <Type className="h-3.5 w-3.5" /><span className="hidden sm:inline">Текст</span>
          </ToolBtn>

          <div className="relative min-w-0" ref={borderBtnRef} data-border-menu-btn>
            <ToolBtn onClick={toggleBorderMenu} title="Добавить рамку" stretch>
              <Square className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Рамка</span><span>{borderMenuOpen ? "▴" : "▾"}</span>
            </ToolBtn>
          </div>

          {borderMenuOpen && borderMenuPos && typeof document !== "undefined" &&
            createPortal(
              <div
                data-border-menu
                className="fixed min-w-[170px] max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-xl"
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

          {onLoadSvgFrame && (
            <ToolBtn onClick={() => svgInputRef.current?.click()} title="Загрузить SVG-рамку из файла" stretch>
              <Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">SVG</span>
            </ToolBtn>
          )}

          <ToolBtn onClick={onRotateCanvas} title="Повернуть холст на 90°" stretch>
            <RotateCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Поворот</span>
          </ToolBtn>

          <ToolBtn onClick={onRemoveSelected} title="Удалить выделенное" destructive stretch>
            <Trash2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Удалить</span>
          </ToolBtn>


        </div>

        <Button
          onClick={onPrint}
          disabled={isPrinting || !canPrint}
          className="ml-auto h-10 min-w-[96px] shrink-0 gap-2 rounded-lg px-4 text-sm font-semibold"
          title={!canPrint ? "Печать недоступна" : isPrinting ? "Печать…" : `Печать · ${sizeDef.label}`}
        >
          <Printer className="h-5 w-5" />
          <span>{!canPrint ? "Недоступно" : isPrinting ? "Печать…" : "Печать"}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 px-2 pb-1">
        <button
          type="button"
          onClick={() => setSettingsOpen((value) => !value)}
          aria-expanded={settingsOpen}
          className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          title={settingsOpen ? "Скрыть настройки текста" : "Настройки шрифта и текста"}
        >
          {settingsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span>Текст и формат</span>
        </button>
        {status && <span className="min-w-0 flex-1 truncate text-[10px] text-blue-600">{status}</span>}
        {!status && <span className="flex-1" />}
      </div>

      {settingsOpen && (
        <>
          <div className="flex flex-wrap items-end gap-1.5 border-t border-border/60 px-2 py-1.5">
        {onExportPng && (
          <div className="flex flex-col gap-0.5 shrink-0">
            <span className="px-0.5 text-[9px] leading-none text-muted-foreground">Экспорт</span>
            <button type="button" onClick={onExportPng} disabled={!canExportPng} title={exportPngTitle ?? "Скачать PNG"} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> PNG
            </button>
          </div>
        )}

        {(onScaleDown || onScaleUp) && (
          <div className="flex flex-col gap-0.5 shrink-0">
            <span className="px-0.5 text-[9px] leading-none text-muted-foreground">Размер объекта</span>
            <div className="flex h-7 items-center gap-1">
              <button type="button" onClick={onScaleDown} disabled={!onScaleDown} title="Уменьшить выделенный элемент" className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40"><ZoomOut className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={onScaleUp} disabled={!onScaleUp} title="Увеличить выделенный элемент" className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40"><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}

        {/* Шрифт */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Шрифт</span>
          <Select value={font} onValueChange={(value) => { if (value) onFontChange(value) }}>
            <SelectTrigger className="h-7 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FONTS.map((f) => (
                <SelectItem key={f} value={f} style={{ fontFamily: f }} className="text-[11px]">{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Начертание: Жирный, Курсив, Подчёркивание, Зачёркивание */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Стиль</span>
          <div className="flex h-7 items-center gap-1">
            <button
              type="button"
              onClick={onToggleBold}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                isBold
                  ? "border-primary bg-primary text-primary-foreground font-bold shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="Жирный"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleItalic}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                isItalic
                  ? "border-primary bg-primary text-primary-foreground italic shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="Курсив"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleUnderline}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                isUnderline
                  ? "border-primary bg-primary text-primary-foreground underline shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="Подчёркивание"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleLinethrough}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                isLinethrough
                  ? "border-primary bg-primary text-primary-foreground line-through shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="Зачёркивание"
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Выравнивание: По левому краю, По центру, По правому краю */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Выравнивание</span>
          <div className="flex h-7 items-center gap-1">
            <button
              type="button"
              onClick={() => onTextAlignChange?.("left")}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                textAlign === "left"
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="По левому краю"
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onTextAlignChange?.("center")}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                textAlign === "center"
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="По центру"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onTextAlignChange?.("right")}
              className={`flex items-center justify-center h-7 w-7 rounded border transition-colors ${
                textAlign === "right"
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border bg-background hover:bg-muted text-foreground"
              }`}
              title="По правому краю"
            >
              <AlignRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Межбуквенный интервал */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Межбукв.</span>
          <div className="flex h-7 items-center gap-1">
            <input
              type="number"
              min={-200}
              max={1000}
              step={10}
              className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-[11px] text-center"
              value={charSpacing ?? 0}
              onChange={(e) => onCharSpacingChange?.(Number(e.target.value) || 0)}
              title="Межбуквенный интервал (charSpacing)"
            />
          </div>
        </div>

        {/* Межстрочный интервал */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Межстроч.</span>
          <div className="flex h-7 items-center gap-1">
            <input
              type="number"
              min={0.5}
              max={3.0}
              step={0.1}
              className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-[11px] text-center"
              value={lineHeight ?? 1.16}
              onChange={(e) => onLineHeightChange?.(Number(e.target.value) || 1.16)}
              title="Межстрочный интервал (lineHeight)"
            />
          </div>
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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 px-2 py-1 text-[9px] text-muted-foreground">
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
        </>
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
  children, onClick, title, destructive = false, stretch = false,
}: {
  children:     React.ReactNode
  onClick:      () => void
  title?:       string
  destructive?: boolean
  stretch?:     boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        "flex h-8 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-medium transition-colors",
        stretch ? "w-full min-w-0" : "shrink-0 min-w-7",
        destructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border bg-background hover:bg-muted",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
