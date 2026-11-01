"use client"

import { Gift } from "lucide-react"
import type { Profile } from "@/lib/types"
import { roleLabel } from "@/lib/format"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export function CabinetProfileCard({ profile, email }: { profile: Profile; email: string }) {
  const initials = (profile.full_name ?? "?").split(" ").filter(Boolean)
    .slice(0, 2).map((part) => part[0]).join("").toUpperCase()
  const points = Number(profile.bonus_points ?? 0)
  const rate = Number(profile.bonus_rate ?? 2)

  return (
    <Card className="min-w-0">
      <CardContent className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 pt-6 sm:grid-cols-[auto_minmax(0,1fr)_minmax(10rem,14rem)]">
        <Avatar className="h-12 w-12 shrink-0 border border-border sm:h-14 sm:w-14">
          <AvatarFallback className="bg-primary/15 text-base text-primary">{initials || "?"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-serif text-lg leading-snug [overflow-wrap:anywhere] sm:text-xl">
            {profile.full_name ?? "Без имени"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere] sm:text-sm">
            {email}
          </div>
          <Badge variant="secondary" className="mt-1.5 max-w-full text-[10px]">{roleLabel(profile.role)}</Badge>
        </div>
        <div className="col-span-2 min-w-0 rounded-xl border border-primary/15 bg-primary/5 p-3 text-left sm:col-span-1 sm:text-right">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:justify-end">
            <Gift className="h-3.5 w-3.5 shrink-0" />
            <span>Бонусные баллы</span>
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold leading-tight tabular-nums text-primary [overflow-wrap:anywhere]">
            {(Number.isFinite(points) ? points : 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            Ставка {Number.isFinite(rate) ? rate : 2}% от прибыли
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
