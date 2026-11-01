"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Compass, Lightbulb, X } from "lucide-react"
import type { ScreenId } from "@/components/app-nav"

type SectionGuide = { id: ScreenId; title: string; description: string; actions: string[]; adminOnly?: boolean; superAdminOnly?: boolean }
type TourStep = { title: string; description: string; screen?: ScreenId; actions?: string[] }
type FocusHint = { text: string; top: number; left: number }

const BUTTON_HINTS: Record<string, string> = {
  "Добавить клиента": "Открыть форму и создать карточку нового клиента.",
  "Добавить товар": "Открыть форму и создать карточку нового товара.",
  "Создать": "Открыть меню быстрых действий.",
  "Открыть меню": "Показать или скрыть боковое меню разделов.",
  "Открыть меню профиля": "Открыть меню профиля и доступных настроек.",
  "Быстрое создание": "Открыть список быстрых действий.",
  "Сохранить": "Сохранить изменения в текущей форме.",
  "Сохранить расположение": "Сохранить текущую раскладку элементов этикетки.",
  "Отмена": "Закрыть форму без сохранения новых изменений.",
  "Закрыть": "Закрыть текущее окно или панель.",
  "Закрыть помощь": "Закрыть справку и вернуться к экрану.",
  "Редактировать": "Открыть выбранную запись для изменения.",
  "Изменить": "Изменить данные выбранной записи.",
  "Удалить": "Удалить выбранную запись. Проверьте выбор перед подтверждением.",
  "Обновить": "Загрузить актуальные данные раздела.",
  "Показать ещё": "Загрузить следующую часть списка.",
  "История покупок": "Открыть список покупок выбранного клиента.",
  "Вернуться к списку клиентов": "Закрыть историю покупок и вернуться к списку клиентов.",
  "Предыдущая страница": "Показать предыдущую страницу списка.",
  "Следующая страница": "Показать следующую страницу списка.",
  "Сгенерировать новый артикул": "Создать новый артикул товара.",
  "Печать этикетки товара": "Отправить этикетку товара на печать.",
  "Редактировать товар": "Открыть карточку товара для изменения.",
  "Удалить товар": "Удалить выбранный товар со склада.",
  "История": "Открыть историю операций или покупок.",
  "Чёрный список": "Добавить клиента в чёрный список или снять ограничение.",
  "Отметить все прочитанными": "Пометить все уведомления прочитанными.",
  "Все прочитаны": "Пометить уведомления прочитанными.",
  "Все уведомления": "Открыть полный список уведомлений.",
  "Добавить комментарий": "Добавить пояснение к выплате поставщику.",
  "Начать экскурсию": "Запустить пошаговое знакомство с Aura.",
  "Пройти тур": "Запустить экскурсию по разделам сайта.",
  "Пропустить тур": "Закрыть экскурсию. Справка останется доступна по кнопке «Помощь».",
  "Назад": "Перейти к предыдущему шагу или странице.",
  "Вперёд": "Перейти к следующей странице списка.",
  "Предыдущий шаг": "Вернуться к предыдущему шагу экскурсии.",
  "Следующий шаг": "Перейти к следующему шагу экскурсии.",
  "Синхронизировать": "Запустить обмен данными с сервером.",
  "Инкассация": "Перевести наличные средства в электронные.",
  "Изъять": "Записать выдачу наличных из кассы.",
  "Внести": "Записать поступление средств в кассу.",
  "Принять лом": "Открыть оформление приёма ювелирного лома.",
  "Добавить строкой в чек": "Добавить рассчитанную позицию лома в текущий чек.",
  "Оформить": "Завершить продажу и сохранить чек.",
  "Оплатить": "Подтвердить и сохранить выплату.",
  "Переподключить": "Повторно подключиться к выбранному устройству.",
  "Сменить устройство": "Выбрать другое устройство для подключения.",
  "Сбросить масштаб": "Вернуть исходный масштаб холста.",
  "Развернуть панель инструментов": "Показать дополнительные настройки редактора этикеток.",
  "Свернуть панель инструментов": "Скрыть панель настроек редактора этикеток.",
  "Развернуть панели настроек": "Показать боковые панели редактора этикеток.",
  "Жирный": "Включить или выключить жирное начертание текста.",
  "Курсив": "Включить или выключить курсивное начертание текста.",
  "Подчёркивание": "Включить или выключить подчёркивание текста.",
  "Зачёркивание": "Включить или выключить зачёркивание текста.",
  "По левому краю": "Выровнять текст по левому краю.",
  "По центру": "Выровнять текст по центру.",
  "По правому краю": "Выровнять текст по правому краю.",
  "Уменьшить выделенный элемент": "Уменьшить размер выбранного элемента этикетки.",
  "Увеличить выделенный элемент": "Увеличить размер выбранного элемента этикетки.",
  "Скачать PNG": "Скачать изображение этикетки в формате PNG.",
  "Сделать фото": "Сделать снимок товара камерой.",
  "Снять фото": "Сделать снимок товара камерой.",
  "Загрузить": "Выбрать файл и добавить его в форму.",
  "PNG": "Скачать этикетку как изображение PNG.",
  "Просмотр": "Открыть выбранный магазин в режиме просмотра.",
  "Биллинг": "Открыть настройки оплаты и подписки магазина.",
  "Долг": "Открыть форму для учёта долга поставщику.",
  "Рассчитаться": "Открыть форму выплаты поставщику.",
  "Выйти": "Завершить текущий вход в систему.",
  "Выйти из системы": "Завершить текущий вход в систему.",
}

function describeButton(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim()
  const exact = BUTTON_HINTS[normalized]
  if (exact) return exact
  if (/^Удалить\b/i.test(normalized)) return `Удалить выбранный объект: ${normalized.replace(/^Удалить\s*/i, "")}.`
  if (/^(Добавить|Создать)\b/i.test(normalized)) return `Создать новую запись: ${normalized}.`
  if (/^(Редактировать|Изменить)\b/i.test(normalized)) return `Открыть выбранный объект для изменения: ${normalized}.`
  if (/^(Печать|Распечатать)\b/i.test(normalized)) return `Отправить выбранные данные на печать: ${normalized}.`
  if (/^(Оформить|Провести|Да, продать)\b/i.test(normalized)) return `Подтвердить и завершить операцию: ${normalized}.`
  if (/^(Оплатить|Внести|Изъять)\b/i.test(normalized)) return `Подтвердить денежную операцию: ${normalized}.`
  if (/^Отменить\b/i.test(normalized)) return `Отменить выбранную операцию: ${normalized.replace(/^Отменить\s*/i, "")}.`
  const pageMatch = normalized.match(/^Перейти на страницу\s+(\d+)$/i)
  if (pageMatch) return `Открыть страницу списка номер ${pageMatch[1]}.`
  if (/^(Закрыть|Отмена)\b/i.test(normalized)) return `Закрыть текущее окно: ${normalized}.`
  if (/^(Предыдущее|Следующее)\b/i.test(normalized)) return `Переключить элемент просмотра: ${normalized}.`
  if (/^(Свернуть|Развернуть)\b/i.test(normalized)) return `${normalized} панель или настройки текущего раздела.`
  if (/^(Сброс|Очистить)\b/i.test(normalized)) return `Очистить или сбросить текущие данные: ${normalized}.`
  if (/^Показать ещё\b/i.test(normalized)) return "Загрузить следующую часть списка."
  if (/^Обновить\b/i.test(normalized)) return "Загрузить актуальные данные."
  return normalized ? `Действие «${normalized}».` : ""
}

function addButtonHints(root: ParentNode, enabled: boolean) {
  const buttons = root instanceof HTMLButtonElement
    ? [root]
    : Array.from(root.querySelectorAll?.("button") ?? [])

  for (const element of buttons) {
    const button = element as HTMLButtonElement
    const currentTitle = button.getAttribute("title")?.trim() ?? ""
    const initialized = button.dataset.auraHintsInitialized === "true"
    const appliedTitle = button.dataset.auraAppliedTitle ?? ""

    if (!initialized) {
      button.dataset.auraOriginalTitle = currentTitle
      button.dataset.auraHasOriginalTitle = currentTitle ? "true" : "false"
      button.dataset.auraHasOriginalDescription = button.hasAttribute("aria-description") ? "true" : "false"
      button.dataset.auraHintsInitialized = "true"
    } else if (currentTitle && appliedTitle && currentTitle !== appliedTitle) {
      // A React-rendered title changed (for example, a changing sync status).
      button.dataset.auraOriginalTitle = currentTitle
      button.dataset.auraHasOriginalTitle = "true"
      if (button.dataset.auraGeneratedLabel === "true" && !button.innerText.trim()) {
        button.setAttribute("aria-label", currentTitle)
      }
    }

    const visibleLabel = button.innerText.replace(/\s+/g, " ").trim()
    const originalTitle = button.dataset.auraOriginalTitle ?? ""
    if (!button.getAttribute("aria-label") && !visibleLabel && originalTitle) {
      button.setAttribute("aria-label", originalTitle)
      button.dataset.auraGeneratedLabel = "true"
    }
    const label = button.getAttribute("aria-label")?.trim() || visibleLabel || originalTitle
    if (!label) continue

    if (!enabled) {
      if (button.hasAttribute("title")) button.removeAttribute("title")
      if (button.dataset.auraGeneratedDescription === "true") {
        button.removeAttribute("aria-description")
        delete button.dataset.auraGeneratedDescription
      }
      button.dataset.auraButtonHint = "false"
      continue
    }

    const explicitTitle = button.dataset.auraHasOriginalTitle === "true" && originalTitle !== label
      ? originalTitle
      : ""
    const hint = explicitTitle || describeButton(label)
    if (button.getAttribute("title") !== hint) button.setAttribute("title", hint)
    button.dataset.auraAppliedTitle = hint
    button.dataset.auraButtonHint = "true"
    if (button.dataset.auraHasOriginalDescription !== "true") {
      if (button.getAttribute("aria-description") !== hint) button.setAttribute("aria-description", hint)
      button.dataset.auraGeneratedDescription = "true"
    }
  }
}

const SECTION_GUIDES: SectionGuide[] = [
  { id: "kassa", title: "Касса", description: "Оформляйте продажи и работайте с чеком.", actions: ["Найдите товар по названию или штрихкоду и добавьте его в чек.", "Выберите клиента и способ оплаты; для продажи в долг клиент обязателен.", "«Оформить» сохраняет продажу и чек.", "«Сброс» очищает текущий чек.", "«Принять лом» открывает оформление приёма лома, а «Добавить строкой в чек» добавляет его в чек."] },
  { id: "money", title: "Деньги", description: "Смотрите движение денег и операции кассы.", actions: ["«Внести» записывает поступление средств в кассу.", "«Изъять» записывает выдачу наличных.", "«Инкассация» переносит наличные в электронные средства.", "История кассы показывает операции за выбранный период."] },
  { id: "vitrina", title: "Витрина", description: "Просматривайте ассортимент магазина.", actions: ["«Все» показывает весь каталог, а «Проданные» — проданные товары.", "Откройте карточку товара, чтобы посмотреть его сведения.", "В галерее используйте «Предыдущее фото» и «Следующее фото».", "«Показать ещё» загружает следующую часть каталога."] },
  { id: "sklad", title: "Склад", description: "Управляйте карточками товаров и складским ассортиментом.", actions: ["«Добавить товар» открывает форму новой карточки.", "«Редактировать» меняет данные выбранного товара; «Удалить» удаляет его.", "«Этикетка» открывает редактор макета, а «Печать этикетки» отправляет этикетку на принтер.", "В редакторе этикеток кнопки панели меняют текст, форматирование, масштаб и расположение элементов.", "В настройках принтера можно подключить, переподключить или сменить Bluetooth-устройство."] },
  { id: "clients", title: "Клиенты", description: "Храните карточки клиентов и просматривайте их покупки.", actions: ["«Добавить клиента» создаёт новую карточку.", "«История покупок» показывает покупки выбранного клиента.", "«Редактировать» меняет карточку, а «Удалить» удаляет её.", "«Чёрный список» включает или снимает ограничение для клиента."] },
  { id: "suppliers", title: "Поставщики", description: "Работайте с поставщиками и связанными расчётами.", actions: ["«Рассчитаться» открывает форму выплаты поставщику.", "«Долг» открывает форму учёта задолженности.", "«История» показывает прошлые расчёты.", "В карточке поставщика можно просматривать и редактировать связанные товары."], adminOnly: true },
  { id: "otchety", title: "Отчёты", description: "Анализируйте продажи и показатели магазина.", actions: ["Выберите период, чтобы изменить даты отчёта.", "Таблицы и диаграммы показывают продажи, остатки и показатели магазина.", "Используйте фильтры категорий для уточнения отчёта.", "Наведите курсор на диаграмму, чтобы увидеть точные значения."], adminOnly: true },
  { id: "shops", title: "Магазины", description: "Управляйте магазинами в панели супер-администратора.", actions: ["«Просмотр» открывает выбранный магазин в его контексте.", "«Выйти из просмотра» возвращает к списку магазинов.", "«Биллинг» открывает настройки оплаты и подписки.", "«Автоблокировка» включает или выключает автоматическую блокировку магазина.", "«Сохранить» применяет изменения."], superAdminOnly: true },
  { id: "notifications", title: "Уведомления", description: "Просматривайте системные уведомления Aura.", actions: ["Откройте уведомление, чтобы прочитать его содержание.", "«Отметить все прочитанными» помечает все уведомления прочитанными.", "«Все уведомления» открывает полный список.", "«Обновить» загружает новые уведомления."], superAdminOnly: true },
  { id: "kabinet", title: "Кабинет", description: "Ваш профиль, команда и рабочие настройки.", actions: ["«Сохранить» применяет изменения профиля или настроек.", "«Обнулить баллы» сбрасывает бонусные баллы выбранного пользователя.", "Администраторы могут переключать режим просмотра роли — это не меняет саму роль.", "История действий позволяет просматривать и отменять поддерживаемые операции.", "«Отклонить» отклоняет запрос пользователя.", "«Выйти из системы» завершает текущий вход."] },
]

export function SiteHelp({ screen, onNavigate, isAdmin, isSuperAdmin, onRegisterOpenHelp }: { screen: ScreenId; onNavigate: (screen: ScreenId) => void; isAdmin: boolean; isSuperAdmin: boolean; onRegisterOpenHelp: (openHelp: () => void) => void }) {
  const [open, setOpen] = useState(false)
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [hasSeen, setHasSeen] = useState(true)
  const [hintsEnabled, setHintsEnabled] = useState(() => {
    if (typeof window === "undefined") return true
    try { return window.localStorage.getItem("aura-button-hints-enabled-v1") !== "0" } catch { return true }
  })
  const [focusHint, setFocusHint] = useState<FocusHint | null>(null)
  const dialogRef = useRef<HTMLElementTagNameMap["section"] | null>(null)
  const focusReturnRef = useRef<HTMLElement | null>(null)

  const sections = useMemo(() => SECTION_GUIDES.filter((section) => {
    if (section.superAdminOnly) return isSuperAdmin
    if (section.adminOnly) return isAdmin
    return true
  }), [isAdmin, isSuperAdmin])

  const tourSteps = useMemo<TourStep[]>(() => [
    { title: "Верхняя панель", description: "Здесь находятся меню, текущий магазин, быстрое создание, уведомления и статус синхронизации.", actions: ["«Создать» открывает быстрые действия: новая продажа, товар, клиент и — для администратора — поставщики.", "Кнопка с названием магазина показывает текущий магазин.", "Индикатор синхронизации сообщает о состоянии обмена данными.", "Переключатель темы находится в боковом меню."] },
    ...sections.map((section) => ({ title: section.title, description: section.description, screen: section.id, actions: section.actions })),
    { title: "Помощь всегда рядом", description: "Кнопка «Помощь» находится внизу бокового меню. Подсказки к кнопкам можно включать и отключать в этой справке." },
  ], [sections])

  useEffect(() => {
    addButtonHints(document, hintsEnabled)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          const button = record.target.parentElement?.closest("button")
          if (button) addButtonHints(button, hintsEnabled)
          continue
        }
        if (record.type === "attributes") {
          if (record.target instanceof HTMLButtonElement) addButtonHints(record.target, hintsEnabled)
          continue
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) addButtonHints(node, hintsEnabled)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label", "aria-description"] })
    return () => observer.disconnect()
  }, [hintsEnabled])

  useEffect(() => {
    if (!hintsEnabled) {
      setFocusHint(null)
      return
    }
    const updateHint = (button: HTMLButtonElement | null) => {
      const text = button?.getAttribute("aria-description") || button?.getAttribute("title")
      if (!button || !text) {
        setFocusHint(null)
        return
      }
      const rect = button.getBoundingClientRect()
      const below = rect.bottom + 64 < window.innerHeight
      const center = rect.left + rect.width / 2
      setFocusHint({
        text,
        top: below ? rect.bottom + 8 : Math.max(8, rect.top - 56),
        left: Math.max(8, Math.min(window.innerWidth - 8, center)),
      })
    }
    const focusedButton = () => {
      const active = document.activeElement
      updateHint(active instanceof Element ? active.closest("button") : null)
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      updateHint(target instanceof Element ? target.closest("button") : null)
    }
    const handleFocusOut = () => window.setTimeout(focusedButton, 0)
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)
    window.addEventListener("resize", focusedButton)
    window.addEventListener("scroll", focusedButton, true)
    return () => {
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      window.removeEventListener("resize", focusedButton)
      window.removeEventListener("scroll", focusedButton, true)
    }
  }, [hintsEnabled])

  const openHelp = useCallback(() => {
    focusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTourIndex(null)
    setOpen(true)
  }, [])

  useEffect(() => {
    onRegisterOpenHelp(openHelp)
  }, [onRegisterOpenHelp, openHelp])

  useEffect(() => {
    let seen = true
    try { seen = window.localStorage.getItem("aura-site-help-seen-v1") === "1" } catch { /* Storage may be disabled. */ }
    setHasSeen(seen)
    if (!seen) {
      focusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOpen(true)
    }
    setReady(true)
  }, [])

  const markSeen = useCallback(() => {
    setHasSeen(true)
    try { window.localStorage.setItem("aura-site-help-seen-v1", "1") } catch { /* Help remains available for this session. */ }
  }, [])
  const closeHelp = useCallback(() => { markSeen(); setOpen(false); setTourIndex(null) }, [markSeen])
  const startTour = () => { setTourIndex(0); setOpen(true) }

  useEffect(() => {
    if (!ready || !open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true")
    const focusFirst = () => (getFocusable()[0] ?? dialog).focus()
    const focusFrame = window.requestAnimationFrame(focusFirst)

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeHelp()
        return
      }
      if (event.key !== "Tab") return

      const focusable = getFocusable()
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("keydown", handleDialogKeyDown)
      const returnTarget = focusReturnRef.current
      const target = returnTarget?.isConnected
        ? returnTarget
        : document.querySelector<HTMLButtonElement>('header button[aria-label="Открыть меню"]')
      if (target?.isConnected) window.requestAnimationFrame(() => target.focus())
    }
  }, [ready, open, closeHelp])
  const moveTour = (direction: -1 | 1) => {
    if (tourIndex === null) return
    const nextIndex = tourIndex + direction
    if (nextIndex < 0) return
    if (nextIndex >= tourSteps.length) { closeHelp(); return }
    setTourIndex(nextIndex)
    const nextStep = tourSteps[nextIndex]
    if (nextStep.screen) onNavigate(nextStep.screen)
  }

  const currentGuide = sections.find((section) => section.id === screen)
  const currentStep = tourIndex === null ? null : tourSteps[tourIndex]

  return (
    <>
      {ready && open && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/50 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeHelp() }}>
          <section ref={dialogRef} tabIndex={-1} data-aura-help-dialog role="dialog" aria-modal="true" aria-labelledby="aura-help-title" aria-describedby="aura-help-description" className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl focus:outline-none">
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{currentStep ? <Compass className="h-5 w-5" /> : <Lightbulb className="h-5 w-5" />}</span>
                <div>
                  <h2 id="aura-help-title" className="text-base font-semibold sm:text-lg">{currentStep ? "Экскурсия по Aura" : "Помощь по Aura"}</h2>
                  <p id="aura-help-description" aria-live="polite" className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{currentStep ? <span>Шаг {tourIndex! + 1} из {tourSteps.length}</span> : "Что находится в разделах и как начать работу"}</p>
                </div>
              </div>
              <button type="button" onClick={closeHelp} aria-label="Закрыть помощь" className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={hintsEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      setHintsEnabled(enabled)
                      try { window.localStorage.setItem("aura-button-hints-enabled-v1", enabled ? "1" : "0") } catch { /* Storage may be disabled. */ }
                    }}
                    aria-describedby="aura-button-hints-description"
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span id="aura-button-hints-description" className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Показывать подсказки к кнопкам</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Выбор сохраняется на этом устройстве.</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{hintsEnabled ? "Включены" : "Отключены"}</span>
                </label>
              </div>
              {currentStep ? (
                <div>
                  <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-all" style={{ width: (((tourIndex! + 1) / tourSteps.length) * 100) + "%" }} /></div>
                  <div aria-live="polite" aria-atomic="true">
                    <h3 className="text-lg font-semibold">{currentStep.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentStep.description}</p>
                  </div>
                  {currentStep.actions?.length ? <ul className="mt-4 space-y-2">{currentStep.actions.map((action) => <li key={action} className="flex gap-2.5 text-sm leading-6"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /><span>{action}</span></li>)}</ul> : null}
                </div>
              ) : (
                <>
                  {!hasSeen && <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm font-medium">Добро пожаловать в Aura!</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Короткая экскурсия покажет назначение главных разделов и кнопок. Её можно пропустить и пройти позже.</p><button type="button" onClick={startTour} className="mt-3 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">Начать экскурсию</button></div>}
                  <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Текущий раздел</div><h3 className="mt-1 text-base font-semibold">{currentGuide?.title ?? "Разделы Aura"}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{currentGuide?.description ?? "Разделы и действия видны согласно вашей роли."}</p>{currentGuide?.actions.length ? <ul className="mt-3 space-y-2">{currentGuide.actions.map((action) => <li key={action} className="flex gap-2.5 text-sm leading-6"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /><span>{action}</span></li>)}</ul> : null}</div>
                  <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Все разделы</h3><button type="button" onClick={startTour} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">Пройти тур</button></div>
                  <div className="grid gap-2 sm:grid-cols-2">{sections.map((section) => <button key={section.id} type="button" onClick={() => { onNavigate(section.id); closeHelp() }} className="rounded-xl border border-border p-3 text-left transition hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block text-sm font-semibold">{section.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{section.description}</span></button>)}</div>
                   <div className="mt-4 rounded-xl bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">Когда подсказки включены, они появляются при наведении и переходе к кнопке клавишей Tab. Экранный диктор читает описание вместе с названием кнопки.</div>
                </>
              )}
            </div>

            {currentStep && <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6"><button type="button" onClick={closeHelp} className="text-sm text-muted-foreground transition hover:text-foreground">Пропустить тур</button><div className="flex gap-2"><button type="button" onClick={() => moveTour(-1)} disabled={tourIndex === 0} aria-label="Предыдущий шаг" className="inline-flex h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Назад</button><button type="button" onClick={() => moveTour(1)} className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90">{tourIndex === tourSteps.length - 1 ? "Завершить" : "Далее"}{tourIndex !== tourSteps.length - 1 && <ChevronRight className="h-4 w-4" />}</button></div></footer>}
          </section>
        </div>
      )}
      {focusHint && <div role="tooltip" aria-hidden="true" className="pointer-events-none fixed z-[200] max-w-sm -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-lg" style={{ top: focusHint.top, left: focusHint.left, maxWidth: "calc(100vw - 1rem)" }}>{focusHint.text}</div>}
    </>
  )
}
