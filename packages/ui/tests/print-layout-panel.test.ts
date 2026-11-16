/** @vitest-environment jsdom */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultOptions,
  LABEL_PRESETS,
  type LabelSpec,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  ArrangedPreview,
  PrintLayoutPanel,
  PrintLayoutSchematic,
  usePrintLayoutOptions,
  type PrintLayoutCapabilities,
  type PrintLayoutPanelProps,
} from '../src/print-layout'

const A4: PageSize = { widthPt: 595.28, heightPt: 841.89 }
const pages = (n: number): PageSize[] => Array.from({ length: n }, () => ({ ...A4 }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)]

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  )
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

type HarnessProps = Partial<Omit<PrintLayoutPanelProps, 'value' | 'onChange'>> & {
  initial?: PrintLayoutOptions
  spy?: (o: PrintLayoutOptions) => void
}

let latest: PrintLayoutOptions = createDefaultOptions()

function Harness(props: HarnessProps) {
  const { initial, spy, ...rest } = props
  const [value, setValue] = useState<PrintLayoutOptions>(initial ?? createDefaultOptions())
  latest = value
  return createElement(PrintLayoutPanel, {
    lang: 'en',
    pages: pages(8),
    capabilities: { showPaperAndFit: true },
    ...rest,
    value,
    onChange: (o: PrintLayoutOptions) => {
      spy?.(o)
      setValue(o)
    },
  })
}

function mount(props: HarnessProps = {}) {
  act(() => root.render(createElement(Harness, props)))
}

function rerender(props: HarnessProps) {
  act(() => root.render(createElement(Harness, props)))
}

function click(el: Element | null) {
  act(() => (el as HTMLElement).click())
}

describe('PrintLayoutPanel', () => {
  it('lets only one layout mode be chosen', () => {
    mount()
    const radios = $$<HTMLInputElement>('input[data-pl="mode"]')
    expect(radios.map((r) => r.value)).toEqual(['single', 'nup', 'booklet', 'poster', 'labels'])
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['single'])
    click(radios[2]!)
    expect(latest.mode).toBe('booklet')
    expect(
      $$<HTMLInputElement>('input[data-pl="mode"]')
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(['booklet'])
    click($$<HTMLInputElement>('input[data-pl="mode"]')[3]!)
    expect(latest.mode).toBe('poster')
    expect($$<HTMLInputElement>('input[data-pl="mode"]').filter((r) => r.checked).length).toBe(1)
  })

  it('shows the booklet hint only for booklets', () => {
    mount()
    expect($('[data-pl="booklet-hint"]')).toBeNull()
    click($$('input[data-pl="mode"]')[2]!)
    expect($('[data-pl="booklet-hint"]')?.textContent).toBe(
      'Print double-sided and flip on the short edge.',
    )
  })

  it('hides paper and fit when the editor has its own', () => {
    mount({ capabilities: { showPaperAndFit: false } })
    expect($('select[data-pl="paper"]')).toBeNull()
    expect($('input[data-pl="fit"]')).toBeNull()
    expect($('input[data-pl="grayscale"]')).not.toBeNull()
    expect($('select[data-pl="dpi"]')).not.toBeNull()
  })

  it('keeps fit off until a paper is chosen with one page per sheet', () => {
    mount()
    const fit = () => $<HTMLInputElement>('input[data-pl="fit"]')!
    expect(fit().disabled).toBe(true)
    act(() => setValue($<HTMLSelectElement>('select[data-pl="paper"]')!, 'A4'))
    expect(latest.paper).toBe('A4')
    expect(fit().disabled).toBe(false)
    click(fit())
    expect(latest.fitToPaper).toBe(true)
    // another mode clears and locks fit
    click($$('input[data-pl="mode"]')[1]!)
    expect(latest.fitToPaper).toBe(false)
    expect(fit().disabled).toBe(true)
    click($$('input[data-pl="mode"]')[0]!)
    click(fit())
    expect(latest.fitToPaper).toBe(true)
    // going back to the document size clears it too
    act(() => setValue($<HTMLSelectElement>('select[data-pl="paper"]')!, 'source'))
    expect(latest.fitToPaper).toBe(false)
    expect(fit().disabled).toBe(true)
  })

  it('keeps one page per sheet and shows the editor reason while layouts are blocked', () => {
    const caps: PrintLayoutCapabilities = {
      showPaperAndFit: true,
      layoutBlockedReason: 'Handouts already place several slides on a page.',
    }
    const initial = createDefaultOptions()
    initial.mode = 'nup'
    mount({ capabilities: caps, initial })
    expect(latest.mode).toBe('single')
    expect($('[data-pl="blocked"]')?.textContent).toBe(caps.layoutBlockedReason)
    const radios = $$<HTMLInputElement>('input[data-pl="mode"]')
    expect(radios.filter((r) => !r.disabled).map((r) => r.value)).toEqual(['single'])
    // odd/even and the rest still work
    click($$<HTMLInputElement>('input[data-pl="sides"]')[1]!)
    expect(latest.sides).toBe('odd')
    expect(latest.mode).toBe('single')
  })

  it('shows the system window note only while an option is on', () => {
    mount()
    expect($('[data-pl="system-note"]')).toBeNull()
    click($('input[data-pl="grayscale"]'))
    expect($('[data-pl="system-note"]')).not.toBeNull()
  })

  it('shows the reason a choice cannot print', () => {
    mount()
    click($$('input[data-pl="mode"]')[3]!)
    act(() => setValue($<HTMLInputElement>('input[data-pl="poster-cols"]')!, '1'))
    act(() => setValue($<HTMLInputElement>('input[data-pl="poster-rows"]')!, '1'))
    expect($('[data-pl="issue"]')?.textContent).toBe('A poster needs more than one sheet.')
  })

  it('lists label presets by cell count and size', () => {
    mount()
    click($$('input[data-pl="mode"]')[4]!)
    const options = $$<HTMLOptionElement>('select[data-pl="label-spec"] option')
    expect(options[0]!.value).toBe(LABEL_PRESETS[0]!.id)
    expect(options[0]!.selected).toBe(true)
    expect(options[0]!.textContent).toBe('21 labels (3 × 7) · 63.5 × 38.1 mm')
    expect(options.at(-1)!.value).toBe('custom')
  })

  it('loads the remembered custom spec, validates it live and saves it', async () => {
    const remembered: LabelSpec = {
      paper: 'A4',
      cols: 2,
      rows: 5,
      cellWidthMm: 90,
      cellHeightMm: 50,
      topMarginMm: 10,
      leftMarginMm: 10,
      hPitchMm: 95,
      vPitchMm: 55,
    }
    const load = vi.fn(async () => remembered)
    const save = vi.fn(async () => {})
    mount({ labelSpecStore: { load, save } })
    click($$('input[data-pl="mode"]')[4]!)
    act(() => setValue($<HTMLSelectElement>('select[data-pl="label-spec"]')!, 'custom'))
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect($<HTMLInputElement>('input[data-pl="label-cols"]')!.value).toBe('2')
    expect(latest.labels.spec).toEqual({ kind: 'custom', spec: remembered })
    expect($('[data-pl="issue"]')).toBeNull()

    // off the paper: 3 columns of 95 mm pitch from 10 mm needs 290 mm on 210 mm A4
    const cols = $<HTMLInputElement>('input[data-pl="label-cols"]')!
    act(() => setValue(cols, '3'))
    expect($('[data-pl="issue"]')?.textContent).toBe(
      'The labels run off the paper. Reduce the margins, label size or pitch.',
    )
    expect($<HTMLInputElement>('input[data-pl="label-cols"]')!.getAttribute('aria-invalid')).toBe(
      'true',
    )
    act(() => cols.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(save).not.toHaveBeenCalled()

    // pitch below the cell
    act(() => setValue(cols, '2'))
    act(() => setValue($<HTMLInputElement>('input[data-pl="label-h-pitch"]')!, '80'))
    expect($('[data-pl="issue"]')?.textContent).toBe(
      'The pitch cannot be smaller than the label width or height.',
    )

    act(() => setValue($<HTMLInputElement>('input[data-pl="label-h-pitch"]')!, '92'))
    expect($('[data-pl="issue"]')).toBeNull()
    act(() =>
      $('input[data-pl="label-h-pitch"]')!.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true }),
      ),
    )
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ ...remembered, hPitchMm: 92 })
    // the same spec is not saved twice
    act(() =>
      $('input[data-pl="label-h-pitch"]')!.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true }),
      ),
    )
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('starts custom entry from the first preset when nothing is remembered', async () => {
    mount({ labelSpecStore: { load: async () => null, save: async () => {} } })
    click($$('input[data-pl="mode"]')[4]!)
    act(() => setValue($<HTMLSelectElement>('select[data-pl="label-spec"]')!, 'custom'))
    await flush()
    expect($<HTMLInputElement>('input[data-pl="label-cols"]')!.value).toBe(
      String(LABEL_PRESETS[0]!.cols),
    )
    expect(latest.labels.spec.kind).toBe('custom')
  })

  it('limits the repeat page to the job and start cell to the sheet', () => {
    mount({ pages: pages(3) })
    click($$('input[data-pl="mode"]')[4]!)
    click($$<HTMLInputElement>('input[data-pl="label-fill"]').find((r) => r.value === 'repeat')!)
    expect($<HTMLInputElement>('input[data-pl="label-repeat"]')!.max).toBe('3')
    expect($<HTMLInputElement>('input[data-pl="label-start"]')!.max).toBe('21')
    act(() => setValue($<HTMLInputElement>('input[data-pl="label-repeat"]')!, '5'))
    expect($('[data-pl="issue"]')?.textContent).toBe('The page to repeat can be from 1 to 3.')
  })

  it('offers save and preview buttons only while an option is on', () => {
    const onSavePdf = vi.fn()
    const onPreviewRequest = vi.fn(async () => [] as Uint8Array[])
    mount({ onSavePdf, onPreviewRequest })
    expect($('button[data-pl="save-pdf"]')).toBeNull()
    expect($('button[data-pl="preview"]')).toBeNull()
    click($('input[data-pl="reverse"]'))
    click($('button[data-pl="save-pdf"]'))
    expect(onSavePdf).toHaveBeenCalledWith(latest)
    expect($('[data-pl="gray-note"]')).toBeNull()
    click($('input[data-pl="grayscale"]'))
    expect($('[data-pl="gray-note"]')).not.toBeNull()
  })
})

describe('usePrintLayoutOptions', () => {
  function Dialog({ open }: { open: boolean }) {
    const [value, setValue] = usePrintLayoutOptions(open)
    latest = value
    if (!open) return null
    return createElement(PrintLayoutPanel, {
      lang: 'en',
      pages: pages(4),
      capabilities: { showPaperAndFit: true },
      value,
      onChange: setValue,
    })
  }

  it('starts from the defaults every time the dialog opens', () => {
    act(() => root.render(createElement(Dialog, { open: true })))
    click($$('input[data-pl="mode"]')[2]!)
    click($('input[data-pl="grayscale"]'))
    expect(latest.mode).toBe('booklet')
    act(() => root.render(createElement(Dialog, { open: false })))
    act(() => root.render(createElement(Dialog, { open: true })))
    expect(latest).toEqual(createDefaultOptions())
    expect($$<HTMLInputElement>('input[data-pl="mode"]').find((r) => r.checked)?.value).toBe(
      'single',
    )
  })
})

describe('PrintLayoutSchematic', () => {
  function render(options: PrintLayoutOptions, n = 8) {
    act(() =>
      root.render(createElement(PrintLayoutSchematic, { lang: 'en', pages: pages(n), options })),
    )
  }

  it('numbers booklet pages with front and back captions', () => {
    const o = createDefaultOptions()
    o.mode = 'booklet'
    render(o)
    const faces = $$('[data-pl-face]')
    expect(
      faces.map((f) => [...f.querySelectorAll('[data-pl-page]')].map((c) => c.textContent)),
    ).toEqual([
      ['8', '1'],
      ['2', '7'],
      ['6', '3'],
      ['4', '5'],
    ])
    expect(faces.map((f) => f.querySelector('figcaption')?.textContent)).toEqual([
      'Sheet 1, front',
      'Sheet 1, back',
      'Sheet 2, front',
      'Sheet 2, back',
    ])
  })

  it('marks faces the odd/even filter drops and counts the rest', () => {
    const o = createDefaultOptions()
    o.sides = 'even'
    render(o, 6)
    const faces = $$('[data-pl-face]')
    expect(faces.map((f) => f.getAttribute('data-excluded'))).toEqual([
      'true',
      'false',
      'true',
      'false',
    ])
    expect(faces[0]!.textContent).toContain('Not printed')
    expect($('[data-pl="more-faces"]')?.textContent).toBe('+2 more')
  })

  it('marks the label start cell and the used cells before it', () => {
    const o = createDefaultOptions()
    o.mode = 'labels'
    o.labels.startCell = 5
    render(o, 2)
    const face = $$('[data-pl-face]')[0]!
    expect(face.querySelectorAll('[data-pl-cell="skipped"]').length).toBe(4)
    expect(
      face.querySelector('[data-pl-cell="start"]')?.querySelector('[data-pl-page]')?.textContent,
    ).toBe('1')
  })

  it('names poster pieces', () => {
    const o = createDefaultOptions()
    o.mode = 'poster'
    render(o, 1)
    expect($$('[data-pl-face] figcaption').map((c) => c.textContent)).toEqual([
      'Page 1 · piece 1 of 4',
      'Page 1 · piece 2 of 4',
      'Page 1 · piece 3 of 4',
      'Page 1 · piece 4 of 4',
    ])
    expect($$('[data-pl-face] line').length).toBeGreaterThan(0)
  })

  it('shows the counting note while the pages are not known', () => {
    act(() =>
      root.render(
        createElement(PrintLayoutSchematic, {
          lang: 'en',
          pages: null,
          options: createDefaultOptions(),
        }),
      ),
    )
    expect(host.textContent).toContain('Counting pages…')
  })
})

describe('ArrangedPreview', () => {
  it('shows progress with cancel, then face images, and revokes them on unmount', () => {
    let next = 0
    const create = vi.fn(() => `blob:face-${++next}`)
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const onCancel = vi.fn()
    const onClose = vi.fn()
    act(() =>
      root.render(
        createElement(ArrangedPreview, {
          lang: 'en',
          state: { status: 'running', progress: { done: 2, total: 5 } },
          onCancel,
          onClose,
        }),
      ),
    )
    expect(host.textContent).toContain('2 of 5 pages')
    click($('button[data-pl="preview-cancel"]'))
    expect(onCancel).toHaveBeenCalled()

    const faces = [new Uint8Array([1]), new Uint8Array([2])]
    act(() =>
      root.render(
        createElement(ArrangedPreview, {
          lang: 'en',
          state: { status: 'done', faces },
          onCancel,
          onClose,
        }),
      ),
    )
    expect($$<HTMLImageElement>('img').map((i) => i.getAttribute('src'))).toEqual([
      'blob:face-1',
      'blob:face-2',
    ])
    act(() => root.unmount())
    expect(revoke).toHaveBeenCalledWith('blob:face-1')
    expect(revoke).toHaveBeenCalledWith('blob:face-2')
    root = createRoot(host)
  })

  it('runs the editor request from the panel and cancels it through the signal', async () => {
    let signal: AbortSignal | null = null
    let progress: ((p: { done: number; total: number }) => void) | null = null
    const onPreviewRequest = vi.fn(
      (_o: PrintLayoutOptions, ctx: { signal: AbortSignal; onProgress: typeof progress }) => {
        signal = ctx.signal
        progress = ctx.onProgress
        return new Promise<Uint8Array[]>(() => {})
      },
    )
    mount({ onPreviewRequest })
    click($('input[data-pl="grayscale"]'))
    click($('button[data-pl="preview"]'))
    expect(onPreviewRequest).toHaveBeenCalledTimes(1)
    act(() => progress!({ done: 1, total: 8 }))
    expect(host.textContent).toContain('1 of 8 pages')
    click($('button[data-pl="preview-cancel"]'))
    expect(signal!.aborted).toBe(true)
    expect($('button[data-pl="preview-cancel"]')).toBeNull()
  })

  it('drops a stale preview when an option changes', async () => {
    const onPreviewRequest = vi.fn(async () => [new Uint8Array([1])])
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    )
    mount({ onPreviewRequest })
    click($('input[data-pl="grayscale"]'))
    click($('button[data-pl="preview"]'))
    await flush()
    expect($$('img').length).toBe(1)
    click($('input[data-pl="reverse"]'))
    expect($$('img').length).toBe(0)
  })
})

describe('PrintLayoutPanel capability changes', () => {
  it('hides paper when the editor turns it off while open', () => {
    mount()
    rerender({ capabilities: { showPaperAndFit: false } })
    expect($('select[data-pl="paper"]')).toBeNull()
  })
})
