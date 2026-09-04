"use client"

// ---------------------------------------------------------------------------
// Панель инструментов редактора этикеток.
// zone="header"  — лента форматов + кнопки Сохранить/Сброс (sticky top)
// zone="bottom"  — все инструменты + кнопка Печать (sticky bottom)
// ---------------------------------------------------------------------------
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Printer,
  Save,
  RefreshCw,
  Trash2,
  Type,
  Square,
  ChevronDown,
  ChevronUp,
  RotateCw,
} from "lucide-react"
import { FONTS } from "./label-editor.types"
import { LABEL_SIZES } from "@/lib/niimbot"
import type { JewelryLabelSizeKey, LabelSizeDef } from "@/lib/niimbot"

// ---------------------------------------------------------------------------
// Варианты рамок
// ---------------------------------------------------------------------------
export type BorderStyleKey =
  | "thin"
  | "thick"
  | "dashed"
  | "dotted"
  | "double"
  | "rounded"

export const BORDER_STYLES: { key: BorderStyleKey; label: string; strokeWidth: number; strokeDashArray: number[] | null; rx: number }[] = [
  { key: "thin",    label: "Тонкая",    strokeWidth: 1, strokeDashArray: null,    rx: 0  },
  { key: "thick",   label: "Жирная",    strokeWidth: 3, strokeDashArray: null,    rx: 0  },
  { key: "dashed",  label: "Пунктир",   strokeWidth: 1.5, strokeDashArray: [8, 4], rx: 0  },
  { key: "dotted",  label: "Точки",     strokeWidth: 1.5, strokeDashArray: [2, 4], rx: 0  },
  { key: "double",  label: "Двойная",   strokeWidth: 2, strokeDashArray: null,    rx: 0  },
  { key: "rounded", label: "Скруглённая", strokeWidth: 1.5, strokeDashArray: null, rx: 10 },
]

interface LabelEditorToolbarProps {
  zone: "header" | "bottom"
  sizeKey: JewelryLabelSizeKey
  sizeDef: LabelSizeDef
  font: string
  fontSize: number
  isPrinting: boolean
  status: string
  onSizeChange: (key: JewelryLabelSizeKey) => void
  onAddText: () => void
  onAddBorder: (style: BorderStyleKey) => void
  onRemoveSelected: () => void
  onSaveTemplate: () => void
  onResetTemplate: () => void
  onFontChange: (font: string) => void
  onFontSizeChange: (size: number) => void
  onPrint: () => void
  /** Поворот холста этикетки на 90° */
  onRotateCanvas: () => void
  /** Свёрнута ли панель настроек (только для zone="bottom") */
  collapsed?: boolean
  /** Переключение свёрнутого состояния */
  onToggleCollapse?: () => void
}

export function LabelEditorToolbar(props: LabelEditorToolbarProps) {
  if (props.zone === "header") return <HeaderZone {...props} />
  return <BottomZone {...props} />
}

// ---------------------------------------------------------------------------
// Header zone: выпадающий список форматов + Сохранить / Сброс
// Кнопка «Повернуть» УДАЛЕНА — она только в нижней панели
// ---------------------------------------------------------------------------
function HeaderZone({
  sizeKey,
  onSizeChange,
  onSaveTemplate,
  onResetTemplate,
}: LabelEditorToolbarProps) {
  const [expanded, setExpanded] = useState(false)

  // Все доступные ключи форматов из реестра LABEL_SIZES
  const allKeys = Object.keys(LABEL_SIZES) as (keyof typeof LABEL_SIZES)[]

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 pt-0.5">
      {/* Кнопка-гармошка для выбора формата этикетки */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* Выпадающая гармошка со списком форматов */}
      {expanded && (
        <div
          className="overflow-x-auto rounded-md border border-border bg-background/95 shadow-md p-1.5"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,0,0,0.15) transparent" }}
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

// ---------------------------------------------------------------------------
// Bottom zone: Текст | Рамка (с вариантами) | Повернуть | Удалить | Шрифт | Размер + Печать
// ---------------------------------------------------------------------------
function BottomZone({
  sizeDef,
  font,
  fontSize,
  isPrinting,
  status,
  onAddText,
  onAddBorder,
  onRemoveSelected,
  onRotateCanvas,
  onFontChange,
  onFontSizeChange,
  onPrint,
  collapsed = false,
  onToggleCollapse,
}: LabelEditorToolbarProps) {
  const [borderMenuOpen, setBorderMenuOpen] = useState(false)

  // ── Свёрнутое состояние: минималистичная компактная карточка ──────────────
  if (collapsed) {
    return (
      <div
        className="pointer-events-auto px-3 pb-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleCollapse}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggleCollapse?.() }}
          className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/80 px-3 py-2 shadow-lg backdrop-blur-md transition-all hover:bg-background/90 cursor-pointer"
          title="Развернуть настройки"
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
      {/* ── Строка 1: Инструменты редактирования ── */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-3 pt-2 pb-1">

        {/* Текст */}
        <ToolBtn onClick={onAddText} title="Добавить текст">
          <Type className="h-4 w-4" />
          <span className="text-[11px]">Текст</span>
        </ToolBtn>

        {/* Рамка — кнопка с выпадающим меню вариантов */}
        <div className="relative shrink-0">
          <ToolBtn
            onClick={() => setBorderMenuOpen((v) => !v)}
            title="Добавить рамку"
          >
            <Square className="h-4 w-4" />
            <span className="text-[11px]">Рамка ▾</span>
          </ToolBtn>

          {borderMenuOpen && (
            <div
              className="absolute bottom-full left-0 mb-1 min-w-[140px] rounded-lg border border-border bg-background shadow-xl py-1"
              style={{ zIndex: 9999 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {BORDER_STYLES.map((bs) => (
                <button
                  key={bs.key}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted transition-colors"
                  onClick={() => {
                    onAddBorder(bs.key)
                    setBorderMenuOpen(false)
                  }}
                >
                  {/* Иконка-превью стиля рамки */}
                  <BorderPreview style={bs} />
                  {bs.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 🔄 Повернуть холст на 90° */}
        <ToolBtn onClick={onRotateCanvas} title="Повернуть холст этикетки на 90°">
          <RotateCw className="h-4 w-4" />
          <span className="text-[11px]">Повернуть</span>
        </ToolBtn>

        {/* Удалить */}
        <ToolBtn onClick={onRemoveSelected} title="Удалить выделенное" destructive>
          <Trash2 className="h-4 w-4" />
          <span className="text-[11px]">Удалить</span>
        </ToolBtn>

        <div className="mx-1 h-6 w-px bg-border shrink-0" />

        {/* Шрифт */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Шрифт</span>
          <select
            className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px] min-w-[90px]"
            value={font}
            onChange={(e) => onFontChange(e.target.value)}
          >
            {FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Размер шрифта */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className="text-[9px] text-muted-foreground leading-none px-0.5">Размер</span>
          <input
            type="number"
            min={8}
            max={64}
            className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-[11px]"
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value) || 16)}
          />
        </div>
      </div>

      {/* ── Строка 2: Легенда линий (зелёная линия сгиба удалена) ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1 text-[9px] text-muted-foreground">
        <span className="font-medium text-foreground/60">Линии:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-blue-500" />
          печать
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-red-500" />
          обрез
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-gray-400" />
          перфорация
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
          {isPrinting ? "Печать…" : `Печать на Niimbot B1 · ${sizeDef.label}`}
        </Button>
      </div>

      {/* ── Строка 4: Кнопка «Свернуть» (в самом низу панели) ── */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
          Свернуть
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Превью стиля рамки в выпадающем меню
// ---------------------------------------------------------------------------
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
          strokeWidth={style.strokeWidth}
          strokeDasharray={dash ? dash.join(" ") : undefined}
          fill="none"
        />
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Вспомогательная кнопка инструмента
// ---------------------------------------------------------------------------
function ToolBtn({
  children,
  onClick,
  title,
  destructive = false,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "shrink-0 flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 transition-colors",
        destructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border bg-background text-foreground hover:bg-muted",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
