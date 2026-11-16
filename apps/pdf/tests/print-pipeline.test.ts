import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { printPdf } from '../src/renderer/print'

/**
 * The default print path's preparation: pages are encoded with the async
 * `canvas.toBlob` into object URLs while the next page renders. These tests
 * pin what must not change (pages, order, scale, JPEG quality) and what the
 * pipeline adds (bounded canvases, released URLs, progress, cancel).
 */

const TARGET_SCALE = 200 / 72

interface FakeBlob {
  width: number
  height: number
}

interface EncodeCall {
  canvas: HTMLCanvasElement
  width: number
  height: number
  type: string | undefined
  quality: number | undefined
  finish: (blob: FakeBlob | null) => void
}

let encodes: EncodeCall[] = []
/** When false, encodes wait for `finishEncodes` so a test can look in between. */
let autoEncode = true
let created: string[] = []
let revoked: string[] = []
let canvasesCreated = 0
let encodesInFlight = 0
let maxEncodesInFlight = 0

function finishEncodes(): void {
  for (const call of encodes) call.finish({ width: call.width, height: call.height })
}

beforeEach(() => {
  encodes = []
  autoEncode = true
  created = []
  revoked = []
  canvasesCreated = 0
  encodesInFlight = 0
  maxEncodesInFlight = 0
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: function (
      this: HTMLCanvasElement,
      callback: (blob: FakeBlob | null) => void,
      type?: string,
      quality?: number,
    ) {
      encodesInFlight += 1
      maxEncodesInFlight = Math.max(maxEncodesInFlight, encodesInFlight)
      let done = false
      const call: EncodeCall = {
        canvas: this,
        width: this.width,
        height: this.height,
        type,
        quality,
        finish: (blob) => {
          if (done) return
          done = true
          encodesInFlight -= 1
          // toBlob always calls back on a later task, never synchronously
          void Promise.resolve().then(() => callback(blob))
        },
      }
      encodes.push(call)
      if (autoEncode) call.finish({ width: call.width, height: call.height })
    },
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: FakeBlob) => {
      const url = `blob:page-${blob.width}x${blob.height}-${created.length}`
      created.push(url)
      return url
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revoked.push(url)
    },
  })
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  })
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') canvasesCreated += 1
    return realCreate(tag)
  }) as typeof document.createElement)
  window.print = vi.fn(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).toBlob
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  document.body.innerHTML = ''
})

/** Page n is (100·n) × (200·n) points, so every encode and image names its page. */
function sizedDoc(numPages: number, sizeOf = (n: number) => ({ w: 100 * n, h: 200 * n })) {
  const render = vi.fn((_args: { viewport: { width: number; height: number } }) => ({
    promise: Promise.resolve(),
  }))
  const getPage = vi.fn(async (n: number) => {
    const { w, h } = sizeOf(n)
    return {
      getViewport: ({ scale }: { scale: number }) => ({ width: w * scale, height: h * scale }),
      render,
      cleanup: vi.fn(),
    }
  })
  return { doc: { numPages, getPage } as unknown as PDFDocumentProxy, getPage, render }
}

function pixelsFor(n: number, scale = TARGET_SCALE) {
  return { width: Math.floor(100 * n * scale), height: Math.floor(200 * n * scale) }
}

function imagesAtPrint(): { srcs: string[] } {
  const seen = { srcs: [] as string[] }
  ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
    seen.srcs = [...document.querySelectorAll<HTMLImageElement>('.pdf-print-root img')].map(
      (img) => img.getAttribute('src') ?? '',
    )
    window.dispatchEvent(new Event('afterprint'))
  })
  return seen
}

describe('printPdf preparation pipeline', () => {
  it('encodes each page as JPEG at quality 0.92 and the same scale, in page order', async () => {
    const { doc } = sizedDoc(4)
    const seen = imagesAtPrint()

    await printPdf(doc, [3, 1, 4])

    expect(encodes.map((c) => [c.width, c.height])).toEqual(
      [1, 3, 4].map((n) => {
        const p = pixelsFor(n)
        return [p.width, p.height]
      }),
    )
    for (const call of encodes) {
      expect(call.type).toBe('image/jpeg')
      expect(call.quality).toBe(0.92)
    }
    // one object URL per page, shown in page order
    expect(seen.srcs).toEqual(created)
    expect(seen.srcs.map((src) => src.replace(/-\d+$/, ''))).toEqual(
      [1, 3, 4].map((n) => `blob:page-${pixelsFor(n).width}x${pixelsFor(n).height}`),
    )
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('does not build base64 data URLs', async () => {
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    const { doc } = sizedDoc(2)
    await printPdf(doc)
    expect(toDataURL).not.toHaveBeenCalled()
  })

  it('revokes every object URL once the dialog has closed', async () => {
    const { doc } = sizedDoc(3)
    let revokedAtPrint = -1
    ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
      revokedAtPrint = revoked.length
      window.dispatchEvent(new Event('afterprint'))
    })

    await printPdf(doc)

    expect(revokedAtPrint).toBe(0)
    expect(created).toHaveLength(3)
    expect([...revoked].sort()).toEqual([...created].sort())
    expect(document.querySelector('.pdf-print-root')).toBeNull()
  })

  it('renders the next page while the previous one is still encoding, with two canvases at most', async () => {
    autoEncode = false
    const { doc, render } = sizedDoc(5)
    const done = printPdf(doc)

    // page 2 renders before page 1's JPEG is ready
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    expect(encodes).toHaveLength(1)
    expect(created).toHaveLength(0)

    // let the rest flow
    autoEncode = true
    finishEncodes()
    await done

    expect(render).toHaveBeenCalledTimes(5)
    expect(encodes).toHaveLength(5)
    expect(canvasesCreated).toBeLessThanOrEqual(2)
    expect(maxEncodesInFlight).toBe(1)
    // the two canvases alternate and are emptied afterwards
    expect(encodes[0]!.canvas).not.toBe(encodes[1]!.canvas)
    expect(encodes[0]!.canvas).toBe(encodes[2]!.canvas)
    for (const call of encodes) {
      expect(call.canvas.width).toBe(0)
      expect(call.canvas.height).toBe(0)
    }
  })

  it('waits for the previous page when two pages together would pass the per-page pixel cap', async () => {
    autoEncode = false
    // 5000 pt squares: the budget floors at 150 DPI, ~108 MP each, 217 MP for two
    const { doc, render } = sizedDoc(2, () => ({ w: 5000, h: 5000 }))
    const done = printPdf(doc)

    await vi.waitFor(() => expect(encodes).toHaveLength(1))
    // give the pipeline every chance to start page 2 early
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    expect(render).toHaveBeenCalledTimes(1)

    autoEncode = true
    finishEncodes()
    await done
    expect(render).toHaveBeenCalledTimes(2)
    expect(encodes.map((c) => c.width)).toEqual([
      Math.floor((5000 * 150) / 72),
      Math.floor((5000 * 150) / 72),
    ])
  })

  it('reports progress from zero to every page before opening the dialog', async () => {
    const { doc } = sizedDoc(3)
    const progress: Array<[number, number]> = []
    let progressAtPrint: Array<[number, number]> = []
    ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
      progressAtPrint = [...progress]
      window.dispatchEvent(new Event('afterprint'))
    })

    await printPdf(doc, undefined, { onProgress: (done, total) => progress.push([done, total]) })

    expect(progressAtPrint[0]).toEqual([0, 3])
    expect(progressAtPrint.at(-1)).toEqual([3, 3])
    for (let i = 1; i < progressAtPrint.length; i += 1) {
      expect(progressAtPrint[i]![0]).toBeGreaterThanOrEqual(progressAtPrint[i - 1]![0])
    }
    expect(progress).toEqual(progressAtPrint)
  })

  it('counts a skipped corrupt page toward progress', async () => {
    const { doc } = sizedDoc(3, (n) => (n === 2 ? { w: Number.NaN, h: 10 } : { w: 100, h: 100 }))
    const progress: Array<[number, number]> = []
    await printPdf(doc, undefined, { onProgress: (done, total) => progress.push([done, total]) })
    expect(progress.at(-1)).toEqual([3, 3])
    expect(created).toHaveLength(2)
  })

  it('cancels while preparing: nothing prints and everything is released', async () => {
    autoEncode = false
    const { doc, getPage } = sizedDoc(6)
    const controller = new AbortController()
    const done = printPdf(doc, undefined, { signal: controller.signal })
    const settled = done.then(
      () => null,
      (err: unknown) => err,
    )

    // page 1 encoded and shown, page 2 rendered and encoding
    await vi.waitFor(() => expect(encodes).toHaveLength(1))
    encodes[0]!.finish({ width: 1, height: 1 })
    await vi.waitFor(() => expect(encodes).toHaveLength(2))
    const fetchedBeforeCancel = getPage.mock.calls.length
    controller.abort()
    autoEncode = true
    finishEncodes()

    const err = await settled
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
    expect(window.print).not.toHaveBeenCalled()
    expect(document.querySelector('.pdf-print-root')).toBeNull()
    expect(created.length).toBeGreaterThan(0)
    expect([...revoked].sort()).toEqual([...created].sort())
    // no further page is fetched after the cancel point
    expect(getPage.mock.calls.length).toBeLessThanOrEqual(fetchedBeforeCancel + 1)
    for (const call of encodes) expect(call.canvas.width).toBe(0)
  })

  it('does not touch the document when cancelled before it starts', async () => {
    const { doc, getPage } = sizedDoc(3)
    const controller = new AbortController()
    controller.abort()
    await expect(printPdf(doc, undefined, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(getPage).not.toHaveBeenCalled()
    expect(window.print).not.toHaveBeenCalled()
  })

  it('cancels during the final image wait without printing', async () => {
    const controller = new AbortController()
    let finishDecode: () => void = () => {}
    ;(HTMLImageElement.prototype.decode as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve
        }),
    )
    const { doc } = sizedDoc(1)
    const done = printPdf(doc, undefined, { signal: controller.signal })
    await vi.waitFor(() => expect(created).toHaveLength(1))
    controller.abort()
    finishDecode()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(window.print).not.toHaveBeenCalled()
    expect(revoked).toEqual(created)
  })

  it('releases the URLs already made when a later page fails to render', async () => {
    const { doc, render } = sizedDoc(4)
    // page 3 (300 pt wide) fails while page 2 is still encoding
    render.mockImplementation((args) =>
      args.viewport.width >= 300 * TARGET_SCALE
        ? { promise: Promise.reject(new Error('render failed')) }
        : { promise: Promise.resolve() },
    )
    await expect(printPdf(doc)).rejects.toThrow('render failed')
    expect(window.print).not.toHaveBeenCalled()
    expect(created).toHaveLength(2)
    expect([...revoked].sort()).toEqual([...created].sort())
    expect(document.querySelector('.pdf-print-root')).toBeNull()
    for (const call of encodes) expect(call.canvas.width).toBe(0)
  })

  it('releases the URLs when an image fails to decode', async () => {
    ;(HTMLImageElement.prototype.decode as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('decode failed'),
    )
    const { doc } = sizedDoc(3)
    await expect(printPdf(doc)).rejects.toThrow('decode failed')
    expect(window.print).not.toHaveBeenCalled()
    expect(created).toHaveLength(3)
    expect([...revoked].sort()).toEqual([...created].sort())
  })

  it('fails the job when a page cannot be encoded', async () => {
    autoEncode = false
    const { doc } = sizedDoc(2)
    const done = printPdf(doc)
    const settled = done.then(
      () => null,
      (err: unknown) => err,
    )
    await vi.waitFor(() => expect(encodes).toHaveLength(1))
    encodes[0]!.finish(null)
    autoEncode = true
    finishEncodes()
    const err = await settled
    expect(err).toBeInstanceOf(Error)
    expect(window.print).not.toHaveBeenCalled()
    expect([...revoked].sort()).toEqual([...created].sort())
  })

  it('keeps the result when the signal fires after the dialog opened', async () => {
    const controller = new AbortController()
    ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
      controller.abort()
      window.dispatchEvent(new Event('afterprint'))
    })
    const { doc } = sizedDoc(2)
    await expect(printPdf(doc, undefined, { signal: controller.signal })).resolves.toBeUndefined()
    expect([...revoked].sort()).toEqual([...created].sort())
  })
})
