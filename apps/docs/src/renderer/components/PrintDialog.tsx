/**
 * Print dialog modeled on Word's print sheet (same pattern as the slides app):
 * live page preview on the left (a scaled clone of the pagination-preview page
 * that will actually print), printer/copies/duplex and range options on the
 * right (a chosen printer prints silently; "System print dialog" defers to the OS). "Print" hides the
 * unselected .pv-page sheets via pv-print-skip and hands the preview pages to
 * the system print dialog.
 *
 * The pagination preview must be mounted (the App opens it, visually hidden,
 * when the dialog opens): its .pv-page boxes are both the print source and the
 * preview source, so what the dialog shows is exactly what prints.
 *
 * The shared page layout panel (decision 0141) sits under the range. With all
 * of its options at their defaults a page range prints exactly as above. Any
 * option, or the "Selection" range, takes the arranged print route instead:
 * the job PDF is the chosen pages printed the way the PDF export prints them
 * (or the selection laid out on pages of its own), and the main process
 * arranges and prints it. Duplex follows odd/even and booklet, and collate
 * stays on while that route is taken.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  effectiveCollate,
  isCollateLocked,
  PrintLayoutPanel,
  PrintLayoutSchematic,
  printLayoutIssueText,
  printLayoutProblem,
  showsLayoutSchematic,
  takesNewPrintRoute,
  useDuplexCoupling,
  usePrintLayoutOptions,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
} from '@genoffice/ui'
import type {
  PageSize,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import type { DocsPrintJobRequest, PrintDuplex, PrintPaper, PrinterInfo } from '../../shared/ipc'
import { useI18n } from '../i18n/locale'
import { parsePrintRange } from '../print-range'
import { previewPageSize, type PrintPageJob, type PrintSelectionJob } from '../print-job'
import { clearPrintZoom, setPrintZoom } from '../print-zoom'

type RangeMode = 'all' | 'current' | 'custom' | 'selection'

/// Printer option values that are not device names (Electron: '' = OS default).
const DEFAULT_PRINTER = ''
const SYSTEM_DIALOG = '\u0000system-dialog'
// macOS's print sheet already carries copies/duplex/paper, so it stays the
// default there; Windows 11's dialog buries them under "More settings".
const IS_MAC = navigator.platform.toLowerCase().includes('mac')
const DUPLEX_MODES: PrintDuplex[] = ['simplex', 'longEdge', 'shortEdge']
const CAPABILITIES = { showPaperAndFit: true }

const pvPages = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.pagination-preview .pv-page'),
]

/** The document's own paper in twips, read off the first preview sheet: the
 * pagination slices pages at the section geometry (96 px per inch), so the
 * sheet's layout box maps back 1:1. `offsetWidth`/`offsetHeight` ignore the
 * preview's visual zoom. Null when no sheet exists yet — the CUPS route then
 * keeps Chromium's default paper rather than printing a wrong size. */
function paperOfPreview(): PrintPaper | undefined {
  const page = pvPages()[0]
  if (!page) return undefined
  const w = page.offsetWidth
  const h = page.offsetHeight
  if (!(w > 0) || !(h > 0)) return undefined
  return { widthTwips: Math.round(w * 15), heightTwips: Math.round(h * 15) }
}

type SelectionState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; parts: string[]; pages: PageSize[] }
  | { status: 'failed'; error: string }

export function PrintDialog({
  onClose,
  setStatus,
  buildPageJob,
  prepareSelection,
  docName,
}: {
  onClose: () => void
  setStatus: (s: string) => void
  /** prints the chosen 0-based preview pages to the job PDF (new route only) */
  buildPageJob?: (pages: number[]) => Promise<PrintPageJob>
  /** set while the editor holds a non-empty selection: lays it out on its own pages */
  prepareSelection?: () => Promise<PrintSelectionJob>
  /** the document's file name, for the save dialog of the arranged PDF */
  docName?: string
}) {
  const { t, lang } = useI18n()
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(0)
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customRange, setCustomRange] = useState('')
  const [printing, setPrinting] = useState(false)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [deviceName, setDeviceName] = useState(IS_MAC ? SYSTEM_DIALOG : DEFAULT_PRINTER)
  const [copies, setCopies] = useState(1)
  const [collate, setCollate] = useState(true)
  // the dialog mounts per print, so the options start from the defaults each time
  const [options, setOptions] = usePrintLayoutOptions(true)
  const { duplex, setDuplex } = useDuplexCoupling(options, 'simplex')
  const [selection, setSelection] = useState<SelectionState>({ status: 'idle' })
  const [jobProgress, setJobProgress] = useState<PrintLayoutProgress | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const systemDialog = deviceName === SYSTEM_DIALOG
  const paneRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** the job PDF of the last page set printed, so preview, print and save share one build */
  const pageJobCache = useRef<{ key: string; parts: string[] } | null>(null)
  /** bumps on cancel: a job finishing after it is dropped */
  const jobToken = useRef(0)

  // The pagination preview measures and slices asynchronously; poll until the
  // .pv-page count is stable (and keep tracking it, e.g. re-slices on resize).
  useEffect(() => {
    let last = -1
    const timer = window.setInterval(() => {
      const n = pvPages().length
      if (n > 0 && n === last) setPageCount(n)
      last = n
    }, 250)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    window.desktop
      .listPrinters()
      .then((list) => {
        if (alive) setPrinters(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // progress of a print or save on the arranged route (pictures of the faces);
  // a result preview reports its own
  const jobActive = useRef(false)
  useEffect(
    () =>
      window.desktop.printLayout?.onProgress((p) => {
        if (jobActive.current) setJobProgress(p)
      }),
    [],
  )

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // the selection is laid out once per dialog, the first time it is chosen
  const prepareRef = useRef(prepareSelection)
  prepareRef.current = prepareSelection
  const prepareStarted = useRef(false)
  useEffect(() => {
    if (rangeMode !== 'selection' || prepareStarted.current) return
    const prepare = prepareRef.current
    if (!prepare) return
    prepareStarted.current = true
    setSelection({ status: 'running' })
    void prepare()
      .catch((err: unknown) => ({ ok: false as const, error: String(err) }))
      .then((r) => {
        if (!alive.current) return
        setSelection(
          r.ok
            ? { status: 'done', parts: r.parts, pages: r.pages }
            : { status: 'failed', error: r.error ?? '' },
        )
      })
  }, [rangeMode])

  const current = Math.min(page, Math.max(0, pageCount - 1))
  const ready = pageCount > 0
  const selectionMode = rangeMode === 'selection'

  /** 0-based page indices selected by the range options (null = invalid custom range) */
  const selected: number[] | null =
    rangeMode === 'all'
      ? Array.from({ length: pageCount }, (_x, i) => i)
      : rangeMode === 'current'
        ? [current]
        : rangeMode === 'custom'
          ? parsePrintRange(customRange, pageCount)
          : null
  const rangeInvalid = rangeMode === 'custom' && selected === null
  const selectedKey = selected ? selected.join(',') : ''
  /** the job PDF depends on the chosen sheets and on how the preview sliced them */
  const pageJobKey = `${pageCount}:${selectedKey}`

  /** the print job's pages in points: the chosen preview sheets, or the laid-out selection */
  const jobPages: PageSize[] | null = useMemo(() => {
    if (selectionMode) return selection.status === 'done' ? selection.pages : null
    // the key names the sheet count too: the sheets re-slice when the preview changes
    const [, chosen] = pageJobKey.split(':')
    if (!chosen) return null
    const sheets = pvPages()
    return chosen.split(',').map((i) => {
      const el = sheets[Number(i)]
      return previewPageSize(
        parseFloat(el?.style.width ?? '') || 0,
        parseFloat(el?.style.height ?? '') || 0,
      )
    })
  }, [selectionMode, selection, pageJobKey])

  const newRoute = selectionMode || takesNewPrintRoute(options)
  const collateLocked = selectionMode || isCollateLocked(options)
  const collateValue = selectionMode ? true : effectiveCollate(options, collate)
  const layoutProblem = newRoute ? printLayoutProblem(options, jobPages) : null
  const showSchematic = selectionMode || showsLayoutSchematic(options)
  const jobPageCount = selectionMode ? (jobPages?.length ?? 0) : (selected?.length ?? 0)
  const canPrint =
    ready &&
    !printing &&
    (selectionMode ? selection.status === 'done' : !!selected && selected.length > 0) &&
    layoutProblem === null

  /** Scale the cloned page so the whole sheet fits the preview pane (Word-style single-page fit) */
  const applyZoom = useCallback(() => {
    const pane = paneRef.current
    const host = hostRef.current
    const pageEl = host?.firstElementChild as HTMLElement | null
    if (!pane || !host || !pageEl) return
    host.style.zoom = '1'
    const w = pageEl.offsetWidth
    const h = pageEl.offsetHeight
    if (w > 0 && h > 0) {
      host.style.zoom = String(Math.min((pane.clientWidth - 36) / w, (pane.clientHeight - 36) / h))
    }
  }, [])

  // Show one printed sheet at a time: clone the selected .pv-page (styles apply
  // in-document, so the clone renders identically) and fit it to the pane.
  // `showSchematic`: the pane remounts when the layout diagram gives way again.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren()
    const src = pvPages()[current]
    if (!src) return
    const clone = src.cloneNode(true) as HTMLElement
    clone.classList.remove('pv-print-skip')
    clone.querySelector('.pv-pageno')?.remove()
    host.appendChild(clone)
    applyZoom()
  }, [pageCount, current, applyZoom, showSchematic])

  // `ready` in the deps: the pane only mounts once pages exist, so the observer
  // must (re)attach after the first pageCount update, not just on dialog mount
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const ro = new ResizeObserver(applyZoom)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [applyZoom, ready, showSchematic])

  const doPrint = async () => {
    const els = pvPages()
    if (!selected || selected.length === 0 || printing) return
    const sel = new Set(selected)
    setPrinting(true)
    // pv-print-skip only takes effect in the print stylesheet: the on-screen
    // (hidden) preview keeps its layout while unselected sheets don't print.
    els.forEach((el, i) => el.classList.toggle('pv-print-skip', !sel.has(i)))
    const scale = setPrintZoom('printer')
    try {
      const r = await window.desktop.print(
        scale,
        systemDialog ? { deviceName: null } : { deviceName, copies, collate, duplex },
        paperOfPreview(),
      )
      if (r.ok) {
        onClose()
        return
      }
      if (r.error) setStatus(t('appPrintFailed', { error: r.error }))
      // not ok without an error = canceled in the system dialog: keep the dialog open
    } finally {
      clearPrintZoom()
      els.forEach((el) => el.classList.remove('pv-print-skip'))
      setPrinting(false)
    }
  }

  /** The new route's request for this job, or null with the reason shown. */
  const jobRequest = async (): Promise<DocsPrintJobRequest | null> => {
    if (selectionMode) {
      return selection.status === 'done' ? { parts: selection.parts, name: docName } : null
    }
    if (!selected || selected.length === 0 || !buildPageJob) return null
    const cached = pageJobCache.current
    if (cached && cached.key === pageJobKey) return { parts: cached.parts, name: docName }
    const built = await buildPageJob(selected).catch((err: unknown) => ({
      ok: false as const,
      error: String(err),
    }))
    if (!built.ok) {
      setJobError(t('appPrintFailed', { error: built.error ?? t('appPrintGroupFailed') }))
      return null
    }
    pageJobCache.current = { key: pageJobKey, parts: built.parts }
    return { parts: built.parts, name: docName }
  }

  const failureText = (r: { error?: string; code?: PrintLayoutErrorCode }): string =>
    r.code
      ? printLayoutIssueText(lang, { code: r.code, message: r.error ?? '' })
      : t('appPrintFailed', { error: r.error ?? '' })

  /** Runs one print or save on the new route with progress, cancel and errors. */
  const runJob = async (
    work: (
      editor: DocsPrintJobRequest,
    ) => Promise<
      | { ok: true; canceled?: true; path?: string }
      | { ok: false; aborted?: true; error?: string; code?: PrintLayoutErrorCode }
    >,
    onDone: (r: { canceled?: true; path?: string }) => void,
  ) => {
    if (printing) return
    const token = ++jobToken.current
    jobActive.current = true
    setPrinting(true)
    setJobError(null)
    setJobProgress({ done: 0, total: Math.max(1, jobPageCount) })
    try {
      const editor = await jobRequest()
      if (!editor || token !== jobToken.current) return
      const r = await work(editor)
      if (token !== jobToken.current) return
      if (r.ok) onDone(r)
      else if (!('aborted' in r && r.aborted)) {
        const text = failureText(r)
        setJobError(text)
        setStatus(text)
      }
    } finally {
      if (token === jobToken.current && alive.current) {
        jobActive.current = false
        setJobProgress(null)
        setPrinting(false)
      }
    }
  }

  const cancelJob = () => {
    jobToken.current += 1
    jobActive.current = false
    void window.desktop.printLayout.cancel()
    setJobProgress(null)
    setPrinting(false)
  }

  const printArranged = () =>
    runJob(
      (editor) =>
        window.desktop.printLayout.print({
          options,
          editor,
          job: systemDialog ? { deviceName: null } : { deviceName, copies, collate: true, duplex },
        }),
      (r) => {
        // closing the system print dialog keeps this one open
        if (!r.canceled) onClose()
      },
    )

  const saveArranged = (opts: PrintLayoutOptions) =>
    runJob(
      (editor) => window.desktop.printLayout.savePdf({ options: opts, editor }),
      (r) => {
        if (r.path) setStatus(t('appExportedPdf', { path: r.path }))
      },
    )

  const previewArranged = async (
    opts: PrintLayoutOptions,
    ctx: { signal: AbortSignal; onProgress: (p: PrintLayoutProgress) => void },
  ): Promise<Uint8Array[]> => {
    const editor = await jobRequest()
    if (!editor) throw new Error('no print job')
    ctx.signal.throwIfAborted()
    const onAbort = () => void window.desktop.printLayout.cancel()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    const off = window.desktop.printLayout.onProgress(ctx.onProgress)
    try {
      const r = await window.desktop.printLayout.preview({ options: opts, editor })
      if (!r.ok) throw new Error('aborted' in r ? 'aborted' : r.error)
      return r.faces.map((f) => f.png)
    } finally {
      off()
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }

  const labelSpecStore: PrintLabelSpecStore = useMemo(
    () => ({
      load: () => window.desktop.printLayout.getLabelSpec(),
      save: async (spec) => {
        await window.desktop.printLayout.setLabelSpec(spec)
      },
    }),
    [],
  )

  const onPrintClick = () => {
    if (newRoute) void printArranged()
    else void doPrint()
  }

  const pageCountText = selectionMode
    ? jobPages && jobPages.length > 0
      ? t('appPrintPageCount', { n: jobPages.length })
      : ''
    : ready && selected && selected.length > 0
      ? t('appPrintPageCount', { n: selected.length })
      : ''

  const previewPane = () => {
    if (selectionMode && selection.status !== 'done') {
      return (
        <div className="print-preview-empty" data-print="selection-state">
          {selection.status === 'failed'
            ? t('appPrintSelectionFailed', { error: selection.error })
            : t('appPrintSelectionPreparing')}
        </div>
      )
    }
    if (showSchematic) {
      return (
        <div className="print-preview-schematic">
          <PrintLayoutSchematic lang={lang} pages={jobPages} options={options} />
        </div>
      )
    }
    if (!ready) return <div className="print-preview-empty">{t('appPrintRendering')}</div>
    return (
      <>
        <div className="print-preview-page" ref={paneRef}>
          <div className="print-preview-zoom" ref={hostRef} />
        </div>
        <div className="print-preview-nav">
          <button
            aria-label={t('appPrintPrevPage')}
            title={t('appPrintPrevPage')}
            disabled={current <= 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <span>
            {current + 1} / {pageCount}
          </span>
          <button
            aria-label={t('appPrintNextPage')}
            title={t('appPrintNextPage')}
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal print-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t('appPrintTitle')}</h2>
        <div className="print-dialog-body">
          <div className="print-preview-pane">{previewPane()}</div>
          <div className="print-options">
            <fieldset>
              <legend>{t('appPrintPrinter')}</legend>
              <select
                className="print-select"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              >
                <option value={DEFAULT_PRINTER}>{t('appPrintDefaultPrinter')}</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))}
                <option value={SYSTEM_DIALOG}>{t('appPrintSystemDialog')}</option>
              </select>
              <label className="print-field">
                <span>{t('appPrintCopies')}</span>
                <input
                  type="number"
                  className="print-copies"
                  min={1}
                  max={999}
                  value={copies}
                  disabled={systemDialog}
                  onChange={(e) =>
                    setCopies(Math.min(999, Math.max(1, Math.round(Number(e.target.value)) || 1)))
                  }
                />
              </label>
              <label className="print-radio">
                <input
                  type="checkbox"
                  data-print="collate"
                  checked={collateValue}
                  disabled={systemDialog || copies < 2 || collateLocked}
                  onChange={(e) => setCollate(e.target.checked)}
                />
                {t('appPrintCollate')}
              </label>
              <label className="print-field">
                <span>{t('appPrintDuplex')}</span>
                <select
                  className="print-select"
                  data-print="duplex"
                  value={duplex}
                  disabled={systemDialog}
                  onChange={(e) => setDuplex(e.target.value as PrintDuplex)}
                >
                  {DUPLEX_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(
                        m === 'simplex'
                          ? 'appPrintDuplexOff'
                          : m === 'longEdge'
                            ? 'appPrintDuplexLong'
                            : 'appPrintDuplexShort',
                      )}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>{t('appPrintRange')}</legend>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-all"
                  checked={rangeMode === 'all'}
                  onChange={() => setRangeMode('all')}
                />
                {t('appPrintRangeAll')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-current"
                  checked={rangeMode === 'current'}
                  onChange={() => setRangeMode('current')}
                />
                {t('appPrintRangeCurrent')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-selection"
                  checked={selectionMode}
                  disabled={!prepareSelection}
                  onChange={() => setRangeMode('selection')}
                />
                {t('appPrintRangeSelection')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-custom"
                  checked={rangeMode === 'custom'}
                  onChange={() => setRangeMode('custom')}
                />
                {t('appPrintRangeCustom')}
              </label>
              <input
                type="text"
                className={`print-range-input ${rangeInvalid ? 'invalid' : ''}`}
                placeholder={t('appPrintRangeHint')}
                value={customRange}
                disabled={rangeMode !== 'custom'}
                onFocus={() => setRangeMode('custom')}
                onChange={(e) => setCustomRange(e.target.value)}
              />
            </fieldset>
            <div className="print-page-count">{pageCountText}</div>
            <PrintLayoutPanel
              lang={lang}
              value={options}
              onChange={setOptions}
              pages={jobPages}
              capabilities={CAPABILITIES}
              labelSpecStore={labelSpecStore}
              showSchematic={false}
              onPreviewRequest={previewArranged}
              onSavePdf={(opts) => void saveArranged(opts)}
              job={{ progress: jobProgress, onCancel: cancelJob, error: jobError }}
              disabled={printing}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" disabled={!canPrint} onClick={onPrintClick}>
            {printing ? t('appPrintProgress') : t('appPrintTitle')}
          </button>
        </div>
      </div>
    </div>
  )
}
