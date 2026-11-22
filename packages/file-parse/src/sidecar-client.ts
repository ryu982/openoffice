import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as osConstants, setPriority } from 'node:os'
import { createInterface, type Interface } from 'node:readline'
import { resolveParseSidecarPath } from './sidecar-path'

export const PARSE_SIDECAR_PROTOCOL_VERSION = 1
const MAX_STDERR_LENGTH = 8_192
const INTERACTIVE_IDLE_TIMEOUT_MS = 120_000
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000

export type SidecarInfraErrorCode =
  | 'binary_not_found'
  | 'spawn_failed'
  | 'process_exited'
  | 'stdin_failed'
  | 'protocol_mismatch'
  | 'malformed_response'
  | 'request_timeout'
  | 'stopped'
  | 'cancelled'
  | 'rpc_error'

export class SidecarInfraError extends Error {
  readonly code: SidecarInfraErrorCode

  constructor(message: string, code: SidecarInfraErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SidecarInfraError'
    this.code = code
  }
}

export interface SidecarTokens {
  readonly bi: string
  readonly uni: string
}

export type SidecarFallbackReason = 'redaction_present' | 'unsupported_format'

export type SidecarRejectCode =
  | 'zip_rejected'
  | 'content_mismatch'
  | 'password_protected'
  | 'corrupt'
  | 'unsupported_encoding'
  | 'io_error'

export type SidecarExtractResult =
  | {
      readonly status: 'ok'
      readonly text: string
      readonly tokens?: SidecarTokens
    }
  | {
      readonly status: 'fallback'
      readonly fallbackReason: SidecarFallbackReason
    }
  | {
      readonly status: 'rejected'
      readonly rejectCode: SidecarRejectCode
      readonly message: string
    }
  | {
      readonly status: 'unsupported'
      readonly message: string
    }

export interface SidecarExtractOptions {
  readonly path: string
  readonly ext: string
  readonly maxChars?: number
  readonly tokenize?: boolean
  readonly maxBodyChars?: number
  readonly redactNamespaces?: readonly string[]
  readonly requestId?: string
  readonly timeoutMs?: number | null
}

export type SidecarThumbnailResult =
  | {
      readonly status: 'ok'
      readonly mime: string
      readonly dataBase64: string
      readonly entry: string
    }
  | {
      readonly status: 'not_found'
    }
  | {
      readonly status: 'fallback'
      readonly fallbackReason: SidecarFallbackReason
    }
  | {
      readonly status: 'rejected'
      readonly rejectCode: SidecarRejectCode
      readonly message: string
    }

export interface SidecarThumbnailOptions {
  readonly path: string
  readonly ext: string
  readonly maxBytes?: number
  readonly requestId?: string
  readonly timeoutMs?: number | null
}

export interface SidecarScannedFile {
  readonly path: string
  readonly mtimeMs: number
  readonly sizeBytes: number
}

export interface SidecarScanDirOptions {
  readonly root: string
  readonly maxDepth?: number
  readonly maxFiles?: number
  readonly requestId?: string
  readonly timeoutMs?: number | null
}

export interface SidecarScanDirResult {
  readonly files: readonly SidecarScannedFile[]
  readonly truncated: boolean
}

export interface SidecarCancelResult {
  readonly cancelled: boolean
}

export interface SidecarShutdownResult {
  readonly shutdown: boolean
}

export interface ParseSidecarClientOptions {
  /** Binary path override; resolved via `resolveParseSidecarPath()` when omitted. */
  readonly binaryPath?: string
  /** Optional arguments passed to the binary (default: none; used by tests). */
  readonly args?: readonly string[]
  /** Auto-shutdown the idle sidecar after this many ms with zero pending requests. */
  readonly idleTimeoutMs?: number | null
  /** Per-request timeout in ms. `null`/`undefined` disables timeouts. */
  readonly requestTimeoutMs?: number | null
  /** Kill and tear down the child process when a request times out. */
  readonly killOnTimeout?: boolean
  /** Lower child process priority to `PRIORITY_BELOW_NORMAL` (best-effort). */
  readonly lowPriority?: boolean
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timeout: NodeJS.Timeout | null
}

interface RawSidecarResponse {
  readonly version?: unknown
  readonly requestId?: unknown
  readonly ok?: unknown
  readonly result?: unknown
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateExtractResult(raw: unknown): SidecarExtractResult {
  if (!isObject(raw) || typeof raw.status !== 'string') {
    throw new SidecarInfraError(
      'Malformed extract_file result from parse sidecar.',
      'malformed_response',
    )
  }
  switch (raw.status) {
    case 'ok':
      if (typeof raw.text !== 'string') {
        throw new SidecarInfraError(
          'Malformed extract_file ok result: missing text.',
          'malformed_response',
        )
      }
      if (raw.tokens !== undefined) {
        if (
          !isObject(raw.tokens) ||
          typeof raw.tokens.bi !== 'string' ||
          typeof raw.tokens.uni !== 'string'
        ) {
          throw new SidecarInfraError(
            'Malformed extract_file ok result: invalid tokens.',
            'malformed_response',
          )
        }
        return {
          status: 'ok',
          text: raw.text,
          tokens: { bi: raw.tokens.bi, uni: raw.tokens.uni },
        }
      }
      return { status: 'ok', text: raw.text }
    case 'fallback':
      if (
        raw.fallbackReason !== 'redaction_present' &&
        raw.fallbackReason !== 'unsupported_format'
      ) {
        throw new SidecarInfraError(
          'Malformed extract_file fallback result: unknown fallbackReason.',
          'malformed_response',
        )
      }
      return { status: 'fallback', fallbackReason: raw.fallbackReason }
    case 'rejected':
      if (typeof raw.rejectCode !== 'string' || typeof raw.message !== 'string') {
        throw new SidecarInfraError('Malformed extract_file rejected result.', 'malformed_response')
      }
      return {
        status: 'rejected',
        rejectCode: raw.rejectCode as SidecarRejectCode,
        message: raw.message,
      }
    case 'unsupported':
      if (typeof raw.message !== 'string') {
        throw new SidecarInfraError(
          'Malformed extract_file unsupported result.',
          'malformed_response',
        )
      }
      return { status: 'unsupported', message: raw.message }
    default:
      throw new SidecarInfraError(
        `Unknown extract_file status from parse sidecar: ${raw.status}`,
        'malformed_response',
      )
  }
}

function validateThumbnailResult(raw: unknown): SidecarThumbnailResult {
  if (!isObject(raw) || typeof raw.status !== 'string') {
    throw new SidecarInfraError(
      'Malformed extract_thumbnail result from parse sidecar.',
      'malformed_response',
    )
  }
  switch (raw.status) {
    case 'ok':
      if (
        typeof raw.mime !== 'string' ||
        typeof raw.dataBase64 !== 'string' ||
        typeof raw.entry !== 'string'
      ) {
        throw new SidecarInfraError(
          'Malformed extract_thumbnail ok result: missing mime, dataBase64, or entry.',
          'malformed_response',
        )
      }
      return {
        status: 'ok',
        mime: raw.mime,
        dataBase64: raw.dataBase64,
        entry: raw.entry,
      }
    case 'not_found':
      return { status: 'not_found' }
    case 'fallback':
      if (
        raw.fallbackReason !== 'redaction_present' &&
        raw.fallbackReason !== 'unsupported_format'
      ) {
        throw new SidecarInfraError(
          'Malformed extract_thumbnail fallback result: unknown fallbackReason.',
          'malformed_response',
        )
      }
      return { status: 'fallback', fallbackReason: raw.fallbackReason }
    case 'rejected':
      if (typeof raw.rejectCode !== 'string' || typeof raw.message !== 'string') {
        throw new SidecarInfraError(
          'Malformed extract_thumbnail rejected result.',
          'malformed_response',
        )
      }
      return {
        status: 'rejected',
        rejectCode: raw.rejectCode as SidecarRejectCode,
        message: raw.message,
      }
    default:
      throw new SidecarInfraError(
        `Unknown extract_thumbnail status from parse sidecar: ${raw.status}`,
        'malformed_response',
      )
  }
}

export class ParseSidecarClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private stderr = ''
  private idleTimer: NodeJS.Timeout | null = null
  private activeEnvOverride = ''
  private readonly processExitHook = (): void => {
    this.stop()
  }

  constructor(private readonly options: ParseSidecarClientOptions = {}) {}

  pid(): number | null {
    return this.process?.pid ?? null
  }

  async extractFile(options: SidecarExtractOptions): Promise<SidecarExtractResult> {
    const raw = await this.request(
      {
        command: 'extract_file',
        path: options.path,
        ext: options.ext,
        ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
        ...(options.tokenize !== undefined ? { tokenize: options.tokenize } : {}),
        ...(options.maxBodyChars !== undefined ? { maxBodyChars: options.maxBodyChars } : {}),
        ...(options.redactNamespaces !== undefined
          ? { redactNamespaces: options.redactNamespaces }
          : {}),
      },
      options.requestId,
      options.timeoutMs,
    )
    return validateExtractResult(raw)
  }

  async extractThumbnail(options: SidecarThumbnailOptions): Promise<SidecarThumbnailResult> {
    const raw = await this.request(
      {
        command: 'extract_thumbnail',
        path: options.path,
        ext: options.ext,
        ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
      },
      options.requestId,
      options.timeoutMs,
    )
    return validateThumbnailResult(raw)
  }

  async scanDir(options: SidecarScanDirOptions): Promise<SidecarScanDirResult> {
    const raw = await this.request(
      {
        command: 'scan_dir',
        root: options.root,
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
      },
      options.requestId,
      options.timeoutMs,
    )
    if (!isObject(raw) || !Array.isArray(raw.files) || typeof raw.truncated !== 'boolean') {
      throw new SidecarInfraError(
        'Malformed scan_dir result from parse sidecar.',
        'malformed_response',
      )
    }
    return {
      files: raw.files as SidecarScannedFile[],
      truncated: raw.truncated,
    }
  }

  async tokenizeText(
    text: string,
    options?: { readonly requestId?: string; readonly timeoutMs?: number | null },
  ): Promise<SidecarTokens> {
    const raw = await this.request(
      { command: 'tokenize_text', text },
      options?.requestId,
      options?.timeoutMs,
    )
    if (!isObject(raw) || typeof raw.bi !== 'string' || typeof raw.uni !== 'string') {
      throw new SidecarInfraError(
        'Malformed tokenize_text result from parse sidecar.',
        'malformed_response',
      )
    }
    return { bi: raw.bi, uni: raw.uni }
  }

  async cancel(targetRequestId: string): Promise<SidecarCancelResult> {
    if (!this.process || this.process.killed) {
      return { cancelled: false }
    }
    const raw = await this.request({
      command: 'cancel',
      targetRequestId,
    })
    if (!isObject(raw) || typeof raw.cancelled !== 'boolean') {
      throw new SidecarInfraError(
        'Malformed cancel result from parse sidecar.',
        'malformed_response',
      )
    }
    return { cancelled: raw.cancelled }
  }

  /**
   * Gracefully asks the sidecar to shut down, waiting up to `graceMs` for it to
   * exit cleanly before force-killing. Detaches the client immediately so any
   * concurrent new request spawns a fresh child cleanly.
   */
  async shutdown(graceMs: number = DEFAULT_SHUTDOWN_GRACE_MS): Promise<void> {
    this.clearIdleTimer()
    const child = this.process
    const lines = this.lines
    if (!child) return

    this.process = null
    this.lines = null
    process.off('exit', this.processExitHook)

    this.rejectPending(new SidecarInfraError('Parse sidecar shutting down.', 'stopped'))
    lines?.close()
    // Keep stdout drained so the sidecar's shutdown reply never blocks exit.
    child.stdout.resume()

    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }

    const exitKiller = (): void => {
      try {
        child.kill()
      } catch {}
    }
    process.once('exit', exitKiller)

    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        process.off('exit', exitKiller)
        resolve()
      }

      const timer = setTimeout(
        () => {
          try {
            child.stdin.destroy()
          } catch {}
          try {
            child.kill()
          } catch {}
          done()
        },
        Math.max(0, graceMs),
      )
      timer.unref()

      child.once('exit', done)
      child.once('error', done)

      try {
        const payload = JSON.stringify({
          version: PARSE_SIDECAR_PROTOCOL_VERSION,
          requestId: randomUUID(),
          command: 'shutdown',
        })
        child.stdin.write(`${payload}\n`)
        child.stdin.end()
      } catch {
        try {
          child.kill()
        } catch {}
        done()
      }
    })
  }

  /**
   * Synchronous immediate teardown for app quit (`releaseAppResources()` and
   * `process.on('exit')`). Kills the child and rejects all pending requests.
   */
  stop(): void {
    this.clearIdleTimer()
    const child = this.process
    const lines = this.lines
    this.process = null
    this.lines = null
    process.off('exit', this.processExitHook)

    lines?.close()
    if (child) {
      try {
        child.stdin.destroy()
      } catch {}
      try {
        child.kill()
      } catch {}
    }
    this.rejectPending(new SidecarInfraError('Parse sidecar stopped.', 'stopped'))
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private scheduleIdleShutdownIfNeeded(): void {
    this.clearIdleTimer()
    const idleMs = this.options.idleTimeoutMs
    if (!idleMs || idleMs <= 0) return
    if (this.pending.size > 0 || !this.process) return

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size === 0 && this.process) {
        void this.shutdown().catch(() => {
          this.stop()
        })
      }
    }, idleMs)
    // Never keep Node, Electron, or Vitest alive solely for the idle timer.
    this.idleTimer.unref()
  }

  private sendCancelFireAndForget(
    child: ChildProcessWithoutNullStreams,
    targetRequestId: string,
  ): void {
    if (this.process !== child || child.killed) return
    try {
      const payload = JSON.stringify({
        version: PARSE_SIDECAR_PROTOCOL_VERSION,
        requestId: randomUUID(),
        command: 'cancel',
        targetRequestId,
      })
      child.stdin.write(`${payload}\n`)
    } catch {
      // Best-effort cancellation on timeout.
    }
  }

  private request(
    command: Readonly<Record<string, unknown>>,
    explicitRequestId?: string,
    overrideTimeoutMs?: number | null,
  ): Promise<unknown> {
    this.clearIdleTimer()
    const child = this.ensureStarted()
    const requestId = explicitRequestId ?? randomUUID()
    const payload = JSON.stringify({
      version: PARSE_SIDECAR_PROTOCOL_VERSION,
      requestId,
      ...command,
    })
    const effectiveTimeoutMs =
      overrideTimeoutMs !== undefined ? overrideTimeoutMs : (this.options.requestTimeoutMs ?? null)

    return new Promise<unknown>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null
      if (effectiveTimeoutMs !== null && effectiveTimeoutMs > 0) {
        timeout = setTimeout(() => {
          const pending = this.pending.get(requestId)
          if (!pending) return
          this.pending.delete(requestId)
          const err = new SidecarInfraError(
            `Parse sidecar request timed out after ${effectiveTimeoutMs}ms.`,
            'request_timeout',
          )
          if (this.options.killOnTimeout) {
            // Reject collateral concurrent requests as process_exited (recoverable)
            // rather than request_timeout, while the timed-out request keeps request_timeout.
            this.teardownChild(
              child,
              new SidecarInfraError(
                'Parse sidecar restarted after another request timed out.',
                'process_exited',
              ),
            )
            reject(err)
          } else {
            this.sendCancelFireAndForget(child, requestId)
            reject(err)
            this.scheduleIdleShutdownIfNeeded()
          }
        }, effectiveTimeoutMs)
        timeout.unref()
      }

      this.pending.set(requestId, { resolve, reject, timeout })

      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return
        const pending = this.pending.get(requestId)
        if (!pending) return
        if (pending.timeout) clearTimeout(pending.timeout)
        this.pending.delete(requestId)
        const infraError = new SidecarInfraError(
          `Parse sidecar stdin write failed: ${error.message}`,
          'stdin_failed',
          { cause: error },
        )
        pending.reject(infraError)
        this.teardownChild(child, infraError)
      })
    })
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.options.binaryPath === undefined && this.process && !this.process.killed) {
      const envOverride = process.env.GENOFFICE_PARSE_SIDECAR_PATH?.trim() ?? ''
      if (envOverride !== this.activeEnvOverride && this.pending.size === 0) {
        this.stop()
      }
    }
    if (this.process && !this.process.killed) return this.process

    const envOverride =
      this.options.binaryPath === undefined
        ? (process.env.GENOFFICE_PARSE_SIDECAR_PATH?.trim() ?? '')
        : ''
    const resolvedPath = this.options.binaryPath ?? resolveParseSidecarPath()
    if (!resolvedPath) {
      throw new SidecarInfraError('Parse sidecar binary not found.', 'binary_not_found')
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(resolvedPath, [...(this.options.args ?? [])], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      throw new SidecarInfraError(
        `Parse sidecar failed to start (${resolvedPath}): ${error instanceof Error ? error.message : String(error)}`,
        'spawn_failed',
        { cause: error },
      )
    }

    if (this.options.lowPriority && child.pid !== undefined) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Best-effort: ignore if platform or sandbox restricts priority changes.
      }
    }

    this.process = child
    this.activeEnvOverride = envOverride
    this.stderr = ''
    process.on('exit', this.processExitHook)

    const lines = createInterface({ input: child.stdout })
    this.lines = lines
    lines.on('line', (line) => this.handleLine(child, line))

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_LENGTH)
    })

    child.once('error', (error) => {
      this.teardownChild(
        child,
        new SidecarInfraError(
          `Parse sidecar failed to run (${resolvedPath}): ${error.message}`,
          'spawn_failed',
          { cause: error },
        ),
      )
    })

    child.stdin.on('error', (error) => {
      const detail = this.stderr.trim() || error.message || 'broken pipe'
      this.teardownChild(
        child,
        new SidecarInfraError(
          `Parse sidecar stdin failed (${detail}).`.slice(0, 240),
          'stdin_failed',
          {
            cause: error,
          },
        ),
      )
    })

    child.once('exit', (code, signal) => {
      const detail = this.stderr.trim()
      const reason = detail
        ? `Parse sidecar exited: ${detail}`
        : `Parse sidecar exited with code ${String(code)} and signal ${String(signal)}.`
      this.teardownChild(child, new SidecarInfraError(reason, 'process_exited'))
    })

    return child
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.process !== child) return

    let response: RawSidecarResponse
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isObject(parsed)) {
        throw new Error('response is not a JSON object')
      }
      response = parsed as RawSidecarResponse
    } catch (error) {
      this.teardownChild(
        child,
        new SidecarInfraError(
          `Malformed JSON line from parse sidecar: ${line.slice(0, 160)}`,
          'malformed_response',
          { cause: error },
        ),
      )
      return
    }

    if (response.version !== PARSE_SIDECAR_PROTOCOL_VERSION) {
      this.teardownChild(
        child,
        new SidecarInfraError(
          `Parse sidecar protocol version mismatch: expected ${PARSE_SIDECAR_PROTOCOL_VERSION}, got ${String(response.version)}.`,
          'protocol_mismatch',
        ),
      )
      return
    }

    if (typeof response.requestId !== 'string' || typeof response.ok !== 'boolean') {
      this.teardownChild(
        child,
        new SidecarInfraError(
          `Malformed response envelope from parse sidecar: ${line.slice(0, 160)}`,
          'malformed_response',
        ),
      )
      return
    }

    if (response.requestId === '' && !response.ok) {
      const message =
        typeof response.error?.message === 'string'
          ? response.error.message
          : 'Parse sidecar reported a protocol error.'
      this.teardownChild(child, new SidecarInfraError(message, 'malformed_response'))
      return
    }

    const pending = this.pending.get(response.requestId)
    if (!pending) return

    if (pending.timeout) clearTimeout(pending.timeout)
    this.pending.delete(response.requestId)

    if (response.ok) {
      pending.resolve(response.result)
    } else {
      const errCode = typeof response.error?.code === 'string' ? response.error.code : 'rpc_error'
      const errMsg =
        typeof response.error?.message === 'string'
          ? response.error.message
          : 'Parse sidecar request failed.'
      const mappedCode: SidecarInfraErrorCode =
        errCode === 'unsupported_version'
          ? 'protocol_mismatch'
          : errCode === 'cancelled'
            ? 'cancelled'
            : 'rpc_error'
      pending.reject(new SidecarInfraError(errMsg, mappedCode))
    }

    this.scheduleIdleShutdownIfNeeded()
  }

  private teardownChild(child: ChildProcessWithoutNullStreams, reason: SidecarInfraError): void {
    if (this.process !== child) return
    this.clearIdleTimer()
    this.process = null
    this.lines?.close()
    this.lines = null
    process.off('exit', this.processExitHook)

    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      try {
        child.stdin.destroy()
      } catch {}
      try {
        child.kill()
      } catch {}
    }

    this.rejectPending(reason)
  }

  private rejectPending(error: SidecarInfraError): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const pending of entries) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(error)
    }
  }
}

let interactiveSidecar: ParseSidecarClient | null = null

/**
 * Shared interactive sidecar singleton used by `parseFileToText`.
 * Has NO per-request timeout (large documents may take arbitrarily long),
 * shuts down after 120s of idle time, and runs at normal priority.
 */
export function getInteractiveParseSidecar(): ParseSidecarClient {
  if (!interactiveSidecar) {
    interactiveSidecar = new ParseSidecarClient({
      requestTimeoutMs: null,
      idleTimeoutMs: INTERACTIVE_IDLE_TIMEOUT_MS,
      lowPriority: false,
    })
  }
  return interactiveSidecar
}

/**
 * Synchronously stops and clears the shared interactive parse sidecar instance.
 * Call during app quit (`releaseAppResources`) and in test teardown hooks.
 */
export function stopParseSidecar(): void {
  if (interactiveSidecar) {
    interactiveSidecar.stop()
    interactiveSidecar = null
  }
}
