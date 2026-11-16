import { useMemo, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { PageSize, PrintLayoutOptions } from '@genoffice/print-layout/plan'
import {
  PrintLayoutPanel,
  printLayoutProblem,
  takesNewPrintRoute,
  usePrintLayoutOptions,
  type PrintLabelSpecStore,
  type PrintLayoutJob,
  type PrintLayoutPreviewRequest,
} from '@genoffice/ui'
import type { TFunc } from './i18n/locale'
import { formatPageRanges } from './page-selection'
import { canPrintPicked, printTargets, type PrintRangeMode } from './print-route'

const CAPABILITIES = { showPaperAndFit: true } as const

export interface PrintDialogProps {
  lang: Lang
  t: TFunc
  /** visible pages */
  pageCount: number
  /** 1-based visible page the reader is on */
  currentPage: number
  /** 1-based visible pages picked in the thumbnails */
  pickedPages: readonly number[]
  includeAnnotations: boolean
  onIncludeAnnotationsChange: (include: boolean) => void
  /** the job's page sizes for these pages (undefined: all), null when unknown */
  pageSizes: (pages: number[] | undefined) => PageSize[] | null
  /** Print pressed with a valid range; `pages` undefined is the whole document */
  onPrint: (pages: number[] | undefined, options: PrintLayoutOptions) => void
  onSavePdf?: (pages: number[] | undefined, options: PrintLayoutOptions) => void
  /** the document has permission restrictions: its arranged result is not
      saved as a PDF (that copy would carry none of them); printing still is */
  saveRestricted?: boolean
  onPreviewRequest?: (
    pages: number[] | undefined,
    ...request: Parameters<PrintLayoutPreviewRequest>
  ) => ReturnType<PrintLayoutPreviewRequest>
  onCancel: () => void
  /** an arranged print or save in progress, or its failure */
  job?: PrintLayoutJob
  labelSpecStore?: PrintLabelSpecStore
}

/**
 * The PDF print dialog: page range, "include annotations", and the shared
 * page layout panel. Mounted per open, so every open starts from the default
 * range and layout options. A document with permission restrictions gets no
 * "save the arranged result as PDF", with a line saying why.
 */
export function PrintDialog(props: PrintDialogProps) {
  const { lang, t, pageCount, currentPage, pickedPages, pageSizes, job } = props
  const [mode, setMode] = useState<PrintRangeMode>('all')
  const [customText, setCustomText] = useState(String(currentPage))
  const [invalid, setInvalid] = useState(false)
  const [options, setOptions] = usePrintLayoutOptions(true)

  const targets = printTargets({ mode, customText, pageCount, currentPage, pickedPages })
  const targetKey = targets.ok ? (targets.pages?.join(',') ?? 'all') : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed per range, not per render
  const pages = useMemo(() => (targets.ok ? pageSizes(targets.pages) : null), [targetKey])
  const running = !!job?.progress
  const newRoute = takesNewPrintRoute(options)
  const blocked = running || (newRoute && printLayoutProblem(options, pages) !== null)
  const pickable = canPrintPicked(pickedPages)
  const saveRestricted = props.saveRestricted === true

  const confirm = () => {
    if (blocked) return
    if (!targets.ok) {
      if (mode === 'custom') setInvalid(true)
      return
    }
    props.onPrint(targets.pages, options)
  }

  const rangeRow = (value: PrintRangeMode, label: string, disabled = false) => (
    <label className="pdf-modal-row">
      <input
        type="radio"
        name="print-range"
        data-print-range={value}
        checked={mode === value}
        disabled={disabled || running}
        onChange={() => setMode(value)}
      />
      <span>{label}</span>
    </label>
  )

  return (
    <div className="pdf-modal-mask" onClick={props.onCancel}>
      <div className="pdf-modal pdf-print-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-modal-title">{t('print')}</div>
        {rangeRow('all', t('printRangeAll'))}
        {rangeRow('current', `${t('printRangeCurrent')} (${currentPage})`)}
        {rangeRow(
          'picked',
          pickable
            ? `${t('printRangePicked')} (${formatPageRanges(pickedPages).replace(/,/g, ', ')})`
            : t('printRangePicked'),
          !pickable,
        )}
        {rangeRow('custom', t('printRangeCustom'))}
        {mode === 'custom' && (
          <input
            className={`pdf-modal-input${invalid ? ' invalid' : ''}`}
            value={customText}
            placeholder={t('printRangeHint')}
            autoFocus
            disabled={running}
            onChange={(e) => {
              setCustomText(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
              else if (e.key === 'Escape') props.onCancel()
            }}
          />
        )}
        <label className="pdf-modal-row">
          <input
            type="checkbox"
            checked={props.includeAnnotations}
            disabled={running}
            onChange={(e) => props.onIncludeAnnotationsChange(e.target.checked)}
          />
          <span>{t('printIncludeAnnots')}</span>
        </label>
        <PrintLayoutPanel
          lang={lang}
          value={options}
          onChange={setOptions}
          pages={pages}
          capabilities={CAPABILITIES}
          labelSpecStore={props.labelSpecStore}
          onPreviewRequest={
            props.onPreviewRequest && targets.ok
              ? (o, context) => props.onPreviewRequest!(targets.pages, o, context)
              : undefined
          }
          onSavePdf={
            props.onSavePdf && targets.ok && !saveRestricted
              ? (o) => props.onSavePdf!(targets.pages, o)
              : undefined
          }
          job={job}
        />
        {saveRestricted && newRoute && (
          <div className="pdf-modal-hint" data-print-save-restricted="">
            {t('printSaveRestricted')}
          </div>
        )}
        <div className="pdf-modal-actions">
          <button className="pdf-modal-btn" onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button
            className="pdf-modal-btn primary"
            data-print-confirm=""
            disabled={blocked}
            onClick={confirm}
          >
            {t('print')}
          </button>
        </div>
      </div>
    </div>
  )
}
