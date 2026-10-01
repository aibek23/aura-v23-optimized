"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, History, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { getActionHistory, undoAction } from "@/app/actions/action-history"
import { ACTION_HISTORY_LIMIT, isRemovalEntity, requiresAdminUndo, type ActionHistoryItem, type UndoActionResult } from "@/lib/action-history"
import { getOutboxPendingCount } from "@/lib/local-db/outbox"
import { getLocalDB } from "@/lib/local-db/db"
import { captureUndoBaseline, type UndoLocalBaseline } from "@/lib/local-db/undo-cache"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value))
}

export function ActionHistory({
  syncLocal = true,
  canUndoRates = false,
  onActionUndone,
}: {
  syncLocal?: boolean
  canUndoRates?: boolean
  onActionUndone?: (result: UndoActionResult, baseline: UndoLocalBaseline) => Promise<boolean>
}) {
  const router = useRouter()
  const [rows, setRows] = useState<ActionHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [selected, setSelected] = useState<ActionHistoryItem | null>(null)
  const [saving, setSaving] = useState(false)
  const requestId = useRef(0)
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      if (!navigator.onLine) throw new Error("Для загрузки истории нужен интернет.")
      const history = await getActionHistory()
      if (id === requestId.current) setRows(history)
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "Не удалось загрузить историю")
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOnline(navigator.onLine)
    void load()
    const connected = () => {
      setOnline(true)
      if (!savingRef.current) void load()
    }
    const disconnected = () => setOnline(false)
    window.addEventListener("online", connected)
    window.addEventListener("offline", disconnected)
    return () => {
      ++requestId.current
      window.removeEventListener("online", connected)
      window.removeEventListener("offline", disconnected)
    }
  }, [load])

  const undo = async () => {
    if (!selected || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      if (!navigator.onLine) throw new Error("Для отмены нужен интернет.")
      // An old queued edit must not replay over a successful server undo.
      if (syncLocal && await getOutboxPendingCount(selected.shop_id) > 0) {
        throw new Error("Сначала дождитесь синхронизации локальных изменений, затем повторите отмену.")
      }
      const baseline = syncLocal
        ? await captureUndoBaseline(await getLocalDB(), selected)
        : null
      const result = await undoAction(selected.id)
      setRows((prev) => prev.map((row) => row.id === selected.id
        ? { ...row, status: "undone", undone_at: new Date().toISOString() }
        : row))
      setSelected(null)
      toast.success(isRemovalEntity(selected.entity_type) ? "Действие отменено. Запись удалена, остатки и касса пересчитаны." : "Действие отменено. Предыдущие значения восстановлены.")
      if (baseline && onActionUndone) {
        try {
          if (!await onActionUndone(result, baseline)) {
            toast.warning("Отмена сохранена на сервере. Более новые локальные изменения не перезаписаны — дождитесь синхронизации.")
          }
        } catch {
          toast.warning("Отмена сохранена на сервере, но локальный кэш не обновился. Обновите приложение после синхронизации.")
        }
      }
      router.refresh()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отменить действие")
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> История действий
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Последние {ACTION_HISTORY_LIMIT} действий магазина: товары, цены, продажи и касса · время Бишкека
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={loading || saving || !online} onClick={() => void load()}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Обновить
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">
            Офлайн-действия появляются после синхронизации. Можно отменить правку карточки или курса,
            добавление товара, продажу (товары вернутся на склад, деньги уйдут из кассы) и кассовую операцию.
          </p>
          {!online && (
            <p role="status" className="mb-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              Нет подключения. Отмена доступна только онлайн.
            </p>
          )}
          {error && <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-border" aria-busy={loading}>
            <Table className="min-w-[660px]">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-3">Время</TableHead>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Описание действия</TableHead>
                  <TableHead className="px-3">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
                      {loading ? "Загрузка истории…" : error ? "История недоступна" : "Изменений пока нет"}
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id} className={row.status === "undone" ? "bg-muted/20" : undefined}>
                    <TableCell className="px-3 align-top font-mono text-xs">
                      <time dateTime={row.created_at}>{formatTime(row.created_at)}</time>
                    </TableCell>
                    <TableCell className="max-w-40 whitespace-normal align-top">{row.employee_name}</TableCell>
                    <TableCell className="min-w-64 max-w-lg whitespace-normal align-top">
                      {row.description}
                    </TableCell>
                    <TableCell className="px-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className={row.status === "undone" ? "text-muted-foreground" : "bg-primary/10 text-primary"}>
                          {row.status === "undone" ? <><CheckCircle2 className="mr-1 h-3 w-3" />Отменено</> : "Выполнено"}
                        </Badge>
                        {row.status === "active" && (
                          <Button variant="outline" size="xs"
                            disabled={saving || loading || !online || (requiresAdminUndo(row.entity_type) && !canUndoRates)}
                            title={requiresAdminUndo(row.entity_type) && !canUndoRates ? "Это действие может отменить только администратор" : undefined}
                            aria-label={`Отменить: ${row.description}`}
                            onClick={() => setSelected(row)}>
                            <RotateCcw /> Отменить
                          </Button>
                        )}
                      </div>
                      {row.undone_at && <div className="mt-1 text-[10px] text-muted-foreground">{formatTime(row.undone_at)}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {rows.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Записей: {rows.length} / {ACTION_HISTORY_LIMIT}</p>}
        </CardContent>
      </Card>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !savingRef.current) setSelected(null) }}>
        <DialogContent showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>Отменить действие?</DialogTitle>
            <DialogDescription>
              {selected?.description}.{" "}
              {selected?.entity_type === "product_create" && "Товар будет удалён со склада. Если он уже продан или взят на реализацию, отмена будет отклонена."}
              {selected?.entity_type === "sale" && "Чек будет аннулирован: товары вернутся на склад, сумма уйдёт из кассы, статистика клиента и бонусы продавца откатятся. Если по чеку был возврат, отмена будет отклонена."}
              {selected?.entity_type === "cash_operation" && "Кассовая операция будет аннулирована, остаток кассы пересчитается."}
              {selected && !isRemovalEntity(selected.entity_type) && "Будут восстановлены предыдущие значения изменённых полей. Если эти поля уже исправляли позже, отмена будет отклонена."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setSelected(null)}>Не отменять</Button>
            <Button disabled={saving || !online} onClick={() => void undo()}>
              {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {saving ? "Восстановление…" : "Отменить действие"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}