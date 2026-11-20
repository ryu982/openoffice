// @vitest-environment node
/**
 * The same-document save guard of the HWP main process (split-view decision 0036):
 * while the same document is open as a split-pane copy pair, a save from one copy
 * must ask before overwriting a change the sibling copy made on disk, and an
 * automatic save must stand down without a dialog. A save of a file open nowhere
 * else behaves exactly as before, and neither asking nor standing down may leave
 * the .bak backup or touch the file.
 */
import { constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** every whole-file read the main process makes, by path */
const fileReads = vi.fn()
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    fileReads(args[0])
    return actual.readFile(...args)
  }) as typeof actual.readFile
  const copyFile = vi.fn(actual.copyFile)
  const open = vi.fn(actual.open)
  return {
    ...actual,
    default: { ...actual, readFile, copyFile, open },
    readFile,
    copyFile,
    open,
  }
})

const actualPromises = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const errnoError = (code: string) => Object.assign(new Error(`${code}: injected`), { code })

/**
 * The platform copy failing as libuv fails on a mount that refuses chmod: an
 * exclusive copy refuses a file that is already there; otherwise the
 * destination has been created or truncated by then and is removed on the way out.
 */
function failPlatformCopyLikeLibuv(code: string): void {
  vi.mocked(copyFile).mockImplementation(async (_source, target, mode) => {
    const path = String(target)
    if (((mode ?? 0) & constants.COPYFILE_EXCL) !== 0 && existsSync(path))
      throw errnoError('EEXIST')
    writeFileSync(path, '')
    rmSync(path)
    throw errnoError(code)
  })
}

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const showMessageBox = vi.fn(async (..._args: unknown[]) => ({ response: 1 }))
const showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: undefined }))

interface FakeContents {
  id: number
  destroyed: boolean
  listeners: Map<string, (...args: unknown[]) => void>
  isDestroyed(): boolean
  setWindowOpenHandler(handler: unknown): void
  loadURL(url: string): Promise<void>
  send(channel: string, ...args: unknown[]): void
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
}

let nextId = 1
function fakeContents(): FakeContents {
  const contents: FakeContents = {
    id: nextId++,
    destroyed: false,
    listeners: new Map(),
    isDestroyed: () => contents.destroyed,
    setWindowOpenHandler: () => {},
    loadURL: async () => {},
    send: () => {},
    on: (event, listener) => {
      contents.listeners.set(event, listener)
    },
    once: (event, listener) => {
      contents.listeners.set(event, listener)
    },
  }
  return contents
}

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) => join(tmpdir(), `hwp-test-${name}`),
    getLocale: () => 'en-US',
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
  },
  shell: { openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  ipcRenderer: {},
  webUtils: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = fakeContents()
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
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

import { setOpenPathProbe } from '@genoffice/electron-utils'
import { createHwpView } from '../src/main/hwp-main'
import { HWP_CHANNELS } from '../src/shared/ipc'
import type { BeginSaveResult, CommitSaveResult } from '../src/shared/ipc'

let dir: string
let docPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-save-conflict-'))
  docPath = join(dir, 'doc.hwpx')
  showMessageBox.mockClear()
  showMessageBox.mockResolvedValue({ response: 1 })
  setOpenPathProbe(null)
})

afterEach(() => {
  setOpenPathProbe(null)
  vi.mocked(copyFile).mockImplementation(actualPromises.copyFile)
  vi.mocked(open).mockImplementation(actualPromises.open)
  rmSync(dir, { recursive: true, force: true })
  Object.defineProperty(process, 'platform', hostPlatform)
})

/**
 * The mount these tests describe (gvfs SMB, WebDAV) is a POSIX one: on Windows
 * the copy helpers keep to CopyFileW and never reach the fallback under test.
 * `node:path` and the rest settled at import, so only the platform checks made
 * at call time see the change.
 */
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const usePosixMount = () =>
  Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' })

/** HWPX bytes enough for the container check (ZIP magic). */
const SAVED_BYTES = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x21, 0x22, 0x23])

const call = <T>(channel: string, contents: FakeContents, ...args: unknown[]): T =>
  handlers.get(channel)!({ sender: contents }, ...args) as T

/** A view that opened the document: the read records the disk state of the copy. */
async function openView(path: string): Promise<FakeContents> {
  const contents = createHwpView(path).webContents as unknown as FakeContents
  await call<Promise<Uint8Array>>(HWP_CHANNELS.readFile, contents, path)
  return contents
}

/** One plain save of the open document: begin resolves the target, commit writes `bytes`. */
async function saveThrough(
  contents: FakeContents,
  bytes: Uint8Array,
  auto?: boolean,
): Promise<CommitSaveResult> {
  const begin = await call<Promise<BeginSaveResult>>(HWP_CHANNELS.beginSave, contents, 'save')
  if (!begin.ok || 'canceled' in begin) throw new Error('the save did not begin')
  // the preload sends the automatic flag in the options object (with a HWPX save's memo list)
  return call<Promise<CommitSaveResult>>(HWP_CHANNELS.commitSave, contents, bytes, [], {
    auto: auto === true,
  })
}

describe('opening a document', () => {
  it('reads the file once: its content also gives the recorded disk state', async () => {
    writeFileSync(docPath, 'v1')
    fileReads.mockClear()
    const contents = await openView(docPath)
    expect(fileReads.mock.calls.filter(([path]) => path === docPath)).toHaveLength(1)
    setOpenPathProbe((path) => path === docPath)
    // another pane's write: the recorded state is there, and an automatic save stands down
    writeFileSync(docPath, 'v2-sibling')
    expect((await saveThrough(contents, SAVED_BYTES, true)).ok).toBe(false)
    // the file as it was read, written again: the recorded state is that content's
    writeFileSync(docPath, 'v1')
    expect(await saveThrough(contents, SAVED_BYTES, true)).toMatchObject({
      ok: true,
      path: docPath,
    })
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})

describe('same-document save guard', () => {
  it('does not ask for a file open nowhere else, whatever the disk holds', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-someone-else')
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result).toMatchObject({ ok: true, path: docPath })
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
  })

  it('asks before a manual save overwrites a sibling copy change, and keeps the disk copy on cancel', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-sibling')
    setOpenPathProbe((path) => path === docPath)
    showMessageBox.mockResolvedValue({ response: 1 })
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result.ok).toBe(false)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(readFileSync(docPath, 'utf8')).toBe('v2-sibling')
    // the prompt comes first: a canceled save leaves no .bak and no bytes either
    expect(existsSync(`${docPath}.bak`)).toBe(false)
  })

  it('writes on proceed, keeping the disk bytes in the .bak the first overwrite makes', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-sibling')
    setOpenPathProbe((path) => path === docPath)
    showMessageBox.mockResolvedValue({ response: 0 })
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result).toMatchObject({ ok: true, path: docPath })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
    expect(readFileSync(`${docPath}.bak`, 'utf8')).toBe('v2-sibling')
  })

  it('defers an automatic save silently while a sibling copy holds a changed file', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    writeFileSync(docPath, 'v2-sibling')
    setOpenPathProbe((path) => path === docPath)
    const result = await saveThrough(contents, SAVED_BYTES, true)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/external-modified/)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(docPath, 'utf8')).toBe('v2-sibling')
    expect(existsSync(`${docPath}.bak`)).toBe(false)
  })

  it('does not ask while the sibling copy still matches the disk', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result).toMatchObject({ ok: true, path: docPath })
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('records what a successful save wrote, so the next save compares against that', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    setOpenPathProbe((path) => path === docPath)
    const first = await saveThrough(contents, SAVED_BYTES)
    expect(first).toMatchObject({ ok: true, path: docPath })
    expect(showMessageBox).not.toHaveBeenCalled()
    // a stale record (the state at open, not the written bytes) would raise the prompt here
    const second = await saveThrough(contents, Uint8Array.from([...SAVED_BYTES, 0x44]))
    expect(second).toMatchObject({ ok: true, path: docPath })
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})

describe('the .bak backup on a mount that refuses the platform copy', () => {
  beforeEach(usePosixMount)

  it('still makes the backup and lands the save when the platform copy fails', async () => {
    writeFileSync(docPath, 'v1')
    const contents = await openView(docPath)
    failPlatformCopyLikeLibuv('ENOTSUP')
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result).toMatchObject({ ok: true, path: docPath, backupPath: `${docPath}.bak` })
    expect(readFileSync(docPath)).toEqual(Buffer.from(SAVED_BYTES))
    expect(readFileSync(`${docPath}.bak`, 'utf8')).toBe('v1')
  })

  it('stops the save when no backup can be made, and keeps the document and the older .bak', async () => {
    writeFileSync(docPath, 'v1')
    writeFileSync(`${docPath}.bak`, 'v0-older-backup')
    const contents = await openView(docPath)
    failPlatformCopyLikeLibuv('ENOTSUP')
    vi.mocked(open).mockImplementation(async (...args) => {
      if (args[1] !== undefined && args[1] !== 'r') throw errnoError('EACCES')
      return actualPromises.open(...(args as Parameters<typeof actualPromises.open>))
    })
    const result = await saveThrough(contents, SAVED_BYTES)
    expect(result.ok).toBe(false)
    expect(readFileSync(docPath, 'utf8')).toBe('v1')
    expect(readFileSync(`${docPath}.bak`, 'utf8')).toBe('v0-older-backup')
  })
})
