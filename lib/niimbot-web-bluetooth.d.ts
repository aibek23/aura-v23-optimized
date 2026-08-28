// Пакет niimbot-web-bluetooth — zero-dependency CJS-скрипт, который при загрузке
// регистрирует API в globalThis.Niimbot (собственных ESM-экспортов у него нет).

/**
 * Ювелирные форматы бирок, поддерживаемые в v15.
 * Размеры в мм: T<ширина>*<высота>+<хвостик> или T<ш>*<в>-<прямоугольник>.
 * Пиксели рассчитаны по 203 dpi принтера Niimbot B1.
 */
declare module "niimbot-web-bluetooth" {
  const _default: unknown
  export default _default
}

declare module "niimbot-web-bluetooth/registry.json" {
  const registry: {
    models: Record<string, NiimbotModel>
    sizes: Record<string, NiimbotSize>
    default_model: string
    default_size: string
  }
  export default registry
}



type NiimbotModel = {
  label: string
  id: number
  dpi: number
  protocol: string
  task: string
  density: number
  label_type: number
  speed: number
  name_prefixes: string[]
}

type NiimbotSize = {
  w_px: number
  h_px: number
  dpi?: number
  offset_y_px?: number
}

type NiimbotApi = {
  isSupported: () => boolean
  connect: (model: NiimbotModel) => Promise<unknown>
  disconnect: () => Promise<void> | void
  printImage: (
    url: string,
    opts: {
      model: NiimbotModel
      size: NiimbotSize
      copies?: number
      density?: number
      offsetY?: number
      onProgress?: (s: string) => void
    },
  ) => Promise<void>
  /**
   * Форсировать режим BLE-записи.
   * "paced" — unacked + задержка PACE_MS мс (обязателен для B1 203 dpi).
   * "acked" — write-with-response (медленно, но гарантировано).
   * "fast"  — unacked без задержки (B1 Pro и аналоги).
   * null    — авто-определение при connect().
   */
  WRITE_MODE: "fast" | "paced" | "acked" | null
  /** Задержка в мс между unacked BLE-записями в режиме "paced". По умолчанию 10. */
  PACE_MS: number
  /** Текущий детектированный режим записи (readonly). */
  readonly DETECTED_WRITE_MODE: string
  /** Текущий эффективный режим с учётом override (readonly). */
  readonly EFFECTIVE_WRITE_MODE: string
}

interface Window {
  Niimbot?: NiimbotApi
}
