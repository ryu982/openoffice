/**
 * The diagram's print dialog against a fake draw.io and a fake preload. At
 * the defaults Print is the print as it always was (the same request to
 * `diagram:print`); the current page prints that page only; any layout option
 * sends the same light sheets down the arranged route. The layout diagram
 * reads the page formats only, never pictures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LANGS, type Lang } from '@genoffice/i18n'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import type { PrintLayoutBridge } from '@genoffice/electron-utils/print-layout-bridge'
import type { BridgeOp, BridgeOps } from '../src/shared/bridge-protocol'
import type { DiagramPrintJob, PrintDiagramRequest, PrintResult } from '../src/shared/ipc'
import { sheetSizePt } from '../src/shared/print-sizes'
import { plainPrint, printSheetSizesIn } from '../src/renderer/document/print-pages'
import { DiagramPrintDialog } from '../src/renderer/PrintDialog'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { appStrings } from '../src/renderer/i18n/strings-app'

/** Two pages: A4 portrait (p1), then a landscape page (p2) on screen. */
function fakeClient() {
  const requests: Array<{ op: string; args: unknown }> = []
  const client = {
    requests,
    request: async <K extends BridgeOp>(
      op: K,
      args: BridgeOps[K]['request'],
    ): Promise<BridgeOps[K]['reply']> => {
      requests.push({ op, args })
      if (op === 'pageInfo') {
        return {
          pages: [
            { id: 'p1', name: 'One', pageWidth: 827, pageHeight: 1169 },
            { id: 'p2', name: 'Two', pageWidth: 1169, pageHeight: 827 },
          ],
          currentPage: 'p2',
        } as BridgeOps[K]['reply']
      }
      if (op === 'pageSvg') {
        const { pageId, theme } = args as { pageId: string; theme: string }
        return {
          svg: `<svg id="${pageId}" data-theme="${theme}"></svg>`,
          width: pageId === 'p1' ? 400 : 300,
          height: pageId === 'p1' ? 300 : 200,
        } as BridgeOps[K]['reply']
      }
      throw new Error(`unexpected ${op}`)
    },
  }
  return client
}

/** The sheets today's print sends for each page: light SVGs at each page format. */
const SHEET_P1 = {
  svg: '<svg id="p1" data-theme="light"></svg>',
  width: 400,
  height: 300,
  pageWidth: 827,
  pageHeight: 1169,
}
const SHEET_P2 = {
  svg: '<svg id="p2" data-theme="light"></svg>',
  width: 300,
  height: 200,
  pageWidth: 1169,
  pageHeight: 827,
}

function fakeBridge(): PrintLayoutBridge<DiagramPrintJob> &
  Record<string, ReturnType<typeof vi.fn>> {
  return {
    preview: vi.fn(async () => ({ ok: true as const, faces: [] })),
    print: vi.fn(async () => ({ ok: true as const })),
    savePdf: vi.fn(async () => ({ ok: true as const, path: 'C:/Out/Flow.pdf' })),
    cancel: vi.fn(async () => {}),
    onProgress: vi.fn(() => () => {}),
    getLabelSpec: vi.fn(async () => null),
    setLabelSpec: vi.fn(async () => ({ ok: true as const })),
  }
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;(window as unknown as { diagramApi: unknown }).diagramApi = {
    onLanguageChanged: () => () => {},
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const click = (el: Element | null) => act(() => (el as HTMLElement).click())
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function open(lang: Lang = 'en') {
  const client = fakeClient()
  const printLayout = fakeBridge()
  const print = vi.fn(async (_request: PrintDiagramRequest): Promise<PrintResult> => ({ ok: true }))
  const onClose = vi.fn()
  const onMessage = vi.fn()
  act(() =>
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DiagramPrintDialog, {
          client,
          api: { print, printLayout },
          title: 'Flow',
          onClose,
          onMessage,
        }),
      ),
    ),
  )
  await settle()
  return { client, printLayout, print, onClose, onMessage }
}

const range = (value: 'all' | 'current') =>
  host.querySelector<HTMLInputElement>(`input[data-pl="range"][value="${value}"]`)

describe('the print as it always was', () => {
  it('sends every page as the same light sheets with the diagram name', async () => {
    const api = { print: vi.fn(async (): Promise<PrintResult> => ({ ok: true })) }
    const client = fakeClient()
    expect(await plainPrint(api, client, 'all', 'Flow')).toEqual({ ok: true })
    expect(api.print).toHaveBeenCalledTimes(1)
    expect(api.print).toHaveBeenCalledWith({ pages: [SHEET_P1, SHEET_P2], title: 'Flow' })
  })

  it('is what Print does when nothing in the dialog changed', async () => {
    const { print, printLayout, onClose, client } = await open()
    expect(range('all')!.checked).toBe(true)
    click($('button[data-pl="print"]'))
    await settle()
    expect(onClose).toHaveBeenCalled()
    expect(print).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith({ pages: [SHEET_P1, SHEET_P2], title: 'Flow' })
    expect(printLayout.print).not.toHaveBeenCalled()
    // pictures in light colors whatever the app theme
    const themes = client.requests.filter((r) => r.op === 'pageSvg').map((r) => r.args)
    expect(themes).toEqual([
      { pageId: 'p1', theme: 'light' },
      { pageId: 'p2', theme: 'light' },
    ])
  })

  it('prints the page on screen only when that is the range', async () => {
    const { print, printLayout } = await open()
    click(range('current'))
    await settle()
    click($('button[data-pl="print"]'))
    await settle()
    expect(print).toHaveBeenCalledWith({ pages: [SHEET_P2], title: 'Flow' })
    expect(printLayout.print).not.toHaveBeenCalled()
  })

  it('reports a failed print in the status line', async () => {
    const { print, onMessage } = await open()
    print.mockResolvedValueOnce({ ok: false, error: 'no printer' })
    click($('button[data-pl="print"]'))
    await settle()
    expect(onMessage).toHaveBeenCalledWith('Printing failed: no printer')
  })
})

describe('the arranged route', () => {
  it('takes the same sheets to the job PDF once an option is on', async () => {
    const { print, printLayout, onClose } = await open()
    click($('input[data-pl="reverse"]'))
    click($('button[data-pl="print"]'))
    await settle()
    const expected = createDefaultOptions()
    expected.reverse = true
    expect(print).not.toHaveBeenCalled()
    expect(printLayout.print).toHaveBeenCalledWith({
      options: expected,
      editor: { pages: [SHEET_P1, SHEET_P2], title: 'Flow' },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('arranges the page on screen only when that is the range', async () => {
    const { printLayout } = await open()
    click(range('current'))
    await settle()
    click($('input[data-pl="grayscale"]'))
    click($('button[data-pl="print"]'))
    await settle()
    expect(printLayout.print).toHaveBeenCalledWith(
      expect.objectContaining({ editor: { pages: [SHEET_P2], title: 'Flow' } }),
    )
  })

  it('saves the arranged PDF and says so', async () => {
    const { printLayout, onClose, onMessage } = await open()
    click($('input[data-pl="reverse"]'))
    click($('button[data-pl="save-pdf"]'))
    await settle()
    expect(printLayout.savePdf).toHaveBeenCalledWith(
      expect.objectContaining({ editor: { pages: [SHEET_P1, SHEET_P2], title: 'Flow' } }),
    )
    expect(onClose).toHaveBeenCalled()
    expect(onMessage).toHaveBeenCalledWith('Saved the arranged result as PDF.')
  })

  it('stays open with the reason when the arranged print fails', async () => {
    const { printLayout, onClose } = await open()
    printLayout.print.mockResolvedValueOnce({ ok: false, error: 'driver gone' })
    click($('input[data-pl="reverse"]'))
    click($('button[data-pl="print"]'))
    await settle()
    expect(onClose).not.toHaveBeenCalled()
    expect($('[data-pl="job-error"]')?.textContent).toBe('Printing failed: driver gone')
  })
})

describe('the layout diagram sheets', () => {
  it('are the page formats in points, with the print document fallback', async () => {
    expect(sheetSizePt({ pageWidth: 827, pageHeight: 1169 })).toEqual({
      widthPt: 595.44,
      heightPt: 841.68,
    })
    expect(sheetSizePt({ pageWidth: 0, pageHeight: Number.NaN })).toEqual({
      widthPt: 595.44,
      heightPt: 841.68,
    })
    const client = fakeClient()
    expect(await printSheetSizesIn(client, 'all')).toEqual([
      { widthPt: 595.44, heightPt: 841.68 },
      { widthPt: 841.68, heightPt: 595.44 },
    ])
    expect(await printSheetSizesIn(client, 'current')).toEqual([
      { widthPt: 841.68, heightPt: 595.44 },
    ])
    expect(client.requests.every((r) => r.op === 'pageInfo')).toBe(true)
  })

  it('are counted without making pictures when the dialog opens or the range changes', async () => {
    const { client } = await open()
    click(range('current'))
    await settle()
    expect(client.requests.length).toBeGreaterThanOrEqual(2)
    expect(client.requests.every((r) => r.op === 'pageInfo')).toBe(true)
  })
})

describe('strings', () => {
  it('says the arranged PDF was saved in every UI language', () => {
    const en = appStrings.en.printLayoutSaved
    for (const lang of LANGS) {
      const text = appStrings[lang].printLayoutSaved
      expect(text, lang).toMatch(/PDF|pdf/)
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
