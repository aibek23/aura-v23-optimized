// ---------------------------------------------------------------------------
// QR-код: URL и data-URL
// ---------------------------------------------------------------------------
import QRCode from "qrcode"
import { toast } from "sonner"
import type { Product } from "@/lib/types"

export function buildQrUrl(data: Product): string {
  const baseUrl  = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080/").replace(/\/$/, "")
  const skuValue = (data.sku || "").trim().toUpperCase()
  const shopKey  = String(data.shop_seq_id ?? data.shop_id ?? "").trim()

  if (!shopKey || !skuValue) {
    throw new Error("Недостаточно данных для QR-кода: проверьте наличие артикула (SKU) и магазина.")
  }
  return `${baseUrl}/q/${shopKey}/${encodeURIComponent(skuValue)}`
}

export async function safeQrDataUrl(data: Product): Promise<string | null> {
  try {
    return await QRCode.toDataURL(buildQrUrl(data), { margin: 0 })
  } catch (e) {
    console.error("[label] QR build error:", e)
    toast.error(e instanceof Error ? e.message : "Не удалось сформировать QR-код")
    return null
  }
}
