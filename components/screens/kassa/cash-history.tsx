"use client"

import { useEffect, useMemo, useState } from "react"
import type { CashOperation } from "@/lib/types"
import { formatDateTime, formatSom } from "@/lib/format"
import { inPeriod, type PeriodId, periodRange } from "@/lib/period"
import { operationSplit } from "@/lib/cash"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PER_PAGE = 10

const SOURCE_LABEL: Record<string, string> = {
  cash: "наличные",
  electronic: "электронные",
  mixed: "смешанно",
}

/** История операций кассы с фильтрами периода/сотрудника и постраничной навигацией. */
export function CashHistory({
  operations,
  period,
  authors,
}: {
  operations: CashOperation[]
  period: PeriodId
  authors: { id: string; name: string }[]
}) {
  const [author, setAuthor] = useState("all")
  const [page, setPage] = useState(1)

  const range = useMemo(() => periodRange(period), [period])

  const filtered = useMemo(
    () =>
      operations.filter(
        (o) => inPeriod(o.created_at, range) && (author === "all" || o.created_by === author),
      ),
    [operations, range, author],
  )

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))

  // Смена фильтров не должна оставлять пользователя на несуществующей странице.
  useEffect(() => {
    setPage(1)
  }, [period, author, operations.length])

  const current = Math.min(page, pages)
  const rows = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-sm font-medium">История операций кассы</span>
        <div className="flex items-center gap-2">
          <select
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
          >
            <option value="all">Все сотрудники</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">{filtered.length} оп.</span>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">Операций за период нет</div>
        )}
        {rows.map((o) => {
          const isIncome = o.type === "income"
          const isCollection = o.type === "collection"
          const split = operationSplit(o)
          return (
            <div key={o.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      isIncome
                        ? "bg-success/15 text-success"
                        : isCollection
                          ? "bg-[#E5AC4C]/15 text-[#E5AC4C]"
                          : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {isIncome ? "Внесение" : isCollection ? "Инкассация" : "Изъятие"}
                  </span>
                  <span className="line-clamp-2 text-sm">{o.reason}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(o.created_at)} · {o.author_name ?? "—"} ·{" "}
                  {SOURCE_LABEL[o.source ?? "cash"] ?? "наличные"}
                  {o.source === "mixed" && ` (${formatSom(split.cash)} + ${formatSom(split.electronic)})`}
                  {isCollection && " → электронные"}
                </div>
              </div>
              <div
                className={cn(
                  "shrink-0 font-mono text-sm font-semibold",
                  isIncome ? "text-success" : isCollection ? "text-[#E5AC4C]" : "text-destructive",
                )}
              >
                {isIncome ? "+" : isCollection ? "⇄ " : "−"}
                {formatSom(Number(o.amount))}
              </div>
            </div>
          )
        })}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-1 border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, current - 1))}
            disabled={current === 1}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Назад
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1)
            .map((n, idx, arr) => (
              <span key={n} className="flex items-center">
                {idx > 0 && arr[idx - 1] !== n - 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
                <button
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "h-8 min-w-8 rounded-lg border px-2 text-xs",
                    n === current
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              </span>
            ))}
          <button
            type="button"
            onClick={() => setPage(Math.min(pages, current + 1))}
            disabled={current === pages}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-40"
          >
            Вперёд
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
