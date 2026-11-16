import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createDefaultOptions,
  PrintLayoutError,
  type PrintLayoutOptions,
  type RasterJobRequest,
} from '@genoffice/print-layout'
import { PDFDict, PDFDocument, PDFName, type PDFRawStream } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inProcessRunner,
  previewArranged,
  printArranged,
  printFacesHtml,
  saveArrangedPdf,
  workerRunner,
  type PrintArrangedRequest,
  type PrintLayoutPrintOptions,
  type PrintLayoutRunner,
  type PrintLayoutWindow,
  type RasterWorkerLike,
} from '../src/print-arranged'

const MM = 72 / 25.4
const A4 = { w: 210 * MM, h: 297 * MM }

async function makeJob(pages: { w: number; h: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const p of pages) {
    const page = doc.addPage([p.w, p.h])
    page.drawRectangle({ x: 0, y: p.h * 0.75, width: p.w / 4, height: p.h / 4 })
  }
  return doc.save()
}

const fourA4 = () => makeJob(Array.from({ length: 4 }, () => A4))

function opts(patch: (o: PrintLayoutOptions) => void = () => {}): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

const pngSize = (bytes: Uint8Array) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20), colorType: bytes[25] }
}

/** Records what the print page held while it was loaded. */
class FakeWindow implements PrintLayoutWindow {
  calls: string[] = []
  html = ''
  dir = ''
  images: { file: string; width: number; height: number; colorType: number }[] = []
  printOptions: PrintLayoutPrintOptions | null = null
  printResult = { success: true, reason: '' }
  failLoad = false
  destroyed = false

  async loadFile(path: string): Promise<void> {
    this.calls.push('loadFile')
    this.dir = dirname(path)
    this.html = readFileSync(path, 'utf8')
    for (const m of this.html.matchAll(/src="([^"]+)"/g)) {
      const size = pngSize(readFileSync(join(this.dir, m[1]!)))
      this.images.push({ file: m[1]!, ...size })
    }
    if (this.failLoad) throw new Error('load failed')
  }

  webContents = {
    executeJavaScript: async () => {
      this.calls.push('ready')
      return true
    },
    print: (
      options: PrintLayoutPrintOptions,
      callback: (success: boolean, reason: string) => void,
    ) => {
      this.calls.push('print')
      this.printOptions = options
      callback(this.printResult.success, this.printResult.reason)
    },
  }

  show() {
    this.calls.push('show')
  }
  focus() {
    this.calls.push('focus')
  }
  isDestroyed() {
    return this.destroyed
  }
  destroy() {
    this.calls.push('destroy')
    this.destroyed = true
  }
}

const prefixes: string[] = []
function uniquePrefix(): string {
  const p = `print-layout-test-${process.pid}-${prefixes.length}-${Date.now()}-`
  prefixes.push(p)
  return p
}
const leftovers = (prefix: string) => readdirSync(tmpdir()).filter((n) => n.startsWith(prefix))

const scratch: string[] = []
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function recordingRunner(inner: PrintLayoutRunner = inProcessRunner) {
  const kinds: string[] = []
  const runner: PrintLayoutRunner = {
    run(request, context) {
      kinds.push(request.kind)
      return inner.run(request, context)
    },
  }
  return { runner, kinds }
}

async function print(
  win: FakeWindow,
  patch: Partial<PrintArrangedRequest> & { jobPdf?: Uint8Array } = {},
) {
  const dirPrefix = uniquePrefix()
  const outcome = await printArranged({
    jobPdf: patch.jobPdf ?? (await fourA4()),
    options: opts(),
    createWindow: () => win,
    platform: 'win32',
    dirPrefix,
    runner: inProcessRunner,
    ...patch,
  })
  return { outcome, dirPrefix }
}

describe('printing arranged faces', () => {
  it('prints through the system dialog with upright face images and removes its files', async () => {
    const win = new FakeWindow()
    const { outcome, dirPrefix } = await print(win, {
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
    })
    expect(outcome).toEqual({ ok: true })
    // 2-up of portrait pages: two landscape faces, printed turned upright
    expect(win.images).toHaveLength(2)
    for (const img of win.images) expect(img.height).toBeGreaterThan(img.width)
    expect(win.html).toMatch(/@page f0\{size:595\.276pt 841\.89pt;margin:0\}/)
    expect(win.printOptions).toEqual({
      silent: false,
      printBackground: true,
      margins: { marginType: 'none' },
      collate: true,
    })
    expect(win.calls).toEqual(['loadFile', 'ready', 'show', 'focus', 'print', 'destroy'])
    expect(existsSync(win.dir)).toBe(false)
    expect(leftovers(dirPrefix)).toEqual([])
  })

  it('turns landscape faces only, and leaves portrait faces as they are', async () => {
    const win = new FakeWindow()
    const { outcome } = await print(win, {
      jobPdf: await makeJob([A4, { w: A4.h, h: A4.w }]),
      options: opts((o) => {
        o.grayscale = true
        o.dpi = 150
      }),
    })
    expect(outcome).toEqual({ ok: true })
    const w = Math.round((A4.w * 150) / 72)
    const h = Math.round((A4.h * 150) / 72)
    // both upright, gray (PNG colour type 0)
    expect(win.images.map((i) => [i.width, i.height, i.colorType])).toEqual([
      [w, h, 0],
      [w, h, 0],
    ])
  })

  it('renders automatic density at 200 dpi and a chosen one as chosen', async () => {
    const auto = new FakeWindow()
    await print(auto, { options: opts((o) => (o.sides = 'odd')) })
    expect(auto.images[0]!.width).toBe(Math.round((A4.w * 200) / 72))
    const chosen = new FakeWindow()
    await print(chosen, {
      options: opts((o) => {
        o.sides = 'odd'
        o.dpi = 300
      }),
    })
    expect(chosen.images[0]!.width).toBe(Math.round((A4.w * 300) / 72))
  })

  it("passes the in-app printer's choice, always collated, with the faces' paper", async () => {
    const win = new FakeWindow()
    const { outcome } = await print(win, {
      options: opts((o) => (o.reverse = true)),
      job: { deviceName: 'Office', copies: 3, collate: false, duplex: 'longEdge' },
    })
    expect(outcome).toEqual({ ok: true })
    expect(win.printOptions).toEqual({
      silent: true,
      printBackground: true,
      margins: { marginType: 'none' },
      collate: true,
      deviceName: 'Office',
      copies: 3,
      duplexMode: 'longEdge',
      pageSize: { width: 210_000, height: 297_000 },
    })
    // a silent job needs no visible window
    expect(win.calls).not.toContain('show')
  })

  it('sends a macOS in-app printer job to the queue as a PDF with landscape faces turned', async () => {
    const win = new FakeWindow()
    const created = vi.fn(() => win)
    const sent: { pdf: Uint8Array; job: unknown }[] = []
    const { runner, kinds } = recordingRunner()
    const { outcome } = await print(win, {
      platform: 'darwin',
      runner,
      createWindow: created,
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
      job: { deviceName: 'Queue', copies: 2, collate: false, duplex: 'shortEdge' },
      sendCups: async (pdf, job) => {
        sent.push({ pdf, job })
        return { ok: true }
      },
    })
    expect(outcome).toEqual({ ok: true })
    expect(kinds).toEqual(['pdf'])
    expect(created).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.job).toEqual({
      deviceName: 'Queue',
      copies: 2,
      collate: true,
      duplexMode: 'shortEdge',
    })
    const doc = await PDFDocument.load(sent[0]!.pdf)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90])
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight())
  })

  it('reports a queue refusal on macOS', async () => {
    const { outcome } = await print(new FakeWindow(), {
      platform: 'darwin',
      job: { deviceName: 'Queue' },
      options: opts((o) => (o.reverse = true)),
      sendCups: async () => ({ ok: false, error: 'lp: no such queue' }),
    })
    expect(outcome).toEqual({ ok: false, error: 'lp: no such queue' })
  })

  it('uses the image route on macOS when the system dialog is asked for', async () => {
    const win = new FakeWindow()
    const sendCups = vi.fn()
    const { outcome } = await print(win, {
      platform: 'darwin',
      options: opts((o) => (o.reverse = true)),
      sendCups,
    })
    expect(outcome).toEqual({ ok: true })
    expect(sendCups).not.toHaveBeenCalled()
    expect(win.calls).toEqual(['loadFile', 'ready', 'print', 'destroy'])
  })

  it('sends nothing and leaves no files when canceled mid-run', async () => {
    const win = new FakeWindow()
    const created = vi.fn(() => win)
    const controller = new AbortController()
    const { outcome, dirPrefix } = await print(win, {
      createWindow: created,
      options: opts((o) => (o.dpi = 150)),
      signal: controller.signal,
      onProgress: (p) => {
        if (p.done === 1) controller.abort()
      },
    })
    expect(outcome).toEqual({ ok: false, aborted: true })
    expect(created).not.toHaveBeenCalled()
    expect(win.calls).toEqual([])
    expect(leftovers(dirPrefix)).toEqual([])
  })

  it('sends nothing and leaves no files when rendering fails', async () => {
    const win = new FakeWindow()
    const created = vi.fn(() => win)
    let outDir = ''
    const failing: PrintLayoutRunner = {
      async run(request: RasterJobRequest) {
        if (request.kind !== 'print-images') throw new Error('unexpected')
        outDir = request.outDir
        await writeFile(join(outDir, 'face-00001.png'), 'partial')
        throw new Error('boom')
      },
    }
    const { outcome, dirPrefix } = await print(win, { runner: failing, createWindow: created })
    expect(outcome).toEqual({ ok: false, error: 'boom' })
    expect(created).not.toHaveBeenCalled()
    expect(existsSync(outDir)).toBe(false)
    expect(leftovers(dirPrefix)).toEqual([])
  })

  it('answers options the job cannot take with the layout reason', async () => {
    const { outcome } = await print(new FakeWindow(), {
      options: opts((o) => {
        o.mode = 'labels'
        o.labels.fill = 'repeat'
        o.labels.repeatPage = 9
      }),
    })
    expect(outcome).toMatchObject({ ok: false, code: 'label-repeat-page-out-of-range' })
  })

  it('treats closing the system dialog as the user canceling, not a failure', async () => {
    const win = new FakeWindow()
    win.printResult = { success: false, reason: 'Print job canceled' }
    const { outcome } = await print(win, { options: opts((o) => (o.reverse = true)) })
    expect(outcome).toEqual({ ok: true, canceled: true })
  })

  it('reports a silent job the print system canceled as an error', async () => {
    const win = new FakeWindow()
    win.printResult = { success: false, reason: 'Print job canceled' }
    const { outcome } = await print(win, {
      options: opts((o) => (o.reverse = true)),
      job: { deviceName: 'Office' },
    })
    expect(outcome).toEqual({ ok: false, error: 'Print job canceled' })
  })

  it('destroys the window and removes the files when loading fails', async () => {
    const win = new FakeWindow()
    win.failLoad = true
    const { outcome, dirPrefix } = await print(win, { options: opts((o) => (o.reverse = true)) })
    expect(outcome).toEqual({ ok: false, error: 'load failed' })
    expect(win.calls).toEqual(['loadFile', 'destroy'])
    expect(leftovers(dirPrefix)).toEqual([])
  })

  it('writes one named page per face size', () => {
    const html = printFacesHtml([
      { file: 'face-00001.png', widthPt: 100, heightPt: 200, rotated: false },
      { file: 'face-00002.png', widthPt: 300, heightPt: 400, rotated: true },
      { file: 'face-00003.png', widthPt: 100, heightPt: 200, rotated: false },
    ])
    expect(html.match(/@page f\d/g)).toEqual(['@page f0', '@page f1'])
    expect(html.match(/<img class="f\d"/g)).toEqual([
      '<img class="f0"',
      '<img class="f1"',
      '<img class="f0"',
    ])
    expect(html).toContain('img+img{break-before:page}')
  })
})

describe('result preview', () => {
  it('returns one small PNG per face, landscape faces not turned', async () => {
    const result = await previewArranged({
      jobPdf: await fourA4(),
      options: opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
      longSidePx: 300,
      runner: inProcessRunner,
    })
    if (!result.ok) throw new Error('preview failed')
    expect(result.faces).toHaveLength(2)
    for (const face of result.faces) {
      expect(pngSize(face.png)).toMatchObject({ width: 300 })
      expect(pngSize(face.png).height).toBeLessThan(300)
      expect(face.widthPt).toBeGreaterThan(face.heightPt)
    }
  })

  it('reports progress and stops when canceled', async () => {
    const controller = new AbortController()
    const progress: number[] = []
    const result = await previewArranged({
      jobPdf: await fourA4(),
      options: opts((o) => (o.reverse = true)),
      runner: inProcessRunner,
      signal: controller.signal,
      onProgress: (p) => {
        progress.push(p.done)
        if (p.done === 2) controller.abort()
      },
    })
    expect(result).toEqual({ ok: false, aborted: true })
    expect(progress).toEqual([0, 1, 2])
  })
})

describe('saving the arranged PDF', () => {
  async function savedTo(options: PrintLayoutOptions): Promise<PDFDocument> {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-save-test-'))
    scratch.push(dir)
    const path = join(dir, 'arranged.pdf')
    const result = await saveArrangedPdf({
      jobPdf: await fourA4(),
      options,
      path,
      runner: inProcessRunner,
    })
    expect(result).toEqual({ ok: true, path })
    return PDFDocument.load(await readFile(path))
  }

  it('writes the arranged PDF with landscape faces as they are', async () => {
    const doc = await savedTo(
      opts((o) => {
        o.mode = 'nup'
        o.nup.count = 2
      }),
    )
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0])
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight())
  })

  it('writes the gray PDF when grayscale is on', async () => {
    const doc = await savedTo(opts((o) => (o.grayscale = true)))
    expect(doc.getPageCount()).toBe(4)
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const image = xobjects.lookup(xobjects.keys()[0]!) as PDFRawStream
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'))
  })
})

describe('worker runner', () => {
  class FakeWorker implements RasterWorkerLike {
    listeners: Record<string, ((arg: any) => void)[]> = {}
    posted: RasterJobRequest[] = []
    terminated = 0
    on(event: string, listener: (arg: any) => void) {
      ;(this.listeners[event] ??= []).push(listener)
      return this
    }
    emit(event: string, arg: unknown) {
      for (const l of this.listeners[event] ?? []) l(arg)
    }
    postMessage(request: RasterJobRequest) {
      this.posted.push(request)
    }
    async terminate() {
      this.terminated++
      return 0
    }
  }

  const request = (): RasterJobRequest => ({
    kind: 'pdf',
    jobPdf: new Uint8Array([1, 2, 3]),
    options: opts(),
    rotateLandscape: false,
  })

  it('forwards progress, answers the result and ends the worker', async () => {
    const worker = new FakeWorker()
    const progress: string[] = []
    const run = workerRunner(() => worker).run(request(), {
      onProgress: (p) => progress.push(`${p.done}/${p.total}`),
    })
    expect(worker.posted[0]!.jobPdf).toEqual(new Uint8Array([1, 2, 3]))
    worker.emit('message', { type: 'progress', done: 1, total: 2 })
    worker.emit('message', { type: 'done', result: { kind: 'pdf', pdf: new Uint8Array([9]) } })
    await expect(run).resolves.toEqual({ kind: 'pdf', pdf: new Uint8Array([9]) })
    expect(progress).toEqual(['1/2'])
    expect(worker.terminated).toBe(1)
  })

  it('rebuilds a layout refusal with its code', async () => {
    const worker = new FakeWorker()
    const run = workerRunner(() => worker).run(request(), {})
    worker.emit('message', {
      type: 'error',
      message: 'no-faces: none',
      issue: { code: 'no-faces', message: 'none' },
    })
    await expect(run).rejects.toBeInstanceOf(PrintLayoutError)
    await expect(run).rejects.toMatchObject({ code: 'no-faces' })
    expect(worker.terminated).toBe(1)
  })

  it('stops the worker before settling a cancel', async () => {
    const worker = new FakeWorker()
    let release!: () => void
    worker.terminate = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1)
        }),
    )
    const controller = new AbortController()
    const run = workerRunner(() => worker).run(request(), { signal: controller.signal })
    let settled = false
    void run.catch(() => (settled = true))
    controller.abort()
    await new Promise((r) => setTimeout(r, 10))
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    release()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fails when the worker exits without answering', async () => {
    const worker = new FakeWorker()
    const run = workerRunner(() => worker).run(request(), {})
    worker.emit('exit', 1)
    await expect(run).rejects.toThrow(/exit code 1/)
  })

  it('does not start a worker for a job already canceled', async () => {
    const spawn = vi.fn(() => new FakeWorker())
    const controller = new AbortController()
    controller.abort()
    await expect(
      workerRunner(spawn).run(request(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawn).not.toHaveBeenCalled()
  })
})
