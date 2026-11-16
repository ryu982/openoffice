/** @vitest-environment jsdom */
// The print preview with the shared page layout panel attached. With every
// layout option at its default, Print and PDF go the way they always went:
// the preview's onPrint with the same arguments, nothing else. With an option
// on, Print and the panel's save gather the same pages the PDF export does and
// hand them to the advanced print layout; the layout diagram stands in for the
// pages while the faces differ from them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'
import { PrintPreview } from '../src/renderer/preview/PrintPreview'
import { layoutPageSizes } from '../src/renderer/preview/preview-model'
import type { HwpApi, PrintJob, PrintResult } from '../src/shared/ipc'

/** A4 portrait and landscape at 96 dpi, as the plugin reports page sizes. */
const PORTRAIT = { width: 793.7, height: 1122.5 }
const LANDSCAPE = { width: 1122.5, height: 793.7 }

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  URL.createObjectURL = () => 'blob:page'
  URL.revokeObjectURL = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  Object.assign(window, {
    hwpApi: { onLanguageChanged: () => () => undefined } as unknown as HwpApi,
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  delete (window as { hwpApi?: unknown }).hwpApi
  vi.unstubAllGlobals()
})

async function settle(turns = 6): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Three pages, by default two portrait around one landscape. */
function previewBridge(sizes = [PORTRAIT, LANDSCAPE, PORTRAIT]) {
  let revision = 0
  return {
    previewPage: vi.fn(async (page: number) => ({
      pageCount: sizes.length,
      page,
      svg: '<svg/>',
      ...sizes[page]!,
      margins: { left: 10, top: 10, right: 10, bottom: 10 },
    })),
    printPageSizes: vi.fn(async (from: number) => ({
      pageCount: sizes.length,
      from,
      sizes: sizes.slice(from),
    })),
    documentRevision: vi.fn(async () => revision),
    /** an edit the preview did not make (an AI call still landing) */
    edit: () => {
      revision += 1
    },
  }
}

/** The pages as the PDF export gathers them: the print profile's SVG, no preview marks. */
const JOB: PrintJob = {
  mode: 'pdf',
  pages: [
    { svg: '<svg>1</svg>', ...PORTRAIT },
    { svg: '<svg>2</svg>', ...LANDSCAPE },
    { svg: '<svg>3</svg>', ...PORTRAIT },
  ],
  images: [],
}

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

/** The job as the PDF export gathers it, counted. */
function gatherFake() {
  return vi.fn(async (onProgress: (done: number, total: number) => void) => {
    onProgress(3, 3)
    return JOB
  })
}

async function mount(props: Record<string, unknown> = {}) {
  const onPrint = vi.fn(async (): Promise<PrintResult> => ({ ok: true }))
  const printLayout = fakePrintLayout()
  const gatherJob = (props.gatherJob as ReturnType<typeof gatherFake> | undefined) ?? gatherFake()
  const all = {
    bridge: previewBridge(),
    initialPage: 0,
    printSignal: 0,
    onClose: vi.fn(),
    onPrint,
    onEditPage: vi.fn(async () => true),
    printLayout,
    gatherJob,
    ...props,
  }
  root = createRoot(container)
  const render = async (next: Record<string, unknown>) => {
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(PrintPreview, { ...all, ...next } as never),
        }),
      )
    })
    await settle()
  }
  await render({})
  return { onPrint, printLayout, gatherJob, render }
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!found) throw new Error(`no button ${text}`)
  return found
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

/** The size a face of the layout diagram gives its page. */
function faceBox(face: number): { width: number; height: number } {
  const svg = container.querySelector(`figure[data-pl-face="${face}"] svg`)
  if (!svg) throw new Error(`no face ${face}`)
  const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number)
  return { width: width!, height: height! }
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
  await settle()
}

describe('the print preview at default layout options', () => {
  it('prints through onPrint exactly as before', async () => {
    const { onPrint, printLayout, gatherJob } = await mount()
    await act(async () => button('Print…').click())
    await settle()
    expect(onPrint).toHaveBeenCalledTimes(1)
    expect(onPrint).toHaveBeenCalledWith('print', expect.any(Function))
    expect(gatherJob).not.toHaveBeenCalled()
    expect(printLayout.print).not.toHaveBeenCalled()
  })

  it('exports a PDF through onPrint exactly as before', async () => {
    const { onPrint } = await mount()
    await act(async () => button('Export as PDF…').click())
    await settle()
    expect(onPrint).toHaveBeenCalledTimes(1)
    expect(onPrint).toHaveBeenCalledWith('pdf', expect.any(Function))
  })

  it('prints through onPrint on a File > Print that arrives while it is open', async () => {
    const { onPrint, render } = await mount()
    await render({ printSignal: 1 })
    expect(onPrint).toHaveBeenCalledTimes(1)
    expect(onPrint).toHaveBeenCalledWith('print', expect.any(Function))
  })

  it('shows the pages, the panel at its defaults, and no arranged-print buttons', async () => {
    await mount()
    expect(container.querySelector('.hwp-preview-grid')).not.toBeNull()
    expect(container.querySelector('.hwp-preview-schematic')).toBeNull()
    expect(mode('single').checked).toBe(true)
    expect(pl('reverse').checked).toBe(false)
    // the preview has no paper field of its own: the shared one shows
    expect(container.querySelector('[data-pl="paper"]')).not.toBeNull()
    expect(container.querySelector('[data-pl="save-pdf"]')).toBeNull()
  })
})

describe('the print preview with a layout option on', () => {
  it('prints the pages of the PDF export through the advanced print layout', async () => {
    const { onPrint, printLayout, gatherJob } = await mount()
    await click(pl('reverse'))
    await click(button('Print…'))
    expect(onPrint).not.toHaveBeenCalled()
    expect(gatherJob).toHaveBeenCalledTimes(1)
    expect(printLayout.print).toHaveBeenCalledTimes(1)
    expect(printLayout.print).toHaveBeenCalledWith({
      options: expect.objectContaining({ reverse: true, mode: 'single' }),
      editor: JOB,
    })
  })

  it('takes the same route for a File > Print that arrives while it is open', async () => {
    const { onPrint, printLayout, render } = await mount()
    await click(pl('grayscale'))
    await render({ printSignal: 1 })
    expect(onPrint).not.toHaveBeenCalled()
    expect(printLayout.print).toHaveBeenCalledWith({
      options: expect.objectContaining({ grayscale: true }),
      editor: JOB,
    })
  })

  it('leaves the ordinary PDF export as it was', async () => {
    const { onPrint, printLayout } = await mount()
    await click(pl('reverse'))
    await click(button('Export as PDF…'))
    expect(onPrint).toHaveBeenCalledWith('pdf', expect.any(Function))
    expect(printLayout.savePdf).not.toHaveBeenCalled()
  })

  it('saves the arranged PDF from the panel and says so', async () => {
    const { onPrint, printLayout } = await mount()
    await click(pl('grayscale'))
    await click(pl('save-pdf'))
    expect(onPrint).not.toHaveBeenCalled()
    expect(printLayout.savePdf).toHaveBeenCalledWith({
      options: expect.objectContaining({ grayscale: true }),
      editor: JOB,
    })
    expect(container.textContent).toContain(strings.en.printLayoutSaved)
  })

  it('previews the arranged result from the same pages', async () => {
    const { printLayout, gatherJob } = await mount()
    await click(mode('nup'))
    await click(pl('preview'))
    expect(gatherJob).toHaveBeenCalledTimes(1)
    expect(printLayout.preview).toHaveBeenCalledWith({
      options: expect.objectContaining({ mode: 'nup' }),
      editor: JOB,
    })
    expect(container.querySelectorAll('.gs-pl-result-face')).toHaveLength(1)
  })

  it('shows why a print failed, and nothing for a canceled one', async () => {
    const { printLayout } = await mount()
    printLayout.print.mockResolvedValueOnce({ ok: false, error: 'no printer' })
    await click(pl('reverse'))
    await click(button('Print…'))
    expect(pl('job-error').textContent).toBe(`${strings.en.printFailed} no printer`)

    printLayout.print.mockResolvedValueOnce({ ok: false, aborted: true })
    await click(button('Print…'))
    expect(container.querySelector('[data-pl="job-error"]')).toBeNull()
  })

  it('swaps the pages for the layout diagram while the faces differ from them', async () => {
    await mount()
    await click(pl('grayscale'))
    // gray alone keeps the faces as the pages: the preview stays
    expect(container.querySelector('.hwp-preview-grid')).not.toBeNull()
    await click(mode('nup'))
    expect(container.querySelector('.hwp-preview-grid')).toBeNull()
    const schematic = container.querySelector('.hwp-preview-schematic')
    expect(schematic).not.toBeNull()
    // three pages two to a sheet: two faces
    expect(schematic!.querySelectorAll('figure[data-pl-face]')).toHaveLength(2)
    await click(mode('single'))
    expect(container.querySelector('.hwp-preview-grid')).not.toBeNull()
  })

  it('draws the diagram with each page at the size the preview drew it', async () => {
    await mount()
    await click(pl('reverse'))
    // the preview drew pages 1 (portrait) and 2 (landscape); faces keep their numbers
    expect(faceBox(1).width).toBeLessThan(faceBox(1).height)
    expect(faceBox(2).width).toBeGreaterThan(faceBox(2).height)
  })

  it('draws the diagram with every page at its print size, drawn or not', async () => {
    // the landscape page is the last: the preview draws pages 1 and 2 only
    const bridge = previewBridge([PORTRAIT, PORTRAIT, LANDSCAPE])
    await mount({ bridge })
    await click(pl('reverse'))
    expect(bridge.previewPage).not.toHaveBeenCalledWith(2)
    expect(bridge.printPageSizes).toHaveBeenCalled()
    expect(faceBox(2).width).toBeLessThan(faceBox(2).height)
    expect(faceBox(3).width).toBeGreaterThan(faceBox(3).height)
  })

  it('falls back to the drawn pages’ sizes when the print sizes cannot be read', async () => {
    const bridge = previewBridge([PORTRAIT, PORTRAIT, LANDSCAPE])
    bridge.printPageSizes.mockRejectedValue(new Error('no plugin'))
    await mount({ bridge })
    await click(pl('reverse'))
    // page 3 is not drawn: it takes the size of page 2
    expect(faceBox(3).width).toBeLessThan(faceBox(3).height)
  })

  it('gathers the pages once for a preview, a print and a save', async () => {
    const { printLayout, gatherJob } = await mount()
    await click(mode('nup'))
    await click(pl('preview'))
    await click(button('Print…'))
    await click(pl('save-pdf'))
    expect(printLayout.preview).toHaveBeenCalledTimes(1)
    expect(printLayout.print).toHaveBeenCalledTimes(1)
    expect(printLayout.savePdf).toHaveBeenCalledTimes(1)
    expect(gatherJob).toHaveBeenCalledTimes(1)
  })

  it('gathers again when the document changed, and in a new preview', async () => {
    const bridge = previewBridge()
    const { gatherJob } = await mount({ bridge })
    await click(pl('reverse'))
    await click(button('Print…'))
    bridge.edit()
    await click(button('Print…'))
    expect(gatherJob).toHaveBeenCalledTimes(2)

    act(() => root!.unmount())
    root = null
    const again = await mount({ bridge, gatherJob })
    expect(again.gatherJob).toBe(gatherJob)
    await click(pl('reverse'))
    await click(button('Print…'))
    expect(gatherJob).toHaveBeenCalledTimes(3)
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

describe('the page sizes of the layout diagram', () => {
  it('are in points, a page not drawn yet taking the nearest drawn size', () => {
    const drawn = new Map([
      [1, { width: 96, height: 192 }],
      [3, { width: 192, height: 96 }],
    ])
    expect(layoutPageSizes(5, drawn, { width: 10, height: 10 })).toEqual([
      { widthPt: 72, heightPt: 144 },
      { widthPt: 72, heightPt: 144 },
      { widthPt: 72, heightPt: 144 },
      { widthPt: 144, heightPt: 72 },
      { widthPt: 144, heightPt: 72 },
    ])
    expect(layoutPageSizes(2, new Map(), { width: 96, height: 96 })).toEqual([
      { widthPt: 72, heightPt: 72 },
      { widthPt: 72, heightPt: 72 },
    ])
  })

  it('are the print sizes of every page when the plugin measured them all', () => {
    const drawn = new Map([[0, { width: 96, height: 192 }]])
    const exact = [
      { width: 96, height: 192 },
      { width: 192, height: 96 },
    ]
    expect(layoutPageSizes(2, drawn, { width: 10, height: 10 }, exact)).toEqual([
      { widthPt: 72, heightPt: 144 },
      { widthPt: 144, heightPt: 72 },
    ])
    // a list of another length is from another document: the drawn pages answer
    expect(layoutPageSizes(3, drawn, { width: 10, height: 10 }, exact)).toHaveLength(3)
    expect(layoutPageSizes(3, drawn, { width: 10, height: 10 }, exact)[1]).toEqual({
      widthPt: 72,
      heightPt: 144,
    })
  })
})

describe('the arranged save notice', () => {
  it('is in every language, and translated outside English', () => {
    for (const lang of LANGS) {
      expect(strings[lang].printLayoutSaved, lang).toMatch(/\S/)
      if (lang !== 'en') {
        expect(strings[lang].printLayoutSaved, lang).not.toBe(strings.en.printLayoutSaved)
      }
    }
    expect(strings.ko.printLayoutSaved).toBe('배치한 결과를 PDF로 저장했습니다.')
  })
})
