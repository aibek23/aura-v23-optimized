"use client"

import { useState, useTransition, useEffect, useRef, useCallback } from "react"
import type { Customer, Product, Profile, Role, Sale } from "@/lib/types"
import { Toaster } from "@/components/ui/sonner"
import { AppHeader } from "@/components/app-header"
import { RatesTicker } from "@/components/rates-ticker"
import { AppNav, SCREEN_PATHS, type ScreenId } from "@/components/app-nav"
import { KassaScreen } from "@/components/screens/kassa/index"
import { VitrinaScreen } from "@/components/screens/vitrina"
import { SkladScreen } from "@/components/screens/sklad"
import { OtchetyScreen } from "@/components/screens/otchety"
import { KabinetScreen } from "@/components/screens/kabinet"
import { ClientsScreen } from "@/components/screens/clients"
import { SuppliersScreen } from "@/components/screens/suppliers"
import { NotificationsPage } from "@/components/notifications"
import { SuperAdminShopsScreen, ImpersonationBanner } from "@/components/screens/superadmin/shops-panel"
import type { CabinetData } from "@/app/actions/cabinet"
import type { MetalRate } from "@/lib/types"
import type { CashData } from "@/app/actions/cash"
import type { ShopBillingRow } from "@/app/actions/superadmin"
import type { SupplierDebtData } from "@/app/actions/suppliers"
import { impersonateShop } from "@/app/actions/superadmin"
import { useRouter } from "next/navigation"
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client"
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
//      • 1-е нажатие: ничего не происходит — шаг восстанавливается через
//        history.pushState, счётчик = 1.
//      • 2-е нажатие: показываем модальное окно подтверждения выхода.
//      • «Отмена» → закрываем модал, сбрасываем счётчик.
//      • «Выйти» → разлогиниваем пользователя и уводим на /auth/login.
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
        <h2 className="text-base font-semibold">Вы действительно хотите выйти из CRM?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Текущая сессия будет завершена, и потребуется повторный вход.
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
  screen,
  profile,
  products,
  sales,
  cabinet,
  rates = [],
  cash,
  supplierDebts,
  email,
  clients = [],
  superAdminShops,
  impersonatedShop,
}: {
  /** Текущий экран определяется URL-роутом, а не внутренним состоянием. */
  screen: ScreenId
  profile: Profile
  products: Product[]
  sales: Sale[]
  cabinet: CabinetData
  rates?: MetalRate[]
  cash: CashData
  supplierDebts: SupplierDebtData
  email: string
  clients?: Customer[]
  superAdminShops?: ShopBillingRow[]
  impersonatedShop?: { shop_id: string; shop_name: string | null }
}) {
  const router = useRouter()
  const [activeScreen, setActiveScreen] = useState<ScreenId>(screen)
  const [viewRole, setViewRole] = useState<Role>(profile.role ?? "seller")
  const [showExitModal, setShowExitModal] = useState(false)

  // Счётчик нажатий «Назад» с главного экрана (0 или 1)
  const backCountRef = useRef(0)
  // Открыт ли модал подтверждения выхода (для обработчика popstate)
  const exitModalOpenRef = useRef(false)

  const canSeePurchasePrice = viewRole === "admin" || viewRole === "super_admin"
  const isAdmin = viewRole === "admin" || viewRole === "super_admin"
  const isSuperAdmin = profile.role === "super_admin"

  const [, startTransition] = useTransition()

  /** Переключение экрана: переход по отдельному URL. */
  const handleScreenChange = useCallback(
    (next: ScreenId) => {
      backCountRef.current = 0 // сбрасываем счётчик при навигации вперёд
      setActiveScreen(next)
      window.history.pushState({ [CRM_HISTORY_KEY]: next }, "", SCREEN_PATHS[next])
    },
    [],
  )

  /**
   * Защита от случайного выхода из CRM работает только на главном экране
   * (/pos). На остальных экранах «Назад» — обычная навигация браузера
   * между URL-адресами разделов.
   */
  useEffect(() => {
    if (activeScreen !== "kassa") {
      const onSectionPopState = () => {
        const next = (Object.entries(SCREEN_PATHS) as [ScreenId, string][]).find(
          ([, path]) => path === window.location.pathname,
        )?.[0]
        if (next) setActiveScreen(next)
      }

      window.addEventListener("popstate", onSectionPopState)
      return () => window.removeEventListener("popstate", onSectionPopState)
    }

    pushCrmState("kassa")
    backCountRef.current = 0

    const onPopState = () => {
      const next = (Object.entries(SCREEN_PATHS) as [ScreenId, string][]).find(
        ([, path]) => path === window.location.pathname,
      )?.[0]
      if (next && next !== "kassa") {
        backCountRef.current = 0
        setActiveScreen(next)
        return
      }

      // Возвращаем «сторожевой» шаг в стек истории.
      pushCrmState("kassa")

      // Если модал уже открыт — повторное «Назад» его просто закрывает.
      if (exitModalOpenRef.current) {
        exitModalOpenRef.current = false
        setShowExitModal(false)
        backCountRef.current = 0
        return
      }

      // 1-е нажатие: ничего не происходит, остаёмся на месте.
      if (backCountRef.current === 0) {
        backCountRef.current = 1
        return
      }

      // 2-е нажатие: модальное окно подтверждения выхода.
      backCountRef.current = 0
      exitModalOpenRef.current = true
      setShowExitModal(true)
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [activeScreen])

  /** «Выйти» — разлогиниваем пользователя и уводим на страницу входа. */
  const handleExitCrm = async () => {
    exitModalOpenRef.current = false
    setShowExitModal(false)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } catch {
      // даже при ошибке сети уводим пользователя на экран входа
    }
    router.replace("/auth/login")
  }

  /** «Отмена» — закрываем модал и сбрасываем счётчик нажатий «Назад». */
  const handleCancelExit = () => {
    exitModalOpenRef.current = false
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
      <AppNav
        screen={activeScreen}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        onNavigate={handleScreenChange}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        {activeScreen === "kassa" && (
          <KassaScreen
            profile={profile}
            products={products}
            viewRole={viewRole}
            sales={sales}
            cash={cash}
            supplierDebts={supplierDebts}
            rates={rates}
            clients={clients}
          />
        )}
        {activeScreen === "vitrina" && (
          <VitrinaScreen products={products} canSeePurchasePrice={canSeePurchasePrice} isAdmin={isAdmin} />
        )}
        {activeScreen === "sklad" && (
          <SkladScreen products={products} canSeePurchasePrice={canSeePurchasePrice} isAdmin={isAdmin} />
        )}
        {activeScreen === "clients" && (
          <ClientsScreen clients={clients} />
        )}
        {activeScreen === "suppliers" && isAdmin && (
          <SuppliersScreen supplierDebts={supplierDebts} isAdmin={isAdmin} />
        )}
        {activeScreen === "kabinet" && (
          <KabinetScreen profile={profile} viewRole={viewRole} sales={sales} data={cabinet} email={email} />
        )}
        {activeScreen === "otchety" && isAdmin && (
          <OtchetyScreen sales={sales} products={products} viewRole={viewRole} profile={profile} />
        )}
        {activeScreen === "shops" && isSuperAdmin && superAdminShops && (
          <SuperAdminShopsScreen initialShops={superAdminShops} />
        )}
        {activeScreen === "notifications" && isSuperAdmin && <NotificationsPage />}
      </main>
      <Toaster position="top-center" richColors />
    </div>
  )
}
