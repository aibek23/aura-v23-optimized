/**
 * Ювелирные форматы бирок.
 * Размеры в мм: T<ширина>*<высота>+<хвостик> или T<ш>*<в>-<прямоугольник>.
 * Пиксели рассчитаны по 203 dpi принтера Niimbot B1.
 */
export type JewelryLabelSizeKey =
  | "T25x30_45"    // T25*30+45 — бирка вертикальная
  | "T30x25_50"    // T30*25+50 — бирка с длинным хвостиком
  | "T50x30_rect"  // T50*30-230 — прямоугольная бирка

// ---------------------------------------------------------------------------
// Модель принтера Niimbot B1 (203 dpi)
// ---------------------------------------------------------------------------
export const NIIMBOT_MODEL: NiimbotModel = {
  label: "B1",
  id: 0x01,
  dpi: 203,
  protocol: "b1",
  task: "b1",
  density: 3,
  label_type: 1,
  speed: 3,
  name_prefixes: ["B1"],
}

// ---------------------------------------------------------------------------
// Реестр ювелирных форматов бирок (v15)
// ---------------------------------------------------------------------------
export type LabelSizeDef = NiimbotSize & {
  key: JewelryLabelSizeKey
  label: string
  /** Ширина рабочей области холста (печатная зона), px */
  w_px: number
  /** Высота рабочей области холста (печатная зона), px */
  h_px: number
}

export const LABEL_SIZES: Record<JewelryLabelSizeKey, LabelSizeDef> = {
  T25x30_45: {
    key: "T25x30_45",
    label: "T25*30+45",
    w_px: 200,
    h_px: 600,
  },
  T30x25_50: {
    key: "T30x25_50",
    label: "T30*25+50",
    w_px: 240,
    h_px: 600,
  },
  T50x30_rect: {
    key: "T50x30_rect",
    label: "T50*30-230",
    w_px: 400,
    h_px: 240,
  },
}

/** Размер по умолчанию */
export const DEFAULT_SIZE_KEY: JewelryLabelSizeKey = "T25x30_45"

export const NIIMBOT_SIZE = LABEL_SIZES[DEFAULT_SIZE_KEY]
export const LABEL_WIDTH = NIIMBOT_SIZE.w_px
export const LABEL_HEIGHT = NIIMBOT_SIZE.h_px

// ---------------------------------------------------------------------------
// Загрузка CJS-драйвера Niimbot
// ---------------------------------------------------------------------------
export async function loadNiimbot(): Promise<NiimbotApi> {
  if (typeof window === "undefined") throw new Error("Печать доступна только в браузере")
  if (!window.Niimbot) await import("niimbot-web-bluetooth")
  const api = window.Niimbot
  if (!api) throw new Error("Не удалось загрузить драйвер Niimbot")
  if (!api.isSupported()) {
    throw new Error("Web Bluetooth не поддерживается браузером. Используйте Chrome, Edge или Opera.")
  }
  return api
}

// ---------------------------------------------------------------------------
// Утилиты холста
// ---------------------------------------------------------------------------
export function canvasToLabelDataUrl(
  source: HTMLCanvasElement,
  sizeDef: LabelSizeDef = LABEL_SIZES[DEFAULT_SIZE_KEY],
): string {
  const targetW = sizeDef.w_px
  const targetH = sizeDef.h_px

  const out = document.createElement("canvas")
  out.width = targetW
  out.height = targetH
  const outCtx = out.getContext("2d", { willReadFrequently: true })
  if (!outCtx) throw new Error("Не удалось подготовить буфер масштабирования")

  // Заполнение белым фоном для исключения прозрачных пикселей
  outCtx.fillStyle = "#ffffff"
  outCtx.fillRect(0, 0, targetW, targetH)

  // Отрисовка источника напрямую с ресайзом
  outCtx.drawImage(source, 0, 0, targetW, targetH)

  return out.toDataURL("image/png")
}

// ---------------------------------------------------------------------------
// Функция печати с защитой от переполнения буфера Bluetooth
// ---------------------------------------------------------------------------
export async function printCanvas(
  source: HTMLCanvasElement,
  sizeDef: LabelSizeDef = LABEL_SIZES[DEFAULT_SIZE_KEY],
  opts: { copies?: number; onProgress?: (s: string) => void } = {},
) {
  const api = await loadNiimbot()

  // Если прошлый сеанс остался открытым, разрываем его
  try {
    await api.disconnect()
  } catch {
    /* игнорируем */
  }

  // Задержка перед началом связи для освобождения BLE шины
  await new Promise((resolve) => setTimeout(resolve, 300))

  // Безопасная конфигурация отправки для высоких бирок (600px)
  api.WRITE_MODE = "paced"
  api.PACE_MS = 50

  const dataUrl = canvasToLabelDataUrl(source, sizeDef)

  opts.onProgress?.("Подключение к Niimbot B1...")

  try {
    await api.printImage(dataUrl, {
      model: NIIMBOT_MODEL,
      size: sizeDef,
      copies: Math.max(1, opts.copies ?? 1),
      onProgress: (p: number | string) => {
        if (typeof p === "number") {
          opts.onProgress?.(`Печать: ${Math.round(p * 100)}%`)
        } else {
          opts.onProgress?.(String(p))
        }
      },
    })
  } catch (err) {
    const errorMsg = (err as Error)?.message || ""

    // Перехват переполнения буфера и переключение на медленный режим с подтверждением (acked)
    if (
      errorMsg.includes("GATT") ||
      errorMsg.includes("buffer full") ||
      errorMsg.includes("paced") ||
      errorMsg.includes("unknown reason")
    ) {
      opts.onProgress?.("Переключение на медленный безопасный режим (acked)...")
      await new Promise((resolve) => setTimeout(resolve, 400))

      api.WRITE_MODE = "acked" // Валидный режим: каждый пакет отправляется только после ответа от принтера

      await api.printImage(dataUrl, {
        model: NIIMBOT_MODEL,
        size: sizeDef,
        copies: Math.max(1, opts.copies ?? 1),
        onProgress: opts.onProgress,
      })
    } else {
      throw err
    }
  } finally {
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      await api.disconnect()
    } catch {
      // Игнорируем ошибки при разрыве соединения
    }
  }
}