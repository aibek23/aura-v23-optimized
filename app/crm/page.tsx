import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/lib/types"
import { PendingScreen } from "@/components/add-edit-Product/pending-screen"
import { Dashboard } from "@/components/dashboard"
import { getProducts } from "@/app/actions/products"
import { getSales } from "@/app/actions/sales"
import { getCabinetData } from "@/app/actions/cabinet"
import { getCashData } from "@/app/actions/cash"
import { getMetalRates } from "@/app/actions/rates"
import { getClients } from "@/app/actions/clients"
import { getSuperAdminShops, getImpersonatedShop } from "@/app/actions/superadmin"
import type { ShopBillingRow } from "@/app/actions/superadmin"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  let { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  // Любой пользователь (включая основателя магазина) должен быть подтверждён суперадмином.
  // Авто-подтверждение намеренно отключено в v18.
  const typed = profile as Profile | null

  // Если профиль не подтверждён — показываем экран ожидания, не вызывая никаких action-функций.
  if (!typed || typed.status !== "approved" || !typed.role) {
    return <PendingScreen profile={typed} email={user.email ?? ""} />
  }

  const isSuperAdmin = typed.role === "super_admin"

  // Параллельная загрузка всех данных (суперадмин получает дополнительно список магазинов).
  // Оборачиваем в try/catch: если сессия устарела или профиль изменился между запросами — редиректим.
  let products, sales, cabinet, cash, rates, clients, superAdminShops, impersonatedShop
  try {
    ;[products, sales, cabinet, cash, rates, clients, superAdminShops, impersonatedShop] =
      await Promise.all([
        getProducts(),
        getSales(),
        getCabinetData(),
        getCashData(),
        getMetalRates(),
        getClients(),
        isSuperAdmin ? getSuperAdminShops() : Promise.resolve([] as ShopBillingRow[]),
        isSuperAdmin ? getImpersonatedShop() : Promise.resolve(null),
      ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : ""
    // Профиль стал неактивным между двумя запросами — показываем экран ожидания.
    if (msg.includes("подтверждён") || msg.includes("не подтверждён") || msg.includes("not approved")) {
      const { data: freshProfile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
      return <PendingScreen profile={freshProfile as Profile | null} email={user.email ?? ""} />
    }
    // Сессия истекла — отправляем на логин.
    if (msg.includes("Сессия") || msg.includes("Требуется вход") || msg.includes("Войдите")) {
      redirect("/auth/login")
    }
    throw err
  }

  return (
    <Dashboard
      profile={typed}
      products={products!}
      sales={sales!}
      cabinet={cabinet!}
      cash={cash!}
      rates={rates!}
      email={user.email ?? ""}
      clients={clients!}
      superAdminShops={isSuperAdmin ? superAdminShops : undefined}
      impersonatedShop={impersonatedShop ?? undefined}
    />
  )
}
