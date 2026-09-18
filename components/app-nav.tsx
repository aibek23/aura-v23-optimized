"use client"

import { useEffect, useMemo, useState } from "react"
import type { Profile, Role } from "@/lib/types"
import { roleLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  LayoutGrid,
  LogOut,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  Users,
  Warehouse,
  X,
  type LucideIcon,
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

type NavGroup = "work" | "management" | "analytics" | "system"

type NavItem = {
  id: ScreenId
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  superAdminOnly?: boolean
  group: NavGroup
}

const ITEMS: NavItem[] = [
  { id: "kassa", label: "Касса", icon: ShoppingCart, group: "work" },
  { id: "vitrina", label: "Витрина", icon: LayoutGrid, group: "work" },
  { id: "sklad", label: "Склад", icon: Warehouse, group: "work" },
  { id: "clients", label: "Клиенты", icon: Users, group: "work" },
  { id: "suppliers", label: "Поставщики", icon: Truck, adminOnly: true, group: "management" },
  { id: "otchety", label: "Отчёты", icon: BarChart3, adminOnly: true, group: "analytics" },
  { id: "shops", label: "Магазины", icon: Store, superAdminOnly: true, group: "system" },
  { id: "notifications", label: "Уведомления", icon: Bell, superAdminOnly: true, group: "system" },
  { id: "kabinet", label: "Кабинет", icon: UserRound, group: "system" },
]

const GROUPS: { id: NavGroup; label: string }[] = [
  { id: "work", label: "Работа" },
  { id: "management", label: "Управление" },
  { id: "analytics", label: "Аналитика" },
  { id: "system", label: "Система" },
]

interface AppNavProps {
  screen: ScreenId
  profile?: Profile | null
  viewRole?: Role
  onChangeViewRole?: (role: Role) => void
  isAdmin: boolean
  isSuperAdmin?: boolean
  onNavigate: (screen: ScreenId) => void
  onOpenCabinet?: () => void
  mobileOpen?: boolean
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function AppNav({
  screen,
  profile,
  viewRole,
  onChangeViewRole,
  isAdmin,
  isSuperAdmin = false,
  onNavigate,
  mobileOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: AppNavProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const canSwitchRole = profile?.role === "admin" || profile?.role === "super_admin"

  const initials = useMemo(() => {
    const parts = profile?.full_name?.trim().split(/\s+/)
    if (!parts?.length) return "?"
    return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase()
  }, [profile?.full_name])

  const visibleItems = useMemo(
    () =>
      ITEMS.filter((item) => {
        if (item.superAdminOnly) return isSuperAdmin
        if (item.adminOnly) return isAdmin
        return true
      }),
    [isAdmin, isSuperAdmin]
  )

  const handleNavigate = (id: ScreenId) => {
    onNavigate(id)
    onClose?.()
  }

  // Блокировка прокрутки body при открытом мобильном меню
  useEffect(() => {
    if (!mobileOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.()
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [mobileOpen, onClose])

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        aria-label="Основная навигация"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-svh flex-col border-r border-border bg-background shadow-xl transition-[transform,width] duration-200 ease-out w-[280px]",
          "lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:shrink-0 lg:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          collapsed && "lg:w-[76px]"
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}
        >
          <button
            type="button"
            onClick={() => handleNavigate("kabinet")}
            aria-label="Открыть кабинет Aura"
            className={cn(
              "flex items-center rounded-lg transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed ? "p-1.5" : "gap-2 px-1.5 py-1"
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <span className="font-serif text-xl text-primary">A</span>
            </span>
            <span className={cn("font-serif text-lg tracking-tight", collapsed && "lg:hidden")}>
              Aura CRM
            </span>
          </button>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Развернуть боковое меню" : "Свернуть боковое меню"}
            aria-expanded={!collapsed}
            className={cn(
              "hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex",
              collapsed && "absolute -right-[18px] top-[14px] border bg-background shadow-sm"
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          {/* Mobile close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Разделы CRM" className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
          <div className="space-y-5">
            {GROUPS.map((group) => {
              const groupItems = visibleItems.filter((i) => i.group === group.id)
              if (!groupItems.length) return null

              return (
                <section key={group.id}>
                  <h2
                    className={cn(
                      "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70",
                      collapsed && "lg:sr-only"
                    )}
                  >
                    {group.label}
                  </h2>

                  <div className="space-y-0.5">
                    {groupItems.map((item) => {
                      const Icon = item.icon
                      const active = screen === item.id

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNavigate(item.id)}
                          title={collapsed ? item.label : undefined}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]"
                              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                            collapsed && "lg:justify-center lg:px-0"
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
                              active ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <Icon
                            aria-hidden="true"
                            className={cn(
                              "h-[18px] w-[18px] shrink-0 transition-transform duration-150 group-hover:scale-[1.04]",
                              active ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span className={cn("truncate", collapsed && "lg:hidden")}>
                            {item.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </nav>

        {/* Bottom area */}
        <div className="shrink-0 border-t border-border p-2">
          {profile ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Открыть меню профиля"
                  className={cn(
                    "flex min-h-12 w-full items-center gap-2 rounded-xl p-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    collapsed && "lg:justify-center lg:px-1"
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0 border border-border">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className={cn("min-w-0 flex-1 leading-tight", collapsed && "lg:hidden")}>
                    <div className="truncate text-sm font-medium">
                      {profile.full_name ?? "Пользователь"}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {canSwitchRole && viewRole ? (
                        <>
                          Как: <strong className="font-medium text-foreground">{roleLabel(viewRole)}</strong>
                        </>
                      ) : (
                        profile.role ? roleLabel(profile.role) : ""
                      )}
                    </div>
                  </div>

                  <ChevronUp aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground/60", collapsed && "lg:hidden")} />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-60">
                <DropdownMenuLabel className="flex flex-col gap-2">
                  <span className="truncate">{profile.full_name ?? "Пользователь"}</span>
                  {profile.role && (
                    <Badge variant="secondary" className="w-fit text-[10px]">
                      {roleLabel(profile.role)}
                    </Badge>
                  )}
                </DropdownMenuLabel>

                {canSwitchRole && viewRole && onChangeViewRole && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Eye className="h-3.5 w-3.5 text-primary" />
                        Режим просмотра
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Только для просмотра. Роль не изменяется.
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={viewRole}
                      onValueChange={(val) => {
                        const nextRole = val as Role
                        if (nextRole !== viewRole) onChangeViewRole(nextRole)
                      }}
                    >
                      <DropdownMenuRadioItem value="seller">Продавец</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="admin">Администратор</DropdownMenuRadioItem>
                      {profile?.role === "super_admin" && (
                        <DropdownMenuRadioItem value="super_admin">Супер-админ</DropdownMenuRadioItem>
                      )}
                    </DropdownMenuRadioGroup>
                  </>
                )}

                <DropdownMenuSeparator />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div aria-label="Загрузка профиля" className={cn("flex min-h-12 items-center gap-2 p-2", collapsed && "lg:justify-center lg:px-1")}>
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className={cn("min-w-0 flex-1 space-y-1.5", collapsed && "lg:hidden")}>
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}