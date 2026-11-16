import { useId, useMemo, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { PageSize, PrintLayoutOptions } from '@genoffice/print-layout/plan'
import { useModalKeys } from '../modal-keys'
import { printLayoutText } from '../strings-print-layout'
import { usePrintLayoutOptions, type PrintLayoutPreviewRequest } from './hooks'
import {
  parsePrintRanges,
  printLayoutProblem,
  takesNewPrintRoute,
  type PrintLayoutCapabilities,
  type PrintPageRange,
} from './model'
import { PrintLayoutPanel, type PrintLabelSpecStore, type PrintLayoutJob } from './PrintLayoutPanel'
import './print-layout.css'

/**
 * Which range choices the editor offers (spec 5): none (one page only),
 * all or a typed range (HTML), all or the current page (diagrams).
 */
export type SimplePrintRangeChoice = 'none' | 'all-custom' | 'all-current'

export type SimplePrintRange =
  { kind: 'all' } | { kind: 'current' } | { kind: 'custom'; text: string; ranges: PrintPageRange[] }

export interface SimplePrintDialogProps {
  lang: Lang
  rangeChoice: SimplePrintRangeChoice
  /** the job's page sizes for the chosen range; null while the editor counts them */
  pages: readonly PageSize[] | null
  capabilities: PrintLayoutCapabilities
  /** told when the range changes so the editor can count the pages again */
  onRangeChange?: ((range: SimplePrintRange) => void) | undefined
  /** nothing changed in the panel: print exactly as before */
  onPlainPrint: (range: SimplePrintRange) => void
  /** an option is on: print down the new route */
  onPrint: (range: SimplePrintRange, options: PrintLayoutOptions) => void
  onSavePdf: (range: SimplePrintRange, options: PrintLayoutOptions) => void
  onCancel: () => void
  labelSpecStore?: PrintLabelSpecStore | undefined
  /** builds the arranged result for this range as one PNG per face (see PrintLayoutPreviewRequest) */
  onPreviewRequest?: (
    range: SimplePrintRange,
    ...request: Parameters<PrintLayoutPreviewRequest>
  ) => ReturnType<PrintLayoutPreviewRequest>
  job?: PrintLayoutJob | undefined
}

type RangeKind = SimplePrintRange['kind']

/**
 * A small print dialog for editors that had none (HTML, mind map, diagram):
 * a range choice, the shared panel, and Print, Cancel and "Save arranged PDF".
 * Mount it for each print so the options start from the defaults.
 */
export function SimplePrintDialog(props: SimplePrintDialogProps): ReactElement {
  const {
    lang,
    rangeChoice,
    pages,
    capabilities,
    onRangeChange,
    onPlainPrint,
    onPrint,
    onSavePdf,
    onCancel,
    labelSpecStore,
    onPreviewRequest,
    job,
  } = props
  const id = useId()
  const [options, setOptions] = usePrintLayoutOptions(true)
  const [kind, setKind] = useState<RangeKind>('all')
  const [text, setText] = useState('')
  const [showInvalid, setShowInvalid] = useState(false)
  const modalKeys = useModalKeys(onCancel, { restoreFocus: true })

  const kinds: RangeKind[] =
    rangeChoice === 'all-custom'
      ? ['all', 'custom']
      : rangeChoice === 'all-current'
        ? ['all', 'current']
        : []

  const rangeOf = (k: RangeKind, typed: string): SimplePrintRange | null => {
    if (k !== 'custom') return { kind: k }
    const ranges = parsePrintRanges(typed)
    return ranges ? { kind: 'custom', text: typed.trim(), ranges } : null
  }
  const range = rangeOf(kind, text)

  const changeRange = (k: RangeKind, typed: string) => {
    setKind(k)
    setText(typed)
    setShowInvalid(false)
    const next = rangeOf(k, typed)
    if (next) onRangeChange?.(next)
  }

  const newRoute = takesNewPrintRoute(options)
  const problem = useMemo(() => printLayoutProblem(options, pages), [options, pages])
  const running = !!job?.progress
  const preview: PrintLayoutPreviewRequest | undefined =
    range && onPreviewRequest ? (o, context) => onPreviewRequest(range, o, context) : undefined

  const print = () => {
    if (!range) {
      setShowInvalid(true)
      return
    }
    if (newRoute) onPrint(range, options)
    else onPlainPrint(range)
  }

  const t = (key: Parameters<typeof printLayoutText>[1]) => printLayoutText(lang, key)

  return (
    <div className="gs-pl-mask" ref={modalKeys.ref} onKeyDown={modalKeys.onKeyDown} tabIndex={-1}>
      <div className="gs-pl-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="gs-pl-dialog-title" id={`${id}-title`}>
          {t('dialogTitle')}
        </div>
        <div className="gs-pl-dialog-body">
          {kinds.length > 0 && (
            <fieldset className="gs-pl-group">
              <legend className="gs-pl-legend">{t('rangeLabel')}</legend>
              {kinds.map((k) => (
                <label key={k} className="gs-pl-check">
                  <input
                    type="radio"
                    name={`${id}-range`}
                    data-pl="range"
                    value={k}
                    checked={kind === k}
                    disabled={running}
                    onChange={() => changeRange(k, text)}
                  />
                  <span>
                    {k === 'custom'
                      ? t('rangeCustom')
                      : k === 'current'
                        ? t('rangeCurrentPage')
                        : rangeChoice === 'all-current'
                          ? t('rangeAllPages')
                          : t('rangeAll')}
                  </span>
                </label>
              ))}
              {kind === 'custom' && (
                <input
                  type="text"
                  className="gs-pl-range-text"
                  data-pl="range-text"
                  value={text}
                  placeholder={t('rangeCustomHint')}
                  aria-label={t('rangeCustom')}
                  aria-invalid={showInvalid && !range ? 'true' : undefined}
                  disabled={running}
                  onChange={(e) => changeRange('custom', e.target.value)}
                />
              )}
              {showInvalid && !range && (
                <p className="gs-pl-issue" role="alert" data-pl="range-invalid">
                  {t('rangeInvalid')}
                </p>
              )}
            </fieldset>
          )}
          <PrintLayoutPanel
            lang={lang}
            value={options}
            onChange={setOptions}
            pages={pages}
            capabilities={capabilities}
            labelSpecStore={labelSpecStore}
            onPreviewRequest={preview}
            job={job}
            disabled={running}
          />
        </div>
        <div className="gs-pl-dialog-actions">
          {newRoute && (
            <button
              type="button"
              className="gs-pl-btn"
              data-pl="save-pdf"
              disabled={running || !!problem || !range}
              onClick={() => range && onSavePdf(range, options)}
            >
              {t('savePdf')}
            </button>
          )}
          {newRoute && options.grayscale && (
            <span className="gs-pl-hint" data-pl="gray-note">
              {t('savePdfGrayNote')}
            </span>
          )}
          <span className="gs-pl-spacer" />
          <button type="button" className="gs-pl-btn" data-pl="cancel" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="gs-pl-btn primary"
            data-pl="print"
            disabled={running || (newRoute && !!problem)}
            onClick={print}
          >
            {t('print')}
          </button>
        </div>
      </div>
    </div>
  )
}
