import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  BOOKLET_BINDINGS,
  DEFAULT_LABEL_PRESET_ID,
  DPI_CHOICES,
  LABEL_FILLS,
  LABEL_PAPERS,
  LABEL_PRESETS,
  LAYOUT_MODES,
  NUP_COUNTS,
  NUP_ORDERS,
  PAPER_NAMES,
  POSTER_OVERLAP_MM_MAX,
  POSTER_OVERLAP_MM_MIN,
  POSTER_TILES_MAX,
  POSTER_TILES_MIN,
  resolveLabelSpec,
  SIDES_FILTERS,
  validateLabelSpec,
  type DpiChoice,
  type LabelPaper,
  type LabelSpec,
  type LayoutMode,
  type PageSize,
  type PaperChoice,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import { printLayoutText, type PrintLayoutStringKey } from '../strings-print-layout'
import { ArrangedPreview, PrintLayoutProgressLine } from './ArrangedPreview'
import { useArrangedPreview, type PrintLayoutPreviewRequest } from './hooks'
import {
  labelCellsOf,
  labelPresetText,
  normalizePanelOptions,
  printLayoutIssueText,
  printLayoutProblem,
  takesNewPrintRoute,
  type PrintLayoutCapabilities,
  type PrintLayoutProgress,
} from './model'
import { PrintLayoutSchematic } from './PrintLayoutSchematic'
import './print-layout.css'

/** Where the app keeps the last typed-in label grid (one per app, spec 4.1). */
export interface PrintLabelSpecStore {
  load: () => Promise<LabelSpec | null>
  save: (spec: LabelSpec) => Promise<void>
}

/** A print or save the editor is running on the new route. */
export interface PrintLayoutJob {
  /** pages turned into pictures so far; null while idle */
  progress: PrintLayoutProgress | null
  onCancel?: (() => void) | undefined
  /** why the last print or save failed, already in the user's language */
  error?: string | null | undefined
}

export interface PrintLayoutPanelProps {
  lang: Lang
  value: PrintLayoutOptions
  onChange: (next: PrintLayoutOptions) => void
  /** the print job's page sizes in points (/Rotate applied); null while the editor counts them */
  pages: readonly PageSize[] | null
  capabilities: PrintLayoutCapabilities
  labelSpecStore?: PrintLabelSpecStore | undefined
  /** draw the layout diagram inside the panel; editors that put it in their preview pass false */
  showSchematic?: boolean | undefined
  /** builds the arranged result as one PNG per face; shows the preview button when given */
  onPreviewRequest?: PrintLayoutPreviewRequest | undefined
  /** saves the arranged PDF; shows the save button while an option is on */
  onSavePdf?: ((options: PrintLayoutOptions) => void) | undefined
  job?: PrintLayoutJob | undefined
  disabled?: boolean | undefined
}

const MODE_KEYS: Record<LayoutMode, PrintLayoutStringKey> = {
  single: 'modeSingle',
  nup: 'modeNup',
  booklet: 'modeBooklet',
  poster: 'modePoster',
  labels: 'modeLabels',
}

type LabelNumberField = Exclude<keyof LabelSpec, 'paper'>

const LABEL_FIELDS: ReadonlyArray<[LabelNumberField, PrintLayoutStringKey, string]> = [
  ['cols', 'labelCols', 'label-cols'],
  ['rows', 'labelRows', 'label-rows'],
  ['cellWidthMm', 'labelCellWidth', 'label-cell-width'],
  ['cellHeightMm', 'labelCellHeight', 'label-cell-height'],
  ['topMarginMm', 'labelTopMargin', 'label-top'],
  ['leftMarginMm', 'labelLeftMargin', 'label-left'],
  ['hPitchMm', 'labelHPitch', 'label-h-pitch'],
  ['vPitchMm', 'labelVPitch', 'label-v-pitch'],
]

type LabelDraft = { paper: LabelPaper } & Record<LabelNumberField, string>

const CUSTOM = 'custom'

/** The grid custom entry starts from when nothing is remembered: the first preset */
function presetSpec(): LabelSpec {
  return resolveLabelSpec({ kind: 'preset', id: DEFAULT_LABEL_PRESET_ID })!
}

function draftOf(spec: LabelSpec): LabelDraft {
  const d = { paper: spec.paper } as LabelDraft
  for (const [field] of LABEL_FIELDS) d[field] = String(spec[field])
  return d
}

const readNumber = (text: string): number => {
  const t = text.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

function specOf(draft: LabelDraft): LabelSpec {
  const spec = { paper: draft.paper } as LabelSpec
  for (const [field] of LABEL_FIELDS) spec[field] = readNumber(draft[field])
  return spec
}

const specKey = (spec: LabelSpec): string => JSON.stringify(specOf(draftOf(spec)))

/** Fields to mark invalid for a typed-in grid */
function invalidFields(spec: LabelSpec): Set<LabelNumberField> {
  const bad = new Set<LabelNumberField>()
  const r = validateLabelSpec(spec)
  if (r.ok) return bad
  if (r.error.code === 'label-spec-off-paper') {
    for (const [f] of LABEL_FIELDS) bad.add(f)
    return bad
  }
  if (r.error.code === 'label-pitch-below-cell') {
    if (spec.hPitchMm < spec.cellWidthMm) bad.add('hPitchMm')
    if (spec.vPitchMm < spec.cellHeightMm) bad.add('vPitchMm')
    return bad
  }
  for (const [f] of LABEL_FIELDS) {
    const v = spec[f]
    const ok =
      f === 'cols' || f === 'rows'
        ? Number.isInteger(v) && v > 0
        : f === 'topMarginMm' || f === 'leftMarginMm'
          ? Number.isFinite(v) && v >= 0
          : Number.isFinite(v) && v > 0
    if (!ok) bad.add(f)
  }
  return bad
}

const numText = (n: number): string => (Number.isFinite(n) ? String(n) : '')

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="gs-pl-field">
      <span className="gs-pl-field-label">{props.label}</span>
      {props.children}
    </label>
  )
}

/**
 * The shared "page layout" panel (spec 4). Controlled: the editor holds the
 * options (see `usePrintLayoutOptions` for fresh defaults on every open) and
 * this panel keeps them within the editor's capabilities.
 */
export function PrintLayoutPanel(props: PrintLayoutPanelProps): ReactElement {
  const {
    lang,
    value,
    onChange,
    pages,
    capabilities,
    labelSpecStore,
    showSchematic = true,
    onPreviewRequest,
    onSavePdf,
    job,
    disabled = false,
  } = props
  const t = (key: PrintLayoutStringKey, params?: Record<string, string | number>) =>
    printLayoutText(lang, key, params)
  const id = useId()
  const blocked = capabilities.layoutBlockedReason
  const running = !!job?.progress

  // The latest value and callbacks, for the async custom-spec load and the
  // normalising effect (an editor's onChange is often a fresh closure).
  const latest = useRef({ value, onChange, capabilities })
  latest.current = { value, onChange, capabilities }

  const emit = (patch: Partial<PrintLayoutOptions>) => {
    const cur = latest.current
    cur.onChange(normalizePanelOptions({ ...cur.value, ...patch }, cur.capabilities))
  }

  // Keep the options inside the capabilities when the editor changes them
  // (slides switching to handouts) or hands over options that do not fit.
  useEffect(() => {
    const cur = latest.current
    const fixed = normalizePanelOptions(cur.value, cur.capabilities)
    if (fixed !== cur.value) cur.onChange(fixed)
  }, [value, capabilities.showPaperAndFit, capabilities.layoutBlockedReason])

  const preview = useArrangedPreview(onPreviewRequest)
  const cancelPreview = preview.cancel
  // A result made for other options or other pages is stale. Pages compare by
  // their sizes so an editor may hand over a fresh array on every render.
  const pagesKey = pages ? pages.map((p) => `${p.widthPt}x${p.heightPt}`).join(',') : ''
  useEffect(() => cancelPreview(), [value, pagesKey, cancelPreview])

  const [draft, setDraft] = useState<LabelDraft | null>(() =>
    value.labels.spec.kind === 'custom' ? draftOf(value.labels.spec.spec) : null,
  )
  const savedKey = useRef<string | null>(null)

  const problem = useMemo(() => printLayoutProblem(value, pages), [value, pages])
  const cellCount = labelCellsOf(value)
  const newRoute = takesNewPrintRoute(value)

  const setLabels = (patch: Partial<PrintLayoutOptions['labels']>) =>
    emit({ labels: { ...latest.current.value.labels, ...patch } })

  const chooseSpec = async (choice: string) => {
    if (choice !== CUSTOM) {
      setLabels({ spec: { kind: 'preset', id: choice } })
      return
    }
    let spec: LabelSpec
    if (draft) {
      spec = specOf(draft)
    } else {
      // an unreadable store starts from the first preset like an empty one
      const loaded = await (labelSpecStore?.load() ?? Promise.resolve(null)).catch(() => null)
      const checked = loaded ? validateLabelSpec(loaded) : null
      spec = checked?.ok ? checked.spec : presetSpec()
      savedKey.current = checked?.ok ? specKey(checked.spec) : null
      setDraft(draftOf(spec))
    }
    setLabels({ spec: { kind: 'custom', spec } })
  }

  const editDraft = (patch: Partial<LabelDraft>) => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    setLabels({ spec: { kind: 'custom', spec: specOf(next) } })
  }

  const saveDraft = () => {
    if (!draft || !labelSpecStore) return
    const checked = validateLabelSpec(specOf(draft))
    if (!checked.ok) return
    const key = specKey(checked.spec)
    if (key === savedKey.current) return
    savedKey.current = key
    void labelSpecStore.save(checked.spec).catch(() => {
      // keep the typed value; a later blur tries again
      if (savedKey.current === key) savedKey.current = null
    })
  }

  const customSpec = value.labels.spec.kind === 'custom' ? value.labels.spec.spec : null
  const badFields = customSpec ? invalidFields(customSpec) : new Set<LabelNumberField>()

  const numberInput = (
    pl: string,
    n: number,
    min: number,
    max: number | undefined,
    onValue: (v: number) => void,
    step = 1,
  ) => (
    <input
      type="number"
      className="gs-pl-number"
      data-pl={pl}
      min={min}
      max={max}
      step={step}
      value={numText(n)}
      disabled={disabled}
      onChange={(e) => onValue(readNumber(e.target.value))}
    />
  )

  const modeControls = (): ReactNode => {
    switch (value.mode) {
      case 'nup':
        return (
          <div className="gs-pl-sub">
            <Field label={t('nupCount')}>
              <select
                data-pl="nup-count"
                value={value.nup.count}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    nup: {
                      ...value.nup,
                      count: Number(e.target.value) as PrintLayoutOptions['nup']['count'],
                    },
                  })
                }
              >
                {NUP_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('nupOrder')}>
              <select
                data-pl="nup-order"
                value={value.nup.order}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    nup: {
                      ...value.nup,
                      order: e.target.value as PrintLayoutOptions['nup']['order'],
                    },
                  })
                }
              >
                {NUP_ORDERS.map((o) => (
                  <option key={o} value={o}>
                    {t(o === 'row' ? 'nupOrderRow' : 'nupOrderColumn')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )
      case 'booklet':
        return (
          <div className="gs-pl-sub">
            <Field label={t('bookletBinding')}>
              <select
                data-pl="booklet-binding"
                value={value.booklet.binding}
                disabled={disabled}
                onChange={(e) =>
                  emit({
                    booklet: {
                      binding: e.target.value as PrintLayoutOptions['booklet']['binding'],
                    },
                  })
                }
              >
                {BOOKLET_BINDINGS.map((b) => (
                  <option key={b} value={b}>
                    {t(b === 'left' ? 'bookletLeft' : 'bookletRight')}
                  </option>
                ))}
              </select>
            </Field>
            <p className="gs-pl-hint" data-pl="booklet-hint">
              {t('bookletHint')}
            </p>
          </div>
        )
      case 'poster':
        return (
          <div className="gs-pl-sub">
            <Field label={t('posterCols')}>
              {numberInput(
                'poster-cols',
                value.poster.cols,
                POSTER_TILES_MIN,
                POSTER_TILES_MAX,
                (v) => emit({ poster: { ...value.poster, cols: v } }),
              )}
            </Field>
            <Field label={t('posterRows')}>
              {numberInput(
                'poster-rows',
                value.poster.rows,
                POSTER_TILES_MIN,
                POSTER_TILES_MAX,
                (v) => emit({ poster: { ...value.poster, rows: v } }),
              )}
            </Field>
            <Field label={t('posterOverlap')}>
              {numberInput(
                'poster-overlap',
                value.poster.overlapMm,
                POSTER_OVERLAP_MM_MIN,
                POSTER_OVERLAP_MM_MAX,
                (v) => emit({ poster: { ...value.poster, overlapMm: v } }),
              )}
            </Field>
            <label className="gs-pl-check">
              <input
                type="checkbox"
                data-pl="poster-cut-marks"
                checked={value.poster.cutMarks}
                disabled={disabled}
                onChange={(e) => emit({ poster: { ...value.poster, cutMarks: e.target.checked } })}
              />
              <span>{t('posterCutMarks')}</span>
            </label>
          </div>
        )
      case 'labels':
        return (
          <div className="gs-pl-sub">
            <Field label={t('labelSpec')}>
              <select
                data-pl="label-spec"
                value={value.labels.spec.kind === 'preset' ? value.labels.spec.id : CUSTOM}
                disabled={disabled}
                onChange={(e) => void chooseSpec(e.target.value)}
              >
                {LABEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {labelPresetText(lang, p)}
                  </option>
                ))}
                <option value={CUSTOM}>{t('labelCustom')}</option>
              </select>
            </Field>
            {customSpec && draft && (
              <fieldset className="gs-pl-custom" onBlur={saveDraft}>
                <legend className="gs-pl-legend">{t('labelCustom')}</legend>
                <Field label={t('labelPaper')}>
                  <select
                    data-pl="label-paper"
                    value={draft.paper}
                    disabled={disabled}
                    onChange={(e) => editDraft({ paper: e.target.value as LabelPaper })}
                  >
                    {LABEL_PAPERS.map((p) => (
                      <option key={p} value={p}>
                        {p === 'Letter' ? t('paperLetter') : p}
                      </option>
                    ))}
                  </select>
                </Field>
                {LABEL_FIELDS.map(([field, key, pl]) => (
                  <Field key={field} label={t(key)}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="gs-pl-number"
                      data-pl={pl}
                      value={draft[field]}
                      disabled={disabled}
                      aria-invalid={badFields.has(field) ? 'true' : undefined}
                      onChange={(e) => editDraft({ [field]: e.target.value })}
                    />
                  </Field>
                ))}
                <p className="gs-pl-hint">{t('labelPitchHint')}</p>
              </fieldset>
            )}
            <fieldset className="gs-pl-group">
              <legend className="gs-pl-legend">{t('labelFill')}</legend>
              {LABEL_FILLS.map((f) => (
                <label key={f} className="gs-pl-check">
                  <input
                    type="radio"
                    name={`${id}-label-fill`}
                    data-pl="label-fill"
                    value={f}
                    checked={value.labels.fill === f}
                    disabled={disabled}
                    onChange={() => setLabels({ fill: f })}
                  />
                  <span>{t(f === 'repeat' ? 'labelFillRepeat' : 'labelFillSequence')}</span>
                </label>
              ))}
            </fieldset>
            {value.labels.fill === 'repeat' && (
              <Field label={t('labelRepeatPage')}>
                {numberInput('label-repeat', value.labels.repeatPage, 1, pages?.length, (v) =>
                  setLabels({ repeatPage: v }),
                )}
              </Field>
            )}
            <Field label={t('labelStartCell')}>
              {numberInput('label-start', value.labels.startCell, 1, cellCount, (v) =>
                setLabels({ startCell: v }),
              )}
            </Field>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <section className="gs-pl" aria-label={t('panelTitle')}>
      <div className="gs-pl-title">{t('panelTitle')}</div>
      <fieldset className="gs-pl-group">
        <legend className="gs-pl-legend">{t('modeLabel')}</legend>
        {LAYOUT_MODES.map((m) => (
          <label key={m} className="gs-pl-check">
            <input
              type="radio"
              name={`${id}-mode`}
              data-pl="mode"
              value={m}
              checked={value.mode === m}
              disabled={disabled || (!!blocked && m !== 'single')}
              onChange={() => emit({ mode: m })}
            />
            <span>{t(MODE_KEYS[m])}</span>
          </label>
        ))}
      </fieldset>
      {blocked && (
        <p className="gs-pl-hint" data-pl="blocked">
          {blocked}
        </p>
      )}
      {modeControls()}
      <fieldset className="gs-pl-group">
        <legend className="gs-pl-legend">{t('sidesLabel')}</legend>
        {SIDES_FILTERS.map((s) => (
          <label key={s} className="gs-pl-check">
            <input
              type="radio"
              name={`${id}-sides`}
              data-pl="sides"
              value={s}
              checked={value.sides === s}
              disabled={disabled}
              onChange={() => emit({ sides: s })}
            />
            <span>{t(s === 'all' ? 'sidesAll' : s === 'odd' ? 'sidesOdd' : 'sidesEven')}</span>
          </label>
        ))}
        <label className="gs-pl-check">
          <input
            type="checkbox"
            data-pl="reverse"
            checked={value.reverse}
            disabled={disabled}
            onChange={(e) => emit({ reverse: e.target.checked })}
          />
          <span>{t('reverse')}</span>
        </label>
      </fieldset>
      {capabilities.showPaperAndFit && (
        <div className="gs-pl-sub">
          <Field label={t('paperLabel')}>
            <select
              data-pl="paper"
              value={value.paper}
              disabled={disabled}
              onChange={(e) => emit({ paper: e.target.value as PaperChoice })}
            >
              <option value="source">{t('paperSource')}</option>
              {PAPER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p === 'Letter' ? t('paperLetter') : p === 'Legal' ? t('paperLegal') : p}
                </option>
              ))}
            </select>
          </Field>
          <label className="gs-pl-check">
            <input
              type="checkbox"
              data-pl="fit"
              checked={value.fitToPaper}
              disabled={disabled || value.paper === 'source' || value.mode !== 'single'}
              onChange={(e) => emit({ fitToPaper: e.target.checked })}
            />
            <span>{t('fitToPaper')}</span>
          </label>
        </div>
      )}
      <div className="gs-pl-sub">
        <label className="gs-pl-check">
          <input
            type="checkbox"
            data-pl="grayscale"
            checked={value.grayscale}
            disabled={disabled}
            onChange={(e) => emit({ grayscale: e.target.checked })}
          />
          <span>{t('grayscale')}</span>
        </label>
        <Field label={t('dpiLabel')}>
          <select
            data-pl="dpi"
            value={String(value.dpi)}
            disabled={disabled}
            onChange={(e) =>
              emit({
                dpi: (e.target.value === 'auto' ? 'auto' : Number(e.target.value)) as DpiChoice,
              })
            }
          >
            {DPI_CHOICES.map((d) => (
              <option key={d} value={String(d)}>
                {d === 'auto' ? t('dpiAuto') : t('dpiValue', { dpi: d })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {problem && (
        <p className="gs-pl-issue" role="alert" data-pl="issue">
          {printLayoutIssueText(lang, problem, { pageCount: pages?.length, cellCount })}
        </p>
      )}
      {newRoute && (
        <p className="gs-pl-hint" data-pl="system-note">
          {t('systemDialogNote')}
        </p>
      )}
      {showSchematic && <PrintLayoutSchematic lang={lang} pages={pages} options={value} />}
      {newRoute && (onPreviewRequest || onSavePdf) && (
        <div className="gs-pl-actions">
          {onPreviewRequest && (
            <button
              type="button"
              className="gs-pl-btn"
              data-pl="preview"
              disabled={disabled || !!problem || running || preview.state.status === 'running'}
              onClick={() => preview.start(value)}
            >
              {t('previewButton')}
            </button>
          )}
          {onSavePdf && (
            <button
              type="button"
              className="gs-pl-btn"
              data-pl="save-pdf"
              disabled={disabled || !!problem || running}
              onClick={() => onSavePdf(value)}
            >
              {t('savePdf')}
            </button>
          )}
          {onSavePdf && value.grayscale && (
            <span className="gs-pl-hint" data-pl="gray-note">
              {t('savePdfGrayNote')}
            </span>
          )}
        </div>
      )}
      <ArrangedPreview
        lang={lang}
        state={preview.state}
        onCancel={preview.cancel}
        onClose={preview.cancel}
      />
      {job?.progress && (
        <PrintLayoutProgressLine lang={lang} progress={job.progress} onCancel={job.onCancel} />
      )}
      {job?.error && !job.progress && (
        <p className="gs-pl-issue" role="alert" data-pl="job-error">
          {job.error}
        </p>
      )}
    </section>
  )
}
