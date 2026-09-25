// Web Worker for background synchronization & heavy tasks
self.onmessage = async (e) => {
  const { type, payload } = e.data

  if (type === 'PING') {
    self.postMessage({ type: 'PONG' })
  }

  if (type === 'CALCULATE_AGGREGATES') {
    // Heavy calculation offloaded from main thread
    const { sales, returns, cashOps } = payload
    let totalSales = 0
    let totalReturns = 0
    let netRevenue = 0

    if (sales) {
      for (let i = 0; i < sales.length; i++) {
        totalSales += Number(sales[i].final_price || 0)
      }
    }
    if (returns) {
      for (let i = 0; i < returns.length; i++) {
        totalReturns += Number(returns[i].return_amount || 0)
      }
    }
    netRevenue = totalSales - totalReturns

    self.postMessage({
      type: 'AGGREGATES_RESULT',
      payload: { totalSales, totalReturns, netRevenue },
    })
  }
}
