// ---------------------------------------------------------------------------
// QR-код: URL и data-URL
// ---------------------------------------------------------------------------
import QRCode from "qrcode"
import { toast } from "sonner"
import type { Product } from "@/lib/types"

export function buildQrUrl(data: Product): string {
  const skuValue = (data.sku || "").trim().toUpperCase()
  const shopSeqId = data.shop_seq_id

  if (typeof shopSeqId !== "number" || !Number.isSafeInteger(shopSeqId) || shopSeqId <= 0 || !skuValue) {
    throw new Error("Для QR-кода нужны артикул и короткий номер магазина. Синхронизируйте товар и попробуйте снова.")
  }
  return `${shopSeqId}/${encodeURIComponent(skuValue)}`
}

export async function safeQrDataUrl(data: Product): Promise<string | null> {
  try {
    return await QRCode.toDataURL(buildQrUrl(data), {
      margin: 2,
      scale: 12,
      errorCorrectionLevel: "M",
    })
  } catch (e) {
    console.error("[label] QR build error:", e)
    toast.error(e instanceof Error ? e.message : "Не удалось сформировать QR-код")
    return null
  }
}
