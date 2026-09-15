/**
 * Короткие звуковые сигналы для сканера.
 *
 * Используется Web Audio API: сигнал синтезируется на лету, поэтому не нужны
 * аудиофайлы и он мгновенно доступен на кассе. Контекст создаётся один раз и
 * переиспользуется — повторные сканирования не «залипают» на разблокировке.
 */

const SCAN_FREQUENCY = 2489
const SCAN_DURATION_MS = 90
const ERROR_FREQUENCY = 320
const ERROR_DURATION_MS = 260

let audioContext: AudioContext | null = null

type AudioContextCtor = typeof AudioContext

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

function getAudioContext(): AudioContext | null {
  const Ctor = resolveAudioContextCtor()
  if (!Ctor) return null
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new Ctor()
    } catch {
      return null
    }
  }
  return audioContext
}

function tone(frequency: number, durationMs: number, volume: number): void {
  const ctx = getAudioContext()
  if (!ctx) return

  // Браузер может держать контекст в suspended после первого запуска.
  if (ctx.state === "suspended") void ctx.resume()

  const startAt = ctx.currentTime
  const endAt = startAt + durationMs / 1000

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = "square"
  oscillator.frequency.setValueAtTime(frequency, startAt)

  // Резкая атака и короткий спад — «пик» кассового аппарата.
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.start(startAt)
  oscillator.stop(endAt + 0.02)
}

/** Одиночный «пик» при успешном распознавании кода. */
export function playScanBeep(): void {
  tone(SCAN_FREQUENCY, SCAN_DURATION_MS, 0.22)
}

/** Двойной низкий сигнал — код прочитан частично / ошибка. */
export function playScanError(): void {
  tone(ERROR_FREQUENCY, ERROR_DURATION_MS, 0.18)
}
