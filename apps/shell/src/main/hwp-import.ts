/**
 * The Hangul AI panel's import_attachment (decision 0135): a Markdown file the
 * person attached becomes a Hangul document without a model retyping it. The
 * bundled command line converts it (Markdown → Word → Hangul, the tables with a
 * Hangul look), and the result opens as a NEW, UNTITLED Hangul document in a tab
 * of its own: the document of the tab that asked is not touched, and the first
 * save asks where. The person's request can go along for the new tab's AI panel,
 * which runs it through its own send gate, as a skill template's copy does.
 *
 * No Electron import: the shell injects the folder, command line, tab and
 * hand-off operations, so the tests run this as is.
 */
import { basename, join } from 'node:path'
import type { SkillHandoff } from '@genoffice/electron-utils/generate-handoff'

export type MarkdownImportResult =
  { ok: true; title: string; handed: boolean } | { ok: false; error: string }

export type HangulFormat = 'hwp' | 'hwpx'

/** the new tab's webContents, as far as this module needs it */
export interface ImportedTabContents {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

export interface MarkdownImportDeps {
  /** the format new Hangul documents are saved in (Settings → General) */
  defaultFormat(): HangulFormat
  /** a new empty folder for one converted copy */
  makeDir(): string
  removeDir(dir: string): void
  /** `convert <input> --to <format> --out <out>`; `reason` is the command's detail.reason */
  convert(
    input: string,
    format: HangulFormat,
    out: string,
  ): Promise<{ ok: true } | { ok: false; error: string; reason?: string }>
  /** the copy as a new, untitled Hangul tab titled `title`; null when it could not open */
  openCopy(path: string, title: string): ImportedTabContents | null
  queueHandoff(contents: ImportedTabContents, handoff: SkillHandoff): void
  newId(): string
  now(): number
}

/**
 * Told to the model of the new tab with the person's request: without it the
 * request ("make this file a Hangul document") would be read as work still to do.
 */
export function importedNote(fileName: string): string {
  return (
    `The app has already converted the file “${fileName}” the person attached into this document ` +
    '(a new, untitled Hangul document): its headings, lists and tables are all here, and the file ' +
    'itself is not attached in this tab. Do not retype it and do not ask for it. Do what remains of ' +
    'the request in this document: look at how it is formatted first, then change styles, page ' +
    'setup and table looks as the request asks. If nothing remains, say the document is ready.'
  )
}

/** the document's title: the file name without its Markdown extension */
const titleOf = (path: string): string =>
  basename(path).replace(/\.(md|markdown)$/i, '') || basename(path)

export async function openMarkdownAsHangul(
  deps: MarkdownImportDeps,
  path: string,
  request?: string,
): Promise<MarkdownImportResult> {
  const title = titleOf(path)
  const dir = deps.makeDir()
  let kept = false
  try {
    const first = deps.defaultFormat()
    let format = first
    let out = join(dir, `${title}.${format}`)
    let converted = await deps.convert(path, format, out)
    if (!converted.ok && format === 'hwp' && converted.reason === 'hwp-readback') {
      // the engine does not read its own .hwp back the same: the document opens as .hwpx
      format = 'hwpx'
      out = join(dir, `${title}.${format}`)
      converted = await deps.convert(path, format, out)
    }
    if (!converted.ok) return { ok: false, error: converted.error }
    const contents = deps.openCopy(out, title)
    if (!contents) return { ok: false, error: 'the new Hangul tab could not be opened' }
    // the copy is the tab's document from here on: it goes when the tab does
    kept = true
    contents.once('destroyed', () => deps.removeDir(dir))
    const words = request?.trim() ?? ''
    if (words && !contents.isDestroyed()) {
      deps.queueHandoff(contents, {
        id: deps.newId(),
        mode: 'skill',
        target: 'hwp',
        text: words,
        chips: [],
        note: importedNote(basename(path)),
        createdAt: deps.now(),
      })
    }
    return { ok: true, title, handed: words !== '' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (!kept) deps.removeDir(dir)
  }
}
