"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Camera, Loader2, X } from "lucide-react"

interface CameraCaptureProps {
  onClose: () => void
  onCapture: (blob: Blob) => void | Promise<void>
}

/**
 * Независимый слой камеры.
 *
 * Живёт в портале прямо в <body>, поэтому не зависит от вёрстки модального окна
 * товара (никаких transform/overflow родителя → нет скролла и обрезки).
 * Колбэки хранятся в ref, поэтому перерисовки формы НЕ перезапускают поток
 * камеры и не приводят к утечке MediaStream.
 */
function CameraCaptureInner({ onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Стабильные ссылки на колбэки — не влияют на жизненный цикл потока.
  const cbRef = useRef({ onClose, onCapture })
  cbRef.current = { onClose, onCapture }

  useEffect(() => setMounted(true), [])

  // Блокируем скролл страницы под камерой.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Один запуск потока на весь жизненный цикл слоя + гарантированная остановка.
  useEffect(() => {
    let cancelled = false
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (e) {
        console.error("[aura] camera error:", e)
        if (!cancelled) setError("Нет доступа к камере устройства")
      }
    }

    void start()

    const onVisibility = () => {
      if (document.visibilityState === "hidden") videoRef.current?.pause()
      else void videoRef.current?.play().catch(() => {})
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [])

  // Esc закрывает камеру.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        cbRef.current.onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  const shoot = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    setShooting(true)
    try {
      const canvas = document.createElement("canvas")
      let width = video.videoWidth
      let height = video.videoHeight

      const MAX_DIM = 1280
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width)
          width = MAX_DIM
        } else {
          width = Math.round((width * MAX_DIM) / height)
          height = MAX_DIM
        }
      }

      canvas.width = width
      canvas.height = height
      canvas.getContext("2d")?.drawImage(video, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.9))
      if (blob) {
        // Сначала закрываем слой (камера освобождается сразу), затем отдаём кадр.
        cbRef.current.onClose()
        void cbRef.current.onCapture(blob)
      }
    } finally {
      setShooting(false)
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] overflow-hidden bg-black"
      style={{ height: "100dvh", width: "100vw", touchAction: "none" }}
      onPointerDownCapture={(e) => e.stopPropagation()}
    >
      {error ? (
        <div className="flex h-full w-full items-center justify-center p-6">
          <p className="text-center text-sm text-white">{error}</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      <button
        type="button"
        aria-label="Закрыть камеру"
        onClick={() => cbRef.current.onClose()}
        className="absolute right-4 top-4 rounded-full bg-white/15 p-2.5 text-white backdrop-blur transition-colors hover:bg-white/25"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-10">
        <button
          type="button"
          onClick={() => void shoot()}
          disabled={!!error || shooting}
          aria-label="Снять фото"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-lg ring-4 ring-white/30 transition-transform active:scale-95 disabled:opacity-50"
        >
          {shooting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export const CameraCapture = memo(CameraCaptureInner)
