"use client"

// ---------------------------------------------------------------------------
// Панель инструментов редактора этикеток: кнопки + настройки стиля
// ---------------------------------------------------------------------------
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Printer,
  Save,
  RefreshCw,
  Trash2,
  Type,
  Square,
} from "lucide-react"
import { FONTS, SIZE_OPTIONS } from "./label-editor.types"
import { LABEL_SIZES } from "@/lib/niimbot"
import type { JewelryLabelSizeKey, LabelSizeDef } from "@/lib/niimbot"

interface LabelEditorToolbarProps {
  sizeKey: JewelryLabelSizeKey
  sizeDef: LabelSizeDef
  font: string
  fontSize: number
  textColor: string
  bgColor: string
  bgTransparent: boolean
  isPrinting: boolean
  onSizeChange: (key: JewelryLabelSizeKey) => void
  onAddText: () => void
  onAddBorder: () => void
  onRemoveSelected: () => void
  onSaveTemplate: () => void
  onResetTemplate: () => void
  onFontChange: (font: string) => void
  onFontSizeChange: (size: number) => void
  onTextColorChange: (color: string) => void
  onBgColorChange: (color: string) => void
  onBgTransparentChange: (transparent: boolean) => void
  onPrint: () => void
  status: string
}

export function LabelEditorToolbar({
  sizeKey,
  sizeDef,
  font,
  fontSize,
  textColor,
  bgColor,
  bgTransparent,
  isPrinting,
  onSizeChange,
  onAddText,
  onAddBorder,
  onRemoveSelected,
  onSaveTemplate,
  onResetTemplate,
  onFontChange,
  onFontSizeChange,
  onTextColorChange,
  onBgColorChange,
  onBgTransparentChange,
  onPrint,
  status,
}: LabelEditorToolbarProps) {
  return (
    <>
      {/* Выбор формата */}
      <div className="flex flex-col gap-1">
        <Label className="text-[11px] text-muted-foreground">Формат бирки</Label>
        <div className="flex flex-wrap gap-1.5">
          {SIZE_OPTIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onSizeChange(key)}
              className={[
                "rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors",
                key === sizeKey
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted",
              ].join(" ")}
            >
              {LABEL_SIZES[key].label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Печатная область: {sizeDef.w_px}×{sizeDef.h_px} px
        </p>
      </div>

      {/* Кнопки действий */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <Button variant="outline" size="sm" onClick={onAddText}>
          <Type className="mr-1 h-3.5 w-3.5" />Текст
        </Button>
        <Button variant="outline" size="sm" onClick={onAddBorder}>
          <Square className="mr-1 h-3.5 w-3.5" />Рамка
        </Button>
        <Button variant="outline" size="sm" onClick={onRemoveSelected}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />Удалить
        </Button>
        <Button variant="outline" size="sm" onClick={onSaveTemplate}>
          <Save className="mr-1 h-3.5 w-3.5" />Сохранить
        </Button>
        <Button variant="ghost" size="sm" onClick={onResetTemplate}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Сброс
        </Button>
      </div>

      {/* Настройки стиля */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Шрифт</Label>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={font}
            onChange={(e) => onFontChange(e.target.value)}
          >
            {FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Размер</Label>
          <input
            type="number"
            min={8}
            max={64}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value) || 16)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Цвет текста</Label>
          <input
            type="color"
            className="h-8 w-full rounded-md border border-input bg-background"
            value={textColor}
            onChange={(e) => onTextColorChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Фон</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              disabled={bgTransparent}
              className="h-8 w-full rounded-md border border-input bg-background disabled:opacity-40"
              value={bgColor}
              onChange={(e) => onBgColorChange(e.target.value)}
            />
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={bgTransparent}
                onChange={(e) => onBgTransparentChange(e.target.checked)}
              />
              прозр.
            </label>
          </div>
        </div>
      </div>

      {/* Легенда SVG-линий */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground/70">Линии (только экран):</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-blue-500" />
          область печати
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-green-600" />
          сгиб
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-red-500" />
          обрез
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 border-t border-dashed border-gray-400" />
          перфорация
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-white/70 ring-1 ring-border" />
          за печатной областью (не печатается)
        </span>
      </div>

      {/* Кнопка печати */}
      <div className="shrink-0 border-t bg-background px-3 pb-[env(safe-area-inset-bottom,0px)] pt-2">
        {status && (
          <p className="mb-1 animate-pulse text-xs font-medium text-blue-600">{status}</p>
        )}
        <Button onClick={onPrint} disabled={isPrinting} className="w-full gap-2">
          <Printer className="h-4 w-4" />
          {isPrinting ? "Печать..." : `Печать на Niimbot B1 · ${sizeDef.label}`}
        </Button>
      </div>
    </>
  )
}
