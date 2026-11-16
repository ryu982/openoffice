// Minimal PNG writer for rendered faces (8-bit gray or RGB, no alpha), on node:zlib.
import { deflateSync } from 'node:zlib'

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) c = CRC_TABLE[(c ^ part[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8)
  const view = new DataView(head.buffer)
  view.setUint32(0, data.length)
  const name = new TextEncoder().encode(type)
  head.set(name, 4)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, crc32([name, data]))
  const out = new Uint8Array(head.length + data.length + tail.length)
  out.set(head, 0)
  out.set(data, head.length)
  out.set(tail, head.length + data.length)
  return out
}

/**
 * Encodes rows of `channels` bytes a pixel (1 = gray, 3 = RGB), no row padding.
 * Every row uses the "up" filter, which suits page renders (long runs of white
 * and repeated rows) and costs one subtraction a byte.
 */
export function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3,
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`invalid PNG size ${width}x${height}`)
  }
  const rowBytes = width * channels
  if (pixels.length < rowBytes * height) throw new Error('PNG pixel buffer is too short')
  const filtered = new Uint8Array((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    const to = y * (rowBytes + 1)
    const from = y * rowBytes
    filtered[to] = 2
    if (y === 0) {
      filtered.set(pixels.subarray(from, from + rowBytes), to + 1)
    } else {
      const above = from - rowBytes
      for (let i = 0; i < rowBytes; i++) {
        filtered[to + 1 + i] = (pixels[from + i]! - pixels[above + i]!) & 0xff
      }
    }
  }
  const header = new Uint8Array(13)
  const hv = new DataView(header.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = channels === 1 ? 0 : 2 // gray or truecolor
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace
  const idat = deflateSync(filtered)
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
