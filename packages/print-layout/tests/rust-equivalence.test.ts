import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import {
  degrees,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  arrangePrintJob,
  createDefaultOptions,
  encodePng,
  grayscalePdf,
  PrintLayoutError,
  readJobPageSizes,
  rotateLandscapeFaces,
  type PrintLayoutOptions,
} from '../src/index'
import { convertBgrxPixels, encodeBgrxToPng } from '../src/raster'
import { ensurePrintLayoutWasm, resetPrintLayoutWasmForTests } from '../src/wasm'
import { makeBoxJob } from './helpers/boxes'
import { A3, A4, A5, makeJob, readFaces, readLines, type SourcePage } from './helpers/pdf'
import { decodePng } from './helpers/png'

const savedEnv = {
  rust: process.env.GENOFFICE_PRINT_LAYOUT_RUST,
  wasmPath: process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH,
}
const tempDirs: string[] = []

afterEach(async () => {
  if (savedEnv.rust === undefined) delete process.env.GENOFFICE_PRINT_LAYOUT_RUST
  else process.env.GENOFFICE_PRINT_LAYOUT_RUST = savedEnv.rust
  if (savedEnv.wasmPath === undefined) delete process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH
  else process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH = savedEnv.wasmPath
  resetPrintLayoutWasmForTests()
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function opts(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

async function withMode<T>(rust: boolean, fn: () => Promise<T>): Promise<T> {
  process.env.GENOFFICE_PRINT_LAYOUT_RUST = rust ? '1' : '0'
  delete process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH
  resetPrintLayoutWasmForTests()
  return fn()
}

describe('Rust WASM vs JS equivalence', () => {
  it('readJobPageSizes matches across rotated, mixed-size, and offset-origin pages', async () => {
    const pages: SourcePage[] = [
      { ...A4, label: 'P1' },
      { ...A4, rotate: 90, label: 'P2' },
      { ...A3, rotate: 180, label: 'P3' },
      { ...A5, rotate: 270, origin: { x: 40, y: 60 }, label: 'P4' },
    ]
    const job = await makeJob(pages)
    const rust = await withMode(true, () => readJobPageSizes(job))
    const js = await withMode(false, () => readJobPageSizes(job))
    expect(rust).toHaveLength(js.length)
    for (let i = 0; i < js.length; i++) {
      expect(rust[i]!.widthPt).toBeCloseTo(js[i]!.widthPt, 3)
      expect(rust[i]!.heightPt).toBeCloseTo(js[i]!.heightPt, 3)
    }
  })

  const scenarios: Array<[string, PrintLayoutOptions]> = [
    [
      '2-up row',
      opts((o) => {
        o.mode = 'nup'
        o.nup = { count: 2, order: 'row' }
      }),
    ],
    [
      '4-up column',
      opts((o) => {
        o.mode = 'nup'
        o.nup = { count: 4, order: 'column' }
      }),
    ],
    [
      'booklet left',
      opts((o) => {
        o.mode = 'booklet'
        o.booklet.binding = 'left'
      }),
    ],
    [
      'booklet right odd reverse',
      opts((o) => {
        o.mode = 'booklet'
        o.booklet.binding = 'right'
        o.sides = 'odd'
        o.reverse = true
      }),
    ],
    [
      'poster 2x2 cut marks',
      opts((o) => {
        o.mode = 'poster'
        o.poster = { cols: 2, rows: 2, overlapMm: 10, cutMarks: true }
      }),
    ],
    [
      'labels sequence',
      opts((o) => {
        o.mode = 'labels'
        o.labels.startCell = 20
      }),
    ],
    [
      'labels repeat',
      opts((o) => {
        o.mode = 'labels'
        o.labels = { ...o.labels, fill: 'repeat', repeatPage: 2, startCell: 15 }
      }),
    ],
    [
      'single fit A4',
      opts((o) => {
        o.paper = 'A4'
        o.fitToPaper = true
      }),
    ],
  ]

  for (const [name, option] of scenarios) {
    it(`arrangePrintJob matches JS output for ${name}`, async () => {
      const job = await makeJob([
        { ...A4, label: 'P1' },
        { ...A4, rotate: 90, label: 'P2' },
        { ...A3, label: 'P3' },
        { ...A5, origin: { x: 30, y: 50 }, label: 'P4' },
        { ...A4, rotate: 270, label: 'P5' },
      ])
      const rustPdf = await withMode(true, () => arrangePrintJob(job, option))
      const jsPdf = await withMode(false, () => arrangePrintJob(job, option))

      const rustFaces = await readFaces(rustPdf)
      const jsFaces = await readFaces(jsPdf)
      expect(rustFaces).toHaveLength(jsFaces.length)
      for (let i = 0; i < jsFaces.length; i++) {
        expect(rustFaces[i]!.width).toBeCloseTo(jsFaces[i]!.width, 1)
        expect(rustFaces[i]!.height).toBeCloseTo(jsFaces[i]!.height, 1)
        const rTexts = [...rustFaces[i]!.texts].sort(
          (a, b) => a.str.localeCompare(b.str) || a.x - b.x || a.y - b.y,
        )
        const jTexts = [...jsFaces[i]!.texts].sort(
          (a, b) => a.str.localeCompare(b.str) || a.x - b.x || a.y - b.y,
        )
        expect(rTexts).toHaveLength(jTexts.length)
        for (let k = 0; k < jTexts.length; k++) {
          expect(rTexts[k]!.str).toBe(jTexts[k]!.str)
          expect(rTexts[k]!.x).toBeCloseTo(jTexts[k]!.x, 1)
          expect(rTexts[k]!.y).toBeCloseTo(jTexts[k]!.y, 1)
        }
      }

      const rustLines = await readLines(rustPdf)
      const jsLines = await readLines(jsPdf)
      expect(rustLines).toHaveLength(jsLines.length)
      for (let i = 0; i < jsLines.length; i++) {
        expect(rustLines[i]!).toHaveLength(jsLines[i]!.length)
      }
    })
  }

  it('skips empty source pages without content streams cleanly', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([A4.w, A4.h]) // empty page (no Contents)
    const p2 = doc.addPage([A4.w, A4.h])
    p2.drawText('P2', { x: A4.w / 2, y: A4.h / 2, size: 12, font })
    const job = await doc.save()
    const out = await withMode(true, () =>
      arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'nup'
          o.nup.count = 2
        }),
      ),
    )
    const faces = await readFaces(out)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.texts.map((t) => t.str)).toEqual(['P2'])
  })

  it('deduplicates shared embedded resources across arranged pages instead of bloating output', async () => {
    const doc = await PDFDocument.create()
    const w = 128
    const h = 128
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) & 0xff
    const img = await doc.embedPng(encodePng(rgb, w, h, 3))
    for (let i = 0; i < 40; i++) {
      const page = doc.addPage([A4.w, A4.h])
      page.drawImage(img, { x: 40, y: 40, width: 120, height: 120 })
    }
    const job = await doc.save()
    const rustOut = await withMode(true, () =>
      arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'nup'
          o.nup.count = 2
        }),
      ),
    )
    // Shared image must stay embedded once, not 40x.
    expect(rustOut.length).toBeLessThan(job.length * 3)
    const loaded = await PDFDocument.load(rustOut)
    expect(loaded.getPageCount()).toBe(20)
  })

  it('convertBgrxPixels, encodePng, and encodeBgrxToPng produce bit-identical decoded pixels to JS', async () => {
    const width = 37
    const height = 29
    const stride = width * 4 + 8 // padded stride
    const bgrx = new Uint8Array(stride * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * stride + x * 4
        bgrx[at] = (x * 7 + y * 3) & 0xff
        bgrx[at + 1] = (x * 5 + y * 11) & 0xff
        bgrx[at + 2] = (x * 13 + y * 2) & 0xff
        bgrx[at + 3] = 255
      }
    }

    for (const gray of [false, true]) {
      const ch: 1 | 3 = gray ? 1 : 3
      const rustPx = await withMode(true, async () =>
        convertBgrxPixels(bgrx, stride, width, height, gray),
      )
      const jsPx = await withMode(false, async () =>
        convertBgrxPixels(bgrx, stride, width, height, gray),
      )
      expect(rustPx).toEqual(jsPx)

      const rustPng = await withMode(true, async () => encodePng(rustPx, width, height, ch))
      const jsPng = await withMode(false, async () => encodePng(jsPx, width, height, ch))
      const fusedPng = await withMode(true, async () =>
        encodeBgrxToPng(bgrx, stride, width, height, gray),
      )

      const dRust = decodePng(rustPng)
      const dJs = decodePng(jsPng)
      const dFused = decodePng(fusedPng)
      expect(dRust).toEqual(dJs)
      expect(dFused).toEqual(dJs)
    }
  })

  it('grayscalePdf matches JS pixel-for-pixel and keeps DeviceGray structure', async () => {
    const job = await makeBoxJob([
      { w: A4.w, h: A4.h, color: [0.8, 0.2, 0.1], text: 'P1' },
      { w: A5.h, h: A5.w, color: [0.1, 0.6, 0.9], text: 'P2' },
    ])
    const rustGray = await withMode(true, () => grayscalePdf(job, { dpi: 150 }))
    const jsGray = await withMode(false, () => grayscalePdf(job, { dpi: 150 }))

    const rDoc = await PDFDocument.load(rustGray)
    const jDoc = await PDFDocument.load(jsGray)
    expect(rDoc.getPageCount()).toBe(jDoc.getPageCount())
    for (let i = 0; i < jDoc.getPageCount(); i++) {
      const rp = rDoc.getPage(i)
      const jp = jDoc.getPage(i)
      expect(rp.getWidth()).toBeCloseTo(jp.getWidth(), 3)
      expect(rp.getHeight()).toBeCloseTo(jp.getHeight(), 3)
      const rX = rp.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
      const jX = jp.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
      const rImg = rX.lookup(rX.keys()[0]!) as PDFRawStream
      const jImg = jX.lookup(jX.keys()[0]!) as PDFRawStream
      expect((rImg.dict.lookup(PDFName.of('ColorSpace')) as PDFName).asString()).toBe('/DeviceGray')
      expect((rImg.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(
        (jImg.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber(),
      )
      const rustPixels = inflateSync(rImg.getContents())
      const jsPixels = inflateSync(jImg.getContents())
      expect(rustPixels.length).toBe(jsPixels.length)
      expect(Buffer.compare(rustPixels, jsPixels)).toBe(0)
    }
  })

  it('rotateLandscapeFaces matches JS on both object-stream and uncompressed PDFs', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([A4.w, A4.h])
    doc.addPage([A4.h, A4.w])
    doc.addPage([A4.w, A4.h]).setRotation(degrees(90))
    doc.addPage([A4.h, A4.w]).setRotation(degrees(270))

    for (const useObjectStreams of [true, false]) {
      const bytes = await doc.save({ useObjectStreams })
      const rust = await withMode(true, () => rotateLandscapeFaces(bytes))
      const js = await withMode(false, () => rotateLandscapeFaces(bytes))
      expect(rust.rotated).toBe(js.rotated)
      const rDoc = await PDFDocument.load(rust.pdf)
      const jDoc = await PDFDocument.load(js.pdf)
      expect(rDoc.getPages().map((p) => p.getRotation().angle)).toEqual(
        jDoc.getPages().map((p) => p.getRotation().angle),
      )
      expect(rDoc.getPages().map((p) => p.getMediaBox().width)).toEqual(
        jDoc.getPages().map((p) => p.getMediaBox().width),
      )
    }
  })
})

describe('Rust WASM env switch, infra fallback, and semantic non-fallback', () => {
  it('disables Rust WASM via GENOFFICE_PRINT_LAYOUT_RUST=0 or off and falls back cleanly', async () => {
    const job = await makeJob([
      { ...A4, label: 'P1' },
      { ...A4, label: 'P2' },
    ])
    for (const flag of ['0', 'off', 'OFF']) {
      process.env.GENOFFICE_PRINT_LAYOUT_RUST = flag
      resetPrintLayoutWasmForTests()
      expect(ensurePrintLayoutWasm()).toBe(false)
      const arranged = await arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'nup'
          o.nup.count = 2
        }),
      )
      const faces = await readFaces(arranged)
      expect(faces).toHaveLength(1)
    }
  })

  it('falls back to JS when WASM file is missing or corrupt (infra failure)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-wasm-fallback-'))
    tempDirs.push(dir)
    const corruptPath = join(dir, 'corrupt.wasm')
    writeFileSync(corruptPath, Buffer.from('not a valid wasm binary'))
    const job = await makeJob([
      { ...A4, label: 'P1' },
      { ...A4, label: 'P2' },
    ])

    for (const badPath of [join(dir, 'missing.wasm'), corruptPath]) {
      delete process.env.GENOFFICE_PRINT_LAYOUT_RUST
      process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH = badPath
      resetPrintLayoutWasmForTests()
      expect(ensurePrintLayoutWasm()).toBe(false)

      const sizes = await readJobPageSizes(job)
      expect(sizes).toHaveLength(2)
      const arranged = await arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'nup'
          o.nup.count = 2
        }),
      )
      expect(await readFaces(arranged)).toHaveLength(1)
      const png = encodePng(new Uint8Array([10, 20, 30, 40]), 2, 2, 1)
      expect(decodePng(png).pixels).toEqual(new Uint8Array([10, 20, 30, 40]))
    }
  })

  it('never falls back on semantic errors (invalid PDF, no-faces, poster-overlap-too-large, invalid PNG)', async () => {
    process.env.GENOFFICE_PRINT_LAYOUT_RUST = '1'
    delete process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH
    resetPrintLayoutWasmForTests()
    expect(ensurePrintLayoutWasm()).toBe(true)

    const garbage = new TextEncoder().encode('not a pdf document')
    await expect(readJobPageSizes(garbage)).rejects.toThrow(/PDF/i)
    await expect(
      arrangePrintJob(
        garbage,
        opts((o) => {
          o.mode = 'nup'
        }),
      ),
    ).rejects.toThrow(/PDF/i)
    await expect(rotateLandscapeFaces(garbage)).rejects.toThrow(/PDF/i)

    const onePage = await makeJob([{ ...A4, label: 'P1' }])
    await expect(
      arrangePrintJob(
        onePage,
        opts((o) => {
          o.sides = 'even'
        }),
      ),
    ).rejects.toMatchObject({ code: 'no-faces' })

    const tiny = await makeJob([{ w: 40, h: 40, label: 'P1' }])
    await expect(
      arrangePrintJob(
        tiny,
        opts((o) => {
          o.mode = 'poster'
          o.poster.overlapMm = 25
        }),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof PrintLayoutError && e.code === 'poster-overlap-too-large',
    )

    expect(() => encodePng(new Uint8Array(4), 0, 2, 1)).toThrow(/invalid PNG size/)
    expect(() => encodePng(new Uint8Array(2), 2, 2, 1)).toThrow(/too short/)
  })
})
