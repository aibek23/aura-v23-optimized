/**
 * Image compression utility for Local-First CRM.
 * Requirement:
 * - Never store raw high-res images directly.
 * - Compress upload to ~1000px WebP before sending to cloud.
 * - Store small thumbnail (~200px) in local database.
 * - Full image loaded lazily on demand from network.
 */

export interface CompressedImageResult {
  fullBlob: Blob
  thumbnailDataUrl: string
  width: number
  height: number
}

export async function compressProductImage(
  file: File | Blob
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        try {
          // 1. Generate ~1000px full WebP image
          const maxDimension = 1000
          let targetWidth = img.width
          let targetHeight = img.height

          if (img.width > maxDimension || img.height > maxDimension) {
            if (img.width > img.height) {
              targetWidth = maxDimension
              targetHeight = Math.round((img.height * maxDimension) / img.width)
            } else {
              targetHeight = maxDimension
              targetWidth = Math.round((img.width * maxDimension) / img.height)
            }
          }

          const canvas = document.createElement('canvas')
          canvas.width = targetWidth
          canvas.height = targetHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Could not get canvas context')
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

          canvas.toBlob(
            (fullBlob) => {
              if (!fullBlob) {
                reject(new Error('Canvas toBlob failed'))
                return
              }

              // 2. Generate ~200px thumbnail for instant local grid rendering
              const thumbMax = 200
              let thumbWidth = img.width
              let thumbHeight = img.height
              if (img.width > thumbMax || img.height > thumbMax) {
                if (img.width > img.height) {
                  thumbWidth = thumbMax
                  thumbHeight = Math.round((img.height * thumbMax) / img.width)
                } else {
                  thumbHeight = thumbMax
                  thumbWidth = Math.round((img.width * thumbMax) / img.height)
                }
              }

              const thumbCanvas = document.createElement('canvas')
              thumbCanvas.width = thumbWidth
              thumbCanvas.height = thumbHeight
              const thumbCtx = thumbCanvas.getContext('2d')
              if (!thumbCtx) throw new Error('Could not get thumbnail canvas context')
              thumbCtx.drawImage(img, 0, 0, thumbWidth, thumbHeight)

              const thumbnailDataUrl = thumbCanvas.toDataURL('image/webp', 0.8)

              resolve({
                fullBlob,
                thumbnailDataUrl,
                width: targetWidth,
                height: targetHeight,
              })
            },
            'image/webp',
            0.82
          )
        } catch (err) {
          reject(err)
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
