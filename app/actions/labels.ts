/** Сохраняет JSON-шаблон этикетки в localStorage.
 *  Ключ: `label_tpl_{sizeKey}_{category}` — индивидуально для каждого формата+категории.
 */
export function saveLabelTemplate(category: string, templateJson: string, sizeKey?: string): void {
  const DEFAULT_CATEGORY = "Прочее"
  const cat = category || DEFAULT_CATEGORY
  const key = sizeKey ? `label_tpl_${sizeKey}_${cat}` : `label_tpl_${cat}`
  try {
    localStorage.setItem(key, templateJson)
  } catch (e) {
    console.error("[label] Ошибка сохранения шаблона в localStorage:", e)
  }
}

/** Возвращает JSON-шаблон для формата+категории из localStorage или null. */
export function getLabelTemplate(category: string, sizeKey?: string): string | null {
  const DEFAULT_CATEGORY = "Прочее"
  const cat = category || DEFAULT_CATEGORY
  const key = sizeKey ? `label_tpl_${sizeKey}_${cat}` : `label_tpl_${cat}`
  // Фолбэк: шаблон для категории без привязки к формату (совместимость с v16)
  const fallbackKey = `label_tpl_${cat}`
  // Ещё старее — legacy ключ из v15 (объект {[cat]: json})
  const legacyKey = "label_templates_cache"
  try {
    const exact = localStorage.getItem(key)
    if (exact) return exact
    if (sizeKey) {
      const noSize = localStorage.getItem(fallbackKey)
      if (noSize) return noSize
    }
    // legacy fallback
    const raw = localStorage.getItem(legacyKey)
    if (raw) {
      const store: Record<string, string> = JSON.parse(raw)
      return store[cat] ?? store[DEFAULT_CATEGORY] ?? null
    }
    return null
  } catch (e) {
    console.error("[label] Ошибка чтения шаблона из localStorage:", e)
    return null
  }
}

/** Удаляет шаблон для формата+категории из localStorage. */
export function deleteLabelTemplate(category: string, sizeKey?: string): void {
  const DEFAULT_CATEGORY = "Прочее"
  const cat = category || DEFAULT_CATEGORY
  const key = sizeKey ? `label_tpl_${sizeKey}_${cat}` : `label_tpl_${cat}`
  try {
    localStorage.removeItem(key)
  } catch (e) {
    console.error("[label] Ошибка удаления шаблона из localStorage:", e)
  }
}
