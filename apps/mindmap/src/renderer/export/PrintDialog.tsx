/**
 * The mind map's print dialog (decision 0141): the shared small print dialog
 * with no range (Print prints one page) and the page layout panel.
 *
 * The page is made before the dialog opens: the sheet on screen fitted to
 * landscape A4 (`snapshotPage`), in the map's own colours whatever the app's
 * theme. With nothing changed in the panel, Print hands that page to the print
 * as before. With an option on, the same page goes to the main process, which
 * makes it the PDF export's one-page PDF and arranges, previews, prints or
 * saves it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  paperSizePt,
  type PageSize,
  type PrintLayoutErrorCode,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  SimplePrintDialog,
  printLayoutIssueText,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
  type SimplePrintDialogProps,
} from '@genoffice/ui'
import { translateIn } from '../i18n/locale'
import type { MindmapExportApi, MindmapPrintJob } from '../../shared/ipc'

const A4 = paperSizePt('A4')

/** The print job is one landscape A4 page, known without making it. */
export const MAP_PRINT_PAGES: readonly PageSize[] = [{ widthPt: A4.heightPt, heightPt: A4.widthPt }]

type LayoutBridge = MindmapExportApi['printLayout']

interface Failure {
  kind: 'print' | 'save'
  code?: PrintLayoutErrorCode
  detail: string
}

export interface MapPrintDialogProps {
  lang: Lang
  /** the page Print prints, and the name an arranged PDF is offered under */
  job: MindmapPrintJob
  printLayout: LayoutBridge
  /** nothing changed in the panel: the print as it was, with this page */
  onPlainPrint: (html: string) => void
  /** the arranged PDF was written */
  onSaved: () => void
  onClose: () => void
}

export function MapPrintDialog(props: MapPrintDialogProps): ReactElement {
  const { lang, job, printLayout, onPlainPrint, onSaved, onClose } = props
  const [progress, setProgress] = useState<PrintLayoutProgress | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)

  // a job still running when the dialog goes away is stopped: nothing is sent
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (running.current) void printLayout.cancel()
    }
  }, [printLayout])

  const run = useCallback(
    async (kind: 'print' | 'save', options: PrintLayoutOptions): Promise<void> => {
      if (running.current) return
      running.current = true
      setFailure(null)
      setProgress({ done: 0, total: 0 })
      const off = printLayout.onProgress((next) => {
        if (mounted.current) setProgress(next)
      })
      try {
        const request = { options, editor: job }
        const result =
          kind === 'print' ? await printLayout.print(request) : await printLayout.savePdf(request)
        if (!mounted.current) return
        if (!result.ok) {
          // a cancel is the user's own: nothing to tell
          if ('aborted' in result) return
          console.error('[mindmap] arranged print failed:', result.error)
          setFailure({ kind, detail: result.error, ...(result.code ? { code: result.code } : {}) })
        } else if (kind === 'print') {
          onClose()
        } else if ('path' in result) {
          onSaved()
          onClose()
        }
      } catch (error) {
        console.error('[mindmap] arranged print failed:', error)
        if (mounted.current) setFailure({ kind, detail: String(error) })
      } finally {
        off()
        running.current = false
        if (mounted.current) setProgress(null)
      }
    },
    [job, printLayout, onClose, onSaved],
  )

  const preview = useCallback<NonNullable<SimplePrintDialogProps['onPreviewRequest']>>(
    async (_range, options, { signal, onProgress }) => {
      signal.throwIfAborted()
      const off = printLayout.onProgress(onProgress)
      const stop = (): void => void printLayout.cancel()
      signal.addEventListener('abort', stop, { once: true })
      try {
        const result = await printLayout.preview({ options, editor: job })
        if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
        return result.faces.map((face) => face.png)
      } finally {
        off()
        signal.removeEventListener('abort', stop)
      }
    },
    [job, printLayout],
  )

  const labelSpecStore = useMemo<PrintLabelSpecStore>(
    () => ({
      load: () => printLayout.getLabelSpec(),
      save: async (spec) => {
        const result = await printLayout.setLabelSpec(spec)
        if (!result.ok) throw new Error(result.error)
      },
    }),
    [printLayout],
  )

  const error = failure
    ? failure.code
      ? printLayoutIssueText(
          lang,
          { code: failure.code, message: failure.detail },
          { pageCount: MAP_PRINT_PAGES.length },
        )
      : translateIn(lang, failure.kind === 'print' ? 'printFailed' : 'exportFailed')
    : null

  return (
    <SimplePrintDialog
      lang={lang}
      rangeChoice="none"
      pages={MAP_PRINT_PAGES}
      capabilities={{ showPaperAndFit: true }}
      onPlainPrint={() => onPlainPrint(job.html)}
      onPrint={(_range, options) => void run('print', options)}
      onSavePdf={(_range, options) => void run('save', options)}
      onCancel={() => {
        if (running.current) void printLayout.cancel()
        onClose()
      }}
      labelSpecStore={labelSpecStore}
      onPreviewRequest={preview}
      job={{ progress, onCancel: () => void printLayout.cancel(), error }}
    />
  )
}
