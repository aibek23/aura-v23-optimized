"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertTriangle, Image as ImageIcon, Keyboard, RefreshCw, X } from "lucide-react"

/**
 * Сканер QR / штрихкода.
 *
 * Ключевое: любой активный MediaStream хранится в activeStreamRef, а контроллер
 * ZXing — в controlsRef. При закрытии окна и при смене камеры оба ресурса
 * останавливаются, поэтому камера гарантированно освобождается.
 */
export function BarcodeScannerModal({
  onClose,
  onScan,
}: {
  onClose: () => void
  onScan: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeStreamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closedRef = useRef(false)

  const camerasRef = useRef<MediaDeviceInfo[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceIndex, setDeviceIndex] = useState(0)
  const [facing, setFacing] = useState<"environment" | "user">("environment")
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState("")
  const [manualMode, setManualMode] = useState(false)


  /** Полная остановка сканера и камеры. */
  const stopEverything = useCallback(() => {
    try {
      controlsRef.current?.stop()
    } catch {
      /* контроллер уже остановлен */
    }
    controlsRef.current = null

    try {
      readerRef.current = null
    } catch {
      /* ignore */
    }

    const stream = activeStreamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop()
        } catch {
          /* ignore */
        }
      })
      activeStreamRef.current = null
    }
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        /* ignore */
      }
      video.srcObject = null
    }
  }, [])

  const close = useCallback(() => {
    closedRef.current = true
    stopEverything()
    onClose()
  }, [onClose, stopEverything])

  const handleResult = useCallback(
    (text: string) => {
      if (closedRef.current) return
      closedRef.current = true
      stopEverything()
      onScan(text)
      onClose()
    },
    [onClose, onScan, stopEverything],
  )

  // Сброс "закрытого" состояния при каждом монтировании — иначе повторное
  // открытие окна стартует с closedRef === true и сканер сразу глушится.
  useEffect(() => {
    closedRef.current = false
    return () => {
      closedRef.current = true
    }
  }, [])

  // Запуск / перезапуск потока при смене камеры.
  // ВАЖНО: список камер НЕ входит в зависимости — раньше он приходил асинхронно
  // и вызывал второй запуск поверх ещё не освобождённого потока, из-за чего при
  // повторном открытии камера "зависала".
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      stopEverything()
      setError(null)

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Браузер не поддерживает камеру или страница открыта без HTTPS.")
        return
      }

      // Даём браузеру такт, чтобы полностью освободить устройство после
      // предыдущего сеанса (иначе getUserMedia может зависнуть).
      await new Promise((r) => setTimeout(r, 60))
      if (cancelled || closedRef.current) return

      const chosen = camerasRef.current[deviceIndex]
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: chosen?.deviceId
          ? { deviceId: { exact: chosen.deviceId } }
          : { facingMode: { ideal: facing } },
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        const name = (err as DOMException)?.name
        setError(
          name === "NotAllowedError"
            ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера или введите код вручную."
            : name === "NotFoundError"
              ? "Камера не найдена. Загрузите фото кода или введите его вручную."
              : "Не удалось запустить камеру. Загрузите фото кода или введите его вручную.",
        )
        return
      }

      if (cancelled || closedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      activeStreamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        activeStreamRef.current = null
        return
      }
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        /* автоплей может быть отложен — не критично */
      }

      // Список камер узнаём только ПОСЛЕ выдачи прав: enumerateDevices не
      // трогает камеру, в отличие от listVideoInputDevices() из ZXing.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = devices.filter((d) => d.kind === "videoinput")
        camerasRef.current = videoInputs
        if (!cancelled && !closedRef.current) setCameras(videoInputs)
      } catch {
        /* не критично — останется переключение по facingMode */
      }

      if (cancelled || closedRef.current) return

      // Каждый сеанс — свой экземпляр ридера: переиспользование старого
      // после stop() приводит к "мёртвому" декодеру при повторном открытии.
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader
      try {
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) handleResult(result.getText())
        })
        if (cancelled || closedRef.current) controls.stop()
        else controlsRef.current = controls
      } catch {
        if (!cancelled && !closedRef.current) {
          setError("Не удалось запустить распознавание. Попробуйте загрузить фото кода.")
        }
      }
    }

    void start()



    return () => {
      cancelled = true
      stopEverything()
    }
  }, [deviceIndex, facing, handleResult, stopEverything])

  // Esc закрывает окно и освобождает камеру.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])

  const switchCamera = () => {
    if (cameras.length > 1) {
      setDeviceIndex((i) => (i + 1) % cameras.length)
    } else {
      setFacing((f) => (f === "environment" ? "user" : "environment"))
    }
  }

  const decodeFile = async (file: File) => {
    setError(null)
    const url = URL.createObjectURL(file)
    try {
      const reader = readerRef.current ?? new BrowserMultiFormatReader()
      const result = await reader.decodeFromImageUrl(url)
      handleResult(result.getText())
    } catch {
      setError("На фото не найден QR или штрихкод. Попробуйте другое фото или введите код вручную.")
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4" onClick={close}>
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold">Сканирование кода</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-60 w-full object-cover" />
          {!error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-40 w-40 rounded-xl border-2 border-primary/70 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/95 px-5 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          )}
        </div>

        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 bg-transparent text-xs" onClick={switchCamera}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Сменить камеру
            </Button>
            <Button
              variant="outline"
              className="flex-1 bg-transparent text-xs"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon className="mr-1.5 h-4 w-4" />
              Фото из галереи
            </Button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void decodeFile(file)
            }}
          />

          {manualMode ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const code = manual.trim()
                if (code) handleResult(code)
              }}
            >
              <Input
                autoFocus
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Введите артикул или код"
                className="h-9 text-xs"
              />
              <Button type="submit" className="h-9 text-xs" disabled={!manual.trim()}>
                Найти
              </Button>
            </form>
          ) : (
            <Button variant="ghost" className="w-full text-xs" onClick={() => setManualMode(true)}>
              <Keyboard className="mr-1.5 h-4 w-4" />
              Ввести код вручную
            </Button>
          )}

          <p className="text-center text-[11px] text-muted-foreground">Наведите камеру на бирку изделия</p>
        </div>
      </div>
    </div>
  )
}
