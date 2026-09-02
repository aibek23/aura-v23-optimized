"use client"

import { useState, useTransition, useMemo } from "react"
import {
  getSuperAdminShops,
  updateShopBilling,
  setShopFrozen,
  impersonateShop,
  type ShopBillingRow,
} from "@/app/actions/superadmin"
import { type SubscriptionStatus, SUBSCRIPTION_STATUS_LABELS } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Store,
  Users,
  CalendarDays,
  ShieldOff,
  ShieldCheck,
  Eye,
  RotateCcw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("ru", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso),
  )
}

function subscriptionBadge(status: SubscriptionStatus, frozen: boolean) {
  if (frozen || status === "frozen") {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <ShieldOff className="h-2.5 w-2.5" />
        Заморожен
      </Badge>
    )
  }
  const map: Record<SubscriptionStatus, { icon: React.ReactNode; cls: string; label: string }> = {
    trial:     { icon: <Clock className="h-2.5 w-2.5" />,       cls: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",  label: "Пробный" },
    active:    { icon: <CheckCircle2 className="h-2.5 w-2.5" />, cls: "bg-green-500/10 text-green-600 border-green-500/30",    label: "Активна" },
    past_due:  { icon: <AlertTriangle className="h-2.5 w-2.5" />,cls: "bg-orange-500/10 text-orange-600 border-orange-500/30", label: "Просрочена" },
    frozen:    { icon: <ShieldOff className="h-2.5 w-2.5" />,    cls: "bg-destructive/10 text-destructive border-destructive/30", label: "Заморожена" },
    cancelled: { icon: <XCircle className="h-2.5 w-2.5" />,      cls: "bg-muted text-muted-foreground border-border",          label: "Отменена" },
  }
  const cfg = map[status] ?? map.trial
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", cfg.cls)}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Диалог редактирования биллинга
// ---------------------------------------------------------------------------

function BillingDialog({
  shop,
  open,
  onClose,
  onSaved,
}: {
  shop: ShopBillingRow
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [pending, start] = useTransition()
  const [paidUntil, setPaidUntil] = useState(shop.paid_until ?? "")
  const [status, setStatus]       = useState<SubscriptionStatus>(shop.subscription_status)
  const [autoBlock, setAutoBlock] = useState(shop.auto_block)

  const handleSave = () => {
    start(async () => {
      try {
        await updateShopBilling({
          shop_id:             shop.shop_id,
          paid_until:          paidUntil || null,
          subscription_status: status,
          auto_block:          autoBlock,
        })
        toast.success("Биллинг магазина обновлён")
        onSaved()
        onClose()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка обновления")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            Биллинг: {shop.shop_name ?? "Магазин"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Оплачено до</Label>
            <Input
              type="date"
              value={paidUntil}
              onChange={(e) => setPaidUntil(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Статус подписки</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(SUBSCRIPTION_STATUS_LABELS) as [SubscriptionStatus, string][]).map(
                  ([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoBlock((v) => !v)}
              className={cn(
                "relative h-5 w-9 rounded-full border transition-colors",
                autoBlock ? "border-primary bg-primary" : "border-border bg-muted",
              )}
              aria-label="Автоблокировка"
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  autoBlock ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <Label className="cursor-pointer text-xs" onClick={() => setAutoBlock((v) => !v)}>
              Автозаморозка по сроку оплаты
            </Label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Баннер режима имперсонации
// ---------------------------------------------------------------------------

export function ImpersonationBanner({
  shopName,
  onExit,
}: {
  shopName: string | null
  onExit: () => void
}) {
  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-orange-500/40 bg-orange-500/10 px-4 py-2.5 backdrop-blur">
      <Eye className="h-4 w-4 shrink-0 text-orange-600" />
      <span className="flex-1 text-sm font-medium text-orange-700 dark:text-orange-400">
        Режим просмотра магазина:{" "}
        <span className="font-semibold">{shopName ?? "—"}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-orange-500/50 text-xs text-orange-700 hover:bg-orange-500/20 dark:text-orange-400"
        onClick={onExit}
      >
        <RotateCcw className="mr-1.5 h-3 w-3" />
        Выйти из просмотра
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Основной экран: список магазинов для суперадмина
// ---------------------------------------------------------------------------

export function SuperAdminShopsScreen({ initialShops }: { initialShops: ShopBillingRow[] }) {
  const router = useRouter()
  const [shops, setShops]         = useState<ShopBillingRow[]>(initialShops)
  const [query, setQuery]         = useState("")
  const [editingShop, setEditing] = useState<ShopBillingRow | null>(null)
  const [pending, start]          = useTransition()
  const [impersonating, setImpersonating] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return shops
    return shops.filter((s) => (s.shop_name ?? "").toLowerCase().includes(q))
  }, [shops, query])

  const reload = () => {
    start(async () => {
      try {
        const { getSuperAdminShops } = await import("@/app/actions/superadmin")
        const fresh = await getSuperAdminShops()
        setShops(fresh)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка обновления")
      }
    })
  }

  const handleFreeze = (shop: ShopBillingRow) => {
    const action = shop.is_frozen ? "Разморозить" : "Заморозить"
    if (!confirm(`${action} магазин «${shop.shop_name ?? shop.shop_id}»?`)) return
    start(async () => {
      try {
        // Единый эндпоинт: сервер сам восстанавливает статус подписки при разморозке
        await setShopFrozen(shop.shop_id, !shop.is_frozen)
        toast.success(shop.is_frozen ? "Магазин разморожен" : "Магазин заморожен")
        reload()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка")
      }
    })
  }

  const handleImpersonate = (shopId: string) => {
    setImpersonating(shopId)
    start(async () => {
      try {
        await impersonateShop(shopId)
        toast.success("Переключились в контекст магазина")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка переключения")
        setImpersonating(null)
      }
    })
  }

  const handleExitImpersonation = () => {
    start(async () => {
      try {
        await impersonateShop(null)
        setImpersonating(null)
        toast.success("Вернулись в панель суперадмина")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка")
      }
    })
  }

  const totalShops   = shops.length
  const activeShops  = shops.filter((s) => s.subscription_status === "active").length
  const frozenShops  = shops.filter((s) => s.is_frozen || s.subscription_status === "frozen").length
  const overdueShops = shops.filter((s) => {
    if (!s.paid_until) return false
    return new Date(s.paid_until) < new Date() && !s.is_frozen
  }).length

  return (
    <div className="space-y-5">
      {impersonating && (
        <ImpersonationBanner
          shopName={shops.find((s) => s.shop_id === impersonating)?.shop_name ?? null}
          onExit={handleExitImpersonation}
        />
      )}

      {/* Заголовок */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-xl">Магазины</h2>
          <p className="text-sm text-muted-foreground">Мультитенантное управление и биллинг</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 bg-transparent w-full sm:w-auto"
          onClick={reload}
          disabled={pending}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Всего магазинов", value: totalShops,   icon: <Store className="h-4 w-4 text-primary" /> },
          { label: "Активных",        value: activeShops,  icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> },
          { label: "Просрочено",      value: overdueShops, icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
          { label: "Заморожено",      value: frozenShops,  icon: <ShieldOff className="h-4 w-4 text-destructive" /> },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              {s.icon}
              <div>
                <div className="text-[11px] text-muted-foreground">{s.label}</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{s.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Поиск */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск магазина..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Таблица — десктоп */}
      <div className="hidden sm:block overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Магазин</th>
              <th className="px-4 py-3 text-left font-medium">Статус</th>
              <th className="px-4 py-3 text-left font-medium">Оплачено до</th>
              <th className="px-4 py-3 text-center font-medium">Персонал</th>
              <th className="px-4 py-3 text-center font-medium">Автоблок</th>
              <th className="px-4 py-3 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  Магазины не найдены
                </td>
              </tr>
            ) : (
              filtered.map((shop) => {
                const isExpired = shop.paid_until && new Date(shop.paid_until) < new Date()
                return (
                  <tr
                    key={shop.shop_id}
                    className={cn(
                      "border-b border-border/50 last:border-0 transition-colors hover:bg-muted/20",
                      shop.is_frozen && "bg-destructive/5 hover:bg-destructive/10",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Store className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="font-medium">{shop.shop_name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {subscriptionBadge(shop.subscription_status, shop.is_frozen)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-mono", isExpired && !shop.is_frozen && "text-orange-500 font-semibold")}>
                        {fmtDate(shop.paid_until)}
                        {isExpired && !shop.is_frozen && " ⚠"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {shop.member_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn("text-xs font-medium", shop.auto_block ? "text-primary" : "text-muted-foreground")}>
                        {shop.auto_block ? "Вкл" : "Выкл"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => handleImpersonate(shop.shop_id)}
                          disabled={pending}
                          title="Войти в контекст магазина"
                        >
                          <Eye className="h-3 w-3" />
                          Просмотр
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => setEditing(shop)}
                          disabled={pending}
                          title="Редактировать биллинг"
                        >
                          <CalendarDays className="h-3 w-3" />
                          Биллинг
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 gap-1 text-xs",
                            shop.is_frozen
                              ? "text-muted-foreground hover:text-primary"
                              : "text-muted-foreground hover:text-destructive",
                          )}
                          onClick={() => handleFreeze(shop)}
                          disabled={pending}
                          title={shop.is_frozen ? "Разморозить магазин" : "Заморозить магазин"}
                        >
                          {shop.is_frozen ? (
                            <><ShieldCheck className="h-3 w-3" />Разморозить</>
                          ) : (
                            <><ShieldOff className="h-3 w-3" />Заморозить</>
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Карточки — мобильный */}
      <div className="sm:hidden space-y-3">
        {filtered.map((shop) => {
          const isExpired = shop.paid_until && new Date(shop.paid_until) < new Date()
          return (
            <Card
              key={shop.shop_id}
              className={cn(
                "overflow-hidden",
                shop.is_frozen && "border-destructive/40 bg-destructive/5",
              )}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Store className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{shop.shop_name ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{shop.member_count} сотр.</p>
                    </div>
                  </div>
                  {subscriptionBadge(shop.subscription_status, shop.is_frozen)}
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Оплачено до: </span>
                    <span className={cn("font-mono", isExpired && "text-orange-500 font-semibold")}>
                      {fmtDate(shop.paid_until)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Автоблок: </span>
                    <span className={shop.auto_block ? "text-primary font-medium" : "text-muted-foreground"}>
                      {shop.auto_block ? "Вкл" : "Выкл"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 gap-1.5 text-xs bg-transparent"
                    onClick={() => handleImpersonate(shop.shop_id)}
                    disabled={pending}
                  >
                    <Eye className="h-3 w-3" />
                    Просмотр
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 gap-1.5 text-xs bg-transparent"
                    onClick={() => setEditing(shop)}
                    disabled={pending}
                  >
                    <CalendarDays className="h-3 w-3" />
                    Биллинг
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-8 p-0",
                      shop.is_frozen ? "text-muted-foreground hover:text-primary" : "text-muted-foreground hover:text-destructive",
                    )}
                    onClick={() => handleFreeze(shop)}
                    disabled={pending}
                    title={shop.is_frozen ? "Разморозить" : "Заморозить"}
                  >
                    {shop.is_frozen ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Диалог редактирования биллинга */}
      {editingShop && (
        <BillingDialog
          shop={editingShop}
          open={!!editingShop}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
