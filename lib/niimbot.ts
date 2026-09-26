/**
 * Ювелирные форматы бирок.
 * Размеры в мм: T<ширина>*<высота>+<хвостик> или T<ш>*<в>-<прямоугольник>.
 * Пиксели рассчитаны по 203 dpi принтера Niimbot B1.
 */
export type JewelryLabelSizeKey =
  | "T25x30_45"    // T25*30+45 — бирка вертикальная
  | "T30x25_45"    // T30*25+45 — бирка с коротким хвостиком
  | "T30x25_50"    // T30*25+50 — бирка с длинным хвостиком
  | "T50x30_rect"  // T50*30-230 — прямоугольная бирка
  | "T12x30_d11"
  | "T12x50_d110"

// ---------------------------------------------------------------------------
// Профили Niimbot. B21, D11 и B3S используют совместимый протокол b1,
// но требуют проверки на конкретном устройстве.
// ---------------------------------------------------------------------------
export type PrinterProfile = NiimbotModel & {
  key: string
  displayName: string
  printheadPx: number
  supportedIds: number[]
  /** Profile appears in the bundled driver's documented model table; this is not a physical test result. */
  driverDocumented: boolean
  supportsDirectBluetooth?: boolean
  defaultLabelKey: JewelryLabelSizeKey
}

const makeProfile = (
  profile: Omit<PrinterProfile, "label_type" | "speed"> & Partial<Pick<PrinterProfile, "label_type" | "speed">>,
): PrinterProfile => ({ label_type: 1, speed: 1, ...profile })

export const PRINTER_PROFILES: PrinterProfile[] = [
  makeProfile({ key: "b1", displayName: "Niimbot B1", label: "Niimbot B1", id: 4096, supportedIds: [4096], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["B1"], printheadPx: 384, driverDocumented: true, defaultLabelKey: "T25x30_45" }),
  makeProfile({ key: "b21", displayName: "Niimbot B21", label: "Niimbot B21", id: 768, supportedIds: [768], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["B21"], printheadPx: 384, driverDocumented: false, defaultLabelKey: "T25x30_45" }),
  makeProfile({ key: "d11", displayName: "Niimbot D11", label: "Niimbot D11", id: 512, supportedIds: [512], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["D11"], printheadPx: 96, driverDocumented: false, defaultLabelKey: "T12x30_d11" }),
  makeProfile({ key: "d11h", displayName: "Niimbot D11_H", label: "Niimbot D11_H", id: 528, supportedIds: [528], dpi: 300, protocol: "v4", task: "v4", density: 3, name_prefixes: ["D11"], printheadPx: 144, driverDocumented: true, defaultLabelKey: "T12x30_d11" }),
  makeProfile({ key: "d110", displayName: "Niimbot D110", label: "Niimbot D110", id: 2304, supportedIds: [2304, 2305], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["D110"], printheadPx: 96, driverDocumented: true, defaultLabelKey: "T12x50_d110" }),
  makeProfile({ key: "b3s", displayName: "Niimbot B3S", label: "Niimbot B3S", id: 256, supportedIds: [256, 260, 262], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["B3S"], printheadPx: 576, driverDocumented: false, supportsDirectBluetooth: false, defaultLabelKey: "T50x30_rect" }),
  makeProfile({ key: "b1pro", displayName: "Niimbot B1 Pro", label: "Niimbot B1 Pro", id: 4097, supportedIds: [4097], dpi: 300, protocol: "v4", task: "v4", density: 3, name_prefixes: ["B1"], printheadPx: 584, driverDocumented: true, defaultLabelKey: "T25x30_45" }),
  makeProfile({ key: "b2pro", displayName: "Niimbot B2 Pro", label: "Niimbot B2 Pro", id: 6912, supportedIds: [6912], dpi: 300, protocol: "v4", task: "v4", density: 3, name_prefixes: ["B2"], printheadPx: 576, driverDocumented: true, defaultLabelKey: "T25x30_45" }),
  makeProfile({ key: "m2h", displayName: "Niimbot M2-H", label: "Niimbot M2-H", id: 4608, supportedIds: [4608], dpi: 300, protocol: "v4", task: "b1", density: 3, name_prefixes: ["M2"], printheadPx: 567, driverDocumented: true, defaultLabelKey: "T25x30_45" }),
  makeProfile({ key: "n1", displayName: "Niimbot N1", label: "Niimbot N1", id: 3586, supportedIds: [3586], dpi: 203, protocol: "v4", task: "b1", density: 3, name_prefixes: ["N1"], printheadPx: 96, driverDocumented: true, defaultLabelKey: "T12x50_d110" }),
]

export const NIIMBOT_MODEL: PrinterProfile = PRINTER_PROFILES[0]
export const getPrinterProfile = (key: string): PrinterProfile =>
  PRINTER_PROFILES.find((profile) => profile.key === key) ?? PRINTER_PROFILES[0]

export async function identifyPrinter(profileKey: string): Promise<{ profile: PrinterProfile; printer: NiimbotPrinterInfo }> {
  const selected = getPrinterProfile(profileKey)
  if (selected.supportsDirectBluetooth === false) {
    throw new Error(`${selected.displayName} не поддерживается прямым Bluetooth-драйвером в этой версии. Подготовьте PNG и отправьте его через приложение Niimbot.`)
  }
  const api = await loadNiimbot()
  try {
    const info = await api.identify(selected)
    const printer = api.printer ?? info
    const matches = PRINTER_PROFILES.filter((profile) => profile.supportedIds.includes(printer.modelId))
    const profile = matches.find((item) => item.key === selected.key) ?? (matches.length === 1 ? matches[0] : undefined)
    if (!profile) {
      throw new Error(`Принтер ответил ID ${printer.modelId}, но модель неоднозначна или не входит в список. Выберите модель вручную.`)
    }
    return { profile: { ...profile, id: printer.modelId }, printer }
  } finally {
    await api.disconnect()
  }
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
  T30x25_45: {
    key: "T30x25_45",
    label: "T30*25+45",
    w_px: 240,
    h_px: 560,
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
  T12x30_d11: {
    key: "T12x30_d11",
    label: "T12×30 · D11",
    w_px: 96,
    h_px: 240,
  },
  T12x50_d110: {
    key: "T12x50_d110",
    label: "T12×50 · D110",
    w_px: 96,
    h_px: 400,
  },
}

/** Размер по умолчанию */
export const DEFAULT_SIZE_KEY: JewelryLabelSizeKey = "T25x30_45"

/** Возвращает описание формата по ключу. */
export function getLabelSizeDef(key: JewelryLabelSizeKey): LabelSizeDef {
  return LABEL_SIZES[key] ?? LABEL_SIZES[DEFAULT_SIZE_KEY]
}

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
  size: NiimbotSize = LABEL_SIZES[DEFAULT_SIZE_KEY],
): string {
  const targetW = size.w_px
  const targetH = size.h_px

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
  opts: { model?: PrinterProfile; copies?: number; density?: number; onProgress?: (s: number | string) => void } = {},
) {
  const model = opts.model ?? NIIMBOT_MODEL
  if (model.supportsDirectBluetooth === false) {
    throw new Error(`${model.displayName}: прямое Bluetooth-подключение не поддерживается. Скачайте PNG и откройте его в приложении Niimbot.`)
  }
  const api = await loadNiimbot()
  const scale = model.dpi / 203
  const targetSize: NiimbotSize = {
    w_px: Math.round(sizeDef.w_px * scale),
    h_px: Math.round(sizeDef.h_px * scale),
    dpi: model.dpi,
  }
  if (targetSize.w_px > model.printheadPx) {
    throw new Error(
      `Макет шириной ${targetSize.w_px} px превышает печатаемую ширину ${model.displayName} (${model.printheadPx} px). Выберите более узкий формат этикетки.`,
    )
  }

  // Если прошлый сеанс остался открытым, разрываем его
  try {
    await api.disconnect()
  } catch {
    /* игнорируем */
  }

  // Задержка перед началом связи для освобождения BLE шины
  await new Promise((resolve) => setTimeout(resolve, 300))

  // Безопасная конфигурация отправки для высоких бирок (600px)
  api.WRITE_MODE = model.task === "b1" ? "paced" : null
  api.PACE_MS = 50

  const dataUrl = canvasToLabelDataUrl(source, targetSize)

  opts.onProgress?.(`Подключение к ${model.displayName}...`)

  try {
    await api.printImage(dataUrl, {
      model,
      size: targetSize,
      copies: Math.max(1, opts.copies ?? 1),
      density: opts.density ?? model.density,
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
        model,
        size: targetSize,
        copies: Math.max(1, opts.copies ?? 1),
        density: opts.density ?? model.density,
        onProgress: (progress) => opts.onProgress?.(progress),
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