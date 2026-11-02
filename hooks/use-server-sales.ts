"use client"

import { useEffect, useMemo, useState } from "react"
import type { Sale } from "@/lib/types"
import { getSalesInRange, type ReportProductInfo } from "@/app/actions/sales"

/**
 * На устройстве хранятся только последние 100 чеков, поэтому отчёты и
 * статистика за период читают продажи с сервера. Без сети (или при ошибке)
 * используется локальная история — экран продолжает работать.
 */

type CacheEntry = { at: number; sales: Sale[]; products: ReportProductInfo[] }
const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()
let cacheVersion = 0

if (typeof window !== "undefined") {
  const invalidate = () => {
    cache.clear()
    cacheVersion++
    window.dispatchEvent(new CustomEvent("aura:server_sales_invalidated"))
  }
  window.addEventListener("aura:data_changed", invalidate)
  window.addEventListener("aura:sale_sync_state_changed", invalidate)
}

function toIso(value: number | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const time = value instanceof Date ? value.getTime() : value
  if (!Number.isFinite(time) || time <= 0) return null
  return new Date(time).toISOString()
}

/** Ключ дедупликации: локальный и серверный чек одной операции совпадают по client_op_id. */
function saleKeys(sale: Sale): string[] {
  return sale.client_op_id ? [sale.id, `op:${sale.client_op_id}`] : [sale.id]
}

export function useServerSalesRange(options: {
  from: number | Date | null
  to: number | Date | null
  localSales: Sale[]
  enabled?: boolean
  withProducts?: boolean
  /** Чеки вне периода, которые всё равно нужны (например, для возвратов). */
  includeSaleIds?: string[]
}) {
  const { localSales, enabled = true, withProducts = false } = options
  const includeKey = useMemo(
    () => [...new Set(options.includeSaleIds ?? [])].sort().join(","),
    [options.includeSaleIds],
  )
  const fromIso = toIso(options.from)
  const toIsoValue = toIso(options.to)
  const key = `${fromIso ?? "-"}|${toIsoValue ?? "-"}|${withProducts ? 1 : 0}|${includeKey}`

  const [state, setState] = useState<{ key: string; entry: CacheEntry | null; loading: boolean }>({
    key,
    entry: cache.get(key) ?? null,
    loading: false,
  })
  const [version, setVersion] = useState(cacheVersion)

  useEffect(() => {
    const onInvalidate = () => setVersion(cacheVersion)
    window.addEventListener("aura:server_sales_invalidated", onInvalidate)
    return () => window.removeEventListener("aura:server_sales_invalidated", onInvalidate)
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState({ key, entry: null, loading: false })
      return
    }
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setState({ key, entry: cached, loading: false })
      return
    }

    let cancelled = false
    setState((prev) => ({ key, entry: prev.key === key ? prev.entry : null, loading: true }))
    // Небольшая задержка: быстрые переключения периода не порождают лишних запросов.
    const timer = window.setTimeout(() => {
      getSalesInRange({
        from: fromIso,
        to: toIsoValue,
        withProducts,
        includeSaleIds: includeKey ? includeKey.split(",") : undefined,
      })
        .then((result) => {
          const entry: CacheEntry = { at: Date.now(), sales: result.sales, products: result.products }
          cache.set(key, entry)
          if (!cancelled) setState({ key, entry, loading: false })
        })
        .catch((err) => {
          console.warn("[sales] Server range unavailable, using local history:", err)
          if (!cancelled) setState({ key, entry: null, loading: false })
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, fromIso, toIsoValue, withProducts, includeKey, enabled, version])

  const entry = state.key === key ? state.entry : null

  const sales = useMemo(() => {
    if (!entry) return localSales
    // Серверные чеки + локальные, ещё не попавшие на сервер (офлайн-продажи).
    const seen = new Set<string>()
    for (const sale of entry.sales) for (const k of saleKeys(sale)) seen.add(k)
    const extra = localSales.filter((sale) => !saleKeys(sale).some((k) => seen.has(k)))
    return extra.length ? [...extra, ...entry.sales] : entry.sales
  }, [entry, localSales])

  return {
    sales,
    products: entry?.products ?? [],
    loading: state.loading,
    fromServer: Boolean(entry),
  }
}
