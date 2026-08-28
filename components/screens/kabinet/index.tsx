"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import type { Profile, Role, Sale } from "@/lib/types"
import { formatSom, roleLabel } from "@/lib/format"
import {
  approveRequest,
  rejectRequest,
  removeMember,
  setDefaultBonusRate,
  setMemberBonusRate,
  resetBonusPoints,
  setBonusPoints,
  touchPresence,
  type CabinetData,
} from "@/app/actions/cabinet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { BadgeCheck, Coins, Gift, RotateCcw, Trash2, UserCheck, UserX, Users, Wifi } from "lucide-react"

const ONLINE_WINDOW_MS = 3 * 60 * 1000

function isOnline(p: Profile) {
  if (!p.last_seen_at) return false
  return Date.now() - new Date(p.last_seen_at).getTime() < ONLINE_WINDOW_MS
}

function initialsOf(name: string | null) {
  return (name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/* ---------------------------------------------------------------- статистика */

type RangeId = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom"

const RANGES: { id: RangeId; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "month", label: "Текущий месяц" },
  { id: "all", label: "За всё время" },
  { id: "custom", label: "Период" },
]

function rangeBounds(id: RangeId, from: string, to: string): [number, number] {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = startOfDay(now)
  const day = 86400000
  switch (id) {
    case "today":
      return [today, today + day]
    case "yesterday":
      return [today - day, today]
    case "7d":
      return [today - 6 * day, today + day]
    case "30d":
      return [today - 29 * day, today + day]
    case "month":
      return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today + day]
    case "custom": {
      const a = from ? new Date(from).getTime() : 0
      const b = to ? new Date(to).getTime() + day : Number.POSITIVE_INFINITY
      return [a, b]
    }
    default:
      return [0, Number.POSITIVE_INFINITY]
  }
}

function SellerStats({ sales, profile }: { sales: Sale[]; profile: Profile }) {
  const [range, setRange] = useState<RangeId>("today")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const mine = useMemo(() => sales.filter((s) => s.seller_id === profile.id), [sales, profile.id])

  const stats = useMemo(() => {
    const [a, b] = rangeBounds(range, from, to)
    const rows = mine.filter((s) => {
      const t = new Date(s.created_at).getTime()
      return t >= a && t < b
    })
    return {
      count: rows.length,
      revenue: rows.reduce((s, r) => s + Number(r.total), 0),
      profit: rows.reduce((s, r) => s + Number(r.profit), 0),
      bonus: rows.reduce((s, r) => s + Number(r.bonus_earned), 0),
    }
  }, [mine, range, from, to])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-primary" />
          Мои продажи
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                range === r.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">С</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">По</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Количество продаж</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{stats.count}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Выручка</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-primary">{formatSom(stats.revenue)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}


/* --------------------------------------------- аналитика по продавцам (админ) */

function TeamSales({
  sales,
  profile,
  team,
  onResetBonus,
  onSetBonus,
  busy,
}: {
  sales: Sale[]
  profile: Profile
  team: Profile[]
  onResetBonus: (id: string, name: string) => void
  onSetBonus: (id: string, points: number) => void
  busy: boolean
}) {
  const [range, setRange] = useState<RangeId>("30d")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  // Администратор обязательно присутствует в списке продавцов.
  const people = useMemo(() => {
    const map = new Map<string, Profile>()
    map.set(profile.id, profile)
    team.forEach((m) => map.set(m.id, m))
    return [...map.values()]
  }, [team, profile])

  const rows = useMemo(() => {
    const [a, b] = rangeBounds(range, from, to)
    const inRange = sales.filter((s) => {
      const t = new Date(s.created_at).getTime()
      return t >= a && t < b
    })

    return people
      .map((p) => {
        const own = inRange.filter((s) => s.seller_id === p.id)
        const units = own.reduce(
          (sum, s) => sum + (s.items ?? []).reduce((n, it) => n + Number(it.quantity || 0), 0),
          0,
        )
        return {
          profile: p,
          revenue: own.reduce((sum, s) => sum + Number(s.total), 0),
          profit: own.reduce((sum, s) => sum + Number(s.profit), 0),
          units,
          receipts: own.length,
          bonus: Number(p.bonus_points ?? 0),
        }
      })
      .sort((x, y) => y.revenue - x.revenue)
  }, [people, sales, range, from, to])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-primary" />
          Продажи по сотрудникам
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                range === r.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">С</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">По</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
            </div>
          </div>
        )}

        <div className="space-y-1">
          {rows.map((r) => (
            <div
              key={r.profile.id}
              className="flex flex-wrap items-center gap-3 border-b border-border/60 py-3 last:border-0"
            >
              <Avatar className="h-9 w-9 border border-border">
                <AvatarFallback className="bg-primary/15 text-xs text-primary">
                  {initialsOf(r.profile.full_name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.profile.full_name ?? "Без имени"}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {roleLabel(r.profile.role)}
                  </Badge>
                  {r.profile.id === profile.id && (
                    <span className="text-[10px] text-muted-foreground">это вы</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  чеков: {r.receipts} · штук: {r.units} · прибыль {formatSom(r.profit)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Выручка</div>
                <div className="font-mono text-sm font-semibold text-primary">{formatSom(r.revenue)}</div>
              </div>

              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Бонусы</div>
                <div className="font-mono text-sm font-semibold">{r.bonus.toFixed(0)}</div>
              </div>

              <BonusPointsEditor
                member={r.profile}
                busy={busy}
                onSetBonus={onSetBonus}
                onResetBonus={onResetBonus}
              />
            </div>
          ))}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Нет данных</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------- виджеты */

/** Обновление баллов сотрудника — доступно админам и супер-админам. */
function BonusPointsEditor({
  member,
  busy,
  onSetBonus,
  onResetBonus,
}: {
  member: Profile
  busy: boolean
  onSetBonus: (id: string, points: number) => void
  onResetBonus: (id: string, name: string) => void
}) {
  const [points, setPoints] = useState(String(Number(member.bonus_points ?? 0).toFixed(0)))

  useEffect(() => {
    setPoints(String(Number(member.bonus_points ?? 0).toFixed(0)))
  }, [member.bonus_points])

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        value={points}
        onChange={(e) => setPoints(e.target.value)}
        className="h-8 w-20"
        aria-label="Бонусные баллы"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 bg-transparent"
        disabled={busy}
        onClick={() => onSetBonus(member.id, Number(points))}
      >
        Обновить
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        title="Обнулить баллы"
        disabled={busy}
        onClick={() => onResetBonus(member.id, member.full_name ?? "сотрудника")}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function MemberRow({
  member,
  canEditRate,
  canDelete,
  onDelete,
  onRate,
  busy,
}: {
  member: Profile
  canEditRate: boolean
  canDelete: boolean
  onDelete: (id: string) => void
  onRate: (id: string, rate: number) => void
  busy: boolean
}) {
  const [rate, setRate] = useState(String(member.bonus_rate ?? 2))
  const online = isOnline(member)

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 py-3 last:border-0">
      <div className="relative">
        <Avatar className="h-9 w-9 border border-border">
          <AvatarFallback className="bg-primary/15 text-xs text-primary">{initialsOf(member.full_name)}</AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{member.full_name ?? "Без имени"}</span>
          <Badge variant="secondary" className="text-[10px]">
            {roleLabel(member.role)}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {online ? "Онлайн" : "Не в сети"} · бонусы: {Number(member.bonus_points ?? 0).toFixed(0)}
        </div>
      </div>

      {canEditRate && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            max={100}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="h-8 w-16"
            aria-label="Процент бонусов"
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button size="sm" variant="outline" className="h-8 bg-transparent" disabled={busy} onClick={() => onRate(member.id, Number(rate))}>
            Сохранить
          </Button>
        </div>
      )}

      {canDelete && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          disabled={busy}
          aria-label="Удалить сотрудника"
          onClick={() => {
            if (confirm(`Удалить ${member.full_name ?? "сотрудника"} из системы?`)) onDelete(member.id)
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------- экран */

export function KabinetScreen({
  profile,
  viewRole,
  sales,
  data,
  email,
}: {
  profile: Profile
  viewRole: Role
  sales: Sale[]
  data: CabinetData
  email: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [defaultRate, setDefaultRate] = useState(String(data.defaultBonusRate))

  const isSuper = viewRole === "super_admin"
  const isAdmin = viewRole === "admin" || isSuper

  // Отметка присутствия для виджета «онлайн».
  useEffect(() => {
    void touchPresence()
    const id = setInterval(() => void touchPresence(), 60_000)
    return () => clearInterval(id)
  }, [])

  const run = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        await fn()
        toast.success(ok)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка")
      }
    })

  const admins = data.team.filter((p) => p.role === "admin")
  const sellers = data.team.filter((p) => p.role === "seller")
  const onlineCount = data.team.filter(isOnline).length + 1 // включая текущего пользователя
  const adminRequests = data.requests.filter((p) => p.requested_role === "admin")
  const otherRequests = data.requests.filter((p) => p.requested_role !== "admin")

  return (
    <div className="space-y-6">
      {/* Профиль */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Avatar className="h-14 w-14 border border-border">
            <AvatarFallback className="bg-primary/15 text-base text-primary">
              {initialsOf(profile.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="font-serif text-xl">{profile.full_name ?? "Без имени"}</div>
            <div className="truncate text-sm text-muted-foreground">{email}</div>
            <Badge variant="secondary" className="mt-1 text-[10px]">
              {roleLabel(profile.role)}
            </Badge>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <Gift className="h-3.5 w-3.5" /> Бонусные баллы
            </div>
            <div className="font-mono text-2xl font-semibold text-primary">
              {Number(profile.bonus_points ?? 0).toFixed(0)}
            </div>
            <div className="text-[11px] text-muted-foreground">ставка {Number(profile.bonus_rate ?? 2)}% от прибыли</div>
          </div>
        </CardContent>
      </Card>

      {/* Продавец: статистика продаж */}
      {!isAdmin && <SellerStats sales={sales} profile={profile} />}

      {isAdmin && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <Wifi className="h-5 w-5 text-success" />
              <div>
                <div className="text-xs text-muted-foreground">Сейчас онлайн</div>
                <div className="font-mono text-2xl font-semibold">{onlineCount}</div>
              </div>
            </CardContent>
          </Card>
          {isSuper && (
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <BadgeCheck className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">Администраторы</div>
                  <div className="font-mono text-2xl font-semibold">{admins.length}</div>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <div className="text-xs text-muted-foreground">{isSuper ? "Сотрудники" : "Мои продавцы"}</div>
                <div className="font-mono text-2xl font-semibold">{sellers.length}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isAdmin && (
        <TeamSales
          sales={sales}
          profile={profile}
          team={data.team}
          busy={pending}
          onResetBonus={(id, name) => {
            if (confirm(`Обнулить бонусы: ${name}?`)) run(() => resetBonusPoints(id), "Бонусы обнулены")
          }}
          onSetBonus={(id, points) => run(() => setBonusPoints(id, points), "Баллы обновлены")}
        />
      )}

      {/* Супер-админ: заявки */}
      {isSuper && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Заявки на доступ</CardTitle>
          </CardHeader>
          <CardContent>
            {data.requests.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Новых заявок нет</p>
            ) : (
              <div className="space-y-1">
                {[...adminRequests, ...otherRequests].map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.full_name ?? "Без имени"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.requested_role === "admin" ? "Заявка на Админа" : "Заявка на Продавца"} · {r.phone ?? "—"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => approveRequest(r.id, r.requested_role === "admin" ? "admin" : "seller"),
                            "Заявка одобрена",
                          )
                        }
                      >
                        <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                        {r.requested_role === "admin" ? "Сделать админом" : "Одобрить"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-transparent text-destructive"
                        disabled={pending}
                        onClick={() => run(() => rejectRequest(r.id), "Заявка отклонена")}
                      >
                        <UserX className="mr-1.5 h-3.5 w-3.5" />
                        Отклонить
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Супер-админ: общий процент бонусов */}
      {isSuper && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Бонусные баллы по магазину</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Процент от прибыли с продаж</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={defaultRate}
                onChange={(e) => setDefaultRate(e.target.value)}
                className="h-9 w-28"
              />
            </div>
            <Button
              disabled={pending}
              onClick={() => run(() => setDefaultBonusRate(Number(defaultRate)), "Процент бонусов обновлён")}
            >
              Сохранить
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Применяется ко всем сотрудникам, у которых не задан персональный процент.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Управление персоналом */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isSuper ? "Персонал магазина" : "Мои продавцы"} · {data.team.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.team.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Сотрудников пока нет</p>
            ) : (
              <div>
                {[...admins, ...sellers].map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    busy={pending}
                    canEditRate={isSuper || m.role === "seller"}
                    canDelete={isSuper || m.role === "seller"}
                    onDelete={(id) => run(() => removeMember(id), "Сотрудник удалён")}
                    onRate={(id, rate) => run(() => setMemberBonusRate(id, rate), "Процент бонусов обновлён")}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
