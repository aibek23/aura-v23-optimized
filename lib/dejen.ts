import { commandFrame, FrameDecoder, dothanTechPrintJob } from "./dejen-protocol.mjs"

// UUIDs and characteristic pairs are from the user-provided Detonger Web
// Bluetooth reference, with the manufacturer's E781 profile retained.
export const DEJEN_VENDOR_SERVICE = "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
export const DEJEN_SERVICE = "0000ff00-0000-1000-8000-00805f9b34fb"
const DEJEN_WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
const DEJEN_NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"
const NIIMBOT_SERIAL_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb"
const NIIMBOT_SERIAL_WRITE = "0000ffe2-0000-1000-8000-00805f9b34fb"
const NIIMBOT_SERIAL_NOTIFY = "0000ffe1-0000-1000-8000-00805f9b34fb"
const DEJEN_SUPPORTED_SERVICES = [
  DEJEN_SERVICE,
  NIIMBOT_SERIAL_SERVICE,
  "ffffff00-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  DEJEN_VENDOR_SERVICE,
  "49535343-fe7d-4ae5-8fa9-9fafd205e45a",
  "49535343-8841-43f4-a8d4-ecbe34729bb3",
]
const DEJEN_OPTIONAL_SERVICES = [
  DEJEN_SERVICE,
  NIIMBOT_SERIAL_SERVICE,
  "ffffff00-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000180a-0000-1000-8000-00805f9b34fb",
  DEJEN_VENDOR_SERVICE,
  "49535343-fe7d-4ae5-8fa9-9fafd205e45a",
  "49535343-8841-43f4-a8d4-ecbe34729bb3",
]
export type DejenModelName = "DP27P" | "DP30P"
export type DejenPrinterInfo = { name: string; dpi: number; printheadPx: number }

function connectionError(stage: string, cause: unknown): Error {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  const error = new Error(`Dejen — ${stage}. ${detail}`)
  error.name = "DejenConnectionError"
  return error
}

type Characteristic = {
  uuid: string
  properties: { write?: boolean; writeWithoutResponse?: boolean; notify?: boolean; indicate?: boolean }
  value?: DataView
  startNotifications(): Promise<unknown>
  writeValueWithResponse?(data: Uint8Array): Promise<unknown>
  writeValueWithoutResponse?(data: Uint8Array): Promise<unknown>
  writeValue?(data: Uint8Array): Promise<unknown>
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}
type DejenDevice = {
  id: string
  gatt?: {
    connected: boolean
    connect(): Promise<unknown>
    disconnect(): void
    getPrimaryServices(): Promise<Array<{ uuid: string; getCharacteristics(): Promise<Characteristic[]> }>>
  } | null
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}
type Pending = {
  resolve(value: Uint8Array): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const DEJEN_ACKED_WRITE_CHUNK_SIZE = 512
const DEJEN_ACKED_WRITE_DELAY_MS = 10
const DEJEN_UNACKED_WRITE_CHUNK_SIZE = 20
const DEJEN_UNACKED_WRITE_DELAY_MS = 20
async function bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function statusError(status: number): string {
  const errors: Record<number, string> = {
    12: "печать отменена", 30: "низкий заряд", 31: "ошибка питания",
    32: "печатающая головка не найдена", 33: "головка перегрета",
    34: "крышка открыта", 35: "нет этикеток", 36: "головка открыта",
    37: "нет ленты", 38: "неподходящая лента", 39: "головка слишком холодная",
  }
  return errors[status] ?? `состояние принтера ${status}`
}

class DejenSession {
  readonly pending = new Map<number, Pending>()
  readonly decoder = new FrameDecoder()
  readonly device: DejenDevice
  readonly tx: Characteristic
  readonly rx: Characteristic
  info: DejenPrinterInfo | null = null
  closed = false
  constructor(device: DejenDevice, tx: Characteristic, rx: Characteristic) {
    this.device = device
    this.tx = tx
    this.rx = rx
    rx.addEventListener("characteristicvaluechanged", this.receive)
    device.addEventListener("gattserverdisconnected", this.disconnected)
  }

  receive = (event: unknown) => {
    const value = (event as { target?: { value?: DataView } }).target?.value
    if (!value || this.closed) return
    const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    for (const frame of this.decoder.push(chunk)) {
      const waiter = this.pending.get(frame.command)
      if (!waiter) continue
      this.pending.delete(frame.command)
      clearTimeout(waiter.timer)
      waiter.resolve(frame.payload)
    }
  }
  disconnected = () => this.dispose(new Error("Dejen: Bluetooth-соединение прервано"))

  dispose(error = new Error("Dejen: соединение закрыто")) {
    if (this.closed) return
    this.closed = true
    this.rx.removeEventListener("characteristicvaluechanged", this.receive)
    this.device.removeEventListener("gattserverdisconnected", this.disconnected)
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.pending.clear()
    try { this.device.gatt?.disconnect() } catch { /* Already disconnected. */ }
  }

  async write(data: Uint8Array, onProgress?: (fraction: number) => void) {
    // Match the working DothanTech Web Bluetooth flow: acknowledged writes
    // accept larger GATT values, and each write promise provides flow control.
    // Keep the conservative ATT-sized path for write-without-response devices.
    // No retries: retrying a partially transmitted print can duplicate a label.
    const acknowledgedWrite = Boolean(
      this.tx.properties.write
      && (this.tx.writeValueWithResponse || this.tx.writeValue),
    )
    const chunkSize = acknowledgedWrite
      ? DEJEN_ACKED_WRITE_CHUNK_SIZE
      : DEJEN_UNACKED_WRITE_CHUNK_SIZE
    const packetDelay = acknowledgedWrite
      ? DEJEN_ACKED_WRITE_DELAY_MS
      : DEJEN_UNACKED_WRITE_DELAY_MS
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      if (this.closed || !this.device.gatt?.connected) throw new Error("Dejen: принтер отключён")
      const chunk = data.slice(offset, offset + chunkSize)
      let operation: Promise<unknown>
      if (this.tx.properties.write && this.tx.writeValueWithResponse) {
        operation = this.tx.writeValueWithResponse(chunk)
      } else if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) {
        operation = this.tx.writeValueWithoutResponse(chunk)
      } else if (this.tx.properties.write && this.tx.writeValue) {
        operation = this.tx.writeValue(chunk)
      } else {
        throw new Error("Dejen: характеристика не поддерживает запись")
      }
      try {
        await bounded(operation, 5000, "Dejen: принтер не подтвердил Bluetooth-запись")
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error("Dejen: ошибка записи"))
        throw error
      }
      if (offset + chunk.length < data.length) await delay(packetDelay)
      onProgress?.(Math.min(1, (offset + chunk.length) / data.length))
    }
  }

  async query(command: number, payload = new Uint8Array()): Promise<Uint8Array> {
    if (this.closed || this.pending.has(command)) throw new Error("Dejen: соединение занято или закрыто")
    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose(new Error(`Dejen: нет ответа на команду 0x${command.toString(16)}. Проверьте модель и прошивку.`))
      }, 5000)
      this.pending.set(command, { resolve, reject, timer })
    })
    try {
      // Notifications may arrive before the ATT write completes. Await both
      // before allowing the next GATT operation.
      const [result] = await Promise.all([response, this.write(commandFrame(command, payload))])
      return result
    } catch (error) {
      this.dispose(error instanceof Error ? error : new Error("Dejen: ошибка команды"))
      throw error
    }
  }

  async waitReady() {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const status = await this.query(0x70)
      if (!status.length) throw new Error("Dejen: пустой ответ состояния")
      if (status[0] === 0) return
      if (status[0] !== 1 && status[0] !== 2) throw new Error(`Dejen: ${statusError(status[0])}`)
      await delay(250)
    }
    throw new Error("Dejen: принтер занят более 30 секунд")
  }
}

let activeSession: DejenSession | null = null

/** Read-only identification before any raster or paper-feed commands. */
export async function connectDejen(model: DejenModelName): Promise<DejenSession & { info: DejenPrinterInfo }> {
  if (typeof navigator === "undefined") throw new Error("Dejen: подключение доступно только в браузере")
  const bluetooth = (navigator as unknown as {
    bluetooth?: { requestDevice(options: unknown): Promise<DejenDevice> }
  }).bluetooth
  if (!bluetooth) throw new Error("Dejen: используйте Chrome на Android и HTTPS")
  let device: DejenDevice
  try {
    device = await bluetooth.requestDevice({
      filters: [{ namePrefix: model }],
      optionalServices: DEJEN_OPTIONAL_SERVICES,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === "NotFoundError") {
      const error = new Error(`Dejen ${model}: устройство не выбрано в окне Bluetooth. Выберите принтер и повторите подключение.`)
      error.name = "PrinterChooserCancelled"
      throw error
    }
    throw connectionError(`выбор устройства ${model}`, cause)
  }
  if (activeSession?.device.id === device.id && !activeSession.closed && device.gatt?.connected) {
    if (!activeSession.info || !new RegExp(`^${model}(?:[-_ ]|$)`, "i").test(activeSession.info.name)) {
      throw new Error("Dejen: подключён другой принтер. Выберите устройство заново.")
    }
    return activeSession as DejenSession & { info: DejenPrinterInfo }
  }
  activeSession?.dispose()
  const gatt = device.gatt
  if (!gatt) throw new Error("Dejen: устройство не предоставляет BLE GATT")
  let session: DejenSession | null = null
  let stage = `подключение к ${model}`
  try {
    await bounded(gatt.connect(), 10000, "Dejen: истекло время подключения")
    stage = `устройство выбрано, поиск BLE-сервисов Dejen (FF00, FFE0, E781)`
    const services = await bounded(gatt.getPrimaryServices(), 5000, "Dejen: не удалось прочитать BLE-сервисы")
    const candidates = DEJEN_SUPPORTED_SERVICES
      .map((uuid) => services.find((item) => item.uuid.toLowerCase() === uuid))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    let selected: { service: (typeof services)[number]; serviceUuid: string; tx: Characteristic; rx: Characteristic } | null = null
    for (const service of candidates) {
      const serviceUuid = service.uuid.toLowerCase()
      stage = `чтение характеристик BLE-сервиса ${service.uuid}`
      const characteristics = await bounded(service.getCharacteristics(), 5000, "Dejen: не удалось прочитать BLE-характеристики")
      const isSerialService = serviceUuid === NIIMBOT_SERIAL_SERVICE
      const txUuid = isSerialService ? NIIMBOT_SERIAL_WRITE : DEJEN_WRITE
      const rxUuid = isSerialService ? NIIMBOT_SERIAL_NOTIFY : DEJEN_NOTIFY
      const tx = characteristics.find((c) => c.uuid.toLowerCase() === txUuid && (c.properties.write || c.properties.writeWithoutResponse))
        ?? (serviceUuid !== DEJEN_SERVICE && isSerialService === false
          ? characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse)
          : undefined)
      const rx = characteristics.find((c) => c.uuid.toLowerCase() === rxUuid && (c.properties.notify || c.properties.indicate))
        ?? (serviceUuid !== DEJEN_SERVICE && !isSerialService
          ? characteristics.find((c) => c !== tx && (c.properties.notify || c.properties.indicate))
            ?? characteristics.find((c) => c === tx && (c.properties.notify || c.properties.indicate))
          : undefined)
      if (tx && rx) {
        selected = { service, serviceUuid, tx, rx }
        break
      }
    }
    if (!candidates.length) {
      const visible = services.map((item) => item.uuid).join(", ") || "нет разрешённых сервисов"
      throw new Error(`Dejen: сервис FF00/FFE0/E781 не найден. Доступны: ${visible}`)
    }
    if (!selected) throw new Error("Dejen: подходящие характеристики записи и уведомлений не найдены в разрешённых BLE-сервисах")
    const { serviceUuid, tx, rx } = selected
    const serviceFamily = serviceUuid === DEJEN_SERVICE ? "FF00"
      : serviceUuid === NIIMBOT_SERIAL_SERVICE ? "FFE0"
        : serviceUuid === DEJEN_VENDOR_SERVICE ? "E781" : selected.service.uuid
    session = new DejenSession(device, tx, rx)
    stage = `включение ответов принтера (${serviceFamily})`
    await bounded(rx.startNotifications(), 5000, "Dejen: не удалось включить ответы принтера")
    stage = "проверка модели (команда 0x79)"
    const nameBytes = await session.query(0x79)
    const name = new TextDecoder().decode(nameBytes).replace(/\0.*$/, "").trim()
    if (!new RegExp(`^${model}(?:[-_ ]|$)`, "i").test(name)) {
      throw new Error(`Dejen: выбран ${model}, но устройство сообщает «${name || "неизвестная модель"}». Печать заблокирована.`)
    }
    stage = "проверка разрешения (команда 0x71)"
    const dpiBytes = await session.query(0x71)
    const dpi = dpiBytes.length >= 2 ? (dpiBytes[0] << 8) | dpiBytes[1] : dpiBytes[0] ?? 0
    if (dpi !== 300) throw new Error(`Dejen: принтер сообщил ${dpi || "неизвестное"} dpi вместо 300 dpi. Печать заблокирована, чтобы не исказить размер.`)
    stage = "проверка ширины головки (команда 0x72)"
    const widthBytes = await session.query(0x72)
    const printheadPx = widthBytes.length >= 2 ? (widthBytes[0] << 8) | widthBytes[1] : 0
    if (printheadPx < 128 || printheadPx > 2048) throw new Error("Dejen: принтер не сообщил допустимую ширину головки")
    session.info = { name, dpi, printheadPx }
    activeSession = session
    return session as DejenSession & { info: DejenPrinterInfo }
  } catch (error) {
    if (session) session.dispose()
    else { try { gatt.disconnect() } catch { /* Preserve the original failure. */ } }
    // A missing service also raises NotFoundError. Do not let the UI translate
    // it into "no printer selected" after the user has already selected one.
    throw connectionError(stage, error)
  }
}

export async function printDejenRaster(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    model: DejenModelName
    copies: number
    density: number
    onProgress?: (value: string) => void
  },
) {
  if (!Number.isInteger(width) || width < 1 || width > 1528
    || !Number.isInteger(height) || height < 1 || height > 6000
    || rgba.length !== width * height * 4) throw new Error("Dejen: недопустимый размер растра")
  if (!Number.isInteger(options.copies) || options.copies < 1 || options.copies > 100) {
    throw new Error("Dejen: укажите от 1 до 100 копий")
  }
  if (!Number.isFinite(options.density)) throw new Error("Dejen: недопустимая плотность")
  const session = await connectDejen(options.model)
  if (width > session.info.printheadPx) throw new Error(`Dejen: макет ${width} px шире головки ${session.info.printheadPx} px`)
  let printTransmissionStarted = false
  try {
    for (let copy = 0; copy < options.copies; copy++) {
      await session.waitReady()
      // Follow the working Web Bluetooth flow: use the printer's saved paper
      // and darkness settings rather than waiting for unsupported 0x42/0x43
      // read-backs before the print job.
      const job = dothanTechPrintJob(rgba, width, height)
      let lastProgress = -1
      printTransmissionStarted = true
      await session.write(job, (fraction) => {
        const current = Math.floor(fraction * 100)
        if (current !== lastProgress) {
          lastProgress = current
          options.onProgress?.(`Передача Dejen: ${current}% · ${copy + 1}/${options.copies}`)
        }
      })
      await session.waitReady()
    }
    options.onProgress?.("Данные переданы Dejen. Проверьте напечатанную этикетку.")
  } catch (cause) {
    session.dispose()
    const outcome = printTransmissionStarted
      ? "Этикетка могла напечататься полностью или частично; проверьте принтер перед повтором."
      : "Данные этикетки не передавались; проверьте состояние принтера и повторите подключение."
    const error = new Error(`Передача Dejen прервана: ${cause instanceof Error ? cause.message : "ошибка"}. ${outcome}`)
    error.name = "DejenPrintError"
    throw error
  }
}
