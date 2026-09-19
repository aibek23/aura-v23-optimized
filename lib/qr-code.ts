/**
 * Разбор содержимого QR-кода с этикетки.
 *
 * Формат QR (см. components/screens/sklad/label/data/qr.ts → buildQrUrl):
 *   "{seq_id магазина}/{SKU}", например "1/RY00042" или "12/BR00007".
 *
 * Для обратной совместимости также понимаем старые полные ссылки:
 *   https://host/q/{seq_id}/{SKU}
 *   https://host/store/{uuid}/product/{SKU}
 *   ...?sku=RY00042
 */
export type ParsedQr = {
  /** Артикул (SKU) в верхнем регистре — то, что подставляется в поиск. */
  sku: string
  /** Числовой ID магазина из QR (seq_id). null — если в коде его нет. */
  shopSeqId: number | null
}

const SHOP_SKU_RE = /^(\d+)\/([^/\s?#]+)\/?$/

export function parseQrCode(raw: string): ParsedQr {
  const clean = raw.trim()
  if (!clean) return { sku: "", shopSeqId: null }

  // Основной формат: "1/RY00042"
  const m = clean.match(SHOP_SKU_RE)
  if (m) {
    return {
      shopSeqId: Number(m[1]),
      sku: safeDecode(m[2]).toUpperCase(),
    }
  }

  // Полный URL (старые этикетки)
  try {
    const url = new URL(clean)
    const segments = url.pathname.split("/").filter(Boolean)

    const qIndex = segments.indexOf("q")
    if (qIndex >= 0 && segments[qIndex + 2]) {
      const shopSeg = segments[qIndex + 1]
      return {
        shopSeqId: /^\d+$/.test(shopSeg) ? Number(shopSeg) : null,
        sku: safeDecode(segments[qIndex + 2]).toUpperCase(),
      }
    }

    const productIndex = segments.lastIndexOf("product")
    if (productIndex >= 0 && segments[productIndex + 1]) {
      return { shopSeqId: null, sku: safeDecode(segments[productIndex + 1]).toUpperCase() }
    }

    const skuFromQuery = url.searchParams.get("sku") ?? url.searchParams.get("article")
    if (skuFromQuery) return { shopSeqId: null, sku: skuFromQuery.toUpperCase() }
  } catch {
    // Обычный штрихкод/артикул — это не URL.
  }

  return { sku: clean, shopSeqId: null }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
