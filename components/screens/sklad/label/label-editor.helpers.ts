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
  // Берём поле metal напрямую. Если его нет — подставляем прочерк "—".
  // Метод trim() уберёт лишние пробелы по краям, не повреждая название "Золото 375".
  const rawMetal = data.metal ? String(data.metal).trim() : ""
  
  // Если строка начинается со слова "Металл:", аккуратно убираем только префикс
  const metalLine = rawMetal.replace(/^металл\s*:?\s*/i, "").trim() || "—"
  
  const weightLine = data.weight ? `${data.weight} г` : "—"
  const sizeLine   = data.size || "—"
  const priceLine  = data.sale_price 
    ? `${data.sale_price.toLocaleString("ru")} сом` 
    : "—"

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
/**
 * Строит короткий QR-URL вида /q/{shopSeqId}/{sku}.
 * Только ASCII — QR-код остаётся компактным и легко читается сканерами.
 * Если seq_id ещё не проставлен (старая запись) — использует UUID магазина.
 */
export function buildQrUrl(data: Product): string {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080/"
  ).replace(/\/$/, "")
  const skuValue = (data.sku || "").trim().toUpperCase()
  // Короткий числовой ID магазина, иначе — UUID магазина (обратная совместимость)
  const shopKey = String(data.shop_seq_id ?? data.shop_id ?? "").trim()

  if (!shopKey || !skuValue) {
    throw new Error(
      "Недостаточно данных для QR-кода: проверьте наличие артикула (SKU) и магазина.",
    )
  }

  return `${baseUrl}/q/${shopKey}/${encodeURIComponent(skuValue)}`
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
