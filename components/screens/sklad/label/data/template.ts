// ---------------------------------------------------------------------------
// Сериализация / десериализация / применение шаблонов
// ---------------------------------------------------------------------------
import { Canvas, Textbox, Rect } from "fabric"
import type { FabricObject } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { TEMPLATE_VERSION, LIVE_ROLES } from "../constants"
import { r2, getRole } from "../types"
import type { TemplateItem, LabelTemplate } from "../types"
import { createTextbox, fitFontToBox, isAutoFit, getFitRatio, refitTextbox, setBoxHeight } from "../canvas/text-fit"

export function serializeLayout(
  canvas: Canvas,
  sizeKey: string,
  bg: string | null,
): LabelTemplate {
  const items: TemplateItem[] = []

  canvas.getObjects().forEach((obj, index) => {
    const role = getRole(obj) ?? `custom-${index}`
    if (role === "bg") return

    const kind: TemplateItem["kind"] =
      obj.type === "textbox" ? "textbox" : obj.type === "image" ? "image" : "rect"

    const item: TemplateItem = {
      role, kind,
      left: r2(obj.left), top: r2(obj.top),
      angle: r2(obj.angle), scaleX: r2(obj.scaleX, 1), scaleY: r2(obj.scaleY, 1),
      width: r2(obj.width), height: r2(obj.height),
    }

    if (kind === "textbox") {
      const tb     = obj as Textbox
      item.fontSize   = r2(tb.fontSize, 12)
      item.fontFamily = String(tb.fontFamily ?? "Arial")
      item.fontWeight = (tb.fontWeight as string) ?? "normal"
      item.textAlign  = String(tb.textAlign ?? "left")
      item.fill       = typeof tb.fill === "string" ? tb.fill : "#000000"
      item.autoFit    = isAutoFit(tb)
      item.fitRatio   = r2(getFitRatio(tb), 1)
      if (role.startsWith("custom-")) item.text = String(tb.text ?? "").slice(0, 200)
    }

    if (kind === "rect") {
      item.fill        = typeof obj.fill === "string" ? obj.fill : "transparent"
      item.stroke      = typeof obj.stroke === "string" ? obj.stroke : "#000000"
      item.strokeWidth = r2(obj.strokeWidth, 1)
    }

    items.push(item)
  })

  return { v: TEMPLATE_VERSION, sizeKey, bg, items }
}

export function parseTemplate(raw: string | null | undefined): LabelTemplate | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<LabelTemplate>
    if (parsed?.v !== TEMPLATE_VERSION || !Array.isArray(parsed.items)) return null
    return {
      v: TEMPLATE_VERSION,
      sizeKey: String(parsed.sizeKey ?? ""),
      bg: parsed.bg ?? null,
      items: parsed.items as TemplateItem[],
    }
  } catch { return null }
}

export function applyTemplate(canvas: Canvas, tpl: LabelTemplate): void {
  const byRole     = new Map(tpl.items.map((i) => [i.role, i]))
  const savedRoles = new Set(tpl.items.map((i) => i.role))

  for (const obj of [...canvas.getObjects()]) {
    const role = getRole(obj)
    if (role && LIVE_ROLES.includes(role as (typeof LIVE_ROLES)[number]) && !savedRoles.has(role)) {
      canvas.remove(obj)
    }
  }

  for (const obj of canvas.getObjects()) {
    const role = getRole(obj)
    if (!role) continue
    const item = byRole.get(role)
    if (!item) continue
    applyItemToObject(obj, item)
    byRole.delete(role)
  }

  for (const item of byRole.values()) {
    if (item.kind === "textbox") {
      const tb = createTextbox(item.text ?? "Текст", {
        left: item.left, top: item.top,
        width: item.width || 80,
        fontSize: item.fontSize ?? 12, fontFamily: item.fontFamily ?? "Arial",
        fontWeight: item.fontWeight ?? "normal",
        textAlign: (item.textAlign as Textbox["textAlign"]) ?? "left",
        fill: item.fill ?? "#000000", angle: item.angle ?? 0,
        scaleX: item.scaleX ?? 1, scaleY: 1,
        data: { role: item.role, autoFit: item.autoFit !== false, fitRatio: item.fitRatio ?? 1 },
      })
      if (item.height && item.height > 2) setBoxHeight(tb, item.height)
      refitTextbox(tb)
      canvas.add(tb)
    } else if (item.kind === "rect") {
      canvas.add(new Rect({
        left: item.left, top: item.top,
        width: item.width || 40, height: item.height || 20,
        fill: item.fill ?? "transparent",
        stroke: item.stroke ?? "#000000", strokeWidth: item.strokeWidth ?? 1,
        angle: item.angle ?? 0, scaleX: item.scaleX ?? 1, scaleY: item.scaleY ?? 1,
        data: { role: item.role },
      }))
    }
  }

  canvas.renderAll()
}

export function applyItemToObject(obj: FabricObject, item: TemplateItem): void {
  obj.set({
    left: item.left, top: item.top,
    angle: item.angle ?? 0, scaleX: item.scaleX ?? 1, scaleY: item.scaleY ?? 1,
  })

  if (obj.type === "textbox") {
    const tb   = obj as Textbox
    const data = (tb as unknown as { data?: Record<string, unknown> }).data ?? {}
    data.autoFit  = item.autoFit !== false
    data.fitRatio = item.fitRatio ?? 1
    ;(tb as unknown as { data?: Record<string, unknown> }).data = data

    tb.set({
      scaleY: 1, padding: 0,
      width: item.width || tb.width,
      fontSize: item.fontSize ?? tb.fontSize,
      fontFamily: item.fontFamily ?? tb.fontFamily,
      fontWeight: item.fontWeight ?? tb.fontWeight,
      textAlign: (item.textAlign as Textbox["textAlign"]) ?? tb.textAlign,
      fill: item.fill ?? tb.fill,
    })

    if (data.autoFit) {
      fitFontToBox(tb, item.width || tb.width, item.height && item.height > 2 ? item.height : undefined)
    } else {
      refitTextbox(tb)
    }
  }

  if (obj.type === "rect") {
    obj.set({
      width: item.width || obj.width, height: item.height || obj.height,
      fill: item.fill ?? obj.fill,
      stroke: item.stroke ?? obj.stroke, strokeWidth: item.strokeWidth ?? obj.strokeWidth,
    })
  }

  obj.setCoords()
}

export function applyBgRect(canvas: Canvas, sizeDef: LabelSizeDef, color: string | null): void {
  const existing = canvas.getObjects().find((o) => getRole(o) === "bg")
  if (existing) canvas.remove(existing)
  if (!color) { canvas.renderAll(); return }

  const rect = new Rect({
    left: 0, top: 0,
    width: sizeDef.w_px, height: sizeDef.h_px,
    fill: color,
    selectable: false, evented: false,
    data: { role: "bg" },
  })
  canvas.add(rect)
  canvas.sendObjectToBack(rect)
  canvas.renderAll()
}
