/**
 * Advanced print in the slides print dialog (decision 0141): defaults keep the
 * current `slides:print` call, the "selected slides" range, layout modes only
 * for full-page slides, and any option on sending the same print op down the
 * shared print layout route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RenderSlide } from '@genoffice/pptx-render'
import { LANGS } from '@genoffice/i18n'

vi.mock('../src/renderer/export-render', () => ({
  renderSlidesToPngBase64: vi.fn(async (slides: unknown[]) =>
    slides.map((_s, i) => ['AAAA', 'BBBB', 'CCCC', 'DDDD'][i] ?? 'EEEE'),
  ),
}))

import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { appStrings } from '../src/renderer/i18n/strings-app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PNGS = ['AAAA', 'BBBB', 'CCCC', 'DDDD']

function deck(hidden: number[] = []): RenderSlide[] {
  return PNGS.map(
    (_p, i) => ({ widthPx: 1600, heightPx: 900, hidden: hidden.includes(i) }) as never,
  )
}

interface Api {
  getNotes: ReturnType<typeof vi.fn>
  printSlides: ReturnType<typeof vi.fn>
  onLanguageChanged: ReturnType<typeof vi.fn>
  printLayout: {
    preview: ReturnType<typeof vi.fn>
    print: ReturnType<typeof vi.fn>
    savePdf: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    onProgress: ReturnType<typeof vi.fn>
    getLabelSpec: ReturnType<typeof vi.fn>
    setLabelSpec: ReturnType<typeof vi.fn>
  }
}

let api: Api
const roots: Array<{ root: Root; container: HTMLElement }> = []

beforeEach(() => {
  api = {
    getNotes: vi.fn(async (i: number) => `note ${i + 1}`),
    printSlides: vi.fn(async () => ({ ok: true })),
    onLanguageChanged: vi.fn(() => () => {}),
    printLayout: {
      preview: vi.fn(async () => ({ ok: true, faces: [] })),
      print: vi.fn(async () => ({ ok: true })),
      savePdf: vi.fn(async () => ({ ok: true, canceled: true })),
      cancel: vi.fn(async () => {}),
      onProgress: vi.fn(() => () => {}),
      getLabelSpec: vi.fn(async () => null),
      setLabelSpec: vi.fn(async () => ({ ok: false, error: 'x' })),
    },
  }
  ;(window as unknown as { slidesApi: Api }).slidesApi = api
  URL.createObjectURL = vi.fn(() => 'blob:slide')
  URL.revokeObjectURL = vi.fn()
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve())
}

async function mount(
  props: { selectedSlides?: number[]; current?: number; hidden?: number[] } = {},
) {
  const onClose = vi.fn()
  const setStatus = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'ko',
        children: createElement(PrintDialog, {
          slides: deck(props.hidden),
          images: new Map(),
          current: props.current ?? 0,
          selectedSlides: props.selectedSlides ?? [props.current ?? 0],
          onClose,
          setStatus,
        }),
      }),
    )
  })
  roots.push({ root, container })
  await flush()
  return { container, onClose, setStatus }
}

const q = <T extends Element = HTMLInputElement>(c: HTMLElement, sel: string) =>
  c.querySelector(sel) as T | null

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => (el as HTMLElement).click())
  await flush()
}

async function choose(el: Element | null, value: string) {
  expect(el).not.toBeNull()
  const select = el as HTMLSelectElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

const printButton = (c: HTMLElement) => q<HTMLButtonElement>(c, '.modal-actions button.primary')

describe('slides print dialog, default options', () => {
  it('prints full slides through slides:print with today’s arguments', async () => {
    const { container, onClose } = await mount()
    await click(printButton(container))
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(api.printSlides).toHaveBeenCalledTimes(1)
    expect(api.printSlides.mock.calls[0]![0]).toStrictEqual({
      pngsBase64: PNGS,
      widthPx: 1600,
      heightPx: 900,
      layout: 'full',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps handouts, notes, orientation, frame and hidden slides as before', async () => {
    const { container } = await mount({ hidden: [1] })
    await click(q(container, 'input[data-layout="notes"]'))
    await click(q(container, 'input[name="print-orientation"][value="landscape"]'))
    await click(printButton(container))
    expect(api.printSlides.mock.calls[0]![0]).toStrictEqual({
      pngsBase64: ['AAAA', 'CCCC', 'DDDD'],
      widthPx: 1600,
      heightPx: 900,
      layout: 'notes',
      notes: ['note 1', 'note 3', 'note 4'],
      orientation: 'landscape',
    })

    const second = await mount()
    await click(q(second.container, 'input[name="print-frame"]'))
    await click(printButton(second.container))
    expect(api.printSlides.mock.calls[1]![0]).toStrictEqual({
      pngsBase64: PNGS,
      widthPx: 1600,
      heightPx: 900,
      layout: 'full',
      frame: true,
    })
    expect(api.printLayout.print).not.toHaveBeenCalled()
  })
})

describe('"selected slides" range', () => {
  it('is offered only with two or more slides chosen in the rail', async () => {
    const one = await mount({ selectedSlides: [2], current: 2 })
    expect(q(one.container, 'input[data-range="selected"]')!.disabled).toBe(true)
    const two = await mount({ selectedSlides: [0, 2], current: 0 })
    expect(q(two.container, 'input[data-range="selected"]')!.disabled).toBe(false)
  })

  it('prints the chosen slides through slides:print as a range', async () => {
    const { container } = await mount({ selectedSlides: [1, 3], current: 1 })
    await click(q(container, 'input[data-range="selected"]'))
    await click(printButton(container))
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(api.printSlides.mock.calls[0]![0]).toStrictEqual({
      pngsBase64: ['BBBB', 'DDDD'],
      widthPx: 1600,
      heightPx: 900,
      layout: 'full',
    })
  })
})

describe('layout modes follow the slide print layout', () => {
  it('handouts keep one page per sheet and say why', async () => {
    const { container } = await mount()
    await click(q(container, 'input[data-pl="mode"][value="nup"]'))
    expect(q(container, 'input[data-pl="mode"][value="nup"]')!.checked).toBe(true)

    await click(q(container, 'input[data-layout="handout3"]'))
    expect(q(container, '[data-pl="blocked"]')!.textContent).toBe(
      appStrings.ko.appPrintLayoutBlocked,
    )
    expect(q(container, 'input[data-pl="mode"][value="single"]')!.checked).toBe(true)
    expect(q(container, 'input[data-pl="mode"][value="nup"]')!.disabled).toBe(true)
    expect(q(container, 'input[data-pl="mode"][value="booklet"]')!.disabled).toBe(true)
    // sides, reverse, grayscale and dpi stay available
    expect(q(container, 'input[data-pl="sides"][value="odd"]')!.disabled).toBe(false)
    expect(q(container, 'input[data-pl="reverse"]')!.disabled).toBe(false)
    expect(q(container, 'input[data-pl="grayscale"]')!.disabled).toBe(false)
    expect(q<HTMLSelectElement>(container, 'select[data-pl="dpi"]')!.disabled).toBe(false)

    // the forced mode means defaults again: the current print path
    await click(printButton(container))
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(api.printSlides.mock.calls[0]![0]).toMatchObject({ layout: 'handout3' })
  })

  it('full-page slides allow every mode', async () => {
    const { container } = await mount()
    expect(q(container, '[data-pl="blocked"]')).toBeNull()
    for (const m of ['single', 'nup', 'booklet', 'poster', 'labels']) {
      expect(q(container, `input[data-pl="mode"][value="${m}"]`)!.disabled).toBe(false)
    }
  })

  it('handouts with odd sides go down the new route', async () => {
    const { container } = await mount()
    await click(q(container, 'input[data-layout="handout2"]'))
    await click(q(container, 'input[data-pl="sides"][value="odd"]'))
    await click(printButton(container))
    expect(api.printSlides).not.toHaveBeenCalled()
    expect(api.printLayout.print).toHaveBeenCalledTimes(1)
    const req = api.printLayout.print.mock.calls[0]![0]
    expect(req.options).toMatchObject({ mode: 'single', sides: 'odd' })
    expect(req.editor).toStrictEqual({
      pngsBase64: PNGS,
      widthPx: 1600,
      heightPx: 900,
      layout: 'handout2',
      orientation: 'portrait',
    })
  })
})

describe('options on', () => {
  it('sends the same print op as the job, with the panel options', async () => {
    const { container, onClose } = await mount({ selectedSlides: [0, 2] })
    await click(q(container, 'input[data-range="selected"]'))
    await click(q(container, 'input[name="print-frame"]'))
    await click(q(container, 'input[data-pl="mode"][value="nup"]'))
    await click(printButton(container))
    expect(api.printSlides).not.toHaveBeenCalled()
    const req = api.printLayout.print.mock.calls[0]![0]
    expect(req.options).toMatchObject({ mode: 'nup', sides: 'all', grayscale: false })
    expect(req.editor).toStrictEqual({
      pngsBase64: ['AAAA', 'CCCC'],
      widthPx: 1600,
      heightPx: 900,
      layout: 'full',
      frame: true,
    })
    // no in-app printer: the system dialog
    expect(req.job).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })

  it('a dpi alone takes the new route, keeping the slide preview', async () => {
    const { container } = await mount()
    await choose(q(container, 'select[data-pl="dpi"]'), '300')
    expect(q(container, '.print-preview-pane iframe')).not.toBeNull()
    await click(printButton(container))
    expect(api.printSlides).not.toHaveBeenCalled()
    expect(api.printLayout.print.mock.calls[0]![0].options).toMatchObject({ dpi: 300 })
  })

  it('swaps the preview for the layout diagram while faces change', async () => {
    const { container } = await mount()
    expect(q(container, '.print-preview-pane iframe')).not.toBeNull()
    await click(q(container, 'input[data-pl="mode"][value="booklet"]'))
    expect(q(container, '.print-preview-pane iframe')).toBeNull()
    expect(q(container, '.print-preview-pane .gs-pl-schematic')).not.toBeNull()
    await click(q(container, 'input[data-pl="mode"][value="single"]'))
    expect(q(container, '.print-preview-pane iframe')).not.toBeNull()
  })

  it('keeps the dialog open when the system dialog is closed', async () => {
    api.printLayout.print.mockResolvedValueOnce({ ok: true, canceled: true })
    const { container, onClose } = await mount()
    await click(q(container, 'input[data-pl="reverse"]'))
    await click(printButton(container))
    expect(api.printLayout.print).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows why the job failed and stays open', async () => {
    api.printLayout.print.mockResolvedValueOnce({ ok: false, error: 'disk full' })
    const { container, onClose } = await mount()
    await click(q(container, 'input[data-pl="grayscale"]'))
    await click(printButton(container))
    expect(onClose).not.toHaveBeenCalled()
    expect(q(container, '[data-pl="job-error"]')!.textContent).toContain('disk full')
  })

  it('saves the arranged PDF with the same op', async () => {
    api.printLayout.savePdf.mockResolvedValueOnce({ ok: true, path: 'C:/out.pdf' })
    const { container, setStatus } = await mount()
    await click(q(container, 'input[data-pl="grayscale"]'))
    await click(q(container, '[data-pl="save-pdf"]'))
    const req = api.printLayout.savePdf.mock.calls[0]![0]
    expect(req.options).toMatchObject({ grayscale: true })
    expect(req.editor).toStrictEqual({
      pngsBase64: PNGS,
      widthPx: 1600,
      heightPx: 900,
      layout: 'full',
    })
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('C:/out.pdf'))
  })

  it('starts from the defaults every time the dialog opens', async () => {
    const first = await mount()
    await click(q(first.container, 'input[data-pl="grayscale"]'))
    expect(q(first.container, 'input[data-pl="grayscale"]')!.checked).toBe(true)
    const second = await mount()
    expect(q(second.container, 'input[data-pl="grayscale"]')!.checked).toBe(false)
  })
})

describe('strings', () => {
  it('every language has the selected-slides range and the blocked reason', () => {
    for (const lang of LANGS) {
      const s = appStrings[lang]
      expect(s.appPrintRangeSelected, `${lang}.appPrintRangeSelected`).toBeTruthy()
      expect(s.appPrintLayoutBlocked, `${lang}.appPrintLayoutBlocked`).toBeTruthy()
      if (lang !== 'en') {
        expect(s.appPrintRangeSelected, lang).not.toBe(appStrings.en.appPrintRangeSelected)
        expect(s.appPrintLayoutBlocked, lang).not.toBe(appStrings.en.appPrintLayoutBlocked)
      }
    }
    expect(appStrings.ko.appPrintRangeSelected).toBe('고른 슬라이드')
  })
})
