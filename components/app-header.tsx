"use client"

import type { Profile, Role } from "@/lib/types"
import { AuraMark } from "@/components/brand/aura-mark"
import { roleLabel } from "@/lib/format"
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
import { LogOut, Eye, ChevronDown, UserRound } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/notifications"


export function AppHeader({
  profile,
  viewRole,
  onChangeViewRole,
  onOpenCabinet,
  onOpenNotifications,
}: {
  profile: Profile
  viewRole: Role
  onChangeViewRole: (role: Role) => void
  onOpenCabinet: () => void
  onOpenNotifications?: () => void
}) {
  const router = useRouter()
  const canSwitch = profile.role === "admin" || profile.role === "super_admin"

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const initials = (profile.full_name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-2 overflow-hidden px-3 sm:gap-4 sm:px-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <AuraMark className="h-8 w-8 shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="font-serif text-lg sm:text-xl">Aura</div>
            <div className="truncate text-[10px] uppercase tracking-[0.2em] text-primary sm:tracking-[0.25em]">{profile.shop_name}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell
            visible={profile.role === "super_admin"}
            onSeeAll={onOpenNotifications}
          />
          <ThemeToggle />
          {canSwitch && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 bg-transparent">
                  <Eye className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">Просмотр как</span>
                  <span className="font-medium">{roleLabel(viewRole)}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Режим просмотра</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={viewRole} onValueChange={(v) => onChangeViewRole(v as Role)}>
                  <DropdownMenuRadioItem value="seller">Продавец</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="admin">Администратор</DropdownMenuRadioItem>
                  {profile.role === "super_admin" && (
                    <DropdownMenuRadioItem value="super_admin">Супер-админ</DropdownMenuRadioItem>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-accent">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarFallback className="bg-primary/15 text-xs font-medium text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden text-left leading-tight sm:block">
                  <div className="text-sm font-medium">{profile.full_name}</div>
                  <div className="text-[11px] text-muted-foreground">{roleLabel(profile.role)}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span>{profile.full_name}</span>
                <Badge variant="secondary" className="w-fit text-[10px]">
                  {roleLabel(profile.role)}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenCabinet}>
                <UserRound className="mr-2 h-4 w-4" />
                Кабинет
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
