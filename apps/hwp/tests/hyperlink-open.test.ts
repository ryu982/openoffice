// @vitest-environment node
/**
 * External hyperlink opening in the HWP editor view: Electron denies new
 * windows and forwards validated http(s) and mailto URLs to shell.openExternal,
 * while rejecting about:blank, file:, javascript:, and custom schemes.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type WindowOpenHandler = (details: { url: string }) => { action: string }

const openExternal = vi.fn(async (_url: string) => {})
let registeredWindowOpenHandler: WindowOpenHandler | null = null

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) => join(tmpdir(), `hwp-link-test-${name}`),
    getLocale: () => 'ko-KR',
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  shell: {
    openExternal: (url: string) => openExternal(url),
    showItemInFolder: vi.fn(),
  },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  ipcRenderer: {},
  webUtils: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = {
      id: 1,
      isDestroyed: () => false,
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        registeredWindowOpenHandler = handler
      },
      loadURL: async () => {},
      send: () => {},
      on: () => {},
      once: () => {},
    }
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('@genoffice/file-parse', () => ({
  hwpToText: vi.fn(async () => ''),
  parseFileToText: vi.fn(async () => ({ kind: 'text', text: '' })),
  ATTACHABLE_EXTS: new Set<string>(),
  ATTACHABLE_IMAGE_EXTS: new Set<string>(),
  ATTACHABLE_MAX_BYTES: 25 * 1024 * 1024,
  attachableMaxBytes: () => 25 * 1024 * 1024,
  ATTACHABLE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
}))

import { createHwpView } from '../src/main/hwp-main'

describe('hwp view window-open handler', () => {
  beforeEach(() => {
    openExternal.mockClear()
    registeredWindowOpenHandler = null
  })

  it('routes http, https, and mailto URLs to shell.openExternal and denies in-app popups', () => {
    createHwpView(null)
    expect(registeredWindowOpenHandler).not.toBeNull()

    expect(registeredWindowOpenHandler!({ url: 'https://example.com/docs?q=1' })).toEqual({
      action: 'deny',
    })
    expect(registeredWindowOpenHandler!({ url: 'http://example.com' })).toEqual({
      action: 'deny',
    })
    expect(registeredWindowOpenHandler!({ url: 'mailto:user@example.com' })).toEqual({
      action: 'deny',
    })

    expect(openExternal).toHaveBeenCalledTimes(3)
    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://example.com/docs?q=1')
    expect(openExternal).toHaveBeenNthCalledWith(2, 'http://example.com')
    expect(openExternal).toHaveBeenNthCalledWith(3, 'mailto:user@example.com')
  })

  it('rejects about:blank, file:, javascript:, and custom schemes', () => {
    createHwpView(null)
    expect(registeredWindowOpenHandler).not.toBeNull()

    for (const url of [
      'about:blank',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'custom-app://open',
      '',
    ]) {
      expect(registeredWindowOpenHandler!({ url })).toEqual({ action: 'deny' })
    }
    expect(openExternal).not.toHaveBeenCalled()
  })
})
