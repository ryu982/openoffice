/**
 * The PDF editor's advanced print channels go through the shared helper
 * (`registerPrintLayoutIpc('pdf', …)`): the job PDF is built from the view's
 * own saved bytes, and a request for a file this view does not own builds
 * nothing. A file with permission restrictions (an /Encrypt entry, here one
 * protected only by an owner password) still previews and prints, but its
 * arranged result is never saved as a PDF.
 */
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import type { PrintLayoutRunner } from '@genoffice/electron-utils/print-arranged'
import { registerPdfPrintLayout } from '../src/main/print-layout'
import { PDF_PRINT_SAVE_RESTRICTED } from '../src/shared/ipc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const ipcMain = {
  handle: (channel: string, listener: Handler) => {
    if (handlers.has(channel)) throw new Error(`second handler for ${channel}`)
    handlers.set(channel, listener)
  },
  removeHandler: (channel: string) => handlers.delete(channel),
}

const jobs: Uint8Array[] = []
const runner: PrintLayoutRunner = {
  run: vi.fn(async (request) => {
    jobs.push(request.jobPdf)
    return { kind: 'preview', faces: [] } as never
  }),
}

let fileBytes: Uint8Array
const lockedBytes = new Uint8Array(
  readFileSync(join(__dirname, 'fixtures', 'enc-r5-owneronly.pdf')),
)
/** what C:/docs/b.pdf holds on disk; a test may protect it mid-request */
let laterBytes: Uint8Array
const readViewBytes = vi.fn(async (viewId: number, path: string) => {
  if (viewId !== 7) throw new Error('pdf: path not granted to this view')
  if (path === 'C:/docs/a.pdf') return fileBytes
  if (path === 'C:/docs/locked.pdf') return lockedBytes
  if (path === 'C:/docs/b.pdf') return laterBytes
  throw new Error('pdf: path not granted to this view')
})
const pickSavePath = vi.fn(async () => null as string | null)
const createPrintWindow = vi.fn()
let unregister: () => void

const event = (id = 7) => ({ sender: { id, send: vi.fn(), isDestroyed: () => false } })
const nup = { ...createDefaultOptions(), mode: 'nup' as const }

beforeAll(async () => {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const pages = [100, 200, 300].map((w) => doc.addPage([w, 400]))
  const link = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }),
  )
  pages[1]!.node.set(PDFName.of('Annots'), doc.context.obj([link]))
  fileBytes = await doc.save({ useObjectStreams: false })
  laterBytes = fileBytes
  unregister = registerPdfPrintLayout({
    ipcMain,
    labelSpecPath: 'unused-label-spec.json',
    readViewBytes,
    createPrintWindow,
    pickSavePath,
    runner,
  })
})

describe('registerPdfPrintLayout', () => {
  it('registers the pdf print layout channels and the shared label channels', () => {
    for (const c of ['preview', 'print', 'save', 'cancel']) {
      expect(handlers.has(`pdf:print-layout-${c}`)).toBe(true)
    }
    expect(handlers.has('print-layout:label-spec-get')).toBe(true)
    expect(handlers.has('print-layout:label-spec-set')).toBe(true)
  })

  it('returns the first remover when registered again', () => {
    const again = registerPdfPrintLayout({
      ipcMain,
      labelSpecPath: 'unused-label-spec.json',
      readViewBytes,
      createPrintWindow,
      pickSavePath,
      runner,
    })
    expect(again).toBe(unregister)
  })

  it('builds the job PDF from the view bytes for the chosen pages', async () => {
    jobs.length = 0
    const result = await handlers.get('pdf:print-layout-preview')!(event(), {
      options: nup,
      editor: { path: 'C:/docs/a.pdf', pages: [2, 3], includeAnnotations: false },
    })
    expect(result).toEqual({ ok: true, faces: [] })
    expect(readViewBytes).toHaveBeenLastCalledWith(7, 'C:/docs/a.pdf')
    expect(jobs).toHaveLength(1)
    const job = await PDFDocument.load(jobs[0]!)
    expect(job.getPages().map((p) => p.getWidth())).toEqual([200, 300])
    expect(job.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)).toBeUndefined()
  })

  it('builds nothing for a file the view does not own or a malformed request', async () => {
    jobs.length = 0
    const foreign = await handlers.get('pdf:print-layout-preview')!(event(8), {
      options: nup,
      editor: { path: 'C:/docs/a.pdf', pages: null, includeAnnotations: true },
    })
    expect(foreign).toMatchObject({ ok: false, error: expect.stringContaining('not granted') })
    const malformed = await handlers.get('pdf:print-layout-preview')!(event(), {
      options: nup,
      editor: { path: 42 },
    })
    expect(malformed).toMatchObject({ ok: false })
    expect(jobs).toHaveLength(0)
  })

  it('asks where to save before building, and a cancel builds nothing', async () => {
    jobs.length = 0
    const editor = { path: 'C:/docs/a.pdf', pages: null, includeAnnotations: true }
    const result = await handlers.get('pdf:print-layout-save')!(event(), { options: nup, editor })
    expect(result).toEqual({ ok: true, canceled: true })
    expect(pickSavePath).toHaveBeenCalledWith(expect.anything(), editor)
    expect(jobs).toHaveLength(0)
  })

  it('refuses to save a restricted file before asking where, and builds nothing', async () => {
    jobs.length = 0
    pickSavePath.mockClear()
    const editor = { path: 'C:/docs/locked.pdf', pages: null, includeAnnotations: true }
    const result = await handlers.get('pdf:print-layout-save')!(event(), { options: nup, editor })
    expect(result).toEqual({ ok: false, error: PDF_PRINT_SAVE_RESTRICTED })
    expect(pickSavePath).not.toHaveBeenCalled()
    expect(jobs).toHaveLength(0)
  })

  it('refuses when the file gained restrictions while the save dialog was open', async () => {
    jobs.length = 0
    const target = join(tmpdir(), `pdf-print-restricted-${process.pid}.pdf`)
    pickSavePath.mockImplementationOnce(async () => {
      laterBytes = lockedBytes
      return target
    })
    try {
      const editor = { path: 'C:/docs/b.pdf', pages: null, includeAnnotations: false }
      const result = await handlers.get('pdf:print-layout-save')!(event(), {
        options: nup,
        editor,
      })
      expect(result).toEqual({ ok: false, error: PDF_PRINT_SAVE_RESTRICTED })
      expect(jobs).toHaveLength(0)
      expect(existsSync(target)).toBe(false)
    } finally {
      laterBytes = fileBytes
    }
  })

  it('still previews and prints a restricted file', async () => {
    jobs.length = 0
    const editor = { path: 'C:/docs/locked.pdf', pages: null, includeAnnotations: false }
    const preview = await handlers.get('pdf:print-layout-preview')!(event(), {
      options: nup,
      editor,
    })
    expect(preview).toEqual({ ok: true, faces: [] })
    // the stub runner answers every request as a preview, so the print itself
    // stops at the runner's answer; what matters is that its job was built
    const printed = await handlers.get('pdf:print-layout-print')!(event(), {
      options: nup,
      editor,
    })
    expect(printed).not.toEqual({ ok: false, error: PDF_PRINT_SAVE_RESTRICTED })
    expect(jobs).toHaveLength(2)
    for (const job of jobs) expect((await PDFDocument.load(job)).isEncrypted).toBe(false)
  })
})
