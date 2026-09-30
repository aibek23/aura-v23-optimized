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

const PRINTER_MODEL_STORAGE_KEY = "sklad:printer-model"
const PRINTER_DEVICE_STORAGE_KEY = "sklad:printer-device-id"
const PRINTER_NAME_STORAGE_KEY = "sklad:printer-device-name"
const PRINTER_CONNECTION_EVENT = "aura:printer-connection-change"

export type PrinterConnectionStatus = "checking" | "connected" | "disconnected" | "unsupported" | "connecting"

export type PrinterConnectionSnapshot = {
  status: PrinterConnectionStatus
  modelKey: string
  deviceName: string | null
  hasRememberedDevice: boolean
  error: string | null
}

type BluetoothDeviceLike = {
  id: string
  name?: string | null
  gatt?: {
    connected: boolean
    connect: () => Promise<unknown>
  } | null
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

type BluetoothAccessLike = {
  requestDevice: (options?: unknown) => Promise<BluetoothDeviceLike>
  getDevices?: () => Promise<BluetoothDeviceLike[]>
}

type BluetoothRequestMode = "choose" | "remembered"

const initialPrinterSnapshot: PrinterConnectionSnapshot = {
  status: "disconnected",
  modelKey: NIIMBOT_MODEL.key,
  deviceName: null,
  hasRememberedDevice: false,
  error: null,
}

let printerSnapshot = initialPrinterSnapshot
let activePrinterDevice: BluetoothDeviceLike | null = null
let disconnectListener: (() => void) | null = null
let monitorStarted = false
let operationQueue: Promise<unknown> = Promise.resolve()
const printerStateListeners = new Set<(snapshot: PrinterConnectionSnapshot) => void>()

function readStoredPrinterModel(): string {
  if (typeof window === "undefined") return NIIMBOT_MODEL.key
  try {
    const key = window.localStorage.getItem(PRINTER_MODEL_STORAGE_KEY)
    return key && PRINTER_PROFILES.some((profile) => profile.key === key) ? key : NIIMBOT_MODEL.key
  } catch {
    return NIIMBOT_MODEL.key
  }
}

function readStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(PRINTER_DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function readStoredDeviceName(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(PRINTER_NAME_STORAGE_KEY)
  } catch {
    return null
  }
}

function publishPrinterSnapshot(update: Partial<PrinterConnectionSnapshot>) {
  printerSnapshot = {
    ...printerSnapshot,
    ...update,
    modelKey: readStoredPrinterModel(),
    deviceName: readStoredDeviceName(),
    hasRememberedDevice: Boolean(readStoredDeviceId()),
  }
  for (const listener of printerStateListeners) listener(printerSnapshot)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PRINTER_CONNECTION_EVENT, { detail: printerSnapshot }))
  }
}

export function getPrinterConnectionSnapshot(): PrinterConnectionSnapshot {
  return {
    ...printerSnapshot,
    modelKey: readStoredPrinterModel(),
    deviceName: readStoredDeviceName(),
    hasRememberedDevice: Boolean(readStoredDeviceId()),
  }
}

export function subscribeToPrinterConnection(listener: (snapshot: PrinterConnectionSnapshot) => void) {
  printerStateListeners.add(listener)
  return () => {
    printerStateListeners.delete(listener)
  }
}

export function savePrinterModelKey(key: string) {
  const profile = getPrinterProfile(key)
  try {
    window.localStorage.setItem(PRINTER_MODEL_STORAGE_KEY, profile.key)
  } catch {
    // The active selection still works for this page if storage is unavailable.
  }
  publishPrinterSnapshot({ modelKey: profile.key, error: null })
}

function savePrinterDevice(device: BluetoothDeviceLike, modelKey: string) {
  try {
    window.localStorage.setItem(PRINTER_DEVICE_STORAGE_KEY, device.id)
    if (device.name) window.localStorage.setItem(PRINTER_NAME_STORAGE_KEY, device.name)
    window.localStorage.setItem(PRINTER_MODEL_STORAGE_KEY, getPrinterProfile(modelKey).key)
  } catch {
    // Keep the live Bluetooth device usable even when local storage is blocked.
  }
  watchPrinterDevice(device)
  publishPrinterSnapshot({ status: "connecting", modelKey, error: null })
}

function clearSavedPrinterDevice() {
  try {
    window.localStorage.removeItem(PRINTER_DEVICE_STORAGE_KEY)
    window.localStorage.removeItem(PRINTER_NAME_STORAGE_KEY)
  } catch {
    // Device selection can still continue for this page.
  }
  publishPrinterSnapshot({ status: "disconnected", error: null })
}

function getBluetoothAccess(): BluetoothAccessLike {
  if (typeof navigator === "undefined") throw new Error("Bluetooth доступен только в браузере.")
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothAccessLike }).bluetooth
  if (!bluetooth?.requestDevice) {
    publishPrinterSnapshot({ status: "unsupported", error: null })
    throw new Error("Web Bluetooth недоступен. Откройте приложение в Chrome или Edge на устройстве с Bluetooth.")
  }
  return bluetooth
}

function enqueuePrinterOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = operationQueue.then(operation, operation)
  operationQueue = current.then(
    () => undefined,
    () => undefined,
  )
  return current
}

function watchPrinterDevice(device: BluetoothDeviceLike) {
  if (activePrinterDevice?.id === device.id) return
  if (activePrinterDevice && disconnectListener) {
    activePrinterDevice.removeEventListener?.("gattserverdisconnected", disconnectListener)
  }

  activePrinterDevice = device
  disconnectListener = () => {
    if (readStoredDeviceId() !== device.id) return
    publishPrinterSnapshot({ status: "disconnected", error: null })
    retryPrinterConnection(device, 0)
  }
  device.addEventListener?.("gattserverdisconnected", disconnectListener)
}

function retryPrinterConnection(device: BluetoothDeviceLike, attempt: number) {
  const delays = [500, 1200, 2500]
  if (attempt >= delays.length || typeof window === "undefined") return
  window.setTimeout(() => {
    void enqueuePrinterOperation(async () => {
      if (readStoredDeviceId() !== device.id || !device.gatt || device.gatt.connected) return
      publishPrinterSnapshot({ status: "connecting", error: null })
      try {
        await device.gatt.connect()
        publishPrinterSnapshot({ status: "connected", error: null })
      } catch {
        publishPrinterSnapshot({ status: "disconnected", error: null })
        retryPrinterConnection(device, attempt + 1)
      }
    })
  }, delays[attempt])
}

async function restoreRememberedPrinter() {
  const deviceId = readStoredDeviceId()
  if (!deviceId) {
    publishPrinterSnapshot({ status: "disconnected", error: null })
    return
  }

  const bluetooth = getBluetoothAccess()
  if (!bluetooth.getDevices) {
    publishPrinterSnapshot({ status: "unsupported", error: null })
    return
  }
  const devices = await bluetooth.getDevices()
  const device = devices.find((item) => item.id === deviceId)
  if (!device) {
    publishPrinterSnapshot({ status: "disconnected", error: null })
    return
  }

  watchPrinterDevice(device)
  if (device.gatt?.connected) {
    publishPrinterSnapshot({ status: "connected", error: null })
    return
  }

  publishPrinterSnapshot({ status: "connecting", error: null })
  try {
    await device.gatt?.connect()
    publishPrinterSnapshot({ status: device.gatt?.connected ? "connected" : "disconnected", error: null })
  } catch {
    publishPrinterSnapshot({ status: "disconnected", error: null })
  }
}

export function startPrinterConnectionMonitor() {
  if (typeof window === "undefined" || monitorStarted) return
  monitorStarted = true
  publishPrinterSnapshot({ status: "checking", error: null })
  void enqueuePrinterOperation(restoreRememberedPrinter).catch(() => {
    publishPrinterSnapshot({ status: "disconnected", error: null })
  })
  window.addEventListener("focus", () => {
    void enqueuePrinterOperation(restoreRememberedPrinter).catch(() => undefined)
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void enqueuePrinterOperation(restoreRememberedPrinter).catch(() => undefined)
    }
  })
}

async function withPrinterDeviceSelection<T>(
  modelKey: string,
  mode: BluetoothRequestMode,
  action: () => Promise<T>,
): Promise<T> {
  const bluetooth = getBluetoothAccess()
  const originalRequestDevice = bluetooth.requestDevice.bind(bluetooth)
  const previousDescriptor = Object.getOwnPropertyDescriptor(bluetooth, "requestDevice")

  const requestRememberedDevice = async (_options?: unknown) => {
    if (mode === "choose") {
      const device = await originalRequestDevice(_options)
      savePrinterDevice(device, modelKey)
      return device
    }

    const deviceId = readStoredDeviceId()
    if (!deviceId) throw new Error("Сначала подключите принтер в настройках.")
    if (!bluetooth.getDevices) {
      throw new Error("Браузер не поддерживает автоматическое восстановление Bluetooth. Используйте Chrome или Edge.")
    }
    const devices = await bluetooth.getDevices()
    const device = devices.find((item) => item.id === deviceId)
    if (!device) {
      throw new Error("Браузер не видит сохранённый принтер. Нажмите «Сменить устройство» и подключите его заново.")
    }
    watchPrinterDevice(device)
    return device
  }

  try {
    Object.defineProperty(bluetooth, "requestDevice", {
      configurable: true,
      writable: true,
      value: requestRememberedDevice,
    })
  } catch {
    throw new Error("Не удалось включить автоматический выбор сохранённого Bluetooth-принтера. Обновите Chrome или Edge.")
  }

  try {
    const result = await action()
    const deviceId = readStoredDeviceId()
    const devices = bluetooth.getDevices ? await bluetooth.getDevices().catch(() => []) : []
    const device = devices.find((item) => item.id === deviceId) ?? activePrinterDevice
    if (device && device.id === deviceId) {
      watchPrinterDevice(device)
      if (!device.gatt?.connected) {
        try {
          await device.gatt?.connect()
        } catch {
          // Printing may have succeeded even if the printer powered down immediately afterwards.
        }
      }
      publishPrinterSnapshot({
        status: device.gatt?.connected ? "connected" : "disconnected",
        error: null,
      })
    }
    return result
  } catch (error) {
    const deviceStillConnected =
      activePrinterDevice?.id === readStoredDeviceId() && Boolean(activePrinterDevice.gatt?.connected)
    publishPrinterSnapshot({
      status: deviceStillConnected ? "connected" : "disconnected",
      error: error instanceof Error ? error.message : "Ошибка Bluetooth-подключения",
    })
    throw error
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(bluetooth, "requestDevice", previousDescriptor)
    } else {
      Reflect.deleteProperty(bluetooth, "requestDevice")
    }
  }
}

async function identifyPrinterOperation(
  profileKey: string,
  mode: BluetoothRequestMode,
): Promise<{ profile: PrinterProfile; printer: NiimbotPrinterInfo }> {
  const selected = getPrinterProfile(profileKey)
  if (selected.supportsDirectBluetooth === false) {
    throw new Error(`${selected.displayName} не поддерживается прямым Bluetooth-драйвером в этой версии. Подготовьте PNG и отправьте его через приложение Niimbot.`)
  }

  const api = await loadNiimbot()
  return withPrinterDeviceSelection(selected.key, mode, async () => {
    const info = await api.identify(selected)
    const printer = api.printer ?? info
    const matches = PRINTER_PROFILES.filter((profile) => profile.supportedIds.includes(printer.modelId))
    const profile = matches.find((item) => item.key === selected.key) ?? (matches.length === 1 ? matches[0] : undefined)
    if (!profile) {
      throw new Error(`Принтер ответил ID ${printer.modelId}, но модель неоднозначна или не входит в список. Выберите модель вручную.`)
    }
    const detectedProfile = { ...profile, id: printer.modelId }
    savePrinterModelKey(detectedProfile.key)
    publishPrinterSnapshot({ status: "connected", modelKey: detectedProfile.key, error: null })
    return { profile: detectedProfile, printer }
  })
}

export function identifyPrinter(profileKey: string): Promise<{ profile: PrinterProfile; printer: NiimbotPrinterInfo }> {
  return enqueuePrinterOperation(() => identifyPrinterOperation(profileKey, "choose"))
}

export function reconnectPrinter(profileKey: string): Promise<{ profile: PrinterProfile; printer: NiimbotPrinterInfo }> {
  return enqueuePrinterOperation(() => identifyPrinterOperation(profileKey, "remembered"))
}

export function changePrinterDevice(profileKey: string): Promise<{ profile: PrinterProfile; printer: NiimbotPrinterInfo }> {
  return enqueuePrinterOperation(async () => {
    clearSavedPrinterDevice()
    try {
      const api = await loadNiimbot()
      await api.disconnect()
    } catch {
      // Selecting another printer should still work if the old device is already gone.
    }
    return identifyPrinterOperation(profileKey, "choose")
  })
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
  /**
   * Полная ширина страницы, которую ожидает принтер (ось печатающей головки).
   * Для task "b1" (B1/B21/D11) страница ВСЕГДА равна ширине головки, иначе
   * строки растра уходят с неверным stride и печатается только первая полоса.
   * Макет при этом прижимается к левому краю (ось подачи не меняется).
   */
  pageW: number = size.w_px,
): string {
  const contentW = size.w_px
  const targetH = size.h_px
  const targetW = Math.max(pageW, contentW)

  const out = document.createElement("canvas")
  out.width = targetW
  out.height = targetH
  const outCtx = out.getContext("2d", { willReadFrequently: true })
  if (!outCtx) throw new Error("Не удалось подготовить буфер масштабирования")

  // Заполнение белым фоном для исключения прозрачных пикселей
  outCtx.fillStyle = "#ffffff"
  outCtx.fillRect(0, 0, targetW, targetH)

  // Отрисовка источника напрямую с ресайзом (контент слева, добивка — белая)
  outCtx.drawImage(source, 0, 0, contentW, targetH)

  return out.toDataURL("image/png")
}

/**
 * Ширина страницы для SetPageSize.
 * task "b1": ширина печатающей головки, выровненная по 8 px — требование
 * протокола 3 (см. docs/protocol-v4.md драйвера). task "v4": ширина этикетки.
 */
export function getPageWidthPx(model: PrinterProfile, contentW: number): number {
  if (model.task !== "b1") return contentW
  const head = Math.floor(model.printheadPx / 8) * 8
  return Math.max(head, Math.ceil(contentW / 8) * 8)
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
  const contentW = Math.round(sizeDef.w_px * scale)
  const contentSize: NiimbotSize = {
    w_px: contentW,
    h_px: Math.round(sizeDef.h_px * scale),
    dpi: model.dpi,
  }
  if (contentW > model.printheadPx) {
    throw new Error(
      `Макет шириной ${contentW} px превышает печатаемую ширину ${model.displayName} (${model.printheadPx} px). Выберите более узкий формат этикетки.`,
    )
  }

  // Растр и SetPageSize должны иметь одинаковую ширину страницы.
  const pageW = getPageWidthPx(model, contentW)
  const targetSize: NiimbotSize = { ...contentSize, w_px: pageW }

  // Безопасная конфигурация отправки для высоких бирок (600px)
  api.WRITE_MODE = model.task === "b1" ? "paced" : null
  api.PACE_MS = 50

  const dataUrl = canvasToLabelDataUrl(source, contentSize, pageW)

  await enqueuePrinterOperation(() =>
    withPrinterDeviceSelection(model.key, "remembered", async () => {
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

          api.WRITE_MODE = "acked"

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
      }
    }),
  )
}

export async function printPrinterTestLabel(profileKey: string) {
  if (typeof document === "undefined") throw new Error("Тестовая печать доступна только в браузере.")
  const profile = getPrinterProfile(profileKey)
  const size = LABEL_SIZES.T12x30_d11
  if (profile.supportsDirectBluetooth === false) {
    throw new Error(`${profile.displayName}: прямое Bluetooth-подключение не поддерживается.`)
  }

  const canvas = document.createElement("canvas")
  canvas.width = size.w_px
  canvas.height = size.h_px
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Не удалось подготовить тестовую этикетку.")

  context.fillStyle = "#fff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = "#111"
  context.lineWidth = 2
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
  context.fillStyle = "#111"
  context.textAlign = "center"
  context.font = "bold 10px sans-serif"
  context.fillText("AURA", canvas.width / 2, 88)
  context.font = "8px sans-serif"
  context.fillText("ТЕСТ ПЕЧАТИ", canvas.width / 2, 110)

  await printCanvas(canvas, size, { model: profile, copies: 1 })
}
