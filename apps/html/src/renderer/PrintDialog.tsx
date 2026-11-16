import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  createDefaultOptions,
  type PageSize,
  type PrintLayoutErrorCode,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  SimplePrintDialog,
  printLayoutIssueText,
  type PrintLabelSpecStore,
  type PrintLayoutPreviewRequest,
  type PrintLayoutProgress,
  type SimplePrintRange,
} from '@genoffice/ui'
import { useI18n } from './i18n/locale'
import { pickPrintPages } from '../shared/print-range'
import type { HtmlApi, HtmlPrintJob } from '../shared/ipc'

export interface HtmlPrintDialogProps {
  api: Pick<HtmlApi, 'printJobPages' | 'printLayout'>
  /** the document as the print serializes it, read at the moment it is needed */
  documentText: () => string
  /** file name (no extension) the save dialog suggests */
  suggestedName: () => string
  /** all pages and nothing changed: the print as it was before this dialog */
  onPlainPrint: () => void
  onClose: () => void
  /** a line on the editor's status bar */
  onNotice: (text: string) => void
}

interface LayoutFailure {
  kind: 'print' | 'save'
  detail: string
  code?: PrintLayoutErrorCode
}

/**
 * The HTML editor's print dialog (decision 0141): all pages or a typed range,
 * and the shared page layout options. With all pages and nothing changed, Print
 * is the print as it was (`onPlainPrint`). An option on, or a typed range, goes
 * the arranged route: the main process makes the job PDF from the page loaded
 * the way the print loads it and prints it with the system dialog.
 */
export function HtmlPrintDialog(props: HtmlPrintDialogProps): ReactElement {
  const { api, documentText, suggestedName, onPlainPrint, onClose, onNotice } = props
  const { lang, t } = useI18n()
  const [allPages, setAllPages] = useState<PageSize[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [range, setRange] = useState<SimplePrintRange>({ kind: 'all' })
  const [progress, setProgress] = useState<PrintLayoutProgress | null>(null)
  const [failure, setFailure] = useState<LayoutFailure | null>(null)
  const [rangeEmpty, setRangeEmpty] = useState(false)
  const runningRef = useRef(false)
  const mountedRef = useRef(true)

  // Every page's size, once per dialog: a typed range picks its pages out of these.
  useEffect(() => {
    mountedRef.current = true
    let live = true
    void api
      .printJobPages({ html: documentText() })
      .then((result) => {
        if (!live) return
        if (result.ok) setAllPages(result.pages)
        else setPagesError(result.error)
      })
      .catch((err: unknown) => {
        if (live) setPagesError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      live = false
      mountedRef.current = false
      // a job still running when the dialog goes away is stopped: nothing is sent
      if (runningRef.current) void api.printLayout.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counted once per dialog
  }, [])

  const pickedOf = useCallback(
    (r: SimplePrintRange): number[] | null =>
      r.kind === 'custom' && allPages ? pickPrintPages(r.ranges, allPages.length) : null,
    [allPages],
  )
  const pages = useMemo(() => {
    if (!allPages) return null
    const picked = pickedOf(range)
    return picked ? picked.map((n) => allPages[n - 1]!) : allPages
  }, [allPages, range, pickedOf])

  const jobOf = (r: SimplePrintRange): HtmlPrintJob => ({
    html: documentText(),
    suggestedName: suggestedName(),
    ...(r.kind === 'custom' ? { ranges: r.ranges.map(({ from, to }) => ({ from, to })) } : {}),
  })

  /** A typed range with no page of the document is refused before anything is built. */
  const refusesRange = (r: SimplePrintRange): boolean => {
    const picked = pickedOf(r)
    const empty = picked !== null && picked.length === 0
    setRangeEmpty(empty)
    return empty
  }

  const runLayout = async (
    kind: 'print' | 'save',
    r: SimplePrintRange,
    options: PrintLayoutOptions,
  ): Promise<void> => {
    if (runningRef.current || refusesRange(r)) return
    runningRef.current = true
    setFailure(null)
    setProgress({ done: 0, total: 0 })
    const off = api.printLayout.onProgress((next) => {
      if (mountedRef.current) setProgress(next)
    })
    try {
      const request = { options, editor: jobOf(r) }
      const result =
        kind === 'print'
          ? await api.printLayout.print(request)
          : await api.printLayout.savePdf(request)
      if (!mountedRef.current) return
      if (!result.ok) {
        if (!('aborted' in result)) {
          setFailure({ kind, detail: result.error, ...(result.code ? { code: result.code } : {}) })
        }
        return
      }
      if (kind === 'save') {
        if ('path' in result) onNotice(t('printLayoutSaved'))
        return
      }
      // printed; a cancel in the system dialog keeps this dialog open
      if (!('canceled' in result)) onClose()
    } catch (err) {
      if (mountedRef.current) {
        setFailure({ kind, detail: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      off()
      runningRef.current = false
      if (mountedRef.current) setProgress(null)
    }
  }

  const plainPrint = (r: SimplePrintRange) => {
    if (r.kind === 'all') {
      onClose()
      onPlainPrint()
      return
    }
    // The system dialog does not take ranges on every platform: a typed range
    // goes the arranged route with the options at their defaults.
    void runLayout('print', r, createDefaultOptions())
  }

  const preview: (
    r: SimplePrintRange,
    ...request: Parameters<PrintLayoutPreviewRequest>
  ) => ReturnType<PrintLayoutPreviewRequest> = async (r, options, { signal, onProgress }) => {
    if (refusesRange(r)) throw new Error(t('printRangeEmpty', { count: allPages?.length ?? 0 }))
    const off = api.printLayout.onProgress(onProgress)
    const stop = () => void api.printLayout.cancel()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const result = await api.printLayout.preview({ options, editor: jobOf(r) })
      if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
      return result.faces.map((face) => face.png)
    } finally {
      off()
      signal.removeEventListener('abort', stop)
    }
  }

  const labelSpecStore = useMemo<PrintLabelSpecStore>(
    () => ({
      load: () => api.printLayout.getLabelSpec(),
      save: async (spec) => {
        const result = await api.printLayout.setLabelSpec(spec)
        if (!result.ok) throw new Error(result.error)
      },
    }),
    [api],
  )

  const error = rangeEmpty
    ? t('printRangeEmpty', { count: allPages?.length ?? 0 })
    : failure
      ? failure.code
        ? printLayoutIssueText(
            lang,
            { code: failure.code, message: failure.detail },
            { pageCount: pages?.length },
          )
        : t(failure.kind === 'print' ? 'printFailed' : 'printLayoutSaveFailed', {
            error: failure.detail,
          })
      : pagesError
        ? t('printPagesFailed', { error: pagesError })
        : null

  return (
    <SimplePrintDialog
      lang={lang}
      rangeChoice="all-custom"
      pages={pages}
      capabilities={{ showPaperAndFit: true }}
      onRangeChange={(next) => {
        setRange(next)
        setRangeEmpty(false)
      }}
      onPlainPrint={plainPrint}
      onPrint={(r, options) => void runLayout('print', r, options)}
      onSavePdf={(r, options) => void runLayout('save', r, options)}
      onCancel={() => {
        if (runningRef.current) void api.printLayout.cancel()
        onClose()
      }}
      labelSpecStore={labelSpecStore}
      onPreviewRequest={preview}
      job={{ progress, onCancel: () => void api.printLayout.cancel(), error }}
    />
  )
}
