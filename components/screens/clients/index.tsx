"use client"

import { useMemo, useState, useTransition } from "react"
import type { Customer } from "@/lib/types"
import { createClient_, updateClient, deleteClient, getClientPurchases, setClientBlacklist, type ClientPurchase } from "@/app/actions/clients"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Phone,
  Mail,
  MessageCircle,
  Camera,
  User,
  Users,
  ChevronLeft,
  ChevronRight,
  History,
  ShieldOff,
  ShieldCheck,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {PurchaseHistoryPanel} from "@/components/screens/clients/Purchase-History-Panel"

const PAGE_SIZE = 20

const GENDER_OPTIONS = [
  { value: "female", label: "Женский" },
  { value: "male", label: "Мужской" },
  { value: "other", label: "Другой" },
]

type ClientForm = {
  name: string
  phone: string
  gender: string
  whatsapp: string
  instagram: string
  email: string
}

const EMPTY_FORM: ClientForm = {
  name: "",
  phone: "",
  gender: "",
  whatsapp: "",
  instagram: "",
  email: "",
}

function toForm(c: Customer): ClientForm {
  return {
    name: c.name ?? "",
    phone: c.phone ?? "",
    gender: c.gender ?? "",
    whatsapp: c.whatsapp ?? "",
    instagram: c.instagram ?? "",
    email: c.email ?? "",
  }
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ru", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

// Подкомпонент панели истории покупок клиента


// Главный компонент экрана клиентов
export function ClientsScreen({ clients }: { clients: Customer[] }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [genderFilter, setGenderFilter] = useState<string>("all")
  const [blacklistFilter, setBlacklistFilter] = useState<"all" | "blacklisted">("all")
  const [page, setPage] = useState(1)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [historyClient, setHistoryClient] = useState<Customer | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return clients.filter((c) => {
      const matchQuery =
        !q ||
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.whatsapp ?? "").includes(q) ||
        (c.instagram ?? "").toLowerCase().includes(q)
      const matchGender = genderFilter === "all" || (c.gender ?? "") === genderFilter
      const matchBlacklist = blacklistFilter === "all" || c.is_blacklisted === true
      return matchQuery && matchGender && matchBlacklist
    })
  }, [clients, query, genderFilter, blacklistFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  const openEdit = (c: Customer) => { setEditing(c); setForm(toForm(c)); setDialogOpen(true) }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Укажите имя клиента"); return }
    setSaving(true)
    try {
      const input = {
        name: form.name,
        phone: form.phone || null,
        gender: form.gender || null,
        whatsapp: form.whatsapp || null,
        instagram: form.instagram || null,
        email: form.email || null,
      }
      if (editing) {
        await updateClient(editing.id, input)
        toast.success("Данные клиента обновлены")
      } else {
        await createClient_(input)
        toast.success("Клиент добавлен")
      }
      setDialogOpen(false)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: Customer) => {
    if (!confirm(`Удалить клиента «${c.name ?? "—"}»?`)) return
    try {
      await deleteClient(c.id)
      toast.success("Клиент удалён")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleToggleBlacklist = (c: Customer) => {
    startTransition(async () => {
      try {
        await setClientBlacklist(c.id, !c.is_blacklisted)
        toast.success(c.is_blacklisted ? `«${c.name}» удалён из чёрного списка` : `«${c.name}» добавлен в чёрный список`)
        router.refresh()
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  }

  const setField = (field: keyof ClientForm, value: string) =>
    setForm((prev: ClientForm) => ({ ...prev, [field]: value }))

  return (
    <div className="min-w-0">
      {historyClient && (
        <PurchaseHistoryPanel client={historyClient} onClose={() => setHistoryClient(null)} />
      )}

      {/* Заголовок */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl">Клиенты</h1>
          <p className="text-sm text-muted-foreground">
            Клиентская база магазина · {clients.length} клиент{clients.length === 1 ? "" : clients.length <= 4 ? "а" : "ов"}
          </p>
        </div>
        <Button onClick={openAdd} className="gap-1.5 w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Добавить клиента
        </Button>
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени, телефону, email..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { value: "all", label: "Все" },
            ...GENDER_OPTIONS,
          ].map((g) => (
            <button
              key={g.value}
              onClick={() => { setGenderFilter(g.value); setPage(1) }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                genderFilter === g.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
          <button
            onClick={() => { setBlacklistFilter(blacklistFilter === "all" ? "blacklisted" : "all"); setPage(1) }}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
              blacklistFilter === "blacklisted"
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldOff className="inline h-3 w-3 mr-1 -mt-0.5" />
            Чёрный список
          </button>
        </div>
      </div>

      {/* Список клиентов */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Клиенты не найдены</p>
        </div>
      ) : (
        <>
          {/* Десктоп таблица */}
          <div className="hidden sm:block overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Имя</th>
                  <th className="px-4 py-3 text-left font-medium">Пол</th>
                  <th className="px-4 py-3 text-left font-medium">Телефон</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-right font-medium">Покупки</th>
                  <th className="px-4 py-3 text-right font-medium">Бонусы</th>
                  <th className="w-[1%] px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((c) => (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors",
                      c.is_blacklisted && "bg-destructive/5 hover:bg-destructive/10",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name ?? "—"}</span>
                        {c.is_blacklisted && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">ЧС</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {GENDER_OPTIONS.find((g) => g.value === c.gender)?.label ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.email ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {(c.purchase_count ?? 0) > 0 ? (
                        <button
                          onClick={() => setHistoryClient(c)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          <History className="h-3 w-3" />
                          {c.purchase_count}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.bonus_points > 0 ? (
                        <Badge variant="secondary" className="font-mono text-xs">{c.bonus_points}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {(c.purchase_count ?? 0) > 0 && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            title="История покупок"
                            onClick={() => setHistoryClient(c)}
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon"
                          className={cn("h-8 w-8", c.is_blacklisted ? "text-destructive hover:text-foreground" : "text-muted-foreground hover:text-destructive")}
                          title={c.is_blacklisted ? "Убрать из чёрного списка" : "Добавить в чёрный список"}
                          onClick={() => handleToggleBlacklist(c)}
                          disabled={isPending}
                        >
                          {c.is_blacklisted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          title="Редактировать"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="Удалить"
                          onClick={() => handleDelete(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Мобильный список карточек */}
          <div className="sm:hidden space-y-2">
            {paginated.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-xl border border-border bg-card p-3 space-y-2",
                  c.is_blacklisted && "border-destructive/40 bg-destructive/5",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      c.is_blacklisted ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                    )}>
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm truncate">{c.name ?? "—"}</p>
                        {c.is_blacklisted && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">ЧС</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {GENDER_OPTIONS.find((g) => g.value === c.gender)?.label ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {c.bonus_points > 0 && (
                      <Badge variant="secondary" className="font-mono text-xs">{c.bonus_points} бон.</Badge>
                    )}
                    {(c.purchase_count ?? 0) > 0 && (
                      <span className="text-[10px] font-semibold text-primary font-mono">{c.purchase_count} покупок</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {c.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /><span className="font-mono">{c.phone}</span>
                    </span>
                  )}
                  {c.whatsapp && (
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /><span className="font-mono">{c.whatsapp}</span>
                    </span>
                  )}
                  {c.instagram && (
                    <span className="flex items-center gap-1">
                      <Camera className="h-3 w-3" />{c.instagram}
                    </span>
                  )}
                  {c.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />{c.email}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 pt-1 border-t border-border/60">
                  {(c.purchase_count ?? 0) > 0 && (
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-primary" onClick={() => setHistoryClient(c)}>
                      <History className="h-3.5 w-3.5" />История
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm"
                    className={cn("h-8 gap-1.5 text-xs", c.is_blacklisted ? "text-destructive hover:text-foreground" : "text-muted-foreground hover:text-destructive")}
                    onClick={() => handleToggleBlacklist(c)}
                    disabled={isPending}
                  >
                    {c.is_blacklisted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                    {c.is_blacklisted ? "Из ЧС" : "В ЧС"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-primary" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" />Изменить
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive ml-auto" onClick={() => handleDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5" />Удалить
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {filtered.length} клиентов · стр. {currentPage}/{totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
                  .map((n, idx, arr) => (
                    <span key={n} className="flex items-center">
                      {idx > 0 && arr[idx - 1] !== n - 1 && (
                        <span className="px-1 text-xs text-muted-foreground">…</span>
                      )}
                      <Button variant={n === currentPage ? "default" : "outline"} size="icon" className="h-8 w-8 text-xs" onClick={() => setPage(n)}>
                        {n}
                      </Button>
                    </span>
                  ))}
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages} onClick={() => setPage(Math.min(totalPages, currentPage + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Диалог добавления / редактирования */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md w-full max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать клиента" : "Новый клиент"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Имя <span className="text-destructive">*</span></Label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Имя клиента" value={form.name} onChange={(e) => setField("name", e.target.value)} className="pl-8" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Пол</Label>
              <Select value={form.gender} onValueChange={(v) => setField("gender", v ?? "")}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Выберите пол" /></SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Телефон</Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="+996 700 000000" value={form.phone} onChange={(e) => setField("phone", e.target.value)} className="pl-8 font-mono" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">WhatsApp</Label>
              <div className="relative">
                <MessageCircle className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="+996 700 000000" value={form.whatsapp} onChange={(e) => setField("whatsapp", e.target.value)} className="pl-8 font-mono" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Instagram</Label>
              <div className="relative">
                <Camera className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="@username" value={form.instagram} onChange={(e) => setField("instagram", e.target.value)} className="pl-8" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Email</Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="email" placeholder="email@example.com" value={form.email} onChange={(e) => setField("email", e.target.value)} className="pl-8" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)} disabled={saving}>Отмена</Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Сохранение...</> : editing ? "Сохранить" : "Добавить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}