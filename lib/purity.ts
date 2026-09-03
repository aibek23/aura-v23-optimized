/**
 * Проба изделия.
 *
 * Колонка public.products.purity удалена из БД — единственным источником
 * истины осталась человекочитаемая строка металла («Золото 585»).
 * Модуль намеренно НЕ помечен "use client": хелпер используется и в
 * серверных компонентах (публичные страницы /q, /store), и в клиентских.
 */
export function purityFromMetal(metal: string | null | undefined): string {
  const m = (metal ?? "").match(/(\d{3,4})\s*$/)
  return m ? m[1] : ""
}
