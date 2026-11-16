/**
 * What the pdf editor's conversion dialog asks of the shell around a
 * Markdown / EPUB job (the job itself goes through the structure channels):
 * free the Markdown target from a tab that shows it, open the result in a
 * Markdown tab, show a result in the file manager.
 *
 * Every request names the view's open PDF; a view that was not given that PDF
 * gets nothing. Only Markdown files are opened, and only existing files of the
 * kinds the conversion writes are shown. Electron-free so it can be tested.
 */
import type { MakeAndOpenAnswer } from '@genoffice/electron-utils/editor-entrance'
import type { PdfConvertOutputRequest, PdfReflowFormat } from '../../../pdf/src/shared/ipc'

export interface PdfConvertUiTabs {
  /** the Markdown tab showing the file, if any */
  findMarkdownTab(path: string): string | undefined
  /** close a tab; its unsaved-changes guard applies (the user may keep it open) */
  closeTab(tabId: string): Promise<void>
  /** bring the pdf view's tab back to the front after closing another tab */
  activateView(viewId: number): void
  /** open a converted file: its tab, or its folder while its editor is off */
  openDocument(path: string): boolean
  /**
   * Before a conversion whose result opens in another editor starts: asks
   * while that editor is off (editor choice spec 7.3). `source` is the PDF.
   */
  askBeforeConvert(format: PdfReflowFormat, source: string): Promise<MakeAndOpenAnswer>
}

export interface PdfConvertUiDeps extends PdfConvertUiTabs {
  /** the view was given this PDF as its open file */
  ownsSource(viewId: number, path: string): boolean
  exists(path: string): boolean
  showInFolder(path: string): void
}

const MAX_PATH = 4096
const MARKDOWN = /\.md$/i
/** what the conversion dialog, the picture export and the translation write */
const REVEALABLE = /\.(md|epub|png|pdf)$/i

export function createPdfConvertUiHandlers(deps: PdfConvertUiDeps) {
  const requestOf = (viewId: number, req: unknown): PdfConvertOutputRequest | null => {
    if (!req || typeof req !== 'object') return null
    const { source, path } = req as Partial<PdfConvertOutputRequest>
    if (typeof source !== 'string' || typeof path !== 'string') return null
    if (!path || path.length > MAX_PATH || !deps.ownsSource(viewId, source)) return null
    return { source, path }
  }

  return {
    /** true when no Markdown tab shows the target (any more) */
    async releaseTarget(viewId: number, req: unknown): Promise<boolean> {
      const request = requestOf(viewId, req)
      if (!request || !MARKDOWN.test(request.path)) return false
      const tab = deps.findMarkdownTab(request.path)
      if (!tab) return true
      await deps.closeTab(tab)
      deps.activateView(viewId)
      return deps.findMarkdownTab(request.path) === undefined
    },

    openResult(viewId: number, req: unknown): boolean {
      const request = requestOf(viewId, req)
      if (!request || !MARKDOWN.test(request.path) || !deps.exists(request.path)) return false
      return deps.openDocument(request.path)
    },

    /** the converter's Markdown entry, before its dialog opens; anything unknown is a cancel */
    async askBeforeConvert(viewId: number, req: unknown): Promise<MakeAndOpenAnswer> {
      if (!req || typeof req !== 'object') return 'cancel'
      const { source, format } = req as { source?: unknown; format?: unknown }
      if (format !== 'md' && format !== 'epub') return 'cancel'
      if (typeof source !== 'string' || !source || source.length > MAX_PATH) return 'cancel'
      if (!deps.ownsSource(viewId, source)) return 'cancel'
      return deps.askBeforeConvert(format, source)
    },

    revealResult(viewId: number, req: unknown): boolean {
      const request = requestOf(viewId, req)
      if (!request || !REVEALABLE.test(request.path) || !deps.exists(request.path)) return false
      deps.showInFolder(request.path)
      return true
    },
  }
}
