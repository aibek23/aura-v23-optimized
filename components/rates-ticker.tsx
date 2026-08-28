"use client"

import { useEffect, useMemo, useState } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"

type Rate = {
  label: string
  value: number
  unit: string
  change: number
}

// Realistic base values for KG market (USD/KGS, metal prices per gram in KGS).
const BASE: Rate[] = [
  { label: "USD", value: 89.4, unit: "с", change: 0.12 },
  { label: "EUR", value: 96.8, unit: "с", change: -0.21 },
  { label: "RUB", value: 0.98, unit: "с", change: 0.03 },
  { label: "Золото 585", value: 5420, unit: "с/г", change: 0.8 },
  { label: "Золото 750", value: 6950, unit: "с/г", change: 1.1 },
  { label: "Серебро 925", value: 82, unit: "с/г", change: -0.4 },
]

function jitter(rate: Rate): Rate {
  const delta = (Math.random() - 0.5) * rate.value * 0.004
  return {
    ...rate,
    value: rate.value + delta,
    change: rate.change + (Math.random() - 0.5) * 0.1,
  }
}

export function RatesTicker() {
  const [rates, setRates] = useState<Rate[]>(BASE)

  useEffect(() => {
    const id = setInterval(() => {
      setRates((prev) => prev.map(jitter))
    }, 4000)
    return () => clearInterval(id)
  }, [])

  const doubled = useMemo(() => [...rates, ...rates], [rates])

  return (
    <div className="relative overflow-hidden border-b border-border bg-card/50">
      <div className="flex w-max animate-[ticker_36s_linear_infinite] gap-8 py-2">
        {doubled.map((r, i) => {
          const up = r.change >= 0
          return (
            <div key={i} className="flex items-center gap-2 whitespace-nowrap px-1 text-xs">
              <span className="font-medium text-muted-foreground">{r.label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {r.value.toLocaleString("ru-RU", { maximumFractionDigits: r.value < 10 ? 2 : 0 })} {r.unit}
              </span>
              <span
                className={`flex items-center gap-0.5 font-mono ${up ? "text-success" : "text-destructive"}`}
              >
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(r.change).toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
      <style jsx>{`
        @keyframes ticker {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  )
}
