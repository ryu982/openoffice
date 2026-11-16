import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultOptions,
  LABEL_PRESETS,
  type PrintLayoutOptions,
} from '@genoffice/print-layout'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLabelSpecStore,
  inProcessRunner,
  LABEL_SPEC_FILE_NAME,
  PRINT_LAYOUT_SHARED_CHANNELS,
  printLayoutChannels,
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcHandlers,
  type PrintLayoutPrintOptions,
  type PrintLayoutRunner,
  type PrintLayoutWindow,
} from '../src/print-arranged'

class FakeIpcMain {
  handlers = new Map<string, (event: any, ...args: any[]) => unknown>()
  registrations: string[] = []
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown) {
    if (this.handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`)
    }
    this.registrations.push(channel)
    this.handlers.set(channel, listener)
  }
  removeHandler(channel: string) {
    this.handlers.delete(channel)
  }
  invoke(channel: string, event: PrintLayoutInvokeEvent, ...args: unknown[]) {
    const h = this.handlers.get(channel)
    if (!h) throw new Error(`no handler for ${channel}`)
    return h(event, ...args)
  }
}

function sender(id: number) {
  const sent: { channel: string; args: unknown[] }[] = []
  return {
    event: {
      sender: {
        id,
        send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
        isDestroyed: () => false,
      },
    } satisfies PrintLayoutInvokeEvent,
    sent,
  }
}

class QuietWindow implements PrintLayoutWindow {
  printOptions: PrintLayoutPrintOptions | null = null
  async loadFile() {}
  webContents = {
    executeJavaScript: async () => true,
    print: (o: PrintLayoutPrintOptions, cb: (ok: boolean, reason: string) => void) => {
      this.printOptions = o
      cb(true, '')
    },
  }
  show() {}
  focus() {}
  isDestroyed() {
    return false
  }
  destroy() {}
}

async function job(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]).drawCircle({ x: 100, y: 150, size: 40 })
  return doc.save()
}

function options(patch: (o: PrintLayoutOptions) => void = () => {}): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

function handlers(
  ipcMain: FakeIpcMain,
  patch: Partial<PrintLayoutIpcHandlers<{ range: string }>> = {},
): PrintLayoutIpcHandlers<{ range: string }> {
  return {
    ipcMain,
    buildJobPdf: async () => job(),
    createPrintWindow: () => new QuietWindow(),
    pickSavePath: async () => null,
    runner: inProcessRunner,
    platform: 'linux',
    ...patch,
  }
}

const scratch: string[] = []
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('editor print layout channels', () => {
  it('names every channel after the editor', () => {
    expect(printLayoutChannels('docs')).toEqual({
      preview: 'docs:print-layout-preview',
      print: 'docs:print-layout-print',
      save: 'docs:print-layout-save',
      cancel: 'docs:print-layout-cancel',
      progress: 'docs:print-layout-progress',
    })
    expect(() => printLayoutChannels('Docs:')).toThrow()
  })

  it('registers each channel once, even when asked twice', () => {
    const ipc = new FakeIpcMain()
    const first = registerPrintLayoutIpc('docs', handlers(ipc))
    const second = registerPrintLayoutIpc('docs', handlers(ipc))
    expect(second).toBe(first)
    expect(ipc.registrations).toEqual([
      'docs:print-layout-preview',
      'docs:print-layout-print',
      'docs:print-layout-save',
      'docs:print-layout-cancel',
    ])
    registerPrintLayoutIpc('pdf', handlers(ipc))
    expect(ipc.registrations).toHaveLength(8)
    first()
    expect([...ipc.handlers.keys()].every((c) => c.startsWith('pdf:'))).toBe(true)
  })

  it('checks the options before building anything', async () => {
    const ipc = new FakeIpcMain()
    const buildJobPdf = vi.fn(async () => job())
    registerPrintLayoutIpc('sheets', handlers(ipc, { buildJobPdf }))
    const { event } = sender(1)
    const answer = await ipc.invoke('sheets:print-layout-print', event, {
      options: { mode: 'tiles' },
      editor: { range: 'all' },
    })
    expect(answer).toMatchObject({ ok: false, code: 'invalid-mode' })
    expect(buildJobPdf).not.toHaveBeenCalled()
  })

  it("prints with the editor's job PDF and request, progress to the asking window only", async () => {
    const ipc = new FakeIpcMain()
    const win = new QuietWindow()
    const buildJobPdf = vi.fn(async () => job(4))
    registerPrintLayoutIpc('docs', handlers(ipc, { buildJobPdf, createPrintWindow: () => win }))
    const asking = sender(1)
    const other = sender(2)
    const answer = await ipc.invoke('docs:print-layout-print', asking.event, {
      options: options((o) => {
        o.mode = 'nup'
        o.nup.count = 2
        o.dpi = 150
      }),
      editor: { range: '1-4' },
      job: { deviceName: 'Office', copies: 2 },
    })
    expect(answer).toEqual({ ok: true })
    expect(buildJobPdf).toHaveBeenCalledWith(asking.event, { range: '1-4' })
    expect(win.printOptions).toMatchObject({ silent: true, deviceName: 'Office', copies: 2 })
    expect(asking.sent.map((s) => s.channel)).toEqual(Array(3).fill('docs:print-layout-progress'))
    expect(asking.sent.map((s) => s.args[0])).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
    expect(other.sent).toEqual([])
  })

  it('previews over IPC', async () => {
    const ipc = new FakeIpcMain()
    registerPrintLayoutIpc('slides', handlers(ipc))
    const answer = (await ipc.invoke('slides:print-layout-preview', sender(1).event, {
      options: options((o) => (o.grayscale = true)),
      longSidePx: 100,
    })) as { ok: boolean; faces: unknown[] }
    expect(answer.ok).toBe(true)
    expect(answer.faces).toHaveLength(2)
  })

  it('cancels the asking window’s running job', async () => {
    const ipc = new FakeIpcMain()
    let release!: (bytes: Uint8Array) => void
    const buildJobPdf = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve
        }),
    )
    const runner: PrintLayoutRunner = { run: vi.fn(inProcessRunner.run) }
    registerPrintLayoutIpc('html', handlers(ipc, { buildJobPdf, runner }))
    const { event } = sender(7)
    const answer = ipc.invoke('html:print-layout-print', event, { options: options() })
    await vi.waitFor(() => expect(buildJobPdf).toHaveBeenCalled())
    await ipc.invoke('html:print-layout-cancel', event)
    release(await job())
    await expect(answer).resolves.toEqual({ ok: false, aborted: true })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('a new request from the same window cancels the previous one', async () => {
    const ipc = new FakeIpcMain()
    const releases: ((b: Uint8Array) => void)[] = []
    const buildJobPdf = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releases.push(resolve)
        }),
    )
    registerPrintLayoutIpc('mindmap', handlers(ipc, { buildJobPdf }))
    const { event } = sender(3)
    const first = ipc.invoke('mindmap:print-layout-preview', event, { options: options() })
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    const second = ipc.invoke('mindmap:print-layout-preview', event, {
      options: options(),
      longSidePx: 80,
    })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    const pdf = await job()
    releases.forEach((r) => r(pdf))
    await expect(first).resolves.toEqual({ ok: false, aborted: true })
    await expect(second).resolves.toMatchObject({ ok: true })
  })

  it('asks where to save first and builds nothing when the user cancels', async () => {
    const ipc = new FakeIpcMain()
    const buildJobPdf = vi.fn(async () => job())
    registerPrintLayoutIpc('diagram', handlers(ipc, { buildJobPdf }))
    const answer = await ipc.invoke('diagram:print-layout-save', sender(1).event, {
      options: options((o) => (o.reverse = true)),
    })
    expect(answer).toEqual({ ok: true, canceled: true })
    expect(buildJobPdf).not.toHaveBeenCalled()
  })

  it('saves the arranged PDF where the user chose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-ipc-save-'))
    scratch.push(dir)
    const path = join(dir, 'out.pdf')
    const ipc = new FakeIpcMain()
    registerPrintLayoutIpc('markdown', handlers(ipc, { pickSavePath: async () => path }))
    const answer = await ipc.invoke('markdown:print-layout-save', sender(1).event, {
      options: options((o) => (o.reverse = true)),
    })
    expect(answer).toEqual({ ok: true, path })
    const doc = await PDFDocument.load(readFileSync(path))
    expect(doc.getPageCount()).toBe(2)
  })
})

describe('shared label grid store', () => {
  const spec = { ...LABEL_PRESETS[0]!, cols: 2, rows: 3 } as Record<string, unknown>
  delete spec.id

  it('round-trips a typed-in grid through its own file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-labels-'))
    scratch.push(dir)
    const path = join(dir, LABEL_SPEC_FILE_NAME)
    const store = createLabelSpecStore(path)
    expect(store.get()).toBeNull()
    expect(store.set(spec)).toEqual({ ok: true, spec })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, spec })
    expect(createLabelSpecStore(() => path).get()).toEqual(spec)
  })

  it('refuses a grid off the paper and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-labels-'))
    scratch.push(dir)
    const path = join(dir, LABEL_SPEC_FILE_NAME)
    const store = createLabelSpecStore(path)
    const answer = store.set({ ...spec, cols: 40 })
    expect(answer).toMatchObject({ ok: false, code: 'label-spec-off-paper' })
    expect(store.set('not a grid')).toMatchObject({ ok: false, code: 'label-spec-invalid' })
    expect(existsSync(path)).toBe(false)
  })

  it('reads a damaged file as no grid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-labels-'))
    scratch.push(dir)
    const path = join(dir, LABEL_SPEC_FILE_NAME)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, '{"version":1,"spec":{"cols":"x"}}')
    expect(createLabelSpecStore(path).get()).toBeNull()
    writeFileSync(path, 'not json')
    expect(createLabelSpecStore(path).get()).toBeNull()
  })

  it('registers the shared channels once per process, whoever asks', async () => {
    vi.resetModules()
    // the store lives on globalThis so separate bundles of the module share it
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('genoffice.print-layout.shared-store')
    ]
    const mod = await import('../src/print-arranged')
    const dir = await mkdtemp(join(tmpdir(), 'print-layout-labels-'))
    scratch.push(dir)
    const ipc = new FakeIpcMain()
    const path = join(dir, LABEL_SPEC_FILE_NAME)
    const first = mod.ensurePrintLayoutIpc({ ipcMain: ipc, labelSpecPath: path })
    const second = mod.ensurePrintLayoutIpc({ ipcMain: ipc, labelSpecPath: join(dir, 'other') })
    const third = mod.ensurePrintLayoutIpc({ ipcMain: new FakeIpcMain(), labelSpecPath: path })
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(ipc.registrations).toEqual([
      PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet,
      PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet,
    ])
    const event = sender(1).event
    expect(await ipc.invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet, event)).toBeNull()
    expect(await ipc.invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet, event, spec)).toEqual({
      ok: true,
      spec,
    })
    expect(await ipc.invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet, event)).toEqual(spec)
    expect(
      await ipc.invoke(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet, event, { ...spec, rows: 0 }),
    ).toMatchObject({ ok: false, code: 'label-spec-invalid' })
  })
})
