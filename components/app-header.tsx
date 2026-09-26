"use client"

import type { Profile, Role } from "@/lib/types"
import { AuraMark } from "@/components/brand/aura-mark"
import { roleLabel } from "@/lib/format"
import type { ScreenId } from "@/components/app-nav"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  Menu,
  PackagePlus,
  Plus,
  ShoppingCart,
  Truck,
  Users,
  LogOut,
} from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/notifications"
import { SyncIndicator } from "@/components/sync/sync-indicator"
import { runLogoutCleanup } from "@/lib/local-db/logout-cleanup"


export function AppHeader({
  profile,
  viewRole,
  onChangeViewRole,
  onOpenCabinet,
  onOpenNotifications,
  onOpenNav,
  onNavigate,
}: {
  profile: Profile
  viewRole: Role
  onChangeViewRole: (role: Role) => void
  onOpenCabinet: () => void
  onOpenNotifications?: () => void
  onOpenNav: () => void
  onNavigate: (screen: ScreenId) => void
}) {
  const router = useRouter()
  const canSwitch = profile.role === "admin" || profile.role === "super_admin"

  const signOut = async () => {
    // Полная очистка локальных данных и кэшей перед выходом
    await runLogoutCleanup()
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {
      // даже при ошибке сети уводим пользователя на экран входа
    }
    router.push("/auth/login")
  }

  const initials = (profile.full_name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const goTo = (screen: ScreenId) => {
    onNavigate(screen)
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Открыть меню"
          onClick={onOpenNav}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div
          className="hidden min-w-0 max-w-56 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-left text-sm md:flex"
          title="Текущий магазин"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span className="truncate font-semibold">{profile.shop_name ?? "Магазин"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
        </div>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SyncIndicator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 bg-transparent" aria-label="Быстрое создание">
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">Создать</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Быстрое создание</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => goTo("kassa")}>
                <ShoppingCart className="mr-2 h-4 w-4" /> Новая продажа
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => goTo("sklad")}>
                <PackagePlus className="mr-2 h-4 w-4" /> Добавить товар
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => goTo("clients")}>
                <Users className="mr-2 h-4 w-4" /> Добавить клиента
              </DropdownMenuItem>
              {canSwitch && (
                <DropdownMenuItem onClick={() => goTo("suppliers")}>
                  <Truck className="mr-2 h-4 w-4" /> Приход товара
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <NotificationBell
            visible={profile.role === "super_admin"}
            onSeeAll={onOpenNotifications}
          />
          <ThemeToggle />
  
        </div>
      </div>
    </header>
  )
}
