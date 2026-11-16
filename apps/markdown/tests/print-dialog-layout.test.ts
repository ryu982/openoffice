/** @vitest-environment jsdom */
// The print dialog with the shared page layout panel attached. With every
// layout option at its default, Print takes the route it always took: the
// system dialog through `printDocument`, with the same request as before. The
// new "Selection" range prints only the selection's own print HTML, and with a
// layout option on, Print and the panel's save go to the advanced print layout
// with the same HTML and paper the preview used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'
import { PrintPreviewDialog } from '../src/renderer/print/PrintPreviewDialog'
import { MARKDOWN_PRINT_OPTIONS } from '../src/shared/print-options'
import type { MarkdownApi } from '../src/shared/ipc'

/** pdf.js stand-in: an A4 document whose page count each test sets. */
const pdfjs = vi.hoisted(() => ({ pages: 3 }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => {
    const doc = {
      numPages: pdfjs.pages,
      loadingTask: { destroy: async () => {} },
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 595.28 * scale,
          height: 841.89 * scale,
        }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      }),
    }
    return { promise: Promise.resolve(doc) }
  },
}))

const HTML = '<!doctype html><html><body><p>whole note</p></body></html>'
const SELECTION_HTML = '<!doctype html><html><body><p>only this</p></body></html>'
const PAPER = { ...MARKDOWN_PRINT_OPTIONS, pageSize: 'A4', landscape: false }

let container: HTMLElement
let root: Root | null = null

function fakePrintLayout() {
  return {
    preview: vi.fn(async () => ({
      ok: true as const,
      faces: [{ png: new Uint8Array([1]), widthPt: 595, heightPt: 842 }],
    })),
    print: vi.fn(async (): Promise<unknown> => ({ ok: true })),
    savePdf: vi.fn(async (): Promise<unknown> => ({ ok: true, path: 'F:/out/arranged.pdf' })),
    cancel: vi.fn(async () => {}),
    onProgress: vi.fn(() => () => {}),
    getLabelSpec: vi.fn(async () => null),
    setLabelSpec: vi.fn(async () => ({ ok: false, error: 'not used' })),
  }
}

let api: {
  renderPrintPreview: ReturnType<typeof vi.fn>
  printDocument: ReturnType<typeof vi.fn>
  printLayout: ReturnType<typeof fakePrintLayout>
}

beforeEach(() => {
  pdfjs.pages = 3
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  api = {
    renderPrintPreview: vi.fn(async () => ({ ok: true, pdf: new Uint8Array([37, 80, 68, 70]) })),
    printDocument: vi.fn(async () => ({ ok: true })),
    printLayout: fakePrintLayout(),
  }
  Object.assign(window, {
    markdownApi: {
      onLanguageChanged: () => () => undefined,
      ...api,
    } as unknown as MarkdownApi,
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  delete (window as { markdownApi?: unknown }).markdownApi
  vi.unstubAllGlobals()
})

async function settle(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(props: { selectionHtml?: string | null } = {}) {
  const onClose = vi.fn()
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(PrintPreviewDialog, {
          html: HTML,
          selectionHtml: props.selectionHtml ?? null,
          title: 'Notes',
          onClose,
        }),
      }),
    )
  })
  await settle()
  return { onClose }
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!found) throw new Error(`no button ${text}`)
  return found
}

function radio(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((l) => l.textContent === label)
  const input = found?.querySelector<HTMLInputElement>('input[type="radio"]')
  if (!input) throw new Error(`no range ${label}`)
  return input
}

function pl(name: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`[data-pl="${name}"]`)
  if (!found) throw new Error(`no ${name}`)
  return found
}

function mode(value: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`[data-pl="mode"][value="${value}"]`)
  if (!found) throw new Error(`no mode ${value}`)
  return found
}

const en = strings.en

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
  await settle()
}

/** Chooses the typed range and types it, as a user does. */
async function customRange(value: string): Promise<void> {
  await click(radio(en.appPrintPreviewCustom))
  const input = container.querySelector<HTMLInputElement>('.md-print-range')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

describe('the print dialog at default layout options', () => {
  it('prints the whole note through the system dialog exactly as before', async () => {
    const { onClose } = await mount()
    await click(button(en.appPrintPreviewPrint))
    expect(api.printDocument).toHaveBeenCalledTimes(1)
    expect(api.printDocument).toHaveBeenCalledWith({ html: HTML, pages: null, options: PAPER })
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('prints the current page and a typed range as before', async () => {
    await mount()
    await click(radio(en.appPrintPreviewCurrent))
    await click(button(en.appPrintPreviewPrint))
    expect(api.printDocument).toHaveBeenLastCalledWith({
      html: HTML,
      pages: { from: 1, to: 1 },
      options: PAPER,
    })
    await customRange('2-3')
    await click(button(en.appPrintPreviewPrint))
    expect(api.printDocument).toHaveBeenLastCalledWith({
      html: HTML,
      pages: { from: 2, to: 3 },
      options: PAPER,
    })
    expect(api.printLayout.print).not.toHaveBeenCalled()
  })

  it('draws the preview of the whole note once, with the paper of the dialog', async () => {
    await mount()
    expect(api.renderPrintPreview).toHaveBeenCalledTimes(1)
    expect(api.renderPrintPreview).toHaveBeenCalledWith({ html: HTML, options: PAPER })
  })

  it('shows the panel at its defaults without its own paper and fit fields', async () => {
    await mount()
    expect(mode('single').checked).toBe(true)
    expect(pl('reverse').checked).toBe(false)
    // the dialog's own paper and orientation decide the job's pages
    expect(container.querySelector('[data-pl="paper"]')).toBeNull()
    expect(container.querySelector('[data-pl="fit"]')).toBeNull()
    expect(container.querySelector('[data-pl="save-pdf"]')).toBeNull()
    expect(container.querySelector('.md-print-schematic')).toBeNull()
  })
})

describe('the Selection range', () => {
  it('cannot be chosen without a selection', async () => {
    await mount({ selectionHtml: null })
    expect(radio(en.appPrintPreviewSelection).disabled).toBe(true)
  })

  it('previews and prints only the selection through the system dialog', async () => {
    await mount({ selectionHtml: SELECTION_HTML })
    const selection = radio(en.appPrintPreviewSelection)
    expect(selection.disabled).toBe(false)
    await click(selection)
    expect(api.renderPrintPreview).toHaveBeenLastCalledWith({
      html: SELECTION_HTML,
      options: PAPER,
    })
    await click(button(en.appPrintPreviewPrint))
    // its own document from page 1: no page range
    expect(api.printDocument).toHaveBeenCalledWith({
      html: SELECTION_HTML,
      pages: null,
      options: PAPER,
    })
    expect(api.printLayout.print).not.toHaveBeenCalled()
  })
})

describe('the print dialog with a layout option on', () => {
  it('prints the preview PDF of the same HTML and paper through the advanced layout', async () => {
    await mount()
    await click(pl('reverse'))
    await click(button(en.appPrintPreviewPrint))
    expect(api.printDocument).not.toHaveBeenCalled()
    expect(api.printLayout.print).toHaveBeenCalledTimes(1)
    expect(api.printLayout.print).toHaveBeenCalledWith({
      options: expect.objectContaining({ reverse: true, mode: 'single' }),
      editor: { html: HTML, pages: null, options: PAPER, name: 'Notes' },
    })
  })

  it('carries the selection or the page range into the job', async () => {
    await mount({ selectionHtml: SELECTION_HTML })
    await click(pl('grayscale'))
    await click(radio(en.appPrintPreviewSelection))
    await click(button(en.appPrintPreviewPrint))
    expect(api.printLayout.print).toHaveBeenLastCalledWith({
      options: expect.objectContaining({ grayscale: true }),
      editor: { html: SELECTION_HTML, pages: null, options: PAPER, name: 'Notes' },
    })
    await customRange('2-3')
    await click(button(en.appPrintPreviewPrint))
    expect(api.printLayout.print).toHaveBeenLastCalledWith({
      options: expect.objectContaining({ grayscale: true }),
      editor: { html: HTML, pages: { from: 2, to: 3 }, options: PAPER, name: 'Notes' },
    })
    expect(api.printDocument).not.toHaveBeenCalled()
  })

  it('saves the arranged PDF from the panel and says so', async () => {
    await mount()
    await click(pl('grayscale'))
    await click(pl('save-pdf'))
    expect(api.printLayout.savePdf).toHaveBeenCalledWith({
      options: expect.objectContaining({ grayscale: true }),
      editor: { html: HTML, pages: null, options: PAPER, name: 'Notes' },
    })
    expect(container.textContent).toContain(en.appPrintPreviewLayoutSaved)
  })

  it('previews the arranged result from the same job', async () => {
    await mount()
    await click(mode('nup'))
    await click(pl('preview'))
    expect(api.printLayout.preview).toHaveBeenCalledWith({
      options: expect.objectContaining({ mode: 'nup' }),
      editor: { html: HTML, pages: null, options: PAPER, name: 'Notes' },
    })
  })

  it('shows why a print failed, and nothing for a canceled one', async () => {
    await mount()
    api.printLayout.print.mockResolvedValueOnce({ ok: false, error: 'no printer' })
    await click(pl('reverse'))
    await click(button(en.appPrintPreviewPrint))
    expect(pl('job-error').textContent).toBe(`${en.appPrintPreviewPrintFailed} no printer`)

    api.printLayout.print.mockResolvedValueOnce({ ok: false, aborted: true })
    await click(button(en.appPrintPreviewPrint))
    expect(container.querySelector('[data-pl="job-error"]')).toBeNull()
  })

  it('swaps the page for the layout diagram while the faces differ from the pages', async () => {
    await mount()
    const canvas = container.querySelector<HTMLCanvasElement>('.md-print-canvas')!
    await click(pl('grayscale'))
    // gray alone keeps the faces as the pages: the preview stays
    expect(container.querySelector('.md-print-schematic')).toBeNull()
    expect(canvas.hidden).toBe(false)
    await click(mode('nup'))
    const schematic = container.querySelector('.md-print-schematic')
    expect(schematic).not.toBeNull()
    expect(canvas.hidden).toBe(true)
    // three pages two to a sheet: two faces
    expect(schematic!.querySelectorAll('figure[data-pl-face]')).toHaveLength(2)
    await click(mode('single'))
    expect(container.querySelector('.md-print-schematic')).toBeNull()
    expect(canvas.hidden).toBe(false)
  })

  it('counts the pages of the chosen range in the diagram, without drawing the preview again', async () => {
    pdfjs.pages = 5
    await mount()
    await click(mode('nup'))
    expect(
      container.querySelectorAll('.md-print-schematic figure[data-pl-face]').length,
    ).toBeGreaterThan(0)
    await customRange('2-3')
    // two pages two to a sheet: one face
    expect(container.querySelectorAll('.md-print-schematic figure[data-pl-face]')).toHaveLength(1)
    await click(pl('reverse'))
    expect(api.renderPrintPreview).toHaveBeenCalledTimes(1)
  })

  it('starts from the defaults every time it opens', async () => {
    await mount()
    await click(pl('reverse'))
    await click(mode('booklet'))
    expect(pl('reverse').checked).toBe(true)
    act(() => root!.unmount())
    root = null
    await mount()
    expect(pl('reverse').checked).toBe(false)
    expect(mode('single').checked).toBe(true)
  })
})

describe('the print dialog strings', () => {
  const KEYS = [
    'appPrintPreviewSelection',
    'appPrintPreviewPrintFailed',
    'appPrintPreviewSaveFailed',
    'appPrintPreviewLayoutSaved',
  ] as const

  it('are in every language, and translated outside English', () => {
    const all: Record<string, Record<string, string>> = strings
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(all[lang]?.[key], `${lang}:${key}`).toMatch(/\S/)
        if (lang !== 'en') expect(all[lang]![key], `${lang}:${key}`).not.toBe(all.en![key])
      }
    }
    expect(strings.ko.appPrintPreviewSelection).toBe('선택 영역')
    expect(strings.ko.appPrintPreviewLayoutSaved).toBe('배치한 결과를 PDF로 저장했습니다.')
  })
})
