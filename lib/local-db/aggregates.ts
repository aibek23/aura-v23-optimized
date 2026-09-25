import { getLocalDB } from './db'
import type { DailyAggregate } from './schema'

/**
 * Precomputes and stores daily aggregates so reports, revenue, cash, and sales
 * calculations are instant (O(1)) instead of scanning 100,000+ historical rows.
 */
export async function getDailyAggregatesForMonth(
  shopId: string,
  yearMonth: string // YYYY-MM
): Promise<DailyAggregate[]> {
  const db = await getLocalDB()
  const tx = db.transaction('daily_aggregates', 'readonly')
  const store = tx.objectStore('daily_aggregates')
  const all = await store.getAll()
  return (all as DailyAggregate[]).filter(
    (agg) => agg.shop_id === shopId && agg.date.startsWith(yearMonth)
  )
}

export async function updateDailyAggregateForDate(
  shopId: string,
  dateStr: string, // YYYY-MM-DD
  diff: {
    salesSom?: number
    salesCount?: number
    returnsSom?: number
    returnsCount?: number
    cashIncomeSom?: number
    cashOutcomeSom?: number
    cashCollectionSom?: number
    scrapWeight?: number
  }
): Promise<void> {
  const db = await getLocalDB()
  const tx = db.transaction('daily_aggregates', 'readwrite')
  const store = tx.objectStore('daily_aggregates')
  const current: DailyAggregate = (await store.get(dateStr)) || {
    date: dateStr,
    shop_id: shopId,
    total_sales_som: 0,
    total_sales_count: 0,
    total_returns_som: 0,
    total_returns_count: 0,
    net_revenue_som: 0,
    cash_income_som: 0,
    cash_outcome_som: 0,
    cash_collection_som: 0,
    scrap_weight_bought: 0,
    updated_at: new Date().toISOString(),
  }

  current.total_sales_som += diff.salesSom || 0
  current.total_sales_count += diff.salesCount || 0
  current.total_returns_som += diff.returnsSom || 0
  current.total_returns_count += diff.returnsCount || 0
  current.net_revenue_som = current.total_sales_som - current.total_returns_som
  current.cash_income_som += diff.cashIncomeSom || 0
  current.cash_outcome_som += diff.cashOutcomeSom || 0
  current.cash_collection_som += diff.cashCollectionSom || 0
  current.scrap_weight_bought += diff.scrapWeight || 0
  current.updated_at = new Date().toISOString()

  await store.put(current)
  await tx.done
}
