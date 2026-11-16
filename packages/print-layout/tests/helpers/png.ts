import { inflateSync } from 'node:zlib'

export interface DecodedPng {
  width: number
  height: number
  /** 1 = gray, 3 = RGB */
  channels: number
  pixels: Uint8Array
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Reads an 8-bit, non-interlaced gray or RGB PNG (any row filter). */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  sig.forEach((b, i) => {
    if (bytes[i] !== b) throw new Error('not a PNG')
  })
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  while (at < bytes.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      if (data[8] !== 8) throw new Error('only 8-bit')
      channels = data[9] === 0 ? 1 : data[9] === 2 ? 3 : 0
      if (!channels) throw new Error(`colour type ${data[9]}`)
    } else if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const row = width * channels
  const out = new Uint8Array(row * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)]
    for (let i = 0; i < row; i++) {
      const x = raw[y * (row + 1) + 1 + i]!
      const a = i >= channels ? out[y * row + i - channels]! : 0
      const b = y > 0 ? out[(y - 1) * row + i]! : 0
      const c = y > 0 && i >= channels ? out[(y - 1) * row + i - channels]! : 0
      const v =
        filter === 0
          ? x
          : filter === 1
            ? x + a
            : filter === 2
              ? x + b
              : filter === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c)
      out[y * row + i] = v & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

/** Mean of the first channel over a box given as fractions of the image. */
export function meanLevel(
  img: { width: number; height: number; channels: number; pixels: Uint8Array },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const xa = Math.floor(img.width * x0)
  const xb = Math.max(xa + 1, Math.floor(img.width * x1))
  const ya = Math.floor(img.height * y0)
  const yb = Math.max(ya + 1, Math.floor(img.height * y1))
  let sum = 0
  let n = 0
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      sum += img.pixels[(y * img.width + x) * img.channels]!
      n++
    }
  }
  return sum / n
}
