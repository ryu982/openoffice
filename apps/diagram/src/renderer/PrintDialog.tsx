/**
 * The diagram's print dialog (spec 4, 5): all pages or the page on screen,
 * and the shared page layout panel. With every layout option at its default,
 * Print is the print as it always was (`plainPrint`: the scope's sheets in
 * the app's hidden print window, the system dialog). With an option on, the
 * same sheets travel to the main process, which makes them the print job PDF
 * and prints, previews or saves the arranged result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SimplePrintDialog,
  printLayoutIssueText,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
  type SimplePrintRange,
  type SimplePrintDialogProps,
} from '@genoffice/ui'
import type {
  PageSize,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import type { DiagramExportApi, DiagramPrintJob, ExportScope } from '../shared/ipc'
import type { DrawioFrame } from './drawio/frame-client'
import { plainPrint, printPagesIn, printSheetSizesIn } from './document/print-pages'
import { useI18n } from './i18n/locale'

type Failure = { kind: 'print' | 'save'; detail: string; code?: PrintLayoutErrorCode | undefined }

/** The print gathers before anything shows a count: "…" until the main process reports. */
const GATHERING: PrintLayoutProgress = { done: 0, total: 0 }

const scopeOf = (range: SimplePrintRange): ExportScope =>
  range.kind === 'current' ? 'current' : 'all'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface DiagramPrintDialogProps {
  client: Pick<DrawioFrame, 'request'>
  api: Pick<DiagramExportApi, 'print' | 'printLayout'>
  /** the diagram's name: the print job's and the saved PDF's */
  title: string
  onClose: () => void
  /** a line for the status bar: a failed plain print, a saved PDF */
  onMessage: (text: string) => void
}

export function DiagramPrintDialog(props: DiagramPrintDialogProps) {
  const { client, api, title, onClose, onMessage } = props
  const { lang, t } = useI18n()
  const [pages, setPages] = useState<PageSize[] | null>(null)
  const [progress, setProgress] = useState<PrintLayoutProgress | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const stoppedRef = useRef(false)
  const countRef = useRef(0)
  const { printLayout } = api

  // the layout diagram's sheets: the page formats of the chosen pages, no pictures made
  const countPages = useCallback(
    (scope: ExportScope) => {
      const nth = ++countRef.current
      setPages(null)
      printSheetSizesIn(client, scope)
        .then((sizes) => {
          if (mountedRef.current && nth === countRef.current) setPages(sizes)
        })
        .catch(() => {
          if (mountedRef.current && nth === countRef.current) setPages([])
        })
    },
    [client],
  )

  useEffect(() => {
    mountedRef.current = true
    countPages('all')
    return () => {
      mountedRef.current = false
      // a job still running when the dialog goes away is stopped: nothing is sent
      if (runningRef.current) void printLayout.cancel()
    }
  }, [countPages, printLayout])

  const jobOf = useCallback(
    async (range: SimplePrintRange): Promise<DiagramPrintJob> => ({
      pages: await printPagesIn(client, scopeOf(range)),
      title,
    }),
    [client, title],
  )

  const onPlainPrint = (range: SimplePrintRange): void => {
    onClose()
    plainPrint(api, client, scopeOf(range), title)
      .then((result) => {
        if (!result.ok) onMessage(t('printFailed', { error: result.error }))
      })
      .catch((err: unknown) => onMessage(t('printFailed', { error: messageOf(err) })))
  }

  const runLayout = async (
    kind: 'print' | 'save',
    range: SimplePrintRange,
    options: PrintLayoutOptions,
  ): Promise<void> => {
    if (runningRef.current) return
    runningRef.current = true
    stoppedRef.current = false
    setFailure(null)
    setProgress(GATHERING)
    const off = printLayout.onProgress((next) => {
      if (mountedRef.current) setProgress(next)
    })
    try {
      const request = { options, editor: await jobOf(range) }
      if (stoppedRef.current || !mountedRef.current) return
      const result =
        kind === 'print' ? await printLayout.print(request) : await printLayout.savePdf(request)
      if (!mountedRef.current) return
      if (!result.ok) {
        if (!('aborted' in result)) {
          setFailure({ kind, detail: result.error, code: result.code })
        }
        return
      }
      if (kind === 'print') {
        onClose()
      } else if ('path' in result) {
        onClose()
        onMessage(t('printLayoutSaved'))
      }
    } catch (err) {
      if (mountedRef.current) setFailure({ kind, detail: messageOf(err) })
    } finally {
      off()
      runningRef.current = false
      if (mountedRef.current) setProgress(null)
    }
  }

  const stopJob = (): void => {
    stoppedRef.current = true
    void printLayout.cancel()
  }

  const onPreviewRequest: SimplePrintDialogProps['onPreviewRequest'] = async (
    range,
    options,
    { signal, onProgress },
  ) => {
    const editor = await jobOf(range)
    signal.throwIfAborted()
    const off = printLayout.onProgress(onProgress)
    const stop = (): void => void printLayout.cancel()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const result = await printLayout.preview({ options, editor })
      if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
      return result.faces.map((face) => face.png)
    } finally {
      off()
      signal.removeEventListener('abort', stop)
    }
  }

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
          { pageCount: pages?.length },
        )
      : t(failure.kind === 'print' ? 'printFailed' : 'exportFailed', { error: failure.detail })
    : null

  return (
    <SimplePrintDialog
      lang={lang}
      rangeChoice="all-current"
      pages={pages}
      capabilities={{ showPaperAndFit: true }}
      onRangeChange={(range) => countPages(scopeOf(range))}
      onPlainPrint={onPlainPrint}
      onPrint={(range, options) => void runLayout('print', range, options)}
      onSavePdf={(range, options) => void runLayout('save', range, options)}
      onCancel={() => {
        if (runningRef.current) stopJob()
        onClose()
      }}
      labelSpecStore={labelSpecStore}
      onPreviewRequest={onPreviewRequest}
      job={{ progress, onCancel: stopJob, error }}
    />
  )
}
