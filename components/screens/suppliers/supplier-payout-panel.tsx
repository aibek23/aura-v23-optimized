"use client"

import { useMemo, useState, useTransition } from "react"
import { ArrowDownToLine, ChevronDown, ChevronUp, History, Plus, WalletCards } from "lucide-react"
import { toast } from "sonner"
import { adjustSupplierDebt, paySupplierDebt, type SupplierDebtData } from "@/app/actions/suppliers"
import type { CashSource } from "@/lib/types"
import { formatSom } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function SupplierPayoutPanel({
  data,
  isAdmin,
}: {
  data: SupplierDebtData
  isAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState("")
  const [amount, setAmount] = useState("")
  const [source, setSource] = useState<CashSource>("cash")
  const [cashPart, setCashPart] = useState("")
  const [electronicPart, setElectronicPart] = useState("")
  const [reason, setReason] = useState("")
  const [adjustment, setAdjustment] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [showJournal, setShowJournal] = useState(false)
  const [pending, startTransition] = useTransition()

  const selected = useMemo(
    () => data.suppliers.find((supplier) => `${supplier.supplier_name}\u0000${supplier.supplier_phone ?? ""}` === selectedKey),
    [data.suppliers, selectedKey],
  )
  const paymentAmount = Number(amount) || 0
  const splitTotal = (Number(cashPart) || 0) + (Number(electronicPart) || 0)
  const canPay = !!selected && paymentAmount > 0 && paymentAmount <= selected.balance + 0.01 &&
    (source !== "mixed" || Math.abs(splitTotal - paymentAmount) < 0.01)

  const chooseSupplier = (key: string) => {
    setSelectedKey(key)
    const supplier = data.suppliers.find((item) => `${item.supplier_name}\u0000${item.supplier_phone ?? ""}` === key)
    setAmount(supplier ? String(Math.round(supplier.balance)) : "")
  }

  const submitPayment = () => {
    if (!selected || !canPay) return
    startTransition(async () => {
      try {
        await paySupplierDebt({
          supplierName: selected.supplier_name,
          supplierPhone: selected.supplier_phone,
          amount: paymentAmount,
          source,
          amountCash: source === "mixed" ? Number(cashPart) || 0 : undefined,
          amountElectronic: source === "mixed" ? Number(electronicPart) || 0 : undefined,
          reason: reason || "Выплата поставщику",
        })
        toast.success("Выплата поставщику проведена")
        window.location.reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось провести выплату")
      }
    })
  }

  const submitAdjustment = () => {
    if (!selected || !(Number(adjustment) > 0) || !adjustmentReason.trim()) return
    startTransition(async () => {
      try {
        await adjustSupplierDebt({
          supplierName: selected.supplier_name,
          supplierPhone: selected.supplier_phone,
          amount: Number(adjustment),
          reason: adjustmentReason,
        })
        toast.success("Изменение долга записано в журнал")
        window.location.reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось изменить долг")
      }
    })
  }

  if (!isAdmin) return null

  return (
    <section className="rounded-2xl border border-[#E5AC4C]/30 bg-[#E5AC4C]/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5AC4C]/15 text-[#B57C1B]">
            <WalletCards className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold">Выплата поставщику</h2>
            <p className="text-xs text-muted-foreground">
              Долг не зависит от остатка товара · {data.suppliers.length} поставщиков
            </p>
          </div>
        </div>
        <Button variant={open ? "secondary" : "default"} onClick={() => setOpen((value) => !value)}>
          <ArrowDownToLine className="mr-1.5 h-4 w-4" />
          {open ? "Скрыть форму" : "Провести выплату"}
        </Button>
      </div>

      {data.suppliers.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
          Пока нет товаров, взятых на реализацию.
        </p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.suppliers.map((supplier) => {
            const key = `${supplier.supplier_name}\u0000${supplier.supplier_phone ?? ""}`
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseSupplier(key)}
                className={cn(
                  "rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/50",
                  selectedKey === key && "border-primary ring-1 ring-primary/20",
                )}
              >
                <div className="truncate text-sm font-medium">{supplier.supplier_name}</div>
                {supplier.supplier_phone && <div className="text-xs text-muted-foreground">{supplier.supplier_phone}</div>}
                <div className="mt-2 font-mono text-lg font-semibold text-[#B57C1B]">{formatSom(supplier.balance)}</div>
                <div className="text-[11px] text-muted-foreground">остаток долга</div>
              </button>
            )
          })}
        </div>
      )}

      {open && selected && (
        <div className="mt-4 grid gap-4 rounded-xl border border-border bg-background p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="text-sm font-semibold">Выплата: {selected.supplier_name}</div>
            <div className="text-xs text-muted-foreground">Доступно к выплате: {formatSom(selected.balance)}</div>
            <div className="grid gap-1.5">
              <Label>Сумма выплаты (с)</Label>
              <Input type="number" min={1} max={selected.balance} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Источник выплаты</Label>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as CashSource)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="cash">Наличные</option>
                <option value="electronic">Электронные</option>
                <option value="mixed">Смешанный</option>
              </select>
            </div>
            {source === "mixed" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5"><Label>Наличные</Label><Input type="number" min={0} value={cashPart} onChange={(event) => setCashPart(event.target.value)} /></div>
                <div className="grid gap-1.5"><Label>Электронные</Label><Input type="number" min={0} value={electronicPart} onChange={(event) => setElectronicPart(event.target.value)} /></div>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Комментарий</Label>
              <Input placeholder="Например: частичная выплата" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            <Button disabled={!canPay || pending} onClick={submitPayment} className="w-full">
              {pending ? "Проведение..." : "Подтвердить выплату"}
            </Button>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Увеличить долг</div>
            <p className="text-xs text-muted-foreground">Только для пересмотра суммы поставщиком. Причина и устройство попадут в журнал.</p>
            <div className="grid gap-1.5">
              <Label>Сумма увеличения (с)</Label>
              <Input type="number" min={1} value={adjustment} onChange={(event) => setAdjustment(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Причина</Label>
              <Input placeholder="Рост цены золота" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
            </div>
            <Button variant="outline" disabled={pending || !(Number(adjustment) > 0) || !adjustmentReason.trim()} onClick={submitAdjustment} className="w-full">
              Записать изменение долга
            </Button>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setShowJournal((value) => !value)} className="mt-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <History className="h-3.5 w-3.5" /> Журнал изменений
        {showJournal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {showJournal && (
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-border bg-background">
          {data.operations.map((operation) => (
            <div key={operation.id} className="grid gap-1 border-b border-border/70 p-3 text-xs last:border-0 sm:grid-cols-[1fr_auto]">
              <div>
                <div className="font-medium">
                  {operation.operation_type === "consignment" ? "Взято на реализацию" : operation.operation_type === "adjustment" ? "Увеличение долга" : "Выплата поставщику"}
                  {" · "}{operation.supplier_name}
                </div>
                <div className="text-muted-foreground">{new Date(operation.created_at).toLocaleString("ru-RU")} · {operation.author_name ?? "—"}</div>
                <div className="text-muted-foreground">{operation.reason}{operation.device_info ? ` · ${operation.device_info}` : ""}</div>
              </div>
              <div className="text-right font-mono">
                <div className={operation.operation_type === "payment" ? "text-emerald-600" : "text-[#B57C1B]"}>
                  {operation.operation_type === "payment" ? "−" : "+"}{formatSom(operation.amount)}
                </div>
                <div className="text-muted-foreground">остаток {formatSom(operation.balance_after)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}