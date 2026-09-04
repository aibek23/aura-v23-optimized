// ---------------------------------------------------------------------------
// Сериализация / десериализация / применение шаблонов бирок
// ---------------------------------------------------------------------------
import { Canvas, Textbox, Rect, type FabricObject } from "fabric"
import type { LabelSizeDef } from "@/lib/niimbot"
import { createTextbox, fitTextboxHeight } from "./label-editor.canvas"
import {
  TEMPLATE_VERSION,
  LIVE_ROLES,
  r2,
  getRole,
  type TemplateItem,
  type LabelTemplate,
} from "./label-editor.types"

// ---------------------------------------------------------------------------
// Сериализация
// ---------------------------------------------------------------------------
/**
 * Сохраняем ТОЛЬКО координаты и стиль элементов.
 * Изображение QR (base64) в шаблон не попадает — именно оно раздувало
 * payload server action до нескольких мегабайт («слишком большие данные»).
 */
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
      obj.type === "textbox"
        ? "textbox"
        : obj.type === "image"
          ? "image"
          : "rect"

    const item: TemplateItem = {
      role,
      kind,
      left: r2(obj.left),
      top: r2(obj.top),
      angle: r2(obj.angle),
      scaleX: r2(obj.scaleX, 1),
      scaleY: r2(obj.scaleY, 1),
      width: r2(obj.width),
      height: r2(obj.height),
    }

    if (kind === "textbox") {
      const tb = obj as Textbox
      item.fontSize = r2(tb.fontSize, 12)
      item.fontFamily = String(tb.fontFamily ?? "Arial")
      item.fontWeight = (tb.fontWeight as string) ?? "normal"
      item.textAlign = String(tb.textAlign ?? "left")
      item.fill = typeof tb.fill === "string" ? tb.fill : "#000000"
      if (role.startsWith("custom-")) item.text = String(tb.text ?? "").slice(0, 200)
    }

    if (kind === "rect") {
      item.fill = typeof obj.fill === "string" ? obj.fill : "transparent"
      item.stroke = typeof obj.stroke === "string" ? obj.stroke : "#000000"
      item.strokeWidth = r2(obj.strokeWidth, 1)
    }

    items.push(item)
  })

  return { v: TEMPLATE_VERSION, sizeKey, bg, items }
}

// ---------------------------------------------------------------------------
// Десериализация
// ---------------------------------------------------------------------------
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
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Применение шаблона к холсту
// ---------------------------------------------------------------------------
/**
 * Накладываем сохранённые координаты на уже построенный стандартный макет.
 * Живые данные (текст/QR) остаются актуальными, двигается только геометрия.
 */
export function applyTemplate(canvas: Canvas, tpl: LabelTemplate): void {
  const byRole = new Map(tpl.items.map((i) => [i.role, i]))
  const savedRoles = new Set(tpl.items.map((i) => i.role))

  // Удаляем стандартные элементы, которых нет в сохранённом шаблоне
  for (const obj of [...canvas.getObjects()]) {
    const role = getRole(obj)
    if (
      role &&
      LIVE_ROLES.includes(role as (typeof LIVE_ROLES)[number]) &&
      !savedRoles.has(role)
    ) {
      canvas.remove(obj)
    }
  }

  // Позиционируем существующие
  for (const obj of canvas.getObjects()) {
    const role = getRole(obj)
    if (!role) continue
    const item = byRole.get(role)
    if (!item) continue
    applyItemToObject(obj, item)
    byRole.delete(role)
  }

  // Пересоздаём пользовательские элементы, которых нет на холсте
  for (const item of byRole.values()) {
    if (item.kind === "textbox") {
      const tb = createTextbox(item.text ?? "Текст", {
        left: item.left,
        top: item.top,
        width: item.width || 80,
        fontSize: item.fontSize ?? 12,
        fontFamily: item.fontFamily ?? "Arial",
        fontWeight: item.fontWeight ?? "normal",
        textAlign: (item.textAlign as Textbox["textAlign"]) ?? "left",
        fill: item.fill ?? "#000000",
        angle: item.angle ?? 0,
        scaleX: item.scaleX ?? 1,
        scaleY: 1,
        data: { role: item.role },
      })
      fitTextboxHeight(tb)
      canvas.add(tb)
    } else if (item.kind === "rect") {
      const rect = new Rect({
        left: item.left,
        top: item.top,
        width: item.width || 40,
        height: item.height || 20,
        fill: item.fill ?? "transparent",
        stroke: item.stroke ?? "#000000",
        strokeWidth: item.strokeWidth ?? 1,
        angle: item.angle ?? 0,
        scaleX: item.scaleX ?? 1,
        scaleY: item.scaleY ?? 1,
        data: { role: item.role },
      })
      canvas.add(rect)
    }
  }

  canvas.renderAll()
}

// ---------------------------------------------------------------------------
// Применение позиции/стиля к объекту
// ---------------------------------------------------------------------------
export function applyItemToObject(obj: FabricObject, item: TemplateItem): void {
  obj.set({
    left: item.left,
    top: item.top,
    angle: item.angle ?? 0,
    scaleX: item.scaleX ?? 1,
    scaleY: item.scaleY ?? 1,
  })

  if (obj.type === "textbox") {
    const tb = obj as Textbox
    // высота текста считается по контенту, сохранённое значение не применяем
    tb.set({
      scaleY: 1,
      padding: 0,
      width: item.width || tb.width,
      fontSize: item.fontSize ?? tb.fontSize,
      fontFamily: item.fontFamily ?? tb.fontFamily,
      fontWeight: item.fontWeight ?? tb.fontWeight,
      textAlign: (item.textAlign as Textbox["textAlign"]) ?? tb.textAlign,
      fill: item.fill ?? tb.fill,
    })
    fitTextboxHeight(tb)
  }

  if (obj.type === "rect") {
    obj.set({
      width: item.width || obj.width,
      height: item.height || obj.height,
      fill: item.fill ?? obj.fill,
      stroke: item.stroke ?? obj.stroke,
      strokeWidth: item.strokeWidth ?? obj.strokeWidth,
    })
  }

  obj.setCoords()
}

// ---------------------------------------------------------------------------
// Фоновый прямоугольник печатной области
// ---------------------------------------------------------------------------
/**
 * Рисует или удаляет цветной фон внутри печатной области.
 * canvas.backgroundColor не используется — холст больше бирки.
 */
export function applyBgRect(
  canvas: Canvas,
  sizeDef: LabelSizeDef,
  color: string | null,
): void {
  const existing = canvas.getObjects().find((o) => getRole(o) === "bg")
  if (existing) canvas.remove(existing)
  if (!color) {
    canvas.renderAll()
    return
  }
  const rect = new Rect({
    left: 0,
    top: 0,
    width: sizeDef.w_px,
    height: sizeDef.h_px,
    fill: color,
    selectable: false,
    evented: false,
    data: { role: "bg" },
  })
  canvas.add(rect)
  canvas.sendObjectToBack(rect)
  canvas.renderAll()
}
