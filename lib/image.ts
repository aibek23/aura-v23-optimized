"use client"

/**
 * Клиентское сжатие изображений в WebP.
 * Каждый файл (загруженный или снятый камерой) ужимается до <= MAX_BYTES
 * перед отправкой в Supabase Storage.
 */

export const MAX_BYTES = 250 * 1024 // 250 Кб
const MAX_SIDE = 1600

async function loadBitmap(file: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file)
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("Не удалось прочитать изображение"))
      el.src = url
    })
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", quality))
}

/** Сжимает изображение до webp размером не более MAX_BYTES. */
export async function compressToWebp(file: Blob, maxBytes = MAX_BYTES): Promise<Blob> {
  const src = await loadBitmap(file)

  let scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height))
  let quality = 0.85
  let out: Blob | null = null

  for (let attempt = 0; attempt < 8; attempt++) {
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) break
    src.draw(ctx, w, h)

    out = await toBlob(canvas, quality)
    if (!out) break
    if (out.size <= maxBytes) return out

    if (quality > 0.45) quality -= 0.15
    else scale *= 0.8
  }

  if (!out) throw new Error("Не удалось сжать изображение")
  return out
}

export function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Кб`
  return `${(bytes / 1024 / 1024).toFixed(1)} Мб`
}
