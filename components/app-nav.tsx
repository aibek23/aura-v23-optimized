"use client"

import { cn } from "@/lib/utils"
import {
  LayoutGrid,
  ShoppingCart,
  Warehouse,
  BarChart3,
  Users,
  Store,
  Bell,
  Truck,
} from "lucide-react"

export type ScreenId =
  | "kassa"
  | "vitrina"
  | "sklad"
  | "otchety"
  | "kabinet"
  | "clients"
  | "shops"
  | "notifications"
  | "suppliers"

/** Единая карта «экран → URL». Используется навигацией и роут-страницами. */
export const SCREEN_PATHS: Record<ScreenId, string> = {
  kassa: "/crm/pos",
  vitrina: "/crm/showcase",
  sklad: "/crm/inventory",
  clients: "/crm/customers",
  otchety: "/crm/reports",
  shops: "/crm/stores",
  notifications: "/crm/notifications",
  suppliers: "/crm/suppliers",
  kabinet: "/crm/cabinet",
}

const ITEMS: {
  id: ScreenId
  label: string
  icon: typeof ShoppingCart
  adminOnly?: boolean
  superAdminOnly?: boolean
}[] = [
  { id: "kassa",   label: "Касса",    icon: ShoppingCart },
  { id: "vitrina", label: "Витрина",  icon: LayoutGrid },
  { id: "sklad",   label: "Склад",    icon: Warehouse },
  { id: "clients", label: "Клиенты",  icon: Users },
  { id: "suppliers", label: "Поставщики", icon: Truck, adminOnly: true },
  { id: "otchety", label: "Отчёты",   icon: BarChart3, adminOnly: true },
  { id: "shops",   label: "Магазины", icon: Store, superAdminOnly: true },
  { id: "notifications", label: "Уведомления", icon: Bell, superAdminOnly: true },
]

export function AppNav({
  screen,
  isAdmin,
  isSuperAdmin = false,
  onNavigate,
}: {
  screen: ScreenId
  isAdmin: boolean
  isSuperAdmin?: boolean
  onNavigate: (screen: ScreenId) => void
}) {
  const items = ITEMS.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin
    if (item.adminOnly) return isAdmin
    return true
  })

  return (
    <nav className="sticky top-16 z-10 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 md:px-6">
        {items.map((item) => {
          const active = screen === item.id
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition-colors md:px-4",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                item.superAdminOnly && !active && "text-orange-500/70 hover:text-orange-600",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
