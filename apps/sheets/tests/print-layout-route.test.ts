// @vitest-environment jsdom
// The Print dialog's two routes (spec 3): with the shared layout panel at its
// defaults the dialog's host prints through `printWorkbook` exactly as before;
// with any option on, the same assembled print HTML goes to the arranged print
// as the job's request, and the in-app printer choice rides along with collate
// forced on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions } from '@genoffice/print-layout/plan'

import { setModuleLang } from '../src/renderer/i18n/locale'
import { printRequest } from '../src/renderer/print-html'
import { printJobPageSizes } from '../src/renderer/print-layout-pages'
import { hostFor } from './print-layout-host'

describe('sheets Print dialog routes', () => {
  let printWorkbook: ReturnType<typeof vi.fn>
  let layoutPrint: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setModuleLang('en')
    printWorkbook = vi.fn().mockResolvedValue({ ok: true })
    layoutPrint = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', {
      desktopApi: {
        printWorkbook,
        printLayout: { print: layoutPrint },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('default options: printWorkbook gets the same request as before the panel', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    const message = await host.print(job, {
      deviceName: 'Office printer',
      copies: 3,
      collate: false,
      pages: null,
    })
    expect(message).toBe('Sent to the printer.')
    expect(printWorkbook).toHaveBeenCalledTimes(1)
    expect(printWorkbook).toHaveBeenCalledWith({
      ...printRequest(job.documents, job.fileName),
      deviceName: 'Office printer',
      copies: 3,
      collate: false,
    })
    expect(layoutPrint).not.toHaveBeenCalled()
  })

  it('default options with the system dialog and a page range: no device, pages filtered', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    await host.print(job, { deviceName: null, copies: 1, collate: true, pages: { from: 1, to: 1 } })
    const include = (page: number) => page >= 1 && page <= 1
    expect(printWorkbook).toHaveBeenCalledWith({
      ...printRequest(job.documents, job.fileName, include),
      copies: 1,
      collate: true,
    })
    expect(printWorkbook.mock.calls[0]![0]).not.toHaveProperty('deviceName')
    expect(layoutPrint).not.toHaveBeenCalled()
  })
})

describe('sheets Print dialog: the arranged route', () => {
  const twoUp = () => ({ ...createDefaultOptions(), mode: 'nup' as const })
  let printWorkbook: ReturnType<typeof vi.fn>
  let bridge: {
    print: ReturnType<typeof vi.fn>
    preview: ReturnType<typeof vi.fn>
    savePdf: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    onProgress: ReturnType<typeof vi.fn>
    getLabelSpec: ReturnType<typeof vi.fn>
    setLabelSpec: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    setModuleLang('en')
    printWorkbook = vi.fn().mockResolvedValue({ ok: true })
    bridge = {
      print: vi.fn().mockResolvedValue({ ok: true }),
      preview: vi.fn().mockResolvedValue({
        ok: true,
        faces: [{ png: new Uint8Array([1, 2]), widthPt: 842, heightPt: 595 }],
      }),
      savePdf: vi.fn().mockResolvedValue({ ok: true, path: 'D:/arranged.pdf' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn().mockReturnValue(() => undefined),
      getLabelSpec: vi.fn().mockResolvedValue(null),
      setLabelSpec: vi.fn().mockResolvedValue({ ok: true }),
    }
    vi.stubGlobal('window', { desktopApi: { printWorkbook, printLayout: bridge } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the plain print request as the job, with the in-app printer and collate forced on', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    const output = { deviceName: 'Office printer', copies: 2, collate: false, pages: null }
    expect(await host.printArranged(job, output, twoUp())).toBe('Sent to the printer.')
    expect(printWorkbook).not.toHaveBeenCalled()
    expect(bridge.print).toHaveBeenCalledTimes(1)
    expect(bridge.print).toHaveBeenCalledWith({
      options: twoUp(),
      editor: printRequest(job.documents, job.fileName),
      job: { deviceName: 'Office printer', copies: 2, collate: true },
    })
  })

  it('the system dialog choice reaches the arranged print as deviceName null', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    await host.printArranged(
      job,
      { deviceName: null, copies: 1, collate: true, pages: null },
      twoUp(),
    )
    expect(bridge.print.mock.calls[0]![0].job).toEqual({
      deviceName: null,
      copies: 1,
      collate: true,
    })
  })

  it('the selection range is the job: only the selected cells reach the job HTML', async () => {
    // B3:C4 selected
    const host = hostFor({ row: 2, column: 1, width: 2, height: 2 })
    expect(host.hasSelection).toBe(true)
    const job = await host.buildJob('selection', {})
    await host.printArranged(
      job,
      { deviceName: '', copies: 1, collate: true, pages: null },
      twoUp(),
    )
    const editor = bridge.print.mock.calls[0]![0].editor as { html: string }
    for (const cell of ['R2C1', 'R2C2', 'R3C1', 'R3C2']) expect(editor.html).toContain(cell)
    for (const cell of ['R0C0', 'R1C1', 'R2C3', 'R4C1']) expect(editor.html).not.toContain(cell)
    expect(editor).toEqual(printRequest(job.documents, job.fileName))
  })

  it('the page range filters the job like the plain print', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    const pages = { from: 1, to: 1 }
    await host.printArranged(job, { deviceName: '', copies: 1, collate: true, pages }, twoUp())
    expect(bridge.print.mock.calls[0]![0].editor).toEqual(
      printRequest(job.documents, job.fileName, (page) => page === 1),
    )
  })

  it('a dialog cancel is a canceled print; a stopped job keeps the dialog (null)', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    const output = { deviceName: null, copies: 1, collate: true, pages: null }
    bridge.print.mockResolvedValueOnce({ ok: true, canceled: true })
    expect(await host.printArranged(job, output, twoUp())).toBe('Printing canceled.')
    bridge.print.mockResolvedValueOnce({ ok: false, aborted: true })
    expect(await host.printArranged(job, output, twoUp())).toBeNull()
  })

  it('a failure throws the layout text for a known cause, else the plain failure text', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    const output = { deviceName: null, copies: 1, collate: true, pages: null }
    bridge.print.mockResolvedValueOnce({ ok: false, error: 'printer offline' })
    await expect(host.printArranged(job, output, twoUp())).rejects.toThrow('Unable to print.')
    bridge.print.mockResolvedValueOnce({
      ok: false,
      error: 'no faces left to print',
      code: 'no-faces',
    })
    const error = await host.printArranged(job, output, twoUp()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toBe('Unable to print.')
    expect((error as Error).message).not.toBe('')
  })

  it('save sends the same job and reports the path; preview returns the face images', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    expect(await host.saveArrangedPdf(job, null, twoUp())).toBe('Exported D:/arranged.pdf.')
    expect(bridge.savePdf).toHaveBeenCalledWith({
      options: twoUp(),
      editor: printRequest(job.documents, job.fileName),
    })
    bridge.savePdf.mockResolvedValueOnce({ ok: true, canceled: true })
    expect(await host.saveArrangedPdf(job, null, twoUp())).toBe('PDF export canceled.')

    const controller = new AbortController()
    const faces = await host.previewArranged(job, null, twoUp(), {
      signal: controller.signal,
      onProgress: () => undefined,
    })
    expect(faces).toEqual([new Uint8Array([1, 2])])
    expect(bridge.preview).toHaveBeenCalledWith({
      options: twoUp(),
      editor: printRequest(job.documents, job.fileName),
    })
  })

  it('stopping the preview cancels the main job', async () => {
    const host = hostFor(null)
    const job = await host.buildJob('active', {})
    let answer: (value: unknown) => void = () => undefined
    bridge.preview.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const controller = new AbortController()
    const pending = host.previewArranged(job, null, twoUp(), {
      signal: controller.signal,
      onProgress: () => undefined,
    })
    controller.abort()
    expect(bridge.cancel).toHaveBeenCalledTimes(1)
    answer({ ok: false, aborted: true })
    await expect(pending).rejects.toThrow()
  })

  it('the label grid store goes through the bridge', async () => {
    const host = hostFor(null)
    await host.labelSpecStore.load()
    expect(bridge.getLabelSpec).toHaveBeenCalledTimes(1)
    bridge.setLabelSpec.mockResolvedValueOnce({ ok: false, error: 'off paper' })
    await expect(host.labelSpecStore.save({} as never)).rejects.toThrow('off paper')
  })
})

describe('printJobPageSizes', () => {
  const portraitA4 = { widthIn: 8.27, heightIn: 11.69 }
  const landscapeLetter = { widthIn: 11, heightIn: 8.5 }
  const documents = [
    { paper: { ...portraitA4, pageSize: 'A4' as const, landscape: false }, pages: [{}, {}] },
    { paper: { ...landscapeLetter, pageSize: 'Letter' as const, landscape: true }, pages: [{}] },
  ] as never

  it('gives every page its sheet paper in points, orientation applied', () => {
    expect(printJobPageSizes(documents, null)).toEqual([
      { widthPt: 8.27 * 72, heightPt: 11.69 * 72 },
      { widthPt: 8.27 * 72, heightPt: 11.69 * 72 },
      { widthPt: 11 * 72, heightPt: 8.5 * 72 },
    ])
  })

  it('keeps only the pages of the page range', () => {
    expect(printJobPageSizes(documents, { from: 2, to: 3 })).toEqual([
      { widthPt: 8.27 * 72, heightPt: 11.69 * 72 },
      { widthPt: 11 * 72, heightPt: 8.5 * 72 },
    ])
  })

  it('matches the pages a built job prints', async () => {
    vi.stubGlobal('window', { desktopApi: {} })
    setModuleLang('en')
    const job = await hostFor(null).buildJob('active', {})
    expect(printJobPageSizes(job.documents, null)).toHaveLength(job.pageCount)
    vi.unstubAllGlobals()
  })
})
