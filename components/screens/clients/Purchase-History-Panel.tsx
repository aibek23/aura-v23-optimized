"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Customer, CustomerDebtOperation } from "@/lib/types"
import {
  getClientPurchases,
  getCustomerDebtData,
  payCustomerDebt,
  type ClientPurchase,
} from "@/app/actions/clients"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { User, ShoppingBag, ArrowLeft, Loader2, Wallet } from "lucide-react"
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

function debtOperationLabel(operation: CustomerDebtOperation) {
  if (operation.operation_type === "credit_sale") return "Продажа в долг"
  if (operation.operation_type === "credit_return") return "Возврат уменьшил долг"
  return "Погашение долга"
}

export function PurchaseHistoryPanel({ client, onClose }: { client: Customer; onClose: () => void }) {
  const router = useRouter()
  const [purchases, setPurchases] = useState<ClientPurchase[] | null>(null)
  const [debtOperations, setDebtOperations] = useState<CustomerDebtOperation[]>([])
  const [debtBalance, setDebtBalance] = useState(Number(client.debt_balance) || 0)
  const [debtAvailable, setDebtAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState("")
  const [source, setSource] = useState<"cash" | "electronic">("cash")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const paymentAttempt = useRef<{ signature: string; id: string } | null>(null)

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    Promise.all([getClientPurchases(client.id), getCustomerDebtData(client.id)])
      .then(([purchaseRows, debtData]) => {
        if (!isMounted) return
        setPurchases(purchaseRows)
        setDebtAvailable(debtData.available)
        setDebtBalance(debtData.balance)
        setDebtOperations(debtData.operations)
      })
      .catch(() => {
        if (isMounted) {
          setPurchases([])
          setError("Не удалось загрузить историю клиента")
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [client.id])

  const handlePayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Введите сумму больше нуля")
      return
    }
    if (parsedAmount > debtBalance) {
      setError("Сумма не может быть больше текущего долга")
      return
    }

    const signature = client.id + ":" + parsedAmount.toFixed(2) + ":" + source
    if (!paymentAttempt.current || paymentAttempt.current.signature !== signature) {
      paymentAttempt.current = { signature, id: crypto.randomUUID() }
    }

    setSaving(true)
    setError("")
    try {
      const operation = await payCustomerDebt({
        customerId: client.id,
        amount: parsedAmount,
        source,
        clientOpId: paymentAttempt.current.id,
      })
      setDebtBalance(Number(operation.balance_after) || 0)
      setDebtOperations((current) => [operation, ...current.filter((row) => row.id !== operation.id)])
      setAmount("")
      paymentAttempt.current = null
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось записать платёж")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl px-4 py-8">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
            <button type="button" onClick={onClose} aria-label="Вернуться к списку клиентов" title="Закрыть историю покупок и вернуться к списку клиентов" className="rounded-lg p-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{client.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">История покупок и расчётов</p>
              </div>
            </div>
            {purchases && (
              <Badge variant="secondary" className="ml-auto shrink-0 font-mono">
                {purchases.length} чек{purchases.length === 1 ? "" : purchases.length <= 4 ? "а" : "ов"}
              </Badge>
            )}
          </div>

          <div className="space-y-6 p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Загрузка...</span>
              </div>
            ) : (
              <>
                <section className="space-y-3 rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Wallet className="h-4 w-4 text-primary" /> Долг клиента
                    </div>
                    <span className="font-mono text-lg font-semibold text-primary">{formatSom(debtBalance)}</span>
                  </div>

                  {!debtAvailable ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Учёт долга пока недоступен. Сначала примените SQL-миграцию кредитных продаж.
                    </p>
                  ) : debtBalance > 0 ? (
                    <form onSubmit={handlePayment} className="grid gap-2 sm:grid-cols-[1fr_170px_auto]">
                      <Input
                        type="number"
                        min="0.01"
                        max={debtBalance}
                        step="0.01"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="Сумма погашения"
                        aria-label="Сумма погашения долга"
                      />
                      <select
                        value={source}
                        onChange={(event) => setSource(event.target.value as "cash" | "electronic")}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        aria-label="Способ погашения"
                      >
                        <option value="cash">Наличные</option>
                        <option value="electronic">Перевод / карта</option>
                      </select>
                      <Button type="submit" disabled={saving || !amount}>
                        {saving ? "Сохранение…" : "Принять оплату"}
                      </Button>
                    </form>
                  ) : (
                    <p className="text-xs text-muted-foreground">Задолженности нет.</p>
                  )}

                  {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

                  {debtOperations.length > 0 && (
                    <div className="space-y-2 border-t border-border pt-3">
                      <p className="text-xs font-medium text-muted-foreground">Операции по долгу</p>
                      {debtOperations.slice(0, 8).map((operation) => (
                        <div key={operation.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span>{debtOperationLabel(operation)} · {formatDate(operation.created_at)}</span>
                          <span className="font-mono">
                            {operation.operation_type === "credit_sale" ? "+" : "−"}{formatSom(operation.amount)}
                            <span className="ml-2 text-muted-foreground">остаток {formatSom(operation.balance_after)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Покупки</h3>
                  {!purchases || purchases.length === 0 ? (
                    <div className="py-8 text-center">
                      <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">Покупок пока нет</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {purchases.map((purchase) => (
                        <div key={purchase.id} className="space-y-2 rounded-xl border border-border bg-background px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">{formatDate(purchase.created_at)}</span>
                            <span className="font-mono text-sm font-semibold text-primary">{formatSom(purchase.total)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {purchase.items.map((item, index) => (
                              <span key={index} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {item.sku ? <span className="mr-1 font-mono text-foreground">{item.sku}</span> : null}
                                {item.name}{item.quantity > 1 ? " ×" + item.quantity : ""}
                              </span>
                            ))}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Оплата: {purchase.payment_method === "credit" ? "В долг" : purchase.payment_method === "cash" ? "Наличные" : purchase.payment_method === "electronic" || purchase.payment_method === "transfer" || purchase.payment_method === "card" ? "Перевод / карта" : "Смешанная"}
                            {" · "}<span className="font-mono text-[10px] opacity-60">#{purchase.id.slice(-6).toUpperCase()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
