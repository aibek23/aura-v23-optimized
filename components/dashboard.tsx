"use client"

import { useState, useTransition, useEffect, useRef, useCallback } from "react"
import type { Customer, Product, Profile, Role, Sale } from "@/lib/types"
import { Toaster } from "@/components/ui/sonner"
import { AppHeader } from "@/components/app-header"
import { RatesTicker } from "@/components/rates-ticker"
import { AppNav, type ScreenId } from "@/components/app-nav"
import { KassaScreen } from "@/components/screens/kassa/index"
import { VitrinaScreen } from "@/components/screens/vitrina"
import { SkladScreen } from "@/components/screens/sklad"
import { OtchetyScreen } from "@/components/screens/otchety"
import { KabinetScreen } from "@/components/screens/kabinet"
import { ClientsScreen } from "@/components/screens/clients"
import { NotificationsPage } from "@/components/notifications"
import { SuperAdminShopsScreen, ImpersonationBanner } from "@/components/screens/superadmin/shops-panel"
import type { CabinetData } from "@/app/actions/cabinet"
import type { MetalRate } from "@/lib/types"
import type { CashData } from "@/app/actions/cash"
import type { ShopBillingRow } from "@/app/actions/superadmin"
import { impersonateShop } from "@/app/actions/superadmin"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Двухэтапная защита от случайного выхода из CRM через кнопку «Назад»
//
// Принцип работы:
//   1. При каждом переключении экрана внутри CRM вызываем history.pushState —
//      это добавляет «шаги» в стек браузера, так что кнопка «Назад» сначала
//      проходит по ним, не покидая CRM.
//   2. Когда пользователь на главном экране (начало истории CRM) и нажимает
//      «Назад» — перехватываем событие popstate.
//      • 1-е нажатие: показываем toast-подсказку, возвращаем шаг через
//        history.pushState, счётчик = 1.
//      • 2-е нажатие: показываем модальное окно подтверждения выхода.
//      • «Отмена» → закрываем модал, сбрасываем счётчик.
//      • «Выйти» → перенаправляем на маркетплейс ("/").
// ---------------------------------------------------------------------------

const CRM_HISTORY_KEY = "crm_nav"

/** Добавляет фиктивную запись в history, чтобы «поглотить» одно нажатие «Назад». */
function pushCrmState(screenId: string) {
  window.history.pushState({ [CRM_HISTORY_KEY]: screenId }, "")
}

function ExitConfirmModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-base font-semibold">Выйти из CRM?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Вы действительно хотите покинуть CRM и перейти на витрину?
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  )
}

export function Dashboard({
  profile,
  products,
  sales,
  cabinet,
  rates = [],
  cash,
  email,
  clients = [],
  superAdminShops,
  impersonatedShop,
}: {
  profile: Profile
  products: Product[]
  sales: Sale[]
  cabinet: CabinetData
  rates?: MetalRate[]
  cash: CashData
  email: string
  clients?: Customer[]
  superAdminShops?: ShopBillingRow[]
  impersonatedShop?: { shop_id: string; shop_name: string | null }
}) {
  const router = useRouter()
  const [screen, setScreen] = useState<ScreenId>("kassa")
  const [viewRole, setViewRole] = useState<Role>(profile.role ?? "seller")
  const [showExitModal, setShowExitModal] = useState(false)

  // История переходов внутри CRM (стек экранов)
  const crmHistoryRef = useRef<ScreenId[]>([])
  // Счётчик нажатий «Назад» с главного экрана (0 или 1)
  const backCountRef = useRef(0)

  const canSeePurchasePrice = viewRole === "admin" || viewRole === "super_admin"
  const isAdmin = viewRole === "admin" || viewRole === "super_admin"
  const isSuperAdmin = profile.role === "super_admin"

  const [, startTransition] = useTransition()

  // При монтировании добавляем первый «сторожевой» шаг в browser history
  useEffect(() => {
    pushCrmState("kassa")
    crmHistoryRef.current = []
  }, [])

  /** Переключение экрана: сохраняем в CRM-стек и добавляем шаг в browser history. */
  const handleScreenChange = useCallback((next: ScreenId) => {
    crmHistoryRef.current.push(screen)
    setScreen(next)
    pushCrmState(next)
    backCountRef.current = 0 // сбрасываем счётчик при навигации вперёд
  }, [screen])

  /** Обработка нажатия «Назад» браузера. */
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as Record<string, unknown> | null

      // Если в стеке истории есть предыдущий CRM-экран — возвращаемся к нему
      if (crmHistoryRef.current.length > 0) {
        const prev = crmHistoryRef.current.pop()!
        setScreen(prev)
        pushCrmState(prev) // восстанавливаем «сторожевой» шаг
        backCountRef.current = 0
        return
      }

      // Находимся на главном экране CRM
      if (state && state[CRM_HISTORY_KEY]) {
        // Это наш собственный pushState — не реагируем
        return
      }

      // 1-е нажатие: toast-подсказка
      if (backCountRef.current === 0) {
        backCountRef.current = 1
        pushCrmState("kassa") // восстанавливаем «сторожевой» шаг
        toast.info("Нажмите «Назад» ещё раз, чтобы выйти из CRM", {
          duration: 3000,
          id: "crm-back-hint",
        })
        return
      }

      // 2-е нажатие: модал подтверждения
      pushCrmState("kassa") // снова восстанавливаем, чтобы не «провалиться»
      backCountRef.current = 0
      setShowExitModal(true)
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const handleExitCrm = () => {
    setShowExitModal(false)
    router.push("/")
  }

  const handleCancelExit = () => {
    setShowExitModal(false)
    backCountRef.current = 0
  }

  const handleExitImpersonation = async () => {
    try {
      await impersonateShop(null)
      toast.success("Вернулись в панель суперадмина")
      startTransition(() => router.refresh())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка")
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Модал подтверждения выхода из CRM */}
      <ExitConfirmModal
        open={showExitModal}
        onCancel={handleCancelExit}
        onConfirm={handleExitCrm}
      />

      {/* Баннер режима имперсонации — отображается поверх всего */}
      {isSuperAdmin && impersonatedShop && (
        <ImpersonationBanner
          shopName={impersonatedShop.shop_name}
          onExit={handleExitImpersonation}
        />
      )}

      <RatesTicker />
      <AppHeader
        profile={profile}
        viewRole={viewRole}
        onChangeViewRole={setViewRole}
        onOpenCabinet={() => handleScreenChange("kabinet")}
        onOpenNotifications={() => handleScreenChange("notifications")}
      />
      <AppNav screen={screen} onChange={handleScreenChange} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        {screen === "kassa" && (
          <KassaScreen
            profile={profile}
            products={products}
            viewRole={viewRole}
            sales={sales}
            cash={cash}
            rates={rates}
            clients={clients}
          />
        )}
        {screen === "vitrina" && (
          <VitrinaScreen products={products} canSeePurchasePrice={canSeePurchasePrice} isAdmin={isAdmin} />
        )}
        {screen === "sklad" && (
          <SkladScreen products={products} canSeePurchasePrice={canSeePurchasePrice} isAdmin={isAdmin} />
        )}
        {screen === "clients" && (
          <ClientsScreen clients={clients} />
        )}
        {screen === "kabinet" && (
          <KabinetScreen profile={profile} viewRole={viewRole} sales={sales} data={cabinet} email={email} />
        )}
        {screen === "otchety" && isAdmin && (
          <OtchetyScreen sales={sales} products={products} viewRole={viewRole} profile={profile} />
        )}
        {screen === "shops" && isSuperAdmin && superAdminShops && (
          <SuperAdminShopsScreen initialShops={superAdminShops} />
        )}
        {screen === "notifications" && isSuperAdmin && <NotificationsPage />}
      </main>
      <Toaster position="top-center" richColors />
    </div>
  )
}
