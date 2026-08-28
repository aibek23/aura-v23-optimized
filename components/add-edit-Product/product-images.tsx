"use client"

import { useCallback, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { compressToWebp, humanSize, MAX_BYTES } from "@/lib/image"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Camera, ImagePlus, Loader2, X } from "lucide-react"
import { CameraCapture } from "@/components/add-edit-Product/camera-capture"

const BUCKET = "product-images"

async function uploadOne(file: Blob) {
  const supabase = createClient()
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
  const { error } = await supabase.storage.from(BUCKET).upload(name, file, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(name)
  return data.publicUrl
}

export function ProductImages({
  images,
  onChange,
}: {
  images: string[]
  onChange: (next: string[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    const urls: string[] = []
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue
        const compressed = await compressToWebp(file)
        urls.push(await uploadOne(compressed))
      }
      if (urls.length) {
        onChange([...images, ...urls])
        toast.success(`Загружено фото: ${urls.length}`)
      }
    } catch (e) {
      console.error("[aura] upload error:", e)
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить фото")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const addBlobRef = useRef<(blob: Blob) => Promise<void>>(async () => {})

  const addBlob = async (blob: Blob) => {
    setBusy(true)
    try {
      const compressed = await compressToWebp(blob)
      const url = await uploadOne(compressed)
      onChange([...images, url])
      toast.success(`Фото добавлено (${humanSize(compressed.size)})`)
    } catch (e) {
      console.error("[aura] capture error:", e)
      toast.error("Не удалось сохранить снимок")
    } finally {
      setBusy(false)
    }
  }

  addBlobRef.current = addBlob

  // Стабильные колбэки: перерисовки формы не трогают слой камеры.
  const closeCamera = useCallback(() => setCamera(false), [])
  const captureCamera = useCallback((blob: Blob) => addBlobRef.current(blob), [])

  return (
    <div className="grid gap-2 relative">
      {camera && <CameraCapture onClose={closeCamera} onCapture={captureCamera} />}
      <Label>Фотографии товара</Label>

      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={url + i} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Фото ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Удалить фото"
              onClick={() => onChange(images.filter((_, idx) => idx !== i))}
              className="absolute right-0.5 top-0.5 rounded-full bg-background/85 p-0.5 text-destructive shadow"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          <span className="text-[10px]">Загрузить</span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setCamera(true)}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Camera className="h-5 w-5" />
          <span className="text-[10px]">Сделать фото</span>
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Каждое фото автоматически сжимается в WebP до {Math.round(MAX_BYTES / 1024)} Кб.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      
    </div>
  )
}