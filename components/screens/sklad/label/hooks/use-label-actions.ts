"use client"
// ---------------------------------------------------------------------------
// Действия редактора: добавить текст / рамку, удалить, сохранить, сброс,
// загрузка SVG-рамки, сохранение работы в файл, масштаб элементов
// ---------------------------------------------------------------------------
import { useCallback } from "react"
import { Textbox } from "fabric"
import type { Canvas as FabricCanvas } from "fabric"
import { toast } from "sonner"
import type { LabelSizeDef, JewelryLabelSizeKey } from "@/lib/niimbot"
import type { Product } from "@/lib/types"
import { saveLabelTemplate, getLabelTemplate } from "@/app/actions/labels"
import type { BorderStyleKey } from "../constants"
import { createTextbox, refitTextbox, setAutoFit, setFitRatio, clampRatio } from "../canvas/text-fit"
import { addBorderToCanvas } from "../canvas/borders"
import { buildDefaultLayout } from "../canvas/layout"
import { serializeLayout, parseTemplate, applyTemplate, applyBgRect } from "../data/template"
import { refreshLiveData } from "../canvas/layout"
import { saveLocalTemplate, getLocalTemplate, clearLocalTemplateCache } from "../data/local-template-storage"

export function useLabelActions(
  fabricRef:  React.RefObject<FabricCanvas | null>,
  sizeDef:    LabelSizeDef,
  sizeKey:    JewelryLabelSizeKey,
  offsetX:    number,
  offsetY:    number,
  product:    Product,
  category:   string,
  font:       string,
  fontSize:   number,
  autoFit:    boolean,
  fitRatio:   number,
  isBold = false,
  isItalic = false,
  isUnderline = false,
  isLinethrough = false,
  textAlign: "left" | "center" | "right" = "left",
  charSpacing = 0,
  lineHeight = 1.16,
) {
  const applyToSelection = useCallback((patch: Record<string, unknown>) => {
    const canvas  = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) { toast.info("Выделите элемент на холсте"); return }
    objects.forEach((o) => {
      o.set(patch)
      if (o.type === "textbox") refitTextbox(o as Textbox)
    })
    canvas.renderAll()
  }, [fabricRef])

  const targetTextboxes = useCallback((): Textbox[] => {
    const canvas = fabricRef.current
    if (!canvas) return []
    const selected = canvas.getActiveObjects().filter((o) => o.type === "textbox") as Textbox[]
    return selected.length
      ? selected
      : canvas.getObjects().filter((o) => o.type === "textbox") as Textbox[]
  }, [fabricRef])

  const addText = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const t = createTextbox("Текст", {
      left: 20, top: 20,
      width: Math.round(sizeDef.w_px * 0.5),
      fontSize, fontFamily: font, fill: "#000000",
      fontWeight: isBold ? "bold" : "normal",
      fontStyle: isItalic ? "italic" : "normal",
      underline: isUnderline,
      linethrough: isLinethrough,
      textAlign,
      charSpacing,
      lineHeight,
      data: { role: `custom-t-${Date.now()}`, autoFit, fitRatio },
    })
    canvas.add(t)
    canvas.setActiveObject(t)
    canvas.renderAll()
  }, [
    fabricRef, sizeDef, font, fontSize, autoFit, fitRatio,
    isBold, isItalic, isUnderline, isLinethrough, textAlign, charSpacing, lineHeight,
  ])

  const addBorder = useCallback((styleKey: BorderStyleKey) => {
    const canvas = fabricRef.current
    if (!canvas) return
    addBorderToCanvas(canvas, sizeDef, styleKey)
  }, [fabricRef, sizeDef])

  const removeSelected = useCallback(() => {
    const canvas  = fabricRef.current
    const objects = canvas?.getActiveObjects() ?? []
    if (!canvas || !objects.length) return
    objects.forEach((o) => canvas.remove(o))
    canvas.discardActiveObject()
    canvas.renderAll()
  }, [fabricRef])

  const handleAutoFitChange = useCallback((on: boolean) => {
    const canvas = fabricRef.current
    if (!canvas) return
    targetTextboxes().forEach((tb) => setAutoFit(tb, on))
    canvas.requestRenderAll()
  }, [fabricRef, targetTextboxes])

  const handleFitRatioChange = useCallback((ratio: number) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const r = clampRatio(ratio)
    targetTextboxes().forEach((tb) => setFitRatio(tb, r))
    canvas.requestRenderAll()
    return r
  }, [fabricRef, targetTextboxes])

  const handleFontChange = useCallback((f: string) => {
    applyToSelection({ fontFamily: f })
  }, [applyToSelection])

  const handleFontSizeChange = useCallback((s: number) => {
    applyToSelection({ fontSize: s })
  }, [applyToSelection])

  const handleBoldToggle = useCallback((bold: boolean) => {
    applyToSelection({ fontWeight: bold ? "bold" : "normal" })
  }, [applyToSelection])

  const handleItalicToggle = useCallback((italic: boolean) => {
    applyToSelection({ fontStyle: italic ? "italic" : "normal" })
  }, [applyToSelection])

  const handleUnderlineToggle = useCallback((underline: boolean) => {
    applyToSelection({ underline })
  }, [applyToSelection])

  const handleLinethroughToggle = useCallback((linethrough: boolean) => {
    applyToSelection({ linethrough })
  }, [applyToSelection])

  const handleTextAlignChange = useCallback((align: "left" | "center" | "right") => {
    applyToSelection({ textAlign: align })
  }, [applyToSelection])

  const handleCharSpacingChange = useCallback((spacing: number) => {
    applyToSelection({ charSpacing: spacing })
  }, [applyToSelection])

  const handleLineHeightChange = useCallback((lh: number) => {
    applyToSelection({ lineHeight: lh })
  }, [applyToSelection])

  const handleSaveTemplate = useCallback(async () => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      const tpl = serializeLayout(canvas, sizeKey, null)
      const serialized = JSON.stringify(tpl)
      saveLocalTemplate(category, serialized, sizeKey)
      await saveLabelTemplate(category, serialized, sizeKey)
      toast.success(`Расположение сохранено для «${category}» / ${sizeKey}`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [fabricRef, sizeKey, category])

  const handleReloadTemplate = useCallback(async () => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      const raw = await getLabelTemplate(category, sizeKey)
      const saved = parseTemplate(raw)
      if (raw && !saved) {
        throw new Error("Шаблон в базе данных имеет неподдерживаемый формат")
      }

      clearLocalTemplateCache(category, sizeKey)
      if (raw && saved) saveLocalTemplate(category, raw, sizeKey)
      if (!canvas.lowerCanvasEl) return

      await buildDefaultLayout(canvas, product, sizeDef)
      if (saved) {
        applyTemplate(canvas, saved)
        await refreshLiveData(canvas, product)
        applyBgRect(canvas, sizeDef, saved.bg ?? null)
      }
      canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
      canvas.renderAll()
      toast.success(
        saved
          ? "Шаблон обновлён из базы данных"
          : "Шаблон в базе не найден — восстановлен стандартный эскиз",
      )
    } catch (error) {
      console.error("[label] Не удалось обновить шаблон из БД:", error)
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить шаблон из базы данных")
    }
  }, [fabricRef, category, sizeKey, product, sizeDef, offsetX, offsetY])

  const loadTemplate = useCallback(async (canvas: FabricCanvas) => {
    // Сначала читаем локальный кэш. При наличии шаблона запрос в Supabase
    // не нужен: это убирает задержку при каждом открытии окна печати.
    let raw = getLocalTemplate(category, sizeKey)
    if (!raw) {
      try {
        raw = await getLabelTemplate(category, sizeKey)
        // Сохраняем ответ сразу после получения, до построения холста.
        if (raw) saveLocalTemplate(category, raw, sizeKey)
      } catch (error) {
        console.warn("[label] Не удалось загрузить шаблон из БД:", error)
      }
    }
    const saved = parseTemplate(raw)
    if (!canvas.lowerCanvasEl) return
    await buildDefaultLayout(canvas, product, sizeDef)
    if (!canvas.lowerCanvasEl) return
    if (saved) {
      applyTemplate(canvas, saved)
      await refreshLiveData(canvas, product)
      applyBgRect(canvas, sizeDef, saved.bg ?? null)
    }
    canvas.setViewportTransform([1, 0, 0, 1, offsetX, offsetY])
    canvas.renderAll()
  }, [category, sizeKey, product, sizeDef, offsetX, offsetY])

  // ── Загрузка SVG-рамки из файловой системы ───────────────────────────────
  const loadSvgFrame = useCallback(async (svgText: string, filename: string) => {
    const canvas = fabricRef.current
    if (!canvas) return
    try {
      const { loadSVGFromString, util } = await import("fabric")
      const { objects, options } = await loadSVGFromString(svgText)
      // Группируем объекты SVG в одну группу
      const group = util.groupSVGElements(objects.filter(Boolean) as import("fabric").FabricObject[], options)
      // Масштабируем рамку под размер холста
      const scaleX = sizeDef.w_px / (group.width  || sizeDef.w_px)
      const scaleY = sizeDef.h_px / (group.height || sizeDef.h_px)
      group.set({
        left: 0, top: 0,
        scaleX, scaleY,
        selectable: true,
        evented:    true,
        data: { role: "svg-frame", filename },
      })
      // Удаляем старую рамку, если была
      const old = canvas.getObjects().find(
        (o) => (o as unknown as { data?: { role?: string } }).data?.role === "svg-frame"
      )
      if (old) canvas.remove(old)
      canvas.add(group)
      canvas.sendObjectToBack(group)
      canvas.requestRenderAll()
      toast.success(`SVG-рамка загружена: ${filename}`)
    } catch (err) {
      toast.error(`Ошибка загрузки SVG: ${(err as Error).message}`)
    }
  }, [fabricRef, sizeDef])

  // ── Сохранение работы в JSON-файл ─────────────────────────────────────────
  const saveToFile = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) { toast.error("Холст не готов"); return }
    try {
      canvas.discardActiveObject()
      canvas.renderAll()
      const json = canvas.toJSON()
      const payload = {
        v: "1",
        sizeKey,
        canvas: json,
        exportedAt: new Date().toISOString(),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = `label-${sizeKey}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success("Файл сохранён")
    } catch (err) {
      toast.error(`Ошибка сохранения: ${(err as Error).message}`)
    }
  }, [fabricRef, sizeKey])

  return {
    addText, addBorder, removeSelected,
    applyToSelection, handleAutoFitChange, handleFitRatioChange,
    handleFontChange, handleFontSizeChange,
    handleBoldToggle, handleItalicToggle, handleUnderlineToggle, handleLinethroughToggle,
    handleTextAlignChange, handleCharSpacingChange, handleLineHeightChange,
    handleSaveTemplate, handleReloadTemplate, loadTemplate,
    loadSvgFrame, saveToFile,
  }
}
