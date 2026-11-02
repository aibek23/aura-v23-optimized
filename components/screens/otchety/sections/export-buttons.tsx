"use client"

// ─── ExportButtons — выгрузка отчётов в Excel (ГНС / управленческий) ───────

import { useState } from "react"
import { FileSpreadsheet, Landmark, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getSalesInRange } from "@/app/actions/sales"
import { getSaleReturnsInRange } from "@/app/actions/returns"
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
  const [busy, setBusy] = useState<{ kind: Kind; phase: "loading" | "building" } | null>(null)

  const run = async (kind: Kind) => {
    if (busy) return
    setBusy({ kind, phase: "loading" })
    try {
      const from = allTime ? null : range.from.getTime()
      const to = allTime ? Date.now() + 60_000 : range.to.getTime()
      // Start loading the large Excel library while the server returns refunds.
      const modPromise = import("@/lib/report-export-xlsx")
      const [refundData, mod] = await Promise.all([
        getSaleReturnsInRange({
          from: from === null ? null : new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        }),
        modPromise,
      ])
      const dataPromise = getSalesInRange({
        from: from === null ? null : new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        withProducts: true,
        includeSaleIds: [...new Set(refundData.returns.map((refund) => refund.sale_id))],
      })
      const [data] = await Promise.all([dataPromise, mod.preloadXlsx()])
      setBusy({ kind, phase: "building" })
      const input = {
        sales: data.sales,
        productInfo: data.products,
        products,
        returns: refundData.returns,
        from,
        to,
      }
      const result =
        kind === "gns"
          ? await mod.exportGnsReport(input)
          : await mod.exportManagerReport({ ...input, scrapPrices })
      if (data.truncated || refundData.truncated) {
        const limits = [
          data.truncated ? "первые 5000 чеков" : "",
          refundData.truncated ? "первые 5000 возвратов" : "",
        ].filter(Boolean)
        toast.warning(`Выгружены ${limits.join(" и ")} периода — сократите период для полной выгрузки`)
      } else {
        toast.success(
          `Файл готов: ${result.sales} позиций продаж, ${result.returns} возвратов, ${result.stock} изделий на складе`,
        )
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
        {busy?.kind === "gns" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
        {busy?.kind === "gns"
          ? busy.phase === "loading"
            ? "Загружаем данные…"
            : "Собираем Excel…"
          : "Экспорт для налоговой (ГНС)"}
      </Button>
      <Button variant="outline" onClick={() => run("manager")} disabled={busy !== null} className="sm:flex-1">
        {busy?.kind === "manager" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        {busy?.kind === "manager"
          ? busy.phase === "loading"
            ? "Загружаем данные…"
            : "Собираем Excel…"
          : "Экспорт (Управленческий)"}
      </Button>
    </div>
  )
}
