// The worker path module's type, for every editor build that compiles this file.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./print-layout-worker-path.d.ts" />
/// Advanced print layout for the editors' main processes: the print job PDF is
/// arranged (and turned gray when asked), rendered to face images in a worker
/// thread, and printed from a hidden window through the system dialog or the
/// editor's in-app printer. macOS in-app printer jobs go to the queue as a PDF
/// instead. Also the result preview, saving the arranged PDF, the IPC helpers
/// every editor registers, and the app-wide label grid store.
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  PrintLayoutError,
  pdfiumWasmPath,
  RASTER_WORKER_DATA,
  runRasterJob,
  validateLabelSpec,
  validateOptions,
  type LabelSpec,
  type PrintImageFace,
  type PrintLayoutOptions,
  type RasterJobRequest,
  type RasterJobResult,
  type RasterWorkerMessage,
} from '@genoffice/print-layout'
import printLayoutWorkerPath from './print-layout-worker?modulePath'
import { atomicWriteFile, writeJsonAtomic } from './atomic-write'
import { printPdfViaCups, type CupsPrintJob } from './print-cups'
import { printJobOptions, printOutcome, type PrintDuplex } from './print-job'
import {
  PRINT_LAYOUT_SHARED_CHANNELS,
  printLayoutChannels,
  type LabelSpecSetResult,
  type PrintLayoutFailure,
  type PrintLayoutPreviewResult,
  type PrintLayoutPrintResult,
  type PrintLayoutProgress,
  type PrintLayoutSaveResult,
} from './print-layout-channels'
import { PRINT_READY_SCRIPT } from './print-window'

export * from './print-layout-channels'

// ── Runners: where a job's rendering happens ───────────────────────────────

export interface PrintLayoutRunContext {
  signal?: AbortSignal | undefined
  onProgress?: ((progress: PrintLayoutProgress) => void) | undefined
}

/** Runs one raster job: in a worker thread in the app, directly in tests. */
export interface PrintLayoutRunner {
  run(request: RasterJobRequest, context: PrintLayoutRunContext): Promise<RasterJobResult>
}

/** Runs jobs on the calling thread (tests, or a build without the worker chunk). */
export const inProcessRunner: PrintLayoutRunner = {
  run: (request, context) => runRasterJob(request, context),
}

/** The part of node:worker_threads' Worker used here. */
export interface RasterWorkerLike {
  on(event: 'message', listener: (message: RasterWorkerMessage) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(request: RasterJobRequest, transfer: ArrayBuffer[]): void
  terminate(): Promise<number>
}

function abortError(): Error {
  return new DOMException('The print job was canceled', 'AbortError')
}

/**
 * One worker per job, terminated on every path: answered, failed, crashed or
 * canceled. A cancel settles only after the worker has stopped, so the caller
 * can remove the job's files right away.
 */
export function workerRunner(spawn: () => RasterWorkerLike): PrintLayoutRunner {
  return {
    run(request, { signal, onProgress }) {
      if (signal?.aborted) return Promise.reject(abortError())
      const worker = spawn()
      return new Promise<RasterJobResult>((resolve, reject) => {
        let settled = false
        const finish = (settle: () => void) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          void worker
            .terminate()
            .catch(() => 0)
            .then(settle)
        }
        const onAbort = () => finish(() => reject(abortError()))
        signal?.addEventListener('abort', onAbort, { once: true })
        worker.on('message', (message) => {
          if (settled) return
          if (message.type === 'progress') {
            onProgress?.({ done: message.done, total: message.total })
          } else if (message.type === 'done') {
            finish(() => resolve(message.result))
          } else {
            const err = message.issue
              ? new PrintLayoutError(message.issue)
              : new Error(message.message)
            finish(() => reject(err))
          }
        })
        worker.on('error', (err) => finish(() => reject(err)))
        worker.on('exit', (code) =>
          finish(() => reject(new Error(`the print job stopped (exit code ${code})`))),
        )
        // a Buffer can view Node's shared pool: hand over a copy this side owns
        const jobPdf = new Uint8Array(request.jobPdf)
        worker.postMessage({ ...request, jobPdf }, [jobPdf.buffer])
      })
    },
  }
}

/** Worker runner for the bundled worker chunk at `path`. */
export function workerRunnerAt(path: string): PrintLayoutRunner {
  return workerRunner(
    () => new Worker(path, { workerData: RASTER_WORKER_DATA }) as unknown as RasterWorkerLike,
  )
}

/**
 * The worker chunk when the build bundled one (every editor main build does:
 * electron-vite resolves `?modulePath`); otherwise, as under the test runner,
 * the calling thread.
 */
export function defaultPrintLayoutRunner(): PrintLayoutRunner {
  const path: unknown = printLayoutWorkerPath
  return typeof path === 'string' && path !== '' && existsSync(path)
    ? workerRunnerAt(path)
    : inProcessRunner
}

// ── Results ────────────────────────────────────────────────────────────────

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  )
}

/** A thrown error as the answer the screen gets. */
export function printLayoutFailure(err: unknown, signal?: AbortSignal): PrintLayoutFailure {
  if (isAbort(err, signal)) return { ok: false, aborted: true }
  if (err instanceof PrintLayoutError) {
    const issue = err.toIssue()
    return { ok: false, error: issue.message, code: issue.code }
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// ── Preview, save and print ────────────────────────────────────────────────

export interface ArrangedJob {
  /** the editor's print job PDF (range, selection and its own layout applied) */
  jobPdf: Uint8Array
  /** checked options (`validateOptions`) */
  options: PrintLayoutOptions
  signal?: AbortSignal | undefined
  onProgress?: ((progress: PrintLayoutProgress) => void) | undefined
  /** default `defaultPrintLayoutRunner()` */
  runner?: PrintLayoutRunner | undefined
  /** default `pdfiumWasmPath()` */
  wasmPath?: string | undefined
}

const runnerOf = (job: ArrangedJob) => job.runner ?? defaultPrintLayoutRunner()
const wasmOf = (job: ArrangedJob) => job.wasmPath ?? pdfiumWasmPath()

/** Each arranged face (grayscale applied) as a small PNG, not turned. */
export async function previewArranged(
  job: ArrangedJob & { longSidePx?: number | undefined },
): Promise<PrintLayoutPreviewResult> {
  try {
    const result = await runnerOf(job).run(
      {
        kind: 'preview',
        jobPdf: job.jobPdf,
        options: job.options,
        longSidePx: job.longSidePx ?? 0,
        wasmPath: wasmOf(job),
      },
      { signal: job.signal, onProgress: job.onProgress },
    )
    if (result.kind !== 'preview') throw new Error('the print job answered the wrong request')
    job.signal?.throwIfAborted()
    return { ok: true, faces: result.faces }
  } catch (err) {
    return printLayoutFailure(err, job.signal)
  }
}

/** The arranged PDF (the gray one when grayscale is on, faces never turned) at `path`. */
export async function saveArrangedPdf(
  job: ArrangedJob & { path: string },
): Promise<PrintLayoutSaveResult> {
  try {
    const result = await runnerOf(job).run(
      {
        kind: 'pdf',
        jobPdf: job.jobPdf,
        options: job.options,
        rotateLandscape: false,
        wasmPath: wasmOf(job),
      },
      { signal: job.signal, onProgress: job.onProgress },
    )
    if (result.kind !== 'pdf') throw new Error('the print job answered the wrong request')
    job.signal?.throwIfAborted()
    await atomicWriteFile(job.path, Buffer.from(result.pdf))
    return { ok: true, path: job.path }
  } catch (err) {
    return printLayoutFailure(err, job.signal)
  }
}

/** Electron's `webContents.print` options this module passes. */
export interface PrintLayoutPrintOptions {
  silent: boolean
  printBackground: boolean
  margins: { marginType: 'none' }
  /** copies are always whole sets: the arranged faces are one set */
  collate: boolean
  deviceName?: string
  copies?: number
  duplexMode?: PrintDuplex
  /** microns; the printed faces' paper for an in-app printer job */
  pageSize?: { width: number; height: number }
}

/** The hidden window the face images print from; the caller owns its webPreferences. */
export interface PrintLayoutWindow {
  loadFile(path: string): Promise<void>
  webContents: {
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
    print(
      options: PrintLayoutPrintOptions,
      callback: (success: boolean, failureReason: string) => void,
    ): void
  }
  show(): void
  focus(): void
  isDestroyed(): boolean
  destroy(): void
}

export type CupsSender = (
  pdf: Uint8Array,
  job: CupsPrintJob,
) => Promise<{ ok: boolean; error?: string }>

export interface PrintArrangedRequest extends ArrangedJob {
  /** `PrintJobOptions` from the in-app printer choice; absent = the system dialog */
  job?: unknown | undefined
  /** made only once the images are ready, so a canceled job opens no window */
  createWindow: () => PrintLayoutWindow
  platform?: NodeJS.Platform | undefined
  /** default `printPdfViaCups` */
  sendCups?: CupsSender | undefined
  /** temp folder prefix inside the OS temp folder */
  dirPrefix?: string | undefined
}

const PT_TO_MICRONS = 25_400 / 72
/** Images get this much less height than their page, so rounding never spills a blank page. */
const FIT_SLACK_PT = 0.75
// a wedged readiness probe must not hold the job forever
const PRINT_READY_TIMEOUT_MS = 10_000

const css = (n: number) => `${Number(n.toFixed(3))}pt`

/**
 * The print page: one image per face, each face on its own named page of its
 * size with no margin. Images are already turned upright.
 */
export function printFacesHtml(faces: readonly PrintImageFace[]): string {
  const sizes = new Map<string, number>()
  const pageOf = (f: PrintImageFace) => {
    const key = `${css(f.widthPt)} ${css(f.heightPt)}`
    let n = sizes.get(key)
    if (n === undefined) {
      n = sizes.size
      sizes.set(key, n)
    }
    return n
  }
  const body = faces
    .map((f) => {
      const n = pageOf(f)
      const style = `width:${css(f.widthPt)};height:${css(Math.max(1, f.heightPt - FIT_SLACK_PT))}`
      return `<img class="f${n}" src="${f.file}" alt="" style="${style}">`
    })
    .join('\n')
  const pages = [...sizes]
    .map(([size, n]) => `@page f${n}{size:${size};margin:0}\n.f${n}{page:f${n}}`)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>print</title><style>
@page{margin:0}
html,body{margin:0;padding:0;background:#fff}
img{display:block;object-fit:contain;break-inside:avoid}
img+img{break-before:page}
${pages}
</style></head><body>
${body}
</body></html>
`
}

/**
 * Prints the arranged job. Faces are rendered to images (gray ones when
 * grayscale is on, rendered once) in a per-job temp folder, landscape faces
 * turned upright, and printed from `createWindow()`. A macOS in-app printer
 * job sends the arranged (or gray) PDF to the queue with landscape faces
 * marked turned instead, without images. On cancel or failure nothing is
 * sent; the temp folder is always removed.
 */
export async function printArranged(req: PrintArrangedRequest): Promise<PrintLayoutPrintResult> {
  const platform = req.platform ?? process.platform
  const jobOpts = printJobOptions(req.job)
  const signal = req.signal
  let tempDir: string | null = null
  try {
    signal?.throwIfAborted()
    if (platform === 'darwin' && jobOpts.silent) {
      const result = await runnerOf(req).run(
        {
          kind: 'pdf',
          jobPdf: req.jobPdf,
          options: req.options,
          rotateLandscape: true,
          wasmPath: wasmOf(req),
        },
        { signal, onProgress: req.onProgress },
      )
      if (result.kind !== 'pdf') throw new Error('the print job answered the wrong request')
      signal?.throwIfAborted()
      const send = req.sendCups ?? ((pdf, job) => printPdfViaCups(pdf, job))
      const sent = await send(result.pdf, {
        ...(jobOpts.deviceName !== undefined ? { deviceName: jobOpts.deviceName } : {}),
        ...(jobOpts.copies !== undefined ? { copies: jobOpts.copies } : {}),
        collate: true,
        ...(jobOpts.duplexMode !== undefined ? { duplexMode: jobOpts.duplexMode } : {}),
      })
      return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? 'the print job failed' }
    }

    tempDir = await mkdtemp(join(tmpdir(), req.dirPrefix ?? 'genoffice-print-layout-'))
    const result = await runnerOf(req).run(
      {
        kind: 'print-images',
        jobPdf: req.jobPdf,
        options: req.options,
        outDir: tempDir,
        wasmPath: wasmOf(req),
      },
      { signal, onProgress: req.onProgress },
    )
    if (result.kind !== 'print-images') throw new Error('the print job answered the wrong request')
    if (result.faces.length === 0) throw new Error('the print job has no faces')
    signal?.throwIfAborted()
    const htmlPath = join(tempDir, 'print.html')
    await writeFile(htmlPath, printFacesHtml(result.faces), 'utf8')

    const win = req.createWindow()
    try {
      await win.loadFile(htmlPath)
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        win.webContents.executeJavaScript(PRINT_READY_SCRIPT, true),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PRINT_READY_TIMEOUT_MS)
        }),
      ]).catch((err: unknown) => {
        console.error('[print-layout] readiness probe failed:', err)
      })
      clearTimeout(timer)
      signal?.throwIfAborted()
      // Windows attaches the native dialog to the printed window, which must be visible
      if (platform === 'win32' && !jobOpts.silent) {
        win.show()
        win.focus()
      }
      const first = result.faces[0]!
      const options: PrintLayoutPrintOptions = {
        silent: jobOpts.silent,
        printBackground: true,
        margins: { marginType: 'none' },
        collate: true,
        ...(jobOpts.silent
          ? {
              ...(jobOpts.deviceName !== undefined ? { deviceName: jobOpts.deviceName } : {}),
              ...(jobOpts.copies !== undefined ? { copies: jobOpts.copies } : {}),
              ...(jobOpts.duplexMode !== undefined ? { duplexMode: jobOpts.duplexMode } : {}),
              pageSize: {
                width: Math.round(first.widthPt * PT_TO_MICRONS),
                height: Math.round(first.heightPt * PT_TO_MICRONS),
              },
            }
          : {}),
      }
      const printed = await new Promise<{ success: boolean; reason: string }>((resolve) => {
        win.webContents.print(options, (success, reason) => resolve({ success, reason }))
      })
      const outcome = printOutcome(printed.success, printed.reason, options.silent)
      if (outcome.ok) return { ok: true }
      // printOutcome leaves out the error only for a cancel in the system dialog
      if (!options.silent && printed.reason && !outcome.error) return { ok: true, canceled: true }
      return { ok: false, error: outcome.error ?? 'the print job failed' }
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  } catch (err) {
    return printLayoutFailure(err, signal)
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ── IPC: one editor's channels ─────────────────────────────────────────────

/** The part of Electron's `ipcMain` these helpers use. */
export interface PrintLayoutIpcMain {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
  removeHandler?(channel: string): void
}

/** The part of the invoking `webContents` used: who asked, and where progress goes. */
export interface PrintLayoutSender {
  id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

export interface PrintLayoutInvokeEvent {
  sender: PrintLayoutSender
}

export interface PrintLayoutIpcHandlers<E = unknown> {
  ipcMain: PrintLayoutIpcMain
  /** the editor's print job PDF for this request: its range, selection and own layout applied */
  buildJobPdf(event: PrintLayoutInvokeEvent, editor: E | undefined): Promise<Uint8Array>
  /** a hidden window with the editor's webPreferences (scripting on, for the readiness check) */
  createPrintWindow(event: PrintLayoutInvokeEvent): PrintLayoutWindow
  /** asks where to save the arranged PDF; null = the user canceled */
  pickSavePath(event: PrintLayoutInvokeEvent, editor: E | undefined): Promise<string | null>
  runner?: PrintLayoutRunner | undefined
  platform?: NodeJS.Platform | undefined
  sendCups?: CupsSender | undefined
}

interface ParsedRequest {
  options: unknown
  editor: unknown
  job: unknown
  longSidePx: unknown
}

function parseRequest(raw: unknown): ParsedRequest {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { options: r.options, editor: r.editor, job: r.job, longSidePx: r.longSidePx }
}

const registered = new WeakMap<PrintLayoutIpcMain, Map<string, () => void>>()

/**
 * Registers `<prefix>:print-layout-preview|print|save|cancel` for one editor.
 * Options are checked before anything is built. Progress goes as
 * `<prefix>:print-layout-progress` to the asking window only. A window runs one
 * job at a time: a new request cancels its previous one. Registering the same
 * prefix again on the same `ipcMain` returns the first registration's remover.
 */
export function registerPrintLayoutIpc<E = unknown>(
  prefix: string,
  handlers: PrintLayoutIpcHandlers<E>,
): () => void {
  const channels = printLayoutChannels(prefix)
  const ipc = handlers.ipcMain
  let byPrefix = registered.get(ipc)
  if (!byPrefix) {
    byPrefix = new Map()
    registered.set(ipc, byPrefix)
  }
  const existing = byPrefix.get(prefix)
  if (existing) return existing

  const running = new Map<number, AbortController>()
  const begin = (sender: PrintLayoutSender): AbortController => {
    running.get(sender.id)?.abort()
    const controller = new AbortController()
    running.set(sender.id, controller)
    return controller
  }
  const end = (sender: PrintLayoutSender, controller: AbortController) => {
    if (running.get(sender.id) === controller) running.delete(sender.id)
  }
  const progressTo = (sender: PrintLayoutSender) => (p: PrintLayoutProgress) => {
    if (!sender.isDestroyed()) sender.send(channels.progress, { done: p.done, total: p.total })
  }
  const checked = (raw: unknown) => validateOptions(raw, Number.MAX_SAFE_INTEGER)
  const common = { runner: handlers.runner }

  async function withJob<T>(
    event: PrintLayoutInvokeEvent,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | PrintLayoutFailure> {
    const controller = begin(event.sender)
    try {
      return await work(controller.signal)
    } catch (err) {
      return printLayoutFailure(err, controller.signal)
    } finally {
      end(event.sender, controller)
    }
  }

  ipc.handle(channels.preview, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    return withJob(event, async (signal) => {
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return previewArranged({
        ...common,
        jobPdf,
        options: options.options,
        longSidePx: typeof req.longSidePx === 'number' ? req.longSidePx : undefined,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.print, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    return withJob(event, async (signal) => {
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return printArranged({
        ...common,
        jobPdf,
        options: options.options,
        job: req.job,
        createWindow: () => handlers.createPrintWindow(event),
        platform: handlers.platform,
        sendCups: handlers.sendCups,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.save, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    return withJob(event, async (signal) => {
      const path = await handlers.pickSavePath(event, req.editor as E | undefined)
      if (!path) return { ok: true as const, canceled: true as const }
      signal.throwIfAborted()
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return saveArrangedPdf({
        ...common,
        jobPdf,
        options: options.options,
        path,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.cancel, (event: PrintLayoutInvokeEvent) => {
    running.get(event.sender.id)?.abort()
    return { ok: true }
  })

  const unregister = () => {
    for (const c of [channels.preview, channels.print, channels.save, channels.cancel]) {
      ipc.removeHandler?.(c)
    }
    for (const controller of running.values()) controller.abort()
    running.clear()
    byPrefix.delete(prefix)
  }
  byPrefix.set(prefix, unregister)
  return unregister
}

// ── App-wide: the typed-in label grid ──────────────────────────────────────

/** File name of the label grid store in the app's user data folder. */
export const LABEL_SPEC_FILE_NAME = 'print-label-spec.json'

const LABEL_SPEC_VERSION = 1

export interface LabelSpecStore {
  /** the stored grid, or null when there is none or it no longer checks out */
  get(): LabelSpec | null
  /** checks and stores a grid; an invalid one is refused and nothing is written */
  set(input: unknown): LabelSpecSetResult
}

/** The last typed-in label grid, one JSON file (not the AI settings file). */
export function createLabelSpecStore(filePath: string | (() => string)): LabelSpecStore {
  const path = () => (typeof filePath === 'function' ? filePath() : filePath)
  return {
    get() {
      try {
        const raw = JSON.parse(readFileSync(path(), 'utf8')) as { spec?: unknown }
        const checked = validateLabelSpec(raw?.spec)
        return checked.ok ? checked.spec : null
      } catch {
        return null
      }
    },
    set(input) {
      const checked = validateLabelSpec(input)
      if (!checked.ok) {
        return { ok: false, error: checked.error.message, code: checked.error.code }
      }
      try {
        writeJsonAtomic(path(), { version: LABEL_SPEC_VERSION, spec: checked.spec })
        return { ok: true, spec: checked.spec }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

export interface PrintLayoutSharedSetup {
  ipcMain: PrintLayoutIpcMain
  /** full path of the store, e.g. join(app.getPath('userData'), LABEL_SPEC_FILE_NAME) */
  labelSpecPath: string | (() => string)
}

// Kept on globalThis, like the other process-wide state here: every editor bundle
// carries its own copy of this module, and the channels may be registered only once.
const SHARED_STORE = Symbol.for('genoffice.print-layout.shared-store')
type SharedStoreHost = { [SHARED_STORE]?: LabelSpecStore }

/**
 * Registers the app-wide `print-layout:` channels once per process, whoever
 * asks first. Several editors' main modules run in one process in the packaged
 * app and registering a channel twice throws, so every editor calls this.
 */
export function ensurePrintLayoutIpc(setup: PrintLayoutSharedSetup): LabelSpecStore {
  const host = globalThis as SharedStoreHost
  const existing = host[SHARED_STORE]
  if (existing) return existing
  const store = createLabelSpecStore(setup.labelSpecPath)
  setup.ipcMain.handle(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet, () => store.get())
  setup.ipcMain.handle(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet, (_event, spec: unknown) =>
    store.set(spec),
  )
  host[SHARED_STORE] = store
  return store
}
