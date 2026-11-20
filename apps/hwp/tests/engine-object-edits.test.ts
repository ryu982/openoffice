/**
 * The engine's object edits behind Hangul's object drags and keys (decision 0153): a picture's
 * crop measured against the image (rhwp patch 0052), pictures ordered with the shapes (0053), and
 * a floating object copied into its own paragraph (0054). Runs the vendored engine itself.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** A w×h PNG, its left half red and its right half blue. */
function png(w: number, h: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8
  header[9] = 2
  const rows: number[] = []
  for (let y = 0; y < h; y++) {
    rows.push(0)
    for (let x = 0; x < w; x++) rows.push(...(x < w / 2 ? [255, 0, 0] : [0, 0, 255]))
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

interface Control {
  type: string
  paraIdx: number
  controlIdx: number
  zOrder: number
  x: number
  y: number
}

/** A blank document with a line of text and a 40×20 px picture drawn 8000×4000 HU. */
function withPicture(): { doc: HwpDocument; pictures: () => Control[] } {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '앞 문단 글')
  doc.insertPictureEx(
    JSON.stringify({
      sectionIdx: 0,
      paraIdx: 0,
      charOffset: 0,
      width: 8000,
      height: 4000,
      naturalWidthPx: 40,
      naturalHeightPx: 20,
      extension: 'png',
    }),
    png(40, 20),
  )
  const pictures = () =>
    (JSON.parse(doc.getPageControlLayout(0)).controls as Control[]).filter(
      (c) => c.type === 'image',
    )
  return { doc, pictures }
}

const propsOf = (doc: HwpDocument, c: Control) =>
  JSON.parse(doc.getPictureProperties(0, c.paraIdx, c.controlIdx))

describe("a picture's crop (patch 0052)", () => {
  it('reads an inserted picture as not cropped, and names the image it crops', () => {
    const { doc, pictures } = withPicture()
    const p = propsOf(doc, pictures()[0])
    expect([p.cropLeft, p.cropTop, p.cropRight, p.cropBottom]).toEqual([0, 0, 0, 0])
    // the crop's own units: 40×20 px × 75
    expect([p.cropExtentWidth, p.cropExtentHeight]).toEqual([3000, 1500])
  })

  it('draws the part of the image a crop keeps', () => {
    const { doc, pictures } = withPicture()
    const pic = pictures()[0]
    doc.setPictureProperties(
      0,
      pic.paraIdx,
      pic.controlIdx,
      JSON.stringify({ cropRight: 1500, width: 4000 }),
    )
    const svg = doc.renderPageSvg(0)
    // the left half of the 40×20 px image, in a frame half as wide
    expect(svg).toMatch(/viewBox="0 0 20 20"[^>]*>\s*<image width="40" height="20"/)
  })

  it('puts the crop back with the frame when a resize is undone', () => {
    const { doc, pictures } = withPicture()
    const pic = pictures()[0]
    const id = doc.capturePictureTransform(
      JSON.stringify({ sec: 0, ppi: pic.paraIdx, ci: pic.controlIdx }),
    )
    doc.setPictureProperties(
      0,
      pic.paraIdx,
      pic.controlIdx,
      JSON.stringify({ cropRight: 1500, width: 4000 }),
    )
    doc.swapPictureTransform(id)
    expect(propsOf(doc, pic)).toMatchObject({ cropRight: 0, width: 8000 })
    doc.swapPictureTransform(id)
    expect(propsOf(doc, pic)).toMatchObject({ cropRight: 1500, width: 4000 })
  })
})

describe('pictures in the z order (patch 0053)', () => {
  it('bring a picture to the front, and put it back from the recorded moves', () => {
    const { doc, pictures } = withPicture()
    doc.insertPictureEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: 0,
        charOffset: 0,
        width: 4000,
        height: 4000,
        naturalWidthPx: 20,
        naturalHeightPx: 10,
        extension: 'png',
      }),
      png(20, 10),
    )
    const [first, second] = pictures()
    const done = JSON.parse(doc.changeShapeZOrder(0, first.paraIdx, first.controlIdx, 'front'))
    expect(done.ok).toBe(true)
    expect(done.moves).toHaveLength(1)
    const z = (c: Control) =>
      pictures().find((x) => x.paraIdx === c.paraIdx && x.controlIdx === c.controlIdx)!.zOrder
    expect(z(first)).toBeGreaterThan(z(second))
    const back = done.moves.map((m: { ppi: number; ci: number; before: number }) => ({
      ppi: m.ppi,
      ci: m.ci,
      z: m.before,
    }))
    expect(JSON.parse(doc.applyShapeZOrderPairs(0, JSON.stringify(back))).ok).toBe(true)
    expect(z(first)).toBe(z(second))
  })
})

describe('a floating object copied in its own paragraph (patch 0054)', () => {
  it('adds the copy, moved, without a new paragraph or a change to the text', () => {
    const { doc, pictures } = withPicture()
    const source = pictures()[0]
    const was = propsOf(doc, source)
    const paragraphs = doc.getParagraphCount(0)
    const text = doc.getTextRange(0, 0, 0, 100)
    const done = JSON.parse(
      doc.duplicateFloatingControl(0, source.paraIdx, source.controlIdx, 750, 1500),
    )
    expect(done.ok).toBe(true)
    expect(doc.getParagraphCount(0)).toBe(paragraphs)
    expect(doc.getTextRange(0, 0, 0, 100)).toBe(text)
    expect(pictures()).toHaveLength(2)
    const copy = JSON.parse(doc.getPictureProperties(0, done.paraIdx, done.controlIdx))
    expect([copy.horzOffset, copy.vertOffset]).toEqual([
      was.horzOffset + 750,
      was.vertOffset + 1500,
    ])
    expect([copy.width, copy.height]).toEqual([was.width, was.height])
    expect(propsOf(doc, source)).toMatchObject({
      horzOffset: was.horzOffset,
      vertOffset: was.vertOffset,
    })
  })

  it('keeps the copy through saving as .hwp and .hwpx', () => {
    const { doc, pictures } = withPicture()
    const source = pictures()[0]
    doc.duplicateFloatingControl(0, source.paraIdx, source.controlIdx, 750, 0)
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      const again = new HwpDocument(bytes)
      const count = JSON.parse(again.getPageControlLayout(0)).controls.filter(
        (c: Control) => c.type === 'image',
      ).length
      expect(count).toBe(2)
    }
  })

  it('refuses what is not a floating picture or shape', () => {
    const { doc } = withPicture()
    // control 0 of the first paragraph is the section definition
    expect(() => doc.duplicateFloatingControl(0, 0, 0, 0, 0)).toThrow()
    expect(() => doc.duplicateFloatingControl(0, 99, 0, 0, 0)).toThrow()
  })
})
