"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Customer, Product, Profile, Role } from "@/lib/types"
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
  ArrowRight,
  ChevronDown,
  Menu,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Truck,
  Users,
  X,
  LogOut,
} from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/notifications"


export function AppHeader({
  profile,
  viewRole,
  onChangeViewRole,
  onOpenCabinet,
  onOpenNotifications,
  onOpenNav,
  onNavigate,
  products = [],
  clients = [],
}: {
  profile: Profile
  viewRole: Role
  onChangeViewRole: (role: Role) => void
  onOpenCabinet: () => void
  onOpenNotifications?: () => void
  onOpenNav: () => void
  onNavigate: (screen: ScreenId) => void
  products?: Product[]
  clients?: Customer[]
}) {
  const router = useRouter()
  const canSwitch = profile.role === "admin" || profile.role === "super_admin"
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === "Escape") setSearchOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return { products: [], clients: [] }
    return {
      products: products
        .filter((product) =>
          [product.name, product.sku, product.category]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalized)),
        )
        .slice(0, 5),
      clients: clients
        .filter((client) =>
          [client.name, client.phone, client.email]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalized)),
        )
        .slice(0, 5),
    }
  }, [clients, products, query])

  const closeSearch = () => {
    setSearchOpen(false)
    setQuery("")
  }

  const goTo = (screen: ScreenId) => {
    closeSearch()
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
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <AuraMark className="h-8 w-8 shrink-0" />
        </div>

        <div
          className="hidden min-w-0 max-w-56 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-left text-sm md:flex"
          title="Текущий магазин"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span className="truncate font-semibold">{profile.shop_name ?? "Магазин"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ml-auto flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted sm:max-w-md"
          aria-label="Открыть глобальный поиск"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Поиск товара, артикула, клиента или QR...</span>
          <kbd className="ml-auto hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:inline">
            Ctrl K
          </kbd>
        </button>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
      {searchOpen && (
        <div className="absolute inset-x-0 top-16 z-50 border-b border-border bg-background p-3 shadow-lg sm:p-4">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center gap-2 rounded-lg border border-primary/50 bg-background px-3 py-2 ring-2 ring-primary/10">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск товара, артикула, клиента или QR..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Поиск по CRM"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Закрыть поиск"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {query.trim() && (
              <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1">
                {results.products.map((product) => (
                  <button
                    key={`product-${product.id}`}
                    type="button"
                    onClick={() => goTo("sklad")}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <PackagePlus className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{product.name}</span>
                    </span>
                    <span className="ml-3 text-xs text-muted-foreground">{product.sku ?? "без артикула"}</span>
                  </button>
                ))}
                {results.clients.map((client) => (
                  <button
                    key={`client-${client.id}`}
                    type="button"
                    onClick={() => goTo("clients")}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Users className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{client.name ?? client.phone ?? "Клиент"}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{client.phone}</span>
                  </button>
                ))}
                {results.products.length === 0 && results.clients.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Ничего не найдено
                  </div>
                )}
              </div>
            )}
            {!query.trim() && (
              <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5" />
                Ищите по названию, артикулу, телефону или email
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
