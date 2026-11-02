"use client"

import { useEffect, useMemo, useState } from "react"
import {
  getDailySalesSummary,
  type DailySalesSummaryRow,
} from "@/app/actions/sales"

type Entry = { at: number; rows: DailySalesSummaryRow[] }
const CACHE_TTL_MS = 60_000
const cache = new Map<string, Entry>()
let cacheVersion = 0

if (typeof window !== "undefined") {
  const invalidate = () => {
    cache.clear()
    cacheVersion++
    window.dispatchEvent(new CustomEvent("aura:daily_summary_invalidated"))
  }
  window.addEventListener("aura:data_changed", invalidate)
  window.addEventListener("aura:sale_sync_state_changed", invalidate)
}

function toIso(value: number | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const time = value instanceof Date ? value.getTime() : value
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function useServerDailySummary(options: {
  from: number | Date | null
  to: number | Date | null
  allTime?: boolean
  enabled?: boolean
}) {
  const from = toIso(options.from)
  const to = toIso(options.to)
  const allTime = options.allTime ?? false
  const key = `${allTime ? "all" : from ?? "-"}|${to ?? "-"}`
  const enabled = options.enabled ?? true
  const [state, setState] = useState<{
    key: string
    rows: DailySalesSummaryRow[] | null
    loading: boolean
    error: string | null
  }>({ key, rows: cache.get(key)?.rows ?? null, loading: false, error: null })
  const [version, setVersion] = useState(cacheVersion)

  useEffect(() => {
    const onInvalidate = () => setVersion(cacheVersion)
    window.addEventListener("aura:daily_summary_invalidated", onInvalidate)
    return () => window.removeEventListener("aura:daily_summary_invalidated", onInvalidate)
  }, [])

  useEffect(() => {
    if (!enabled || (!from && !allTime) || !to) return
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setState({ key, rows: cached.rows, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((previous) => ({
      key,
      rows: previous.key === key ? previous.rows : null,
      loading: true,
      error: null,
    }))
    getDailySalesSummary({ from, to, allTime })
      .then((rows) => {
        cache.set(key, { at: Date.now(), rows })
        if (!cancelled) setState({ key, rows, loading: false, error: null })
      })
      .catch((error) => {
        console.warn("[sales] Daily summary unavailable:", error)
        if (!cancelled) setState({
          key,
          rows: null,
          loading: false,
          error: error instanceof Error ? error.message : "Не удалось загрузить дневной отчёт",
        })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, from, to, allTime, key, version])

  return useMemo(
    () => ({
      rows: state.key === key ? state.rows ?? [] : [],
      loading: state.key === key && state.loading,
      fromServer: state.key === key && state.rows !== null,
      error: state.key === key ? state.error : null,
    }),
    [key, state],
  )
}
