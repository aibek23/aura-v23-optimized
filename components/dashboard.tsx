"use client"

import { useState } from "react"
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

  const canSeePurchasePrice = viewRole === "admin" || viewRole === "super_admin"
  const isAdmin = viewRole === "admin" || viewRole === "super_admin"
  const isSuperAdmin = profile.role === "super_admin"

  const handleExitImpersonation = async () => {
    try {
      await impersonateShop(null)
      toast.success("Вернулись в панель суперадмина")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка")
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
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
        onOpenCabinet={() => setScreen("kabinet")}
        onOpenNotifications={() => setScreen("notifications")}
      />
      <AppNav screen={screen} onChange={setScreen} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />

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
