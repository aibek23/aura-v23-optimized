// ---------------------------------------------------------------------------
// Хелперы данных: формирование текста бирки и QR-кода
// ---------------------------------------------------------------------------
import QRCode from "qrcode"
import { toast } from "sonner"
import type { Product } from "@/lib/types"

// ---------------------------------------------------------------------------
// Текстовые данные изделия
// ---------------------------------------------------------------------------
export function buildJewelryText(data: Product) {
  const metalLine = [data.metal, data.purity].filter(Boolean).join(" • ") || "—"
  const weightLine = data.weight ? `${data.weight} г` : "—"
  const sizeLine = data.size || "—"
  const priceLine = `${data.sale_price.toLocaleString("ru")} сом`
  return { metalLine, weightLine, sizeLine, priceLine }
}

// ---------------------------------------------------------------------------
// QR-код
// ---------------------------------------------------------------------------
/**
 * Строит короткий QR-URL вида /q/{shopSeqId}/{sku}.
 * Только ASCII — QR-код остаётся компактным и легко читается сканерами.
 * Если seq_id ещё не проставлен (старая запись) — использует UUID магазина.
 */
export function buildQrUrl(data: Product): string {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://aura-gold.kg"
  ).replace(/\/$/, "")
  const skuValue = (data.sku || "").trim().toUpperCase()
  // Короткий числовой ID магазина, иначе — UUID магазина (обратная совместимость)
  const shopKey = String(data.shop_seq_id ?? data.shop_id ?? "").trim()
  // ID самого изделия: попадает в QR как параметр, чтобы сканер всегда получал
  // однозначный идентификатор записи, даже если артикул позже изменится.
  const productId = String(data.id ?? "").trim()
  const hasRealId = Boolean(productId) && productId !== "draft"

  if (!shopKey || !skuValue || !hasRealId) {
    throw new Error(
      "Недостаточно данных для QR-кода: сначала сохраните товар (нужны ID изделия, артикул и магазин).",
    )
  }

  return `${baseUrl}/q/${shopKey}/${encodeURIComponent(skuValue)}?id=${productId}`
}

/**
 * Безопасно генерирует QR-картинку.
 * Если данных не хватает (товар ещё не сохранён) — возвращает null
 * и показывает понятную ошибку вместо битого QR.
 */
export async function safeQrDataUrl(data: Product): Promise<string | null> {
  try {
    return await QRCode.toDataURL(buildQrUrl(data), { margin: 0 })
  } catch (e) {
    console.error("[label] QR build error:", e)
    toast.error(
      e instanceof Error ? e.message : "Не удалось сформировать QR-код",
    )
    return null
  }
}
