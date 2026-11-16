import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultOptions,
  isRasterWorkerData,
  PREVIEW_LONG_SIDE_PX,
  PrintLayoutError,
  RASTER_WORKER_DATA,
  runRasterJob,
  serveRasterJob,
  type PrintLayoutOptions,
  type RasterJobRequest,
  type RasterWorkerMessage,
} from '../src/index'
import { makeBoxJob } from './helpers/boxes'
import { A4 } from './helpers/pdf'
import { decodePng } from './helpers/png'

function opts(patch: (o: PrintLayoutOptions) => void = () => {}): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

const fourA4 = () =>
  makeBoxJob(Array.from({ length: 4 }, (_, i) => ({ w: A4.w, h: A4.h, text: `P${i + 1}` })))

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'print-layout-test-'))
  dirs.push(d)
  return d
}

describe('print images job', () => {
  it('writes one upright image file per arranged face', async () => {
    const outDir = await tempDir()
    const result = await runRasterJob({
      kind: 'print-images',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
        o.dpi = 150
      }),
      outDir,
    })
    if (result.kind !== 'print-images') throw new Error('wrong kind')
    // 2-up of portrait A4 makes two landscape A4 faces, turned upright
    expect(result.faces).toHaveLength(2)
    expect((await readdir(outDir)).sort()).toEqual(result.faces.map((f) => f.file).sort())
    for (const face of result.faces) {
      expect(face.rotated).toBe(true)
      expect(face.widthPt).toBeCloseTo(A4.w, 1)
      expect(face.heightPt).toBeCloseTo(A4.h, 1)
      const png = decodePng(await readFile(join(outDir, face.file)))
      expect(png.channels).toBe(3)
      expect(png.width).toBe(Math.round((A4.w * 150) / 72))
      expect(png.height).toBe(Math.round((A4.h * 150) / 72))
    }
  })

  it('writes gray images when grayscale is on', async () => {
    const outDir = await tempDir()
    const result = await runRasterJob({
      kind: 'print-images',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.grayscale = true
        o.dpi = 150
      }),
      outDir,
    })
    if (result.kind !== 'print-images') throw new Error('wrong kind')
    expect(result.faces).toHaveLength(4)
    for (const face of result.faces) {
      expect(face.rotated).toBe(false)
      expect(decodePng(await readFile(join(outDir, face.file))).channels).toBe(1)
    }
  })

  it('reports faces done', async () => {
    const outDir = await tempDir()
    const progress: string[] = []
    await runRasterJob(
      {
        kind: 'print-images',
        jobPdf: await fourA4(),
        options: opts((o) => {
          o.sides = 'odd'
          o.dpi = 150
        }),
        outDir,
      },
      { onProgress: (p) => progress.push(`${p.done}/${p.total}`) },
    )
    expect(progress).toEqual(['0/2', '1/2', '2/2'])
  })

  it('refuses options the job cannot take with the layout reason', async () => {
    const outDir = await tempDir()
    const run = runRasterJob({
      kind: 'print-images',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'labels'
        o.labels.fill = 'repeat'
        o.labels.repeatPage = 9
      }),
      outDir,
    })
    await expect(run).rejects.toBeInstanceOf(PrintLayoutError)
    await expect(run).rejects.toMatchObject({ code: 'label-repeat-page-out-of-range' })
    expect(await readdir(outDir)).toEqual([])
  })
})

describe('preview job', () => {
  it('returns one small PNG per face, not turned', async () => {
    const result = await runRasterJob({
      kind: 'preview',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
      longSidePx: 0,
    })
    if (result.kind !== 'preview') throw new Error('wrong kind')
    expect(result.faces).toHaveLength(2)
    for (const face of result.faces) {
      expect(face.widthPt).toBeCloseTo(A4.h, 1)
      expect(face.heightPt).toBeCloseTo(A4.w, 1)
      const png = decodePng(face.png)
      expect(png.width).toBe(PREVIEW_LONG_SIDE_PX)
      expect(png.height).toBeLessThan(png.width)
    }
  })

  it('previews in gray when grayscale is on', async () => {
    const result = await runRasterJob({
      kind: 'preview',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.grayscale = true
      }),
      longSidePx: 200,
    })
    if (result.kind !== 'preview') throw new Error('wrong kind')
    expect(result.faces).toHaveLength(4)
    expect(decodePng(result.faces[0]!.png)).toMatchObject({ channels: 1, height: 200 })
  })
})

describe('pdf job', () => {
  it('returns the arranged PDF, landscape faces kept, text kept', async () => {
    const result = await runRasterJob({
      kind: 'pdf',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
      rotateLandscape: false,
    })
    if (result.kind !== 'pdf') throw new Error('wrong kind')
    const doc = await PDFDocument.load(result.pdf)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getRotation().angle).toBe(0)
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight())
  })

  it('marks landscape faces turned for a printer queue', async () => {
    const result = await runRasterJob({
      kind: 'pdf',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
      rotateLandscape: true,
    })
    if (result.kind !== 'pdf') throw new Error('wrong kind')
    const doc = await PDFDocument.load(result.pdf)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90])
  })

  it('returns the gray PDF when grayscale is on', async () => {
    const result = await runRasterJob({
      kind: 'pdf',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.grayscale = true
        o.dpi = 150
      }),
      rotateLandscape: false,
    })
    if (result.kind !== 'pdf') throw new Error('wrong kind')
    const doc = await PDFDocument.load(result.pdf)
    expect(doc.getPageCount()).toBe(4)
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const image = xobjects.lookup(xobjects.keys()[0]!) as PDFRawStream
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'))
  })
})

describe('raster worker server', () => {
  class FakePort {
    listener: ((r: RasterJobRequest) => void) | null = null
    messages: RasterWorkerMessage[] = []
    done: Promise<void>
    private settle!: () => void
    constructor() {
      this.done = new Promise((r) => (this.settle = r))
    }
    once(_event: 'message', listener: (r: RasterJobRequest) => void) {
      this.listener = listener
    }
    postMessage(message: RasterWorkerMessage) {
      this.messages.push(message)
      if (message.type !== 'progress') this.settle()
    }
  }

  it('answers one job with progress and the result', async () => {
    const port = new FakePort()
    serveRasterJob(port)
    port.listener!({
      kind: 'preview',
      jobPdf: await fourA4(),
      options: opts(),
      longSidePx: 100,
    })
    await port.done
    expect(port.messages.filter((m) => m.type === 'progress')).toHaveLength(5)
    const last = port.messages.at(-1)!
    expect(last.type).toBe('done')
    if (last.type === 'done' && last.result.kind === 'preview') {
      expect(last.result.faces).toHaveLength(4)
    }
  })

  it('answers a refused job with the layout reason', async () => {
    const port = new FakePort()
    serveRasterJob(port)
    port.listener!({
      kind: 'pdf',
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'labels'
        o.labels.fill = 'repeat'
        o.labels.repeatPage = 9
      }),
      rotateLandscape: false,
    })
    await port.done
    expect(port.messages.at(-1)).toMatchObject({
      type: 'error',
      issue: { code: 'label-repeat-page-out-of-range' },
    })
  })

  it('recognises its worker data', () => {
    expect(isRasterWorkerData(RASTER_WORKER_DATA)).toBe(true)
    expect(isRasterWorkerData(undefined)).toBe(false)
    expect(isRasterWorkerData({})).toBe(false)
    expect(existsSync(tmpdir())).toBe(true)
  })
})
