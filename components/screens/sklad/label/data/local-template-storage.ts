const DEFAULT_CATEGORY = "Прочее"

function key(category: string, sizeKey?: string) {
  const cat = category || DEFAULT_CATEGORY
  return sizeKey ? `label_tpl_${sizeKey}_${cat}` : `label_tpl_${cat}`
}

function databaseRefreshKey(category: string, sizeKey?: string) {
  const cat = category || DEFAULT_CATEGORY
  return `label_tpl_db_refreshed_${sizeKey || "default"}_${cat}`
}

/** Legacy/local fallback: нужен для уже сохранённых шаблонов и offline-работы. */
export function saveLocalTemplate(category: string, templateJson: string, sizeKey?: string) {
  try {
    localStorage.setItem(key(category, sizeKey), templateJson)
  } catch (error) {
    console.error("[label] Ошибка сохранения шаблона в localStorage:", error)
  }
}

export function getLocalTemplate(category: string, sizeKey?: string): string | null {
  try {
    const exact = localStorage.getItem(key(category, sizeKey))
    if (exact) return exact

    if (sizeKey) {
      const noSize = localStorage.getItem(key(category))
      if (noSize) return noSize

      // An explicit DB refresh must not fall back to an older category-only cache.
      if (localStorage.getItem(databaseRefreshKey(category, sizeKey)) === "1") return null
    }

    const legacy = localStorage.getItem("label_templates_cache")
    if (legacy) {
      const store = JSON.parse(legacy) as Record<string, string>
      return store[category || DEFAULT_CATEGORY] ?? store[DEFAULT_CATEGORY] ?? null
    }
  } catch (error) {
    console.error("[label] Ошибка чтения шаблона из localStorage:", error)
  }
  return null
}

export function deleteLocalTemplate(category: string, sizeKey?: string) {
  try {
    localStorage.removeItem(key(category, sizeKey))
  } catch (error) {
    console.error("[label] Ошибка удаления шаблона из localStorage:", error)
  }
}

/** Invalidate older cache fallbacks after explicitly requesting the current DB template. */
export function clearLocalTemplateCache(category: string, sizeKey?: string) {
  try {
    localStorage.removeItem(key(category, sizeKey))
    localStorage.removeItem(key(category))
    if (sizeKey) localStorage.setItem(databaseRefreshKey(category, sizeKey), "1")
  } catch (error) {
    console.error("[label] Ошибка очистки кэша шаблона:", error)
  }
}