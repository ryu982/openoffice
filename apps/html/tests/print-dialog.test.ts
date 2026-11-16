/** @vitest-environment jsdom */
/**
 * The HTML print dialog (decision 0141). All pages with nothing changed is the
 * print as before (the editor's runPrint); an option on, or a typed range, goes
 * the arranged route with the document and the range as the job.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions, type PageSize } from '@genoffice/print-layout/plan'
import { LANGS } from '@genoffice/i18n'

vi.mock('../src/renderer/i18n/locale', async () => {
  const { createI18n } = await import('@genoffice/i18n')
  const { strings } = await import('../src/renderer/i18n/strings')
  const translate = createI18n(strings)
  return {
    useI18n: () => ({
      lang: 'en',
      t: (key: string, params?: Record<string, string | number>) =>
        translate('en', key as never, params),
    }),
  }
})

import { HtmlPrintDialog, type HtmlPrintDialogProps } from '../src/renderer/PrintDialog'
import { appStrings } from '../src/renderer/i18n/strings-app'

const A4: PageSize = { widthPt: 595, heightPt: 842 }
const DOC = '<p>page</p>\n'

let host: HTMLDivElement
let root: Root

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
})

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)]
const click = async (el: Element | null) => {
  await act(async () => (el as HTMLElement).click())
}
const settle = () => act(async () => {})

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function fakeApi(pages: PageSize[] | Error = [A4, A4, A4]) {
  return {
    printJobPages: vi.fn(async () =>
      pages instanceof Error
        ? { ok: false as const, error: pages.message }
        : { ok: true as const, pages },
    ),
    printLayout: {
      preview: vi.fn(async () => ({ ok: true as const, faces: [] })),
      print: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: true; canceled: true }),
      savePdf: vi.fn(async () => ({ ok: true as const, path: 'C:/out.pdf' })),
      cancel: vi.fn(async () => {}),
      onProgress: vi.fn(() => () => {}),
      getLabelSpec: vi.fn(async () => null),
      setLabelSpec: vi.fn(),
    },
  }
}

async function mount(api = fakeApi()) {
  const props = {
    api: api as unknown as HtmlPrintDialogProps['api'],
    documentText: vi.fn(() => DOC),
    suggestedName: vi.fn(() => 'page'),
    onPlainPrint: vi.fn(),
    onClose: vi.fn(),
    onNotice: vi.fn(),
  }
  act(() => root.render(createElement(HtmlPrintDialog, props)))
  await settle()
  return { props, api }
}

const pick = (value: string) =>
  $$<HTMLInputElement>('input[data-pl="range"]').find((r) => r.value === value)!

describe('the HTML print dialog', () => {
  it('prints all pages with nothing changed exactly as before', async () => {
    const { props, api } = await mount()
    expect($('[role="dialog"]')).not.toBeNull()
    expect($$<HTMLInputElement>('input[data-pl="range"]').map((r) => r.value)).toEqual([
      'all',
      'custom',
    ])
    await click($('button[data-pl="print"]'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onPlainPrint).toHaveBeenCalledTimes(1)
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(api.printLayout.savePdf).not.toHaveBeenCalled()
  })

  it('counts the pages once per dialog, from the document as the print serializes it', async () => {
    const { props, api } = await mount()
    expect(api.printJobPages).toHaveBeenCalledTimes(1)
    expect(api.printJobPages).toHaveBeenCalledWith({ html: DOC })
    await click(pick('custom'))
    const text = $<HTMLInputElement>('input[data-pl="range-text"]')!
    type(text, '1')
    type(text, '1-2')
    type(text, '1-3')
    await settle()
    expect(api.printJobPages).toHaveBeenCalledTimes(1)
    expect(props.documentText).toHaveBeenCalledTimes(1)
  })

  it('sends an option-on print down the arranged route with the document', async () => {
    const { props, api } = await mount()
    await click($('input[data-pl="reverse"]'))
    await click($('button[data-pl="print"]'))
    const options = { ...createDefaultOptions(), reverse: true }
    expect(api.printLayout.print).toHaveBeenCalledWith({
      options,
      editor: { html: DOC, suggestedName: 'page' },
    })
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('prints a typed range on the arranged route even with the options at their defaults', async () => {
    const { props, api } = await mount()
    await click(pick('custom'))
    type($<HTMLInputElement>('input[data-pl="range-text"]')!, '2-3')
    await click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect(api.printLayout.print).toHaveBeenCalledWith({
      options: createDefaultOptions(),
      editor: { html: DOC, suggestedName: 'page', ranges: [{ from: 2, to: 3 }] },
    })
  })

  it('refuses a range with none of the document pages and sends nothing', async () => {
    const { props, api } = await mount()
    await click(pick('custom'))
    type($<HTMLInputElement>('input[data-pl="range-text"]')!, '7-9')
    await click($('button[data-pl="print"]'))
    expect(api.printLayout.print).not.toHaveBeenCalled()
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect(host.textContent).toContain('This document has 3 pages. Type page numbers within them.')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when the system dialog is canceled', async () => {
    const api = fakeApi()
    api.printLayout.print.mockResolvedValueOnce({ ok: true, canceled: true })
    const { props } = await mount(api)
    await click($('input[data-pl="grayscale"]'))
    await click($('button[data-pl="print"]'))
    expect(api.printLayout.print).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows why an arranged print failed', async () => {
    const api = fakeApi()
    api.printLayout.print.mockResolvedValueOnce({ ok: false, error: 'boom' } as never)
    const { props } = await mount(api)
    await click($('input[data-pl="reverse"]'))
    await click($('button[data-pl="print"]'))
    expect(host.textContent).toContain('Print failed: boom')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('saves the arranged PDF with the suggested name and says so', async () => {
    const { props, api } = await mount()
    await click($('input[data-pl="reverse"]'))
    await click($('button[data-pl="save-pdf"]'))
    expect(api.printLayout.savePdf).toHaveBeenCalledWith({
      options: { ...createDefaultOptions(), reverse: true },
      editor: { html: DOC, suggestedName: 'page' },
    })
    expect(props.onNotice).toHaveBeenCalledWith('Saved the arranged result as PDF.')
  })

  it('says when the pages could not be counted', async () => {
    await mount(fakeApi(new Error('no window')))
    expect(host.textContent).toContain('Could not count the pages to print: no window')
  })
})

describe('the print dialog strings', () => {
  const KEYS = [
    'printRangeEmpty',
    'printPagesFailed',
    'printLayoutSaved',
    'printLayoutSaveFailed',
  ] as const

  it('are written in every screen language, not copied from English', () => {
    const table = appStrings as unknown as Record<string, Record<string, string>>
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const text = table[lang]?.[key]
        expect(text, `${lang}.${key}`).toBeTruthy()
        if (lang !== 'en') expect(text, `${lang}.${key}`).not.toBe(table.en![key])
      }
      expect(table[lang]!.printRangeEmpty).toContain('{count}')
      expect(table[lang]!.printPagesFailed).toContain('{error}')
      expect(table[lang]!.printLayoutSaveFailed).toContain('{error}')
    }
  })
})
