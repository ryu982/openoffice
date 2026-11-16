import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { convertLegacyDocToDocx, isLegacyDocError } from '../../../../packages/doc2docx/src'
import { convertPptToPptx, LegacyPptError } from '../../../../packages/ppt2pptx/src'

/**
 * Legacy Office binaries that open as a converted copy: Word 97-2003 (.doc,
 * and its .dot template) in the Word tab, PowerPoint 97-2003 (.ppt) in the
 * slides tab. The original is only read. The copy opens untitled, and its
 * first save asks where, suggesting the converted name beside the original,
 * the way an .xls or .ods opens in the spreadsheet tab (decision 0119).
 */
export const LEGACY_DOC_RE = /\.(doc|dot)$/i
export const LEGACY_PPT_RE = /\.ppt$/i

export type LegacyEditor = 'docs' | 'slides'

export function legacyEditorFor(path: string): LegacyEditor | null {
  if (LEGACY_DOC_RE.test(path)) return 'docs'
  if (LEGACY_PPT_RE.test(path)) return 'slides'
  return null
}

export interface LegacyCopy {
  editor: LegacyEditor
  bytes: Uint8Array
  /** the converted file's name, the original's stem with the new extension */
  fileName: string
  /** where the copy's first save suggests writing: beside the original */
  saveAsDefaultPath: string
  /** the original's extension, lower case without the dot */
  importedFrom: string
}

export type LegacyConvertResult =
  | { ok: true; copy: LegacyCopy }
  | {
      ok: false
      /** `encrypted` has its own advice; anything else is a damaged or unread file */
      reason: 'encrypted' | 'failed'
      /** the original's extension and the one the copy would have had */
      from: string
      to: string
      error: string
    }

/** Read and convert one legacy file; never throws for a file the converter refuses. */
export async function convertLegacyFile(
  filePath: string,
  read: (path: string) => Promise<Uint8Array> = readFile,
): Promise<LegacyConvertResult | null> {
  const editor = legacyEditorFor(filePath)
  if (!editor) return null
  const from = extname(filePath).slice(1).toLowerCase()
  const to = editor === 'docs' ? 'docx' : 'pptx'
  try {
    const source = new Uint8Array(await read(filePath))
    const bytes =
      editor === 'docs'
        ? (await convertLegacyDocToDocx(source)).docx
        : (await convertPptToPptx(source)).bytes
    const name = basename(filePath)
    const stem = name.slice(0, name.length - from.length - 1) || name
    const fileName = `${stem}.${to}`
    return {
      ok: true,
      copy: {
        editor,
        bytes,
        fileName,
        saveAsDefaultPath: join(dirname(filePath), fileName),
        importedFrom: from,
      },
    }
  } catch (error) {
    const encrypted =
      (isLegacyDocError(error) || error instanceof LegacyPptError) && error.code === 'encrypted'
    return {
      ok: false,
      reason: encrypted ? 'encrypted' : 'failed',
      from,
      to,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
