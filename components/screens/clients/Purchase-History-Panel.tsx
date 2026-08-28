"use client"

import { useEffect, useState } from "react"
import type { Customer } from "@/lib/types"
import { getClientPurchases, type ClientPurchase } from "@/app/actions/clients"
import { Badge } from "@/components/ui/badge"
import {
  User,
  ShoppingBag,
  ArrowLeft,
  Loader2,
} from "lucide-react"
import { formatSom } from "@/lib/format"

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ru", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

export function PurchaseHistoryPanel({ client, onClose }: { client: Customer; onClose: () => void }) {
  const [purchases, setPurchases] = useState<ClientPurchase[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    
    getClientPurchases(client.id)
      .then((data) => {
        if (isMounted) setPurchases(data)
      })
      .catch(() => {
        if (isMounted) setPurchases([])
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [client.id])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl px-4 py-8">
        <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4 bg-muted/30">
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{client.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">История покупок</p>
              </div>
            </div>
            {purchases && (
              <Badge variant="secondary" className="ml-auto shrink-0 font-mono">
                {purchases.length} чек{purchases.length === 1 ? "" : purchases.length <= 4 ? "а" : "ов"}
              </Badge>
            )}
          </div>

          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Загрузка...</span>
              </div>
            ) : !purchases || purchases.length === 0 ? (
              <div className="py-16 text-center">
                <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Покупок пока нет</p>
              </div>
            ) : (
              <div className="space-y-3">
                {purchases.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border bg-background px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(p.created_at)}</span>
                      <span className="font-mono font-semibold text-sm text-primary">{formatSom(p.total)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(p.items as ClientPurchase["items"]).map((item, i) => (
                        <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {item.sku ? <span className="font-mono mr-1 text-foreground">{item.sku}</span> : null}
                          {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Оплата: {p.payment_method === "cash" ? "Наличные" : p.payment_method === "electronic" ? "Перевод" : "Смешанная"}
                      {" · "}
                      <span className="font-mono text-[10px] opacity-60">#{p.id.slice(-6).toUpperCase()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}