import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type {
  PageSize,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  PrintLayoutPanel,
  PrintLayoutSchematic,
  printLayoutIssueText,
  printLayoutProblem,
  showsLayoutSchematic,
  takesNewPrintRoute,
  usePrintLayoutOptions,
  type PrintLabelSpecStore,
  type PrintLayoutPreviewRequest,
  type PrintLayoutProgress,
} from '@genoffice/ui'
import { useI18n } from '../i18n/locale'
import {
  MARKDOWN_PRINT_OPTIONS,
  parseMarkdownPageRange,
  type MarkdownPageRange,
  type MarkdownPaperSize,
} from '../../shared/print-options'
import type { MarkdownPrintLayoutJob } from '../../shared/ipc'

/** The page range the dialog asks the printer for. */
type RangeMode = 'all' | 'current' | 'custom' | 'selection'

/** What the print dialog prints: the whole note, and its selection when there is one. */
export interface PrintPreviewContent {
  /** the self-contained print HTML; the same document the PDF export writes */
  html: string
  /** the same print HTML of only the selection; null without a selection */
  selectionHtml: string | null
  /** the document's name, offered when the arranged result is saved as a PDF */
  title: string
}

interface Props extends Omit<PrintPreviewContent, 'selectionHtml'> {
  selectionHtml?: string | null
  onClose: () => void
}

/** Why the last arranged print or save failed, put in words when it is shown. */
interface LayoutFailure {
  kind: 'print' | 'save'
  detail: string
  code?: PrintLayoutErrorCode
}

/**
 * The print preview of a Markdown note: the pages of the PDF the export writes,
 * drawn with pdf.js. Printing sends the same HTML and options to the main
 * process, so the paper the printer gets is the paper on screen.
 */
export function PrintPreviewDialog({
  html,
  selectionHtml = null,
  title,
  onClose,
}: Props): JSX.Element {
  const { t, lang } = useI18n()
  // every print starts at the default layout: nothing carries over from the last one
  const [layout, setLayout] = usePrintLayoutOptions(true)
  const [jobPageSize, setJobPageSize] = useState<PageSize | null>(null)
  const [layoutProgress, setLayoutProgress] = useState<PrintLayoutProgress | null>(null)
  const [layoutFailure, setLayoutFailure] = useState<LayoutFailure | null>(null)
  const [layoutSaved, setLayoutSaved] = useState(false)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [fit, setFit] = useState(true)
  const [paper, setPaper] = useState<MarkdownPaperSize>('A4')
  const [landscape, setLandscape] = useState(false)
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customRange, setCustomRange] = useState('')
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 })
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTask = useRef<{ cancel(): void } | null>(null)
  const renderId = useRef(0)
  const printingRef = useRef(false)
  const layoutRunningRef = useRef(false)
  const mountedRef = useRef(true)
  // the "Selection" range prints the selection's own document, paginated from page 1
  const printHtml = rangeMode === 'selection' && selectionHtml !== null ? selectionHtml : html

  useEffect(() => {
    let alive = true
    renderTask.current?.cancel()
    renderId.current += 1
    setRendering(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.markdownApi.renderPrintPreview({
          html: printHtml,
          options: { ...MARKDOWN_PRINT_OPTIONS, pageSize: paper, landscape },
        })
        if (!alive) return
        if (!result.ok) {
          setDoc(null)
          setPageCount(0)
          setError(result.error)
          setRendering(false)
          return
        }
        const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        GlobalWorkerOptions.workerSrc = workerUrl
        const pdf = await getDocument({ data: result.pdf }).promise
        // every page has the dialog's paper: the first one sizes the layout diagram
        const first = pdf.numPages > 0 ? (await pdf.getPage(1)).getViewport({ scale: 1 }) : null
        if (!alive) {
          void pdf.loadingTask.destroy()
          return
        }
        setJobPageSize(first ? { widthPt: first.width, heightPt: first.height } : null)
        setDoc(pdf)
        setPageCount(pdf.numPages)
        setPage((current) => Math.min(Math.max(current, 1), Math.max(pdf.numPages, 1)))
      } catch (cause) {
        if (alive) {
          setDoc(null)
          setPageCount(0)
          setError(cause instanceof Error ? cause.message : String(cause))
          setRendering(false)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [printHtml, paper, landscape])

  useEffect(
    () => () => {
      renderTask.current?.cancel()
      if (doc) void doc.loadingTask.destroy()
    },
    [doc],
  )

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const measure = (): void => setPaneSize({ width: pane.clientWidth, height: pane.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const renderPage = useCallback(async (): Promise<void> => {
    const target = canvasRef.current
    if (!doc || !target) return
    const id = ++renderId.current
    renderTask.current?.cancel()
    setRendering(true)
    try {
      const pdfPage = await doc.getPage(page)
      if (id !== renderId.current) return
      const base = pdfPage.getViewport({ scale: 1 })
      const fitScale =
        paneSize.width > 0 && paneSize.height > 0
          ? Math.min((paneSize.width - 32) / base.width, (paneSize.height - 32) / base.height)
          : 1
      const displayScale = fit ? Math.min(2, Math.max(0.1, fitScale)) : 1
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const viewport = pdfPage.getViewport({ scale: displayScale * ratio })
      target.width = Math.max(1, Math.floor(viewport.width))
      target.height = Math.max(1, Math.floor(viewport.height))
      target.style.width = `${base.width * displayScale}px`
      target.style.height = `${base.height * displayScale}px`
      const task = pdfPage.render({ canvas: target, viewport })
      renderTask.current = task
      await task.promise
      if (id === renderId.current) {
        setRendering(false)
        setError(null)
      }
    } catch (cause) {
      // a canceled render is what a page change does; it is not worth a message
      if (id === renderId.current && !/cancel/i.test(String(cause))) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setRendering(false)
      }
    }
  }, [doc, fit, page, paneSize.height, paneSize.width])

  useEffect(() => {
    if (doc) void renderPage()
  }, [doc, renderPage])

  const range = useMemo((): MarkdownPageRange | null | 'invalid' => {
    if (rangeMode === 'all' || rangeMode === 'selection') return null
    if (rangeMode === 'current') return { from: page, to: page }
    return parseMarkdownPageRange(customRange, pageCount) ?? 'invalid'
  }, [rangeMode, page, customRange, pageCount])
  const rangeInvalid = range === 'invalid'
  const pages = range === 'invalid' ? null : range

  // The job's pages for the layout diagram and its checks: the preview's pages,
  // kept to the range. Nothing is built for them: the preview already drew them.
  const jobPageCount = range === 'invalid' ? null : range ? range.to - range.from + 1 : pageCount
  const layoutPages = useMemo(
    (): PageSize[] | null =>
      jobPageSize && jobPageCount ? Array.from({ length: jobPageCount }, () => jobPageSize) : null,
    [jobPageSize, jobPageCount],
  )
  const layoutOn = takesNewPrintRoute(layout)
  const layoutProblem = useMemo(
    () => (layoutOn ? printLayoutProblem(layout, layoutPages) : null),
    [layoutOn, layout, layoutPages],
  )
  const showSchematic = showsLayoutSchematic(layout)
  const printLayout = window.markdownApi.printLayout

  /** The advanced layout's job: the preview's HTML and paper, kept to the range. */
  const job = useMemo(
    (): MarkdownPrintLayoutJob => ({
      html: printHtml,
      pages,
      options: { ...MARKDOWN_PRINT_OPTIONS, pageSize: paper, landscape },
      name: title,
    }),
    [printHtml, pages, paper, landscape, title],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // a layout job still running when the dialog closes is stopped: nothing is sent
      if (layoutRunningRef.current) void printLayout.cancel()
    }
  }, [printLayout])

  /** Print or save on the advanced print layout's route. */
  const runLayout = useCallback(
    async (kind: 'print' | 'save', options: PrintLayoutOptions): Promise<void> => {
      if (printingRef.current) return
      printingRef.current = true
      layoutRunningRef.current = true
      setPrinting(true)
      setError(null)
      setLayoutFailure(null)
      setLayoutSaved(false)
      const off = printLayout.onProgress((next) => {
        if (mountedRef.current) setLayoutProgress(next)
      })
      try {
        const request = { options, editor: job }
        const result =
          kind === 'print' ? await printLayout.print(request) : await printLayout.savePdf(request)
        if (!mountedRef.current) return
        if (!result.ok) {
          if (!('aborted' in result)) {
            setLayoutFailure({
              kind,
              detail: result.error,
              ...(result.code ? { code: result.code } : {}),
            })
          }
        } else if (kind === 'print') {
          onClose()
        } else if ('path' in result) {
          setLayoutSaved(true)
        }
      } catch (cause) {
        if (mountedRef.current) {
          setLayoutFailure({
            kind,
            detail: cause instanceof Error ? cause.message : String(cause),
          })
        }
      } finally {
        off()
        printingRef.current = false
        layoutRunningRef.current = false
        if (mountedRef.current) {
          setPrinting(false)
          setLayoutProgress(null)
        }
      }
    },
    [job, onClose, printLayout],
  )

  const previewLayout = useCallback<PrintLayoutPreviewRequest>(
    async (options, { signal, onProgress }) => {
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

  const print = async (): Promise<void> => {
    if (printingRef.current || rangeInvalid || rendering) return
    // a layout option on: the arranged route; all at their defaults: the print as it was
    if (layoutOn) {
      if (layoutProblem === null) await runLayout('print', layout)
      return
    }
    printingRef.current = true
    setPrinting(true)
    setError(null)
    try {
      const result = await window.markdownApi.printDocument({
        html: printHtml,
        pages,
        options: { ...MARKDOWN_PRINT_OPTIONS, pageSize: paper, landscape },
      })
      if (result.ok) {
        onClose()
        return
      }
      setError(result.error)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setPage((current) => Math.max(1, current - 1))
      } else if (event.key === 'PageDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        setPage((current) => Math.min(Math.max(pageCount, 1), current + 1))
      } else if (event.ctrlKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void print()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const layoutError = layoutFailure
    ? layoutFailure.code
      ? printLayoutIssueText(
          lang,
          { code: layoutFailure.code, message: layoutFailure.detail },
          { pageCount: jobPageCount ?? undefined },
        )
      : `${t(layoutFailure.kind === 'print' ? 'appPrintPreviewPrintFailed' : 'appPrintPreviewSaveFailed')} ${layoutFailure.detail}`
    : null

  return (
    <div className="md-print-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="md-print-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('appPrintPreviewTitle')}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="md-print-header">{t('appPrintPreviewTitle')}</header>
        <div className="md-print-body">
          <div className="md-print-preview" ref={paneRef}>
            <canvas ref={canvasRef} className="md-print-canvas" hidden={showSchematic} />
            {showSchematic && (
              // the faces are not the pages while the layout moves them: show where they go
              <div className="md-print-schematic">
                <PrintLayoutSchematic lang={lang} pages={layoutPages} options={layout} />
              </div>
            )}
            {rendering && <div className="md-print-overlay">{t('appPrintPreviewRendering')}</div>}
            {error && (
              <div className="md-print-overlay error" role="alert">
                {t('appPrintPreviewFailed')} {error}
              </div>
            )}
          </div>
          <div className="md-print-options">
            <div className="md-print-nav">
              <button
                type="button"
                className="md-print-button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                ‹
              </button>
              <span>{t('appPrintPreviewPageOf', { page, total: pageCount })}</span>
              <button
                type="button"
                className="md-print-button"
                disabled={pageCount === 0 || page >= pageCount}
                onClick={() => setPage((current) => Math.min(Math.max(pageCount, 1), current + 1))}
              >
                ›
              </button>
              <span className="md-print-gap" />
              <button
                type="button"
                className={`md-print-button${fit ? ' active' : ''}`}
                aria-pressed={fit}
                onClick={() => setFit(true)}
              >
                {t('appPrintPreviewFit')}
              </button>
              <button
                type="button"
                className={`md-print-button${fit ? '' : ' active'}`}
                aria-pressed={!fit}
                onClick={() => setFit(false)}
              >
                {t('appPrintPreviewActual')}
              </button>
            </div>
            <fieldset className="md-print-fieldset">
              <legend>{t('appPrintPreviewRange')}</legend>
              <label>
                <input
                  type="radio"
                  name="md-print-range"
                  checked={rangeMode === 'all'}
                  onChange={() => setRangeMode('all')}
                />
                {t('appPrintPreviewAll')}
              </label>
              <label>
                <input
                  type="radio"
                  name="md-print-range"
                  checked={rangeMode === 'current'}
                  onChange={() => setRangeMode('current')}
                />
                {t('appPrintPreviewCurrent')}
              </label>
              <label>
                <input
                  type="radio"
                  name="md-print-range"
                  checked={rangeMode === 'custom'}
                  onChange={() => setRangeMode('custom')}
                />
                {t('appPrintPreviewCustom')}
              </label>
              <label>
                <input
                  type="radio"
                  name="md-print-range"
                  checked={rangeMode === 'selection'}
                  disabled={selectionHtml === null}
                  onChange={() => setRangeMode('selection')}
                />
                {t('appPrintPreviewSelection')}
              </label>
              <input
                className={`md-print-range${rangeInvalid ? ' invalid' : ''}`}
                type="text"
                inputMode="numeric"
                placeholder="1-3"
                aria-label={t('appPrintPreviewCustom')}
                value={customRange}
                disabled={rangeMode !== 'custom'}
                onChange={(event) => {
                  setCustomRange(event.target.value)
                  setRangeMode('custom')
                }}
              />
              {rangeInvalid && (
                <span className="md-print-hint" role="alert">
                  {t('appPrintPreviewInvalidRange')}
                </span>
              )}
            </fieldset>
            <label className="md-print-field">
              <span>{t('appPrintPreviewPaper')}</span>
              <select
                value={paper}
                onChange={(event) => setPaper(event.target.value as MarkdownPaperSize)}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </label>
            <label className="md-print-field">
              <span>{t('appPrintPreviewOrientation')}</span>
              <select
                value={landscape ? 'landscape' : 'portrait'}
                onChange={(event) => setLandscape(event.target.value === 'landscape')}
              >
                <option value="portrait">{t('appPrintPreviewPortrait')}</option>
                <option value="landscape">{t('appPrintPreviewLandscape')}</option>
              </select>
            </label>
            <PrintLayoutPanel
              lang={lang}
              value={layout}
              onChange={setLayout}
              pages={layoutPages}
              // the dialog's own paper and orientation make the job's pages (spec 4.5)
              capabilities={{ showPaperAndFit: false }}
              labelSpecStore={labelSpecStore}
              showSchematic={false}
              onPreviewRequest={previewLayout}
              onSavePdf={(options) => void runLayout('save', options)}
              job={{
                progress: layoutProgress,
                onCancel: () => void printLayout.cancel(),
                error: layoutError,
              }}
              disabled={printing}
            />
          </div>
        </div>
        <div className="md-print-actions">
          {layoutSaved && (
            <span className="md-print-saved" role="status">
              {t('appPrintPreviewLayoutSaved')}
            </span>
          )}
          <button type="button" className="md-print-button" onClick={onClose}>
            {t('redactCancel')}
          </button>
          <button
            type="button"
            className="md-print-button primary"
            disabled={
              printing ||
              rangeInvalid ||
              pageCount === 0 ||
              rendering ||
              (layoutOn && layoutProblem !== null)
            }
            onClick={() => void print()}
          >
            {t('appPrintPreviewPrint')}
          </button>
        </div>
      </div>
    </div>
  )
}
