/**
 * The hidden window's isolation, wired against a stand-in Electron: the page
 * is hostile (an altChunk inside a downloaded .docx, an HTML file someone
 * sent), so what it may load, where it may go and what it may ask for are
 * decided here, not by the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RequestListener = (
  details: { url: string; webContentsId?: number },
  callback: (response: { cancel: boolean }) => void,
) => void

const fake = vi.hoisted(() => {
  const state = {
    partitions: [] as { name: string; options: unknown }[],
    windows: [] as any[],
    nextId: 1,
  }
  return state
})

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const session = new (class extends EventEmitter {
    onBeforeRequest: RequestListener | null = null
    permissionRequest: ((wc: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null
    permissionCheck: (() => boolean) | null = null
    deviceCheck: (() => boolean) | null = null
    spellcheck = true
    handled = new Map<string, unknown>()
    storageCleared = 0
    webRequest = {
      onBeforeRequest: (listener: RequestListener) => {
        this.onBeforeRequest = listener
      },
    }
    protocol = {
      handle: (scheme: string, handler: unknown) => this.handled.set(scheme, handler),
      isProtocolHandled: (scheme: string) => this.handled.has(scheme),
    }
    setSpellCheckerEnabled(on: boolean) {
      this.spellcheck = on
    }
    setPermissionRequestHandler(fn: any) {
      this.permissionRequest = fn
    }
    setPermissionCheckHandler(fn: any) {
      this.permissionCheck = fn
    }
    setDevicePermissionHandler(fn: any) {
      this.deviceCheck = fn
    }
    clearStorageData() {
      this.storageCleared += 1
      return Promise.resolve()
    }
  })()

  class FakeWebContents extends EventEmitter {
    id = fake.nextId++
    destroyed = false
    windowOpen: (() => { action: string }) | null = null
    webrtcPolicy = ''
    debugger = Object.assign(new EventEmitter(), {
      attach: () => {},
      detach: () => {},
      sendCommand: async () => ({}),
    })
    setWindowOpenHandler(fn: () => { action: string }) {
      this.windowOpen = fn
    }
    setWebRTCIPHandlingPolicy(policy: string) {
      this.webrtcPolicy = policy
    }
    loadURL() {
      return Promise.resolve()
    }
    isDestroyed() {
      return this.destroyed
    }
  }

  class BrowserWindow {
    webContents = new FakeWebContents()
    private gone = false
    constructor(public options: any) {
      fake.windows.push(this)
    }
    setContentSize() {}
    isDestroyed() {
      return this.gone
    }
    destroy() {
      this.gone = true
      this.webContents.destroyed = true
      this.webContents.emit('destroyed')
    }
  }

  return {
    BrowserWindow,
    session: {
      fromPartition: (name: string, options: unknown) => {
        fake.partitions.push({ name, options })
        return session
      },
    },
  }
})

const { ElectronBrowserDriver } = await import('../src/drivers/electron')
const { session } = (await import('electron')) as any
const ses = session.fromPartition('probe', {})

const VIEWPORT = { width: 794, height: 1123, deviceScaleFactor: 2 }
const PAGE = 'file:///C:/tmp/genoffice-altchunk-x/chunk.html'

function decide(url: string, webContentsId: number | undefined): boolean {
  let cancel: boolean | undefined
  ses.onBeforeRequest({ url, webContentsId }, (response: { cancel: boolean }) => {
    cancel = response.cancel
  })
  return cancel === false
}

describe.sequential('ElectronBrowserDriver isolation', () => {
  beforeEach(() => {
    fake.windows.length = 0
    fake.partitions.length = 0
  })

  it('opens the page in its own in-memory session, locked down', async () => {
    const driver = await ElectronBrowserDriver.create(VIEWPORT, {
      allowRequest: (url) => url === PAGE,
    })
    const win = fake.windows.at(-1)
    const prefs = win.options.webPreferences
    expect(prefs.session).toBe(ses)
    expect(fake.partitions[0].name.startsWith('persist:')).toBe(false)
    expect(prefs).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    })
    expect(prefs.preload).toBeUndefined()
    expect(ses.spellcheck).toBe(false)
    expect(win.webContents.webrtcPolicy).toBe('disable_non_proxied_udp')
    expect(win.webContents.windowOpen()).toEqual({ action: 'deny' })
    await driver.close()
  })

  it('loads what the caller allows and cancels everything else', async () => {
    const driver = await ElectronBrowserDriver.create(VIEWPORT, {
      allowRequest: (url) => url === PAGE,
    })
    const id = fake.windows.at(-1).webContents.id
    expect(decide(PAGE, id)).toBe(true)
    expect(decide('data:image/png;base64,AAAA', id)).toBe(true)
    expect(decide('file:///C:/Users/someone/Documents/notes.txt', id)).toBe(false)
    expect(decide('file:///C:/tmp/genoffice-altchunk-x/', id)).toBe(false)
    expect(decide('http://127.0.0.1:8080/', id)).toBe(false)
    expect(decide('https://example.com/a.png', id)).toBe(false)
    expect(decide('ws://127.0.0.1:9/', id)).toBe(false)
    // no window of ours behind it (a worker, the session itself): refused
    expect(decide(PAGE, undefined)).toBe(false)
    expect(decide(PAGE, 9999)).toBe(false)
    await driver.close()
    // the window is gone: its policy with it
    expect(decide(PAGE, id)).toBe(false)
  })

  it('keeps each window to its own policy', async () => {
    const a = await ElectronBrowserDriver.create(VIEWPORT, { allowRequest: (u) => u === PAGE })
    const idA = fake.windows.at(-1).webContents.id
    const b = await ElectronBrowserDriver.create(VIEWPORT, {
      allowRequest: (u) => u.startsWith('https:'),
    })
    const idB = fake.windows.at(-1).webContents.id
    expect(decide('https://example.com/', idA)).toBe(false)
    expect(decide('https://example.com/', idB)).toBe(true)
    expect(decide(PAGE, idB)).toBe(false)
    await a.close()
    await b.close()
  })

  it('refuses navigation, permissions and downloads', async () => {
    const driver = await ElectronBrowserDriver.create(VIEWPORT, { allowRequest: () => true })
    const wc = fake.windows.at(-1).webContents
    const navigation = { preventDefault: vi.fn() }
    wc.emit('will-navigate', navigation)
    expect(navigation.preventDefault).toHaveBeenCalled()
    const granted = vi.fn()
    ses.permissionRequest(wc, 'media', granted)
    expect(granted).toHaveBeenCalledWith(false)
    expect(ses.permissionCheck()).toBe(false)
    expect(ses.deviceCheck()).toBe(false)
    const download = { preventDefault: vi.fn() }
    ses.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalled()
    await driver.close()
  })

  it('serves the schemes the caller brings in the isolated session, and forgets storage', async () => {
    const handler = () => new Response('x')
    const cleared = ses.storageCleared
    const driver = await ElectronBrowserDriver.create(VIEWPORT, {
      allowRequest: () => false,
      protocols: { 'html-asset': handler },
    })
    expect(ses.handled.get('html-asset')).toBe(handler)
    await driver.close()
    expect(ses.storageCleared).toBe(cleared + 1)
  })
})
