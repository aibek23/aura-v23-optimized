/**
 * Independent implementation of the published DothanTech wire format.
 * Reference: https://github.com/sb-child/dz-print/blob/master/protocol.md
 * No manufacturer SDK binary or third-party source code is bundled.
 */

/** @param {number} command @param {Uint8Array} [payload] */
export function commandFrame(command, payload = new Uint8Array()) {
  if (!Number.isInteger(command) || command < 0 || command > 255 || payload.length > 2048) {
    throw new Error("Invalid Dejen command")
  }
  const length = payload.length < 192
    ? [payload.length]
    : [0xc0 | (payload.length >> 8), payload.length & 255]
  const frame = new Uint8Array(3 + length.length + payload.length)
  frame.set([0x1f, command, ...length])
  frame.set(payload, 2 + length.length)
  let sum = 0
  for (let i = 1; i < frame.length - 1; i++) sum += frame[i]
  frame[frame.length - 1] = (sum & 255) ^ 255
  return frame
}

/** @param {number} contentWidthPx @param {number} dpi @param {number} [printableWidthMm] */
export function dejenPageWidthPx(contentWidthPx, dpi, printableWidthMm) {
  if (!Number.isInteger(contentWidthPx) || contentWidthPx < 1
    || !Number.isFinite(dpi) || dpi < 1) {
    throw new Error("Invalid Dejen print dimensions")
  }
  const pageWidth = printableWidthMm
    ? Math.floor(printableWidthMm * dpi / 25.4)
    : contentWidthPx
  if (!Number.isFinite(pageWidth) || pageWidth < contentWidthPx) {
    throw new Error("Dejen label exceeds the printable page width")
  }
  return pageWidth
}

export class FrameDecoder {
  buffer = new Uint8Array()

  /** Handles split notifications, concatenated frames and invalid checksums.
   * @param {Uint8Array} chunk
   * @returns {{ command: number, payload: Uint8Array }[]}
   */
  push(chunk) {
    if (chunk.length + this.buffer.length > 8192) this.buffer = new Uint8Array()
    const joined = new Uint8Array(this.buffer.length + chunk.length)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.length)
    this.buffer = joined
    const frames = []
    while (this.buffer.length >= 4) {
      if (this.buffer[0] !== 0x1f) {
        this.buffer = this.buffer.slice(1)
        continue
      }
      const wide = (this.buffer[2] & 0xc0) === 0xc0
      const prefix = wide ? 4 : 3
      const size = wide
        ? ((this.buffer[2] & 0x3f) << 8) | this.buffer[3]
        : this.buffer[2]
      if (size > 2048) {
        this.buffer = this.buffer.slice(1)
        continue
      }
      const total = prefix + size + 1
      if (this.buffer.length < total) break
      let sum = 0
      for (let i = 1; i < total - 1; i++) sum += this.buffer[i]
      const checksum = this.buffer[total - 1]
      if (checksum !== 0x88 && checksum !== ((sum & 255) ^ 255)) {
        this.buffer = this.buffer.slice(1)
        continue
      }
      frames.push({ command: this.buffer[1], payload: this.buffer.slice(prefix, total - 1) })
      this.buffer = this.buffer.slice(total)
    }
    return frames
  }
}

/**
 * A raster line uses an unframed 1F 2A command, little-endian dot count,
 * black=1, most-significant bit first. Transparent pixels are composited on white.
 * @param {Uint8ClampedArray} rgba One row of RGBA pixels.
 * @param {number} width
 */
export function rasterRow(rgba, width) {
  if (!Number.isInteger(width) || width < 1 || width > 1528 || rgba.length !== width * 4) {
    throw new Error("Invalid Dejen raster row")
  }
  const row = new Uint8Array(4 + Math.ceil(width / 8))
  row.set([0x1f, 0x2a, width & 255, width >> 8])
  for (let x = 0; x < width; x++) {
    const i = x * 4
    const alpha = rgba[i + 3] / 255
    const luma = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) * alpha
      + 255 * (1 - alpha)
    if (luma < 128) row[4 + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return row
}

/**
 * Encode a label bitmap using the DothanTech FF00/FF02/FF01 Web-Bluetooth
 * command stream (print init, line width, compressed print lines, print end).
 * The device itself remains gated by the model/DPI/head-width checks in the
 * caller; this helper only converts the supplied raster into protocol frames.
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {{ pageKey?: number; threshold?: number }} [options]
 */
export function dothanTechPrintJob(rgba, width, height, options = {}) {
  if (!Number.isInteger(width) || width < 1 || width > 1528
    || !Number.isInteger(height) || height < 1 || height > 6000
    || rgba.length !== width * height * 4) {
    throw new Error("Invalid DothanTech print raster")
  }
  const threshold = options.threshold ?? 192
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error("Invalid DothanTech threshold")
  }
  const pageKey = options.pageKey ?? Math.floor(Math.random() * 0xffff)
  if (!Number.isInteger(pageKey) || pageKey < 0 || pageKey > 0xffff) {
    throw new Error("Invalid DothanTech page key")
  }
  const encodeShort = (value) => value < 192
    ? [value]
    : [0xc0 | ((value >> 8) & 0x3f), value & 0xff]
  const commands = []
  const append = (command, payload = []) => {
    commands.push(...commandFrame(command, Uint8Array.from(payload)))
  }
  const lineBytes = Math.ceil(width / 8)
  append(0x20, [(pageKey >> 8) & 0xff, pageKey & 0xff, 0, 0, 0, 0, 0, 0])
  append(0x27, [...encodeShort(lineBytes), 1])

  const encodeLine = (y) => {
    const line = new Uint8Array(lineBytes)
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4
      const alpha = rgba[pixel + 3] / 255
      const gray = (rgba[pixel] + rgba[pixel + 1] + rgba[pixel + 2]) / 3 * alpha + 255 * (1 - alpha)
      if (gray < threshold) line[x >> 3] |= 1 << (7 - (x & 7))
    }
    return line
  }
  const appendCompressedLine = (line, repeats) => {
    let offset = 0
    while (offset < line.length && line[offset] === 0) offset++
    append(0x21, [...encodeShort(repeats - 1), ...encodeShort(offset), ...line.slice(offset)])
  }

  let previous = null
  let repeatCount = 0
  for (let y = 0; y < height; y++) {
    const line = encodeLine(y)
    const same = previous && line.every((byte, index) => byte === previous[index])
    if (same) {
      repeatCount++
      continue
    }
    if (previous) appendCompressedLine(previous, repeatCount)
    previous = line
    repeatCount = 1
  }
  if (previous) appendCompressedLine(previous, repeatCount)
  append(0x28)
  return Uint8Array.from(commands)
}
