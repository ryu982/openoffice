/**
 * The PDF print dialog with the shared page layout panel: the "picked pages"
 * range is there only for two or more picked thumbnails, the layout options
 * start from the defaults every time the dialog opens, and Print hands the
 * chosen pages and options to the editor.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import { PrintDialog, type PrintDialogProps } from '../src/renderer/PrintDialog'
import { strings } from '../src/renderer/i18n/strings'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const t = ((key: string) =>
  strings.en[key as keyof typeof strings.en] ?? key) as PrintDialogProps['t']

async function mount(over: Partial<PrintDialogProps> = {}) {
  const props: PrintDialogProps = {
    lang: 'en',
    t,
    pageCount: 6,
    currentPage: 2,
    pickedPages: [],
    includeAnnotations: true,
    onIncludeAnnotationsChange: vi.fn(),
    pageSizes: (pages) =>
      (pages ?? [1, 2, 3, 4, 5, 6]).map(() => ({ widthPt: 595, heightPt: 842 })),
    onPrint: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(PrintDialog, props)))
  return props
}

const q = <T extends Element>(sel: string) => container!.querySelector<T>(sel)
const range = (v: string) => q<HTMLInputElement>(`input[data-print-range="${v}"]`)!
const printButton = () => q<HTMLButtonElement>('[data-print-confirm]')!
const click = (el: Element) => act(async () => (el as HTMLElement).click())

describe('PrintDialog', () => {
  it('shows the shared layout panel with paper and fit', async () => {
    await mount()
    expect(q('[data-pl="mode"]')).not.toBeNull()
    expect(q('[data-pl="paper"]')).not.toBeNull()
    expect(q('[data-pl="fit"]')).not.toBeNull()
  })

  it('offers "picked pages" only for two or more picked thumbnails', async () => {
    await mount({ pickedPages: [] })
    expect(range('picked').disabled).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount({ pickedPages: [5] })
    expect(range('picked').disabled).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount({ pickedPages: [3, 5] })
    expect(range('picked').disabled).toBe(false)
  })

  it('prints at default options with the same page lists as before', async () => {
    const props = await mount({ pickedPages: [3, 5] })
    await click(printButton())
    await click(range('current'))
    await click(printButton())
    await click(range('picked'))
    await click(printButton())
    const onPrint = props.onPrint as ReturnType<typeof vi.fn>
    expect(onPrint.mock.calls).toEqual([
      [undefined, createDefaultOptions()],
      [[2], createDefaultOptions()],
      [[3, 5], createDefaultOptions()],
    ])
  })

  it('hands chosen layout options to the editor', async () => {
    const props = await mount()
    const nup = container!.querySelector<HTMLInputElement>('input[data-pl="mode"][value="nup"]')!
    await click(nup)
    await click(printButton())
    const [pages, options] = (props.onPrint as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(pages).toBeUndefined()
    expect(options.mode).toBe('nup')
  })

  it('starts from the default options every time it opens', async () => {
    await mount()
    await click(container!.querySelector('input[data-pl="mode"][value="booklet"]')!)
    expect(q<HTMLInputElement>('input[data-pl="mode"][value="booklet"]')!.checked).toBe(true)
    await act(async () => root!.unmount())
    container!.remove()
    await mount()
    expect(q<HTMLInputElement>('input[data-pl="mode"][value="single"]')!.checked).toBe(true)
  })

  it('marks a custom range that does not parse instead of printing', async () => {
    const props = await mount()
    await click(range('custom'))
    const field = q<HTMLInputElement>('input.pdf-modal-input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, '9')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(printButton())
    expect(props.onPrint).not.toHaveBeenCalled()
    expect(q('input.pdf-modal-input.invalid')).not.toBeNull()
  })
})

describe('a PDF with permission restrictions', () => {
  const chooseNup = () => click(container!.querySelector('input[data-pl="mode"][value="nup"]')!)
  const saveButton = () => q('[data-pl="save-pdf"]')
  const reason = () => q('[data-print-save-restricted]')

  it('offers no "save the arranged result as PDF" and says why', async () => {
    const onSavePdf = vi.fn()
    await mount({ onSavePdf, saveRestricted: true })
    await chooseNup()
    expect(saveButton()).toBeNull()
    expect(reason()?.textContent).toBe(strings.en.printSaveRestricted)
    // printing stays available
    expect(printButton().disabled).toBe(false)
  })

  it('keeps the save button and no reason line for an unrestricted PDF', async () => {
    const onSavePdf = vi.fn()
    await mount({ onSavePdf })
    await chooseNup()
    expect(saveButton()).not.toBeNull()
    expect(reason()).toBeNull()
  })

  it('says nothing while no layout option is chosen (there is no save button then)', async () => {
    await mount({ onSavePdf: vi.fn(), saveRestricted: true })
    expect(reason()).toBeNull()
  })
})

describe('restricted save wording', () => {
  it('exists in every UI language, translated rather than copied from English', () => {
    expect(strings.ko.printSaveRestricted).toBe(
      '권한이 걸린 PDF라 배치한 결과를 PDF로 저장할 수 없습니다. 인쇄는 할 수 있습니다.',
    )
    expect(strings.en.printSaveRestricted).toBe(
      'This PDF has permission restrictions, so the arranged result cannot be saved as a PDF. You can still print it.',
    )
    expect(LANGS).toContain('tr')
    for (const lang of LANGS) {
      const text = strings[lang].printSaveRestricted
      expect(typeof text).toBe('string')
      expect(text.trim()).not.toBe('')
      if (lang !== 'en') expect(text).not.toBe(strings.en.printSaveRestricted)
    }
  })
})

describe('"picked pages" range wording', () => {
  it('exists in every UI language, translated rather than copied from English', () => {
    expect(strings.ko.printRangePicked).toBe('고른 페이지')
    expect(strings.en.printRangePicked).toBe('Selected pages')
    for (const lang of LANGS) {
      const text = strings[lang].printRangePicked
      expect(typeof text).toBe('string')
      expect(text.trim()).not.toBe('')
      if (lang !== 'en') expect(text).not.toBe(strings.en.printRangePicked)
    }
  })
})
