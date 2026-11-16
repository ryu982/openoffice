/**
 * The AI's import_attachment reaches the main process as hwp:files-import-document:
 * only a Markdown file that passes the attachment checks goes on to the shell,
 * which converts it and opens the new tab. A file open with unsaved changes is
 * not converted from its stale bytes on disk.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
  },
  BrowserWindow: class {},
}))
vi.mock('@genoffice/file-parse', () => ({
  parseFileToText: vi.fn(),
  ATTACHABLE_EXTS: new Set(['txt', 'md', 'markdown', 'docx', 'hwp', 'png']),
  ATTACHABLE_IMAGE_EXTS: new Set(['png']),
  ATTACHABLE_MAX_BYTES: 50 * 1024 * 1024,
  attachableMaxBytes: () => 8,
  ATTACHABLE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  diagramPictureExtOf: () => null,
  diagramPictureExtOfName: () => null,
}))
// the real unsaved-files helper, by path: the package root reaches Electron
vi.mock('@genoffice/electron-utils', async () => ({
  showOpenDialogWithMemory: vi.fn(),
  ...(await import('../../../packages/electron-utils/src/unsaved-files')),
}))

import {
  UNSAVED_CHANGES_MESSAGE,
  setOpenFilesSource,
} from '../../../packages/electron-utils/src/unsaved-files'
import { registerHwpAttachmentIpc, type HwpAttachmentHost } from '../src/main/attachments-ipc'

type ImportResult = { ok: true; title: string; handed: boolean } | { ok: false; error: string }
let dir: string
const open = vi.fn<NonNullable<HwpAttachmentHost['openMarkdownAsDocument']>>()

function importDocument(
  path: unknown,
  request?: unknown,
  host: HwpAttachmentHost = { openMarkdownAsDocument: open },
): Promise<ImportResult> {
  handlers.clear()
  registerHwpAttachmentIpc(() => host)
  const fn = handlers.get('hwp:files-import-document') as unknown as (
    e: unknown,
    path: unknown,
    request: unknown,
  ) => Promise<ImportResult>
  return fn({ sender: { id: 3 } }, path, request)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-import-'))
  open.mockReset()
  open.mockResolvedValue({ ok: true, title: 'note', handed: false })
})
afterEach(() => {
  setOpenFilesSource(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('hwp:files-import-document', () => {
  it('hands a Markdown file to the shell for the asking tab, with the request trimmed', async () => {
    const path = join(dir, 'note.md')
    writeFileSync(path, '# note')
    open.mockResolvedValue({ ok: true, title: 'note', handed: true })
    expect(await importDocument(path, '  표를 다듬어 줘 ')).toEqual({
      ok: true,
      title: 'note',
      handed: true,
    })
    expect(open).toHaveBeenCalledWith(3, path, '표를 다듬어 줘')
  })

  it('passes no request when there is none', async () => {
    const path = join(dir, 'note.markdown')
    writeFileSync(path, '# note')
    await importDocument(path)
    expect(open).toHaveBeenCalledWith(3, path, undefined)
    await importDocument(path, '   ')
    expect(open).toHaveBeenLastCalledWith(3, path, undefined)
  })

  it('refuses anything that is not a Markdown file path', async () => {
    const docx = join(dir, 'report.docx')
    writeFileSync(docx, 'x')
    for (const bad of [docx, 7, undefined, join(dir, 'note.md.exe')]) {
      expect(await importDocument(bad)).toMatchObject({ ok: false })
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses a file that is missing or over the attachment size limit', async () => {
    expect(await importDocument(join(dir, 'gone.md'))).toMatchObject({ ok: false })
    const big = join(dir, 'big.md')
    writeFileSync(big, '123456789')
    expect(await importDocument(big)).toMatchObject({ ok: false })
    expect(open).not.toHaveBeenCalled()
  })

  it('does not convert a file that is open with unsaved changes', async () => {
    const path = join(dir, 'editing.md')
    writeFileSync(path, '# old')
    setOpenFilesSource(() => [{ filePath: path, dirty: true }])
    expect(await importDocument(path)).toEqual({ ok: false, error: UNSAVED_CHANGES_MESSAGE })
    expect(open).not.toHaveBeenCalled()
  })

  it('says so when no shell can open a tab, and reports what the shell could not do', async () => {
    const path = join(dir, 'note.md')
    writeFileSync(path, '# note')
    expect(await importDocument(path, undefined, {})).toEqual({
      ok: false,
      error: 'this window cannot open a new document tab',
    })
    open.mockRejectedValue(new Error('the conversion failed'))
    expect(await importDocument(path)).toEqual({ ok: false, error: 'the conversion failed' })
  })
})
