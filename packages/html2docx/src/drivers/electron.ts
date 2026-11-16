/**
 * html2docx BrowserDriver over a hidden BrowserWindow. The converter drives
 * the page through webContents.executeJavaScript and the Chrome DevTools
 * Protocol (device metrics, network idle, screenshots), so the export sees
 * the document exactly as the preview does: scripts on, assets through
 * html-asset://, no preload and no Node.
 *
 * The page is hostile: an HTML chunk inside a downloaded .docx, or an HTML
 * file someone sent. Loaded from file://, Electron would let its scripts read
 * other local files, so every window lives in an in-memory session apart from
 * the app's, where only what its caller allows may load (`allowRequest`), the
 * page cannot navigate itself anywhere, and permissions, downloads and
 * non-proxied WebRTC are refused.
 */
import { BrowserWindow, session as electronSession } from 'electron'
import type { Debugger, Session, WebContents } from 'electron'
import type { BrowserDriver, ScreenshotOptions, Viewport } from '../driver'

export interface ElectronDriverIsolation {
  /** Whether the page may load this URL (the document itself included).
   *  Anything refused is cancelled before it leaves the session. */
  allowRequest(url: string): boolean
  /** Scheme handlers the page needs in its session (custom schemes are
   *  registered per session, so the default session's handlers do not apply). */
  protocols?: Readonly<Record<string, (request: Request) => Response | Promise<Response>>>
}

/** Loads every window needs whatever the caller allows: the blank page the
 *  driver starts on, and in-page data the document already carries. */
function alwaysAllowed(url: string): boolean {
  return url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')
}

/** In memory only, used by nothing but these windows. One session for all of
 *  them (Electron never frees a partition), each window under its own policy. */
const ISOLATED_PARTITION = 'html2docx-isolated'
const policyByWebContents = new Map<number, ElectronDriverIsolation>()
const configuredSessions = new WeakSet<Session>()

function isolatedSession(isolation: ElectronDriverIsolation): Session {
  const ses = electronSession.fromPartition(ISOLATED_PARTITION, { cache: false })
  if (!configuredSessions.has(ses)) {
    configuredSessions.add(ses)
    ses.setSpellCheckerEnabled(false)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.setDevicePermissionHandler(() => false)
    ses.on('will-download', (event) => event.preventDefault())
    // a request no window of ours made (a worker, the session itself) has no policy: refused
    ses.webRequest.onBeforeRequest((details, callback) => {
      const policy =
        details.webContentsId === undefined
          ? undefined
          : policyByWebContents.get(details.webContentsId)
      const allowed = !!policy && (alwaysAllowed(details.url) || policy.allowRequest(details.url))
      callback({ cancel: !allowed })
    })
  }
  // a scheme served here is still refused to windows whose policy does not allow it
  for (const [scheme, handler] of Object.entries(isolation.protocols ?? {})) {
    if (!ses.protocol.isProtocolHandled(scheme)) ses.protocol.handle(scheme, handler)
  }
  return ses
}

/** Whatever one conversion's page stored must not reach the next one. */
function forgetWindow(ses: Session, webContentsId: number): void {
  policyByWebContents.delete(webContentsId)
  if (policyByWebContents.size === 0) void ses.clearStorageData().catch(() => {})
}

const NETWORK_QUIET_MS = 500
const POLL_MS = 100

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class ElectronBrowserDriver implements BrowserDriver {
  private readonly inflight = new Set<string>()

  private constructor(
    private readonly win: BrowserWindow,
    private readonly wc: WebContents,
    private readonly cdp: Debugger,
  ) {}

  static async create(
    viewport: Viewport,
    isolation: ElectronDriverIsolation,
  ): Promise<ElectronBrowserDriver> {
    const ses = isolatedSession(isolation)
    const win = new BrowserWindow({
      show: false,
      width: viewport.width,
      height: viewport.height,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        navigateOnDragDrop: false,
      },
    })
    const wc = win.webContents
    const webContentsId = wc.id
    policyByWebContents.set(webContentsId, isolation)
    wc.once('destroyed', () => forgetWindow(ses, webContentsId))
    try {
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      // only the driver moves the page (loadURL does not raise these); a
      // script, link, form or meta refresh stays where it is
      wc.on('will-navigate', (event) => event.preventDefault())
      wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      // nobody can answer a beforeunload prompt in a hidden window
      wc.on('will-prevent-unload', (event) => event.preventDefault())
      // a fresh window has no renderer yet and CDP commands would wait for one
      await wc.loadURL('about:blank')
      const cdp = wc.debugger
      cdp.attach('1.3')
      const driver = new ElectronBrowserDriver(win, wc, cdp)
      cdp.on('message', (_event, method, params) => driver.onCdpMessage(method, params))
      await cdp.sendCommand('Page.enable')
      await cdp.sendCommand('Network.enable')
      await driver.setViewport(viewport)
      return driver
    } catch (err) {
      if (!win.isDestroyed()) win.destroy()
      throw err
    }
  }

  private onCdpMessage(method: string, params: any): void {
    if (method === 'Network.requestWillBeSent') this.inflight.add(params.requestId)
    else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.inflight.delete(params.requestId)
    } else if (method === 'Page.javascriptDialogOpening') {
      // alert/confirm/prompt would block the renderer forever; dismiss like Playwright does
      void this.cdp.sendCommand('Page.handleJavaScriptDialog', { accept: false }).catch(() => {})
    }
  }

  async setViewport(viewport: Viewport): Promise<void> {
    this.win.setContentSize(viewport.width, viewport.height)
    await this.cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false,
    })
  }

  async goto(url: string, { timeoutMs }: { timeoutMs: number }): Promise<void> {
    const deadline = Date.now() + timeoutMs
    this.inflight.clear()
    // loadURL settles on load or failure; a stalled subresource can hold it past
    // the deadline, so stop the load and convert what has rendered (CLI behavior)
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    // a main-frame load error (or the ERR_ABORTED our stop() causes after a
    // timeout) means: convert whatever rendered, like the CLI does
    const load = this.wc.loadURL(url).then(
      () => 'loaded' as const,
      () => 'failed' as const,
    )
    try {
      const result = await Promise.race([load, timedOut])
      if (result === 'timeout' && !this.wc.isDestroyed()) this.wc.stop()
    } finally {
      clearTimeout(timer)
    }
    // networkidle: no request in flight for NETWORK_QUIET_MS; give up at the deadline
    let quietSince: number | null = null
    while (Date.now() < deadline) {
      if (this.inflight.size === 0) {
        quietSince ??= Date.now()
        if (Date.now() - quietSince >= NETWORK_QUIET_MS) return
      } else {
        quietSince = null
      }
      await sleep(POLL_MS)
    }
  }

  evaluate<T>(fn: string | ((arg?: any) => T | Promise<T>), arg?: unknown): Promise<T> {
    const expression =
      typeof fn === 'string'
        ? fn
        : `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
    return this.wc.executeJavaScript(expression, true) as Promise<T>
  }

  async addScript(source: string): Promise<void> {
    await this.wc.executeJavaScript(source, true)
  }

  async addInitScript(source: string): Promise<void> {
    await this.cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source })
  }

  async screenshot(options: ScreenshotOptions): Promise<Uint8Array> {
    if (options.omitBackground) {
      await this.cdp.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      })
    }
    try {
      const { data } = (await this.cdp.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        ...(options.clip ? { clip: { ...options.clip, scale: 1 } } : {}),
      })) as { data: string }
      return Buffer.from(data, 'base64')
    } finally {
      if (options.omitBackground) {
        await this.cdp.sendCommand('Emulation.setDefaultBackgroundColorOverride', {})
      }
    }
  }

  async screenshotElement(
    selector: string,
    options: Pick<ScreenshotOptions, 'omitBackground'>,
  ): Promise<Uint8Array | null> {
    const box = await this.evaluate<{ x: number; y: number; width: number; height: number } | null>(
      (sel: string) => {
        const node = document.querySelector(sel)
        if (!node) return null
        const r = node.getBoundingClientRect()
        return {
          x: Math.max(0, Math.round(r.left + window.scrollX)),
          y: Math.max(0, Math.round(r.top + window.scrollY)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }
      },
      selector,
    )
    if (!box || box.width <= 0 || box.height <= 0) return null
    return this.screenshot({ clip: box, omitBackground: options.omitBackground })
  }

  elementExists(selector: string): Promise<boolean> {
    return this.evaluate<boolean>((sel: string) => document.querySelector(sel) !== null, selector)
  }

  /** Whether the hidden window is already gone (destroyed externally or by a crash). */
  isWindowDestroyed(): boolean {
    return this.win.isDestroyed()
  }

  /** Forcibly tear the hidden window down; for watchdogs that must stop a
   *  conversion whose renderer never yields (a pending executeJavaScript can
   *  never settle, so a graceful close would never run either). */
  destroyNow(): void {
    if (!this.win.isDestroyed()) this.win.destroy()
  }

  async close(): Promise<void> {
    try {
      this.cdp.detach()
    } catch {
      // already detached with the page
    }
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
