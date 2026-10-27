import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'

/* Image fingerprints for the DMCA Daemon.
   - sha: sha256 of the raw bytes (equal means the very same file).
   - dhash: 64-bit difference hash. The image is reduced to a 9x8 grayscale grid by area averaging; bit (x, y) is set when
     cell (x, y) is darker than cell (x + 1, y). Two pictures that look alike differ in few bits (0 = same picture,
     about 32 = unrelated), and re-encoding or a small resize moves only a bit or two.
   - color: a coarse 4x4x4 RGB histogram, one hex nibble per bin (square-root scaled), compared by histogram intersection.
   - flat: the picture has almost no detail (a solid placeholder). Flat images are never used as evidence. */

export interface Fingerprint {
  sha: string
  /** 16 hex chars. */
  dhash: string
  /** 64 hex chars, one per colour bin. */
  color: string
  flat: boolean
}

export interface RawImage {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Decodes a JPEG, or returns null when the bytes are not a JPEG this decoder can read. */
export function decodeJpeg(bytes: Uint8Array): RawImage | null {
  try {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 24, maxMemoryUsageInMB: 256 })
    if (!img.width || !img.height || img.data.length < img.width * img.height * 4) return null
    return { width: img.width, height: img.height, data: img.data as Uint8Array }
  } catch {
    return null
  }
}

export function encodeJpeg(img: RawImage, quality: number): Buffer {
  return Buffer.from(jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data) }, quality).data)
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Area-averaged grayscale reduction to cols x rows. Every source pixel contributes in proportion to its overlap. */
export function grayGrid(img: RawImage, cols: number, rows: number): number[] {
  const { width: w, height: h, data } = img
  const out = new Array<number>(cols * rows).fill(0)
  for (let gy = 0; gy < rows; gy++) {
    const y0 = (gy * h) / rows
    const y1 = ((gy + 1) * h) / rows
    for (let gx = 0; gx < cols; gx++) {
      const x0 = (gx * w) / cols
      const x1 = ((gx + 1) * w) / cols
      let sum = 0
      let weight = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0)
          const i = (y * w + x) * 4
          const wt = wx * wy
          sum += luma(data[i], data[i + 1], data[i + 2]) * wt
          weight += wt
        }
      }
      out[gy * cols + gx] = weight > 0 ? sum / weight : 0
    }
  }
  return out
}

export function dHash(img: RawImage): string {
  const g = grayGrid(img, 9, 8)
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (g[y * 9 + x] < g[y * 9 + x + 1] ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

export function colorSignature(img: RawImage): string {
  const bins = new Array<number>(64).fill(0)
  const { width: w, height: h, data } = img
  // Every second pixel in each direction is plenty for a 64-bin histogram.
  let n = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      bins[((data[i] >> 6) << 4) | ((data[i + 1] >> 6) << 2) | (data[i + 2] >> 6)]++
      n++
    }
  }
  return bins.map((c) => Math.min(15, Math.round(Math.sqrt(c / n) * 15)).toString(16)).join('')
}

/** Standard deviation of the 9x8 grayscale grid; a solid or near-solid picture is below ~4. */
function isFlat(img: RawImage): boolean {
  const g = grayGrid(img, 9, 8)
  const mean = g.reduce((a, b) => a + b, 0) / g.length
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length)
  return sd < 4
}

/** Fingerprint raw bytes. `decoded` is null when the bytes could not be decoded (the sha is still returned). */
export function fingerprintBytes(bytes: Uint8Array): { fp: Fingerprint; image: RawImage } | null {
  const image = decodeJpeg(bytes)
  if (!image) return null
  return { fp: { sha: sha256(bytes), dhash: dHash(image), color: colorSignature(image), flat: isFlat(image) }, image }
}

/** Number of differing bits between two 16-hex-char dhashes (0 to 64). */
export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

/** Histogram intersection of two colour signatures, 0 to 1. */
export function colorSimilarity(a: string, b: string): number {
  let inter = 0
  let total = 0
  for (let i = 0; i < 64; i++) {
    const x = (parseInt(a[i], 16) / 15) ** 2
    const y = (parseInt(b[i], 16) / 15) ** 2
    inter += Math.min(x, y)
    total += Math.max(x, y)
  }
  return total > 0 ? inter / total : 0
}

/** Area-averaged resize, for the validation test (a rescaled copy must hash the same). */
export function resizeImage(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8Array(w * h * 4)
  for (let gy = 0; gy < h; gy++) {
    const y0 = (gy * img.height) / h
    const y1 = ((gy + 1) * img.height) / h
    for (let gx = 0; gx < w; gx++) {
      const x0 = (gx * img.width) / w
      const x1 = ((gx + 1) * img.width) / w
      let r = 0
      let g = 0
      let b = 0
      let weight = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wt = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy
          const i = (y * img.width + x) * 4
          r += img.data[i] * wt
          g += img.data[i + 1] * wt
          b += img.data[i + 2] * wt
          weight += wt
        }
      }
      const o = (gy * w + gx) * 4
      out[o] = Math.round(r / weight)
      out[o + 1] = Math.round(g / weight)
      out[o + 2] = Math.round(b / weight)
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}
