"use client"

// ─── ScrapAnalysis — оценка лома и потенциальной маржи ──────────────────────

import { Gem } from "lucide-react"
import { formatSom, formatWeight } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Panel } from "../ui/panel"
import { MiniStat } from "../ui/mini-stat"
import { Empty } from "../ui/empty"
import type { PurityRow, PurityTotals } from "../types"

interface ScrapAnalysisProps {
  markup: number
  setMarkup: (v: number) => void
  purityRows: PurityRow[]
  purityTotals: PurityTotals
  setScrapPrice: (purity: string, price: number) => void
}

/**
 * Секция оценки лома: ползунок наценки, суммарный потенциал,
 * детализация по каждой пробе с полем ввода цены за грамм.
 */
export function ScrapAnalysis({
  markup,
  setMarkup,
  purityRows,
  purityTotals,
  setScrapPrice,
}: ScrapAnalysisProps) {
  return (
    <Panel
      title="Лом, пробы и потенциальная маржа"
      subtitle="Оценка текущего остатка витрины"
      icon={Gem}
    >
      {/* Ползунок наценки */}
      <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <label
            htmlFor="markup"
            className="min-w-0 text-xs font-medium text-muted-foreground"
          >
            Наценка на закуп
          </label>
          <span className="shrink-0 font-mono text-sm font-semibold text-primary">
            {markup} %
          </span>
        </div>
        <input
          id="markup"
          type="range"
          min={0}
          max={200}
          step={1}
          value={markup}
          onChange={(e) => setMarkup(Number(e.target.value))}
          className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
        />

        {/* Суммарный потенциал */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <MiniStat
            label="Потенц. выручка"
            value={formatSom(purityTotals.potentialRevenue)}
          />
          <MiniStat
            label="Потенц. прибыль"
            value={formatSom(purityTotals.potentialProfit)}
            tone="success"
          />
          <MiniStat
            label="Потенц. маржа"
            value={`${
              purityTotals.potentialRevenue > 0
                ? (
                    (purityTotals.potentialProfit /
                      purityTotals.potentialRevenue) *
                    100
                  ).toFixed(1)
                : "0.0"
            } %`}
          />
        </div>
      </div>

      {/* Строки по пробам */}
      {purityRows.length === 0 ? (
        <Empty>Нет товаров в остатке</Empty>
      ) : (
        <div className="space-y-2">
          {purityRows.map((r) => (
            <div key={r.purity} className="rounded-xl border border-border p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    Проба {r.purity}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatWeight(r.weight)} · {r.items} шт.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    value={r.scrapPrice}
                    onChange={(e) =>
                      setScrapPrice(r.purity, Number(e.target.value))
                    }
                    className="h-8 w-24 text-right font-mono text-xs"
                    aria-label={`Цена лома за грамм, проба ${r.purity}`}
                  />
                  <span className="text-[11px] text-muted-foreground">с/г</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Закуплено на" value={formatSom(r.cost)} />
                <MiniStat
                  label="Оценка за лом"
                  value={formatSom(r.scrapValue)}
                />
                <MiniStat
                  label="Потенц. выручка"
                  value={formatSom(r.potentialRevenue)}
                />
                <MiniStat
                  label="Потенц. маржа"
                  value={`${r.potentialMargin.toFixed(1)} %`}
                  tone="success"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
