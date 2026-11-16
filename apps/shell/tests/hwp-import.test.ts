/**
 * The Hangul AI panel's import_attachment in the shell: the Markdown file is
 * converted by the bundled command line into a folder of its own, the copy
 * opens as a new, untitled Hangul tab that owns that folder, and the person's
 * request is queued for that tab's panel with the app's note.
 */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SkillHandoff } from '@genoffice/electron-utils/generate-handoff'
import {
  importedNote,
  openMarkdownAsHangul,
  type HangulFormat,
  type ImportedTabContents,
  type MarkdownImportDeps,
} from '../src/main/hwp-import'

type ConvertAnswer = { ok: true } | { ok: false; error: string; reason?: string }

function setup(options: {
  format?: HangulFormat
  convert?: (format: HangulFormat) => ConvertAnswer
  opens?: boolean
}) {
  const destroyed: Array<() => void> = []
  const contents: ImportedTabContents = {
    id: 7,
    isDestroyed: () => false,
    once: (_event, listener) => destroyed.push(listener),
  }
  const removed: string[] = []
  const converted: Array<{ input: string; format: HangulFormat; out: string }> = []
  const opened: Array<{ path: string; title: string }> = []
  const queued: Array<{ contents: ImportedTabContents; handoff: SkillHandoff }> = []
  const deps: MarkdownImportDeps = {
    defaultFormat: () => options.format ?? 'hwp',
    makeDir: () => join('T:', 'imports', 'one'),
    removeDir: (dir) => removed.push(dir),
    convert: vi.fn(async (input, format, out) => {
      converted.push({ input, format, out })
      return options.convert?.(format) ?? { ok: true }
    }),
    openCopy: (path, title) => {
      opened.push({ path, title })
      return options.opens === false ? null : contents
    },
    queueHandoff: (target, handoff) => queued.push({ contents: target, handoff }),
    newId: () => 'h1',
    now: () => 42,
  }
  return { deps, removed, converted, opened, queued, closeTab: () => destroyed.forEach((l) => l()) }
}

const NOTE_MD = join('C:', 'notes', '도서관 이용 안내.md')

describe('a Markdown attachment as a new Hangul tab', () => {
  it('converts into its own folder in the default format and opens the copy untitled', async () => {
    const { deps, converted, opened, removed, queued, closeTab } = setup({})
    const result = await openMarkdownAsHangul(deps, NOTE_MD)
    const copy = join('T:', 'imports', 'one', '도서관 이용 안내.hwp')
    expect(result).toEqual({ ok: true, title: '도서관 이용 안내', handed: false })
    expect(converted).toEqual([{ input: NOTE_MD, format: 'hwp', out: copy }])
    expect(opened).toEqual([{ path: copy, title: '도서관 이용 안내' }])
    expect(queued).toEqual([])
    // the copy is the tab's document: the folder goes when the tab does
    expect(removed).toEqual([])
    closeTab()
    expect(removed).toEqual([join('T:', 'imports', 'one')])
  })

  it('follows the setting for new Hangul documents and takes the .markdown extension', async () => {
    const { deps, converted, opened } = setup({ format: 'hwpx' })
    const result = await openMarkdownAsHangul(deps, join('C:', 'notes', 'plan.markdown'))
    expect(result).toMatchObject({ ok: true, title: 'plan' })
    expect(converted[0]).toMatchObject({ format: 'hwpx' })
    expect(opened[0]!.path.endsWith('plan.hwpx')).toBe(true)
  })

  it('hands the request to the new tab with the note that the file is already in it', async () => {
    const { deps, queued } = setup({})
    const result = await openMarkdownAsHangul(deps, NOTE_MD, '  교육청 양식으로 만들어 줘  ')
    expect(result).toEqual({ ok: true, title: '도서관 이용 안내', handed: true })
    expect(queued).toHaveLength(1)
    expect(queued[0]!.contents.id).toBe(7)
    expect(queued[0]!.handoff).toEqual({
      id: 'h1',
      mode: 'skill',
      target: 'hwp',
      text: '교육청 양식으로 만들어 줘',
      chips: [],
      note: importedNote('도서관 이용 안내.md'),
      createdAt: 42,
    })
    expect(queued[0]!.handoff.note).toContain('already converted')
    expect(queued[0]!.handoff.note).toContain('Do not retype it')
  })

  it('hands nothing over for an empty request', async () => {
    const { deps, queued } = setup({})
    expect(await openMarkdownAsHangul(deps, NOTE_MD, '   ')).toMatchObject({ handed: false })
    expect(queued).toEqual([])
  })

  it('opens as .hwpx when the engine does not read its own .hwp back the same', async () => {
    const { deps, converted, opened } = setup({
      convert: (format) =>
        format === 'hwp'
          ? {
              ok: false,
              error: 'the .hwp reads back with 4 pages instead of 3',
              reason: 'hwp-readback',
            }
          : { ok: true },
    })
    const result = await openMarkdownAsHangul(deps, NOTE_MD)
    expect(result).toMatchObject({ ok: true })
    expect(converted.map((c) => c.format)).toEqual(['hwp', 'hwpx'])
    expect(opened[0]!.path.endsWith('도서관 이용 안내.hwpx')).toBe(true)
  })

  it('reports a failed conversion, opens no tab and leaves no folder', async () => {
    const { deps, opened, removed, queued } = setup({
      convert: () => ({ ok: false, error: 'not a Markdown file the editor reads' }),
    })
    const result = await openMarkdownAsHangul(deps, NOTE_MD, '다듬어 줘')
    expect(result).toEqual({ ok: false, error: 'not a Markdown file the editor reads' })
    expect(opened).toEqual([])
    expect(queued).toEqual([])
    expect(removed).toEqual([join('T:', 'imports', 'one')])
  })

  it('does not retry another format for a failure that is not the .hwp read-back', async () => {
    const { deps, converted } = setup({
      convert: () => ({ ok: false, error: 'boom', reason: 'not-docx' }),
    })
    expect(await openMarkdownAsHangul(deps, NOTE_MD)).toEqual({ ok: false, error: 'boom' })
    expect(converted).toHaveLength(1)
  })

  it('removes the folder when the tab could not be opened', async () => {
    const { deps, removed, queued } = setup({ opens: false })
    const result = await openMarkdownAsHangul(deps, NOTE_MD, '다듬어 줘')
    expect(result).toEqual({ ok: false, error: 'the new Hangul tab could not be opened' })
    expect(removed).toEqual([join('T:', 'imports', 'one')])
    expect(queued).toEqual([])
  })
})
