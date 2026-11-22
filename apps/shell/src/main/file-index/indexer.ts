import { Worker } from 'node:worker_threads'
import { REDACT_NS } from '@genoffice/agent-core/redact-range'
import {
  isParseSidecarEnabled,
  ParseSidecarClient,
  SIDECAR_EXTS,
  SidecarInfraError,
  type ParseSidecarClientOptions,
} from '@genoffice/file-parse'
import { documentExtension } from '../app-routing'
import {
  MAX_BODY_CHARS,
  MAX_EXTRACT_BYTES,
  ZIP_INDEX_UNLIMITED_EXTS,
  type Extracted,
} from './extract'
import type { WorkerRequest, WorkerResponse } from './extract-worker'
import { isSupportedTreeFile } from '../folder-tree'
import { statOrNull, type ScannedFile } from './scan'
import type { FileIndexStore, PretokenizedBody } from './store'

export interface IndexProgress {
  /** files currently in the index */
  indexed: number
  /** files waiting for extraction (queued + in-flight) */
  pending: number
  scanning: boolean
}

export interface IndexerSources {
  /** the folders walked recursively: the save folder and every added root */
  roots: () => readonly string[]
  /** files outside the roots that should still be searchable (recents, starred) */
  extraPaths: () => readonly string[]
  /**
   * Of the files a scan is about to (re)index, those to index by name only
   * because their content is not on this PC (project folders, spec 5.8). Asked
   * once per scan with the whole batch; extracting such a file would download
   * it. Absent: every file is extracted, as before.
   */
  nameOnly?: (paths: readonly string[]) => Promise<ReadonlySet<string>>
}

export interface FileIndexerOptions {
  /** Use the dedicated indexer-owned Rust parse sidecar when enabled (default: true). */
  useSidecar?: boolean
  /** Background parallel extraction concurrency (default: 2, clamped to 1..4). */
  concurrency?: number
  /** Optional overrides for the dedicated indexer ParseSidecarClient. */
  sidecarOptions?: ParseSidecarClientOptions
  /** Optional injected ParseSidecarClient instance (primarily for tests). */
  sidecarClient?: ParseSidecarClient
}

/** a scanned file and whether its body is left out (not on this PC) */
interface QueuedFile extends ScannedFile {
  cloud?: boolean
}

const RESCAN_DEBOUNCE_MS = 1500
/**
 * a worker request left unanswered this long means a wedged parse or a stalled
 * walk: the request fails as an extraction error and the worker is recycled,
 * so one bad file cannot stall indexing (and search with it) for good
 */
const WORKER_REQUEST_TIMEOUT_MS = 120_000
/**
 * heap cap for the extraction worker: without resourceLimits a parse that
 * exhausts V8's heap is a process-wide fatal OOM and takes the whole app down
 * with it; with one, only the worker dies and the file is recorded as an error
 */
const WORKER_HEAP_LIMIT_MB = 1024

/** default and upper bound for low-priority background sidecar concurrency (tunable) */
const DEFAULT_SIDECAR_CONCURRENCY = 2
const MAX_SIDECAR_CONCURRENCY = 4
const INDEXER_SIDECAR_IDLE_TIMEOUT_MS = 120_000

/** name-only rows written in one go before yielding to the event loop */
const NAME_ONLY_BATCH = 64

/**
 * Keeps the store in step with the disk: a scan diffs mtime/size against the
 * index, changed files queue for extraction, and vanished files are dropped.
 * Supported ZIP and non-redacted text formats run in a dedicated low-priority
 * Rust sidecar process (bounded concurrency) with pre-tokenization off the main
 * thread; unsupported formats, redaction delegations, and infra failures fall
 * back to the sequential extraction worker.
 */
export class FileIndexer {
  private worker: Worker | null = null
  private sidecar: ParseSidecarClient | null = null
  private readonly useSidecar: boolean
  private readonly concurrency: number
  private readonly sidecarOptions: ParseSidecarClientOptions | undefined
  private readonly injectedSidecar: ParseSidecarClient | null
  private nextId = 1
  private readonly waiting = new Map<number, (r: WorkerResponse) => void>()
  private readonly queue: QueuedFile[] = []
  private readonly queued = new Set<string>()
  private inFlight = 0
  private draining = false
  private scanning = false
  private scanRequested = false
  private rescanTimer: NodeJS.Timeout | null = null
  private lastScanAt = 0
  private stopped = false

  constructor(
    private readonly store: FileIndexStore,
    private readonly workerPath: string,
    private readonly sources: IndexerSources,
    private readonly requestTimeoutMs = WORKER_REQUEST_TIMEOUT_MS,
    private readonly workerHeapLimitMb = WORKER_HEAP_LIMIT_MB,
    options: FileIndexerOptions = {},
  ) {
    this.useSidecar = options.useSidecar ?? true
    const rawConcurrency = options.concurrency ?? DEFAULT_SIDECAR_CONCURRENCY
    this.concurrency = Math.max(
      1,
      Math.min(
        MAX_SIDECAR_CONCURRENCY,
        Number.isFinite(rawConcurrency) ? Math.floor(rawConcurrency) : DEFAULT_SIDECAR_CONCURRENCY,
      ),
    )
    this.sidecarOptions = options.sidecarOptions
    this.injectedSidecar = options.sidecarClient ?? null
  }

  progress(): IndexProgress {
    return {
      indexed: this.store.count(),
      pending: this.queue.length + this.inFlight,
      scanning: this.scanning,
    }
  }

  /** PID of the indexer's own sidecar child process, or null when not running. */
  sidecarPid(): number | null {
    return this.sidecar?.pid() ?? null
  }

  /** schedule a scan soon; repeated calls within the debounce window fold into one */
  refresh(): void {
    if (this.stopped) return
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null
      void this.scan()
    }, RESCAN_DEBOUNCE_MS)
  }

  /** scan now unless one ran within `maxAgeMs` */
  refreshIfStale(maxAgeMs: number): void {
    if (Date.now() - this.lastScanAt >= maxAgeMs) void this.scan()
  }

  async scan(): Promise<void> {
    if (this.stopped) return
    if (this.scanning) {
      this.scanRequested = true
      return
    }
    this.scanning = true
    try {
      const seen = new Map<string, ScannedFile>()
      let walked = true
      let complete = true
      for (const root of this.sources.roots()) {
        if (this.stopped) {
          walked = false
          break
        }
        const scanned = await this.scanRoot(root)
        if (scanned) {
          for (const f of scanned.files) seen.set(f.path, f)
          if (scanned.truncated) complete = false
        } else {
          walked = false
        }
      }
      if (walked && !this.stopped) await this.diff(seen, complete)
    } finally {
      this.scanning = false
    }
    // a refresh that arrived mid-scan runs now, whether or not the walk succeeded
    if (this.scanRequested && !this.stopped) {
      this.scanRequested = false
      void this.scan()
    }
  }

  private async scanRoot(
    root: string,
  ): Promise<{ files: readonly ScannedFile[]; truncated?: boolean } | null> {
    const sidecar = this.ensureSidecar()
    if (sidecar) {
      try {
        const res = await sidecar.scanDir({ root })
        return { files: res.files, truncated: res.truncated }
      } catch (err) {
        if (this.stopped) return null
        if (!(err instanceof SidecarInfraError) || err.code === 'stopped') {
          return null
        }
        // Infra error (missing binary, spawn failure, crash, protocol mismatch): fall back to Worker scan
      }
    }
    const res = await this.ask({ id: 0, type: 'scan', root })
    // a crashed worker answers with an extract error; dropping the index on that would empty search
    if (res.type === 'scan') {
      return { files: res.files, truncated: res.truncated }
    }
    return null
  }

  /** bring the store in step with what the walk saw; extra paths are stat-ed here */
  // a budget-capped walk cannot tell a vanished file from one it never reached,
  // so entries are only removed when every root was walked to the end
  private async diff(seen: Map<string, ScannedFile>, complete: boolean): Promise<void> {
    for (const p of this.sources.extraPaths()) {
      if (seen.has(p) || !isSupportedTreeFile(p)) continue
      const st = statOrNull(p)
      if (st) seen.set(p, st)
    }
    const known = this.store.listAll()
    if (complete) {
      const gone: string[] = []
      for (const path of known.keys()) if (!seen.has(path)) gone.push(path)
      this.store.remove(gone)
    }
    const changed: ScannedFile[] = []
    // name-only for want of the content (cloud files, or ZIP docs previously capped at 64 MiB):
    // looked at again so their body is filled gradually without bumping EXTRACT_VERSION
    const recheck: ScannedFile[] = []
    for (const f of seen.values()) {
      // an unchanged file that already failed is not retried: a parse that
      // kills the worker would otherwise be re-run on every scan
      const k = known.get(f.path)
      if (k && k.mtimeMs === f.mtimeMs && k.sizeBytes === f.sizeBytes) {
        if (k.status === 'cloud') {
          recheck.push(f)
        } else if (
          k.status === 'name-only' &&
          ZIP_INDEX_UNLIMITED_EXTS.has(documentExtension(f.path))
        ) {
          recheck.push(f)
        }
        continue
      }
      changed.push(f)
    }
    const nameOnly = await this.decideNameOnly([...changed, ...recheck])
    for (const f of changed) this.enqueue(nameOnly.has(f.path) ? { ...f, cloud: true } : f)
    for (const f of recheck) if (!nameOnly.has(f.path)) this.enqueue(f)
    this.lastScanAt = Date.now()
  }

  /** one call for the whole batch; a source that fails leaves every file name-only rather than extracted */
  private async decideNameOnly(files: readonly ScannedFile[]): Promise<ReadonlySet<string>> {
    const decide = this.sources.nameOnly
    if (!decide || files.length === 0) return new Set()
    try {
      return await decide(files.map((f) => f.path))
    } catch {
      return new Set(files.map((f) => f.path))
    }
  }

  private enqueue(f: QueuedFile): void {
    if (this.queued.has(f.path)) return
    this.queued.add(f.path)
    this.queue.push(f)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const workerCount = this.useSidecar && isParseSidecarEnabled() ? this.concurrency : 1
      let nameOnlyRun = 0
      const runSlot = async (): Promise<void> => {
        while (this.queue.length && !this.stopped) {
          const f = this.queue.shift()!
          this.queued.delete(f.path)
          this.inFlight++
          try {
            // the file may have changed again while queued; index what is on disk now
            const st = statOrNull(f.path)
            if (!st) {
              this.store.remove([f.path])
              continue
            }
            if (f.cloud) {
              // name and folder only: the content is never opened, so never downloaded
              this.apply(st, { kind: 'name-only' }, 'cloud')
              if (++nameOnlyRun % NAME_ONLY_BATCH === 0) {
                await new Promise((r) => setImmediate(r))
              }
              continue
            }
            await this.extractAndApply(st)
          } finally {
            this.inFlight--
          }
        }
      }
      const slots = Array.from({ length: workerCount }, () => runSlot())
      await Promise.all(slots)
    } finally {
      this.draining = false
    }
  }

  private async extractAndApply(st: ScannedFile): Promise<void> {
    const ext = documentExtension(st.path)
    const sidecar = this.ensureSidecar()
    if (sidecar && SIDECAR_EXTS.has(ext)) {
      if (!ZIP_INDEX_UNLIMITED_EXTS.has(ext) && st.sizeBytes > MAX_EXTRACT_BYTES) {
        this.apply(st, { kind: 'name-only' })
        return
      }
      try {
        const res = await sidecar.extractFile({
          path: st.path,
          ext,
          tokenize: true,
          maxBodyChars: MAX_BODY_CHARS,
          redactNamespaces: [REDACT_NS],
        })
        if (this.stopped) return
        if (res.status === 'ok') {
          this.apply(
            st,
            { kind: 'text', text: res.text.slice(0, MAX_BODY_CHARS) },
            'name-only',
            res.tokens ?? null,
          )
          return
        }
        if (res.status === 'rejected') {
          // Never fall back to TS/Worker on security or semantic rejections
          this.apply(st, { kind: 'error', error: res.message })
          return
        }
        if (res.status === 'unsupported') {
          this.apply(st, { kind: 'name-only' })
          return
        }
        // res.status === 'fallback' (e.g. redaction_present, legacy OLE2 .doc): delegate to Worker below
      } catch (err) {
        if (this.stopped) return
        if (err instanceof SidecarInfraError) {
          if (err.code === 'stopped') return
          if (err.code === 'request_timeout') {
            // The indexer's own sidecar was killed/recycled on timeout; record error without retrying on Worker
            this.apply(st, { kind: 'error', error: err.message })
            return
          }
          // Other infra failure (missing binary, spawn failure, crash, protocol mismatch): fall back to Worker
        } else {
          this.apply(st, {
            kind: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
          return
        }
      }
    }
    const res = await this.ask({ id: 0, type: 'extract', path: st.path })
    if (this.stopped || res.type !== 'extract') return
    this.apply(st, res.result)
  }

  private apply(
    f: ScannedFile,
    r: Extracted,
    nameOnlyStatus: 'name-only' | 'cloud' = 'name-only',
    pretokenized?: PretokenizedBody | null,
  ): void {
    try {
      if (r.kind === 'text') this.store.upsert(f, r.text, 'ok', pretokenized)
      else if (r.kind === 'name-only') this.store.upsert(f, null, nameOnlyStatus)
      else this.store.upsert(f, null, 'error')
    } catch {
      // a corrupt row must not stall the queue; the next scan retries it
    }
  }

  private ensureSidecar(): ParseSidecarClient | null {
    if (!this.useSidecar || !isParseSidecarEnabled()) return null
    if (this.sidecar) return this.sidecar
    if (this.injectedSidecar) {
      this.sidecar = this.injectedSidecar
      return this.sidecar
    }
    this.sidecar = new ParseSidecarClient({
      lowPriority: true,
      requestTimeoutMs: this.requestTimeoutMs,
      killOnTimeout: true,
      idleTimeoutMs: INDEXER_SIDECAR_IDLE_TIMEOUT_MS,
      ...this.sidecarOptions,
    })
    return this.sidecar
  }

  private ask(req: WorkerRequest): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // a wedged worker never answers: fail this request the way a crashed
        // worker's requests fail, and retire the worker so later requests get a
        // fresh one instead of hanging too
        this.waiting.delete(id)
        this.recycleWorker()
        resolve({
          id,
          type: 'extract',
          result: { kind: 'error', error: 'worker request timed out' },
        })
      }, this.requestTimeoutMs)
      this.waiting.set(id, (r: WorkerResponse) => {
        clearTimeout(timer)
        resolve(r)
      })
      try {
        this.ensureWorker().postMessage({ ...req, id })
      } catch (e) {
        // a failed post must not reject into the void-ed callers: answer as an
        // extraction error, exactly like the drop handler does for a crash
        clearTimeout(timer)
        this.waiting.delete(id)
        resolve({
          id,
          type: 'extract',
          result: { kind: 'error', error: e instanceof Error ? e.message : String(e) },
        })
      }
    })
  }

  /** retire the current worker; 'exit' fails any other in-flight request via drop */
  private recycleWorker(): void {
    const w = this.worker
    if (!w) return
    this.worker = null
    void w.terminate()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    // Force pure TypeScript extraction inside the fallback worker so delegated
    // files (e.g. redacted .pptx, legacy .doc, or sidecar infra fallback) never
    // spawn a hidden third untracked ieum-parse-sidecar process.
    const w = new Worker(this.workerPath, {
      resourceLimits: { maxOldGenerationSizeMb: this.workerHeapLimitMb },
      env: { ...process.env, GENOFFICE_PARSE_SIDECAR: '0' },
    })
    w.on('message', (msg: WorkerResponse) => {
      const cb = this.waiting.get(msg.id)
      if (!cb) return
      this.waiting.delete(msg.id)
      cb(msg)
    })
    const drop = () => {
      // a crashed worker fails its in-flight request as an extraction error so the queue moves on
      if (this.worker === w) this.worker = null
      for (const [id, cb] of this.waiting) {
        cb({ id, type: 'extract', result: { kind: 'error', error: 'worker exited' } })
      }
      this.waiting.clear()
    }
    w.on('error', drop)
    w.on('exit', drop)
    this.worker = w
    return w
  }

  stop(): void {
    this.stopped = true
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    this.rescanTimer = null
    this.queue.length = 0
    this.queued.clear()
    this.sidecar?.stop()
    this.sidecar = null
    void this.worker?.terminate()
    this.worker = null
  }
}
