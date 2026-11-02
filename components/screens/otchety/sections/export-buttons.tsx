"use client"

// ─── ExportButtons — выгрузка отчётов в Excel (ГНС / управленческий) ───────

import { useState } from "react"
import { FileSpreadsheet, Landmark, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getSalesInRange } from "@/app/actions/sales"
import type { Product } from "@/lib/types"
import type { DateRange } from "../types"

type Kind = "gns" | "manager"

export function ExportButtons({
  range,
  allTime,
  products,
  scrapPrices,
}: {
  range: DateRange
  allTime: boolean
  products: Product[]
  scrapPrices: Record<string, number>
}) {
  const [busy, setBusy] = useState<Kind | null>(null)

  const run = async (kind: Kind) => {
    if (busy) return
    setBusy(kind)
    try {
      const from = allTime ? null : range.from.getTime()
      const to = allTime ? Date.now() + 60_000 : range.to.getTime()
      // Чеки за период всегда читаются с сервера: на устройстве их только часть.
      const data = await getSalesInRange({
        from: from === null ? null : new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        withProducts: true,
      })
      const mod = await import("@/lib/report-export-xlsx")
      const input = { sales: data.sales, productInfo: data.products, products, from, to }
      const result =
        kind === "gns"
          ? await mod.exportGnsReport(input)
          : await mod.exportManagerReport({ ...input, scrapPrices })
      if (data.truncated) {
        toast.warning("Выгружены первые 5000 чеков периода — сократите период для полной выгрузки")
      } else {
        toast.success(`Файл готов: ${result.sales} позиций продаж, ${result.stock} изделий на складе`)
      }
    } catch (error) {
      toast.error(
        `Не удалось сформировать файл: ${error instanceof Error ? error.message : "проверьте подключение к интернету"}`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button variant="outline" onClick={() => run("gns")} disabled={busy !== null} className="sm:flex-1">
        {busy === "gns" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
        Экспорт для налоговой (ГНС)
      </Button>
      <Button variant="outline" onClick={() => run("manager")} disabled={busy !== null} className="sm:flex-1">
        {busy === "manager" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Экспорт (Управленческий)
      </Button>
    </div>
  )
}
