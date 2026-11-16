/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions, type PageSize } from '@genoffice/print-layout/plan'
import { SimplePrintDialog, type SimplePrintDialogProps } from '../src/print-layout'

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
const click = (el: Element | null) => act(() => (el as HTMLElement).click())

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function mount(overrides: Partial<SimplePrintDialogProps> = {}) {
  const props: SimplePrintDialogProps = {
    lang: 'en',
    rangeChoice: 'all-custom',
    pages: pages(4),
    capabilities: { showPaperAndFit: true },
    onPlainPrint: vi.fn(),
    onPrint: vi.fn(),
    onSavePdf: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  act(() => root.render(createElement(SimplePrintDialog, props)))
  return props
}

describe('SimplePrintDialog', () => {
  it('prints down the current path when nothing changed', () => {
    const props = mount()
    expect($('[role="dialog"]')).not.toBeNull()
    expect($('button[data-pl="save-pdf"]')).toBeNull()
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({ kind: 'all' })
    expect(props.onPrint).not.toHaveBeenCalled()
  })

  it('takes the new route and shows save once an option is on', () => {
    const props = mount()
    click($('input[data-pl="reverse"]'))
    expect($('button[data-pl="save-pdf"]')).not.toBeNull()
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    const expected = createDefaultOptions()
    expected.reverse = true
    expect(props.onPrint).toHaveBeenCalledWith({ kind: 'all' }, expected)
    click($('button[data-pl="save-pdf"]'))
    expect(props.onSavePdf).toHaveBeenCalledWith({ kind: 'all' }, expected)
  })

  it('reads a custom range and refuses a malformed one', () => {
    const onRangeChange = vi.fn()
    const props = mount({ onRangeChange })
    click($$<HTMLInputElement>('input[data-pl="range"]').find((r) => r.value === 'custom')!)
    const text = $<HTMLInputElement>('input[data-pl="range-text"]')!
    type(text, '3-1')
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).not.toHaveBeenCalled()
    expect($('[data-pl="range-invalid"]')?.textContent).toBe('Write the page range like "1-3, 5".')
    type(text, '1-2, 4')
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({
      kind: 'custom',
      text: '1-2, 4',
      ranges: [
        { from: 1, to: 2 },
        { from: 4, to: 4 },
      ],
    })
    expect(onRangeChange).toHaveBeenLastCalledWith({
      kind: 'custom',
      text: '1-2, 4',
      ranges: [
        { from: 1, to: 2 },
        { from: 4, to: 4 },
      ],
    })
  })

  it('offers all pages and the current page for page-based editors', () => {
    const props = mount({ rangeChoice: 'all-current' })
    expect($$<HTMLInputElement>('input[data-pl="range"]').map((r) => r.value)).toEqual([
      'all',
      'current',
    ])
    click($$<HTMLInputElement>('input[data-pl="range"]')[1]!)
    click($('button[data-pl="print"]'))
    expect(props.onPlainPrint).toHaveBeenCalledWith({ kind: 'current' })
  })

  it('has no range choice for one-page editors', () => {
    mount({ rangeChoice: 'none' })
    expect($('input[data-pl="range"]')).toBeNull()
  })

  it('blocks printing while the options cannot print or a job runs', () => {
    const props = mount({ pages: pages(1) })
    click($$<HTMLInputElement>('input[data-pl="sides"]').find((r) => r.value === 'even')!)
    expect($<HTMLButtonElement>('button[data-pl="print"]')!.disabled).toBe(true)
    expect($('[data-pl="issue"]')?.textContent).toBe('The chosen sides have nothing to print.')
    const onCancelJob = vi.fn()
    mount({ ...props, job: { progress: { done: 1, total: 3 }, onCancel: onCancelJob } })
    expect($<HTMLButtonElement>('button[data-pl="print"]')!.disabled).toBe(true)
    expect(host.textContent).toContain('1 of 3 pages')
    click($('button[data-pl="job-cancel"]'))
    expect(onCancelJob).toHaveBeenCalled()
  })

  it('asks the editor for a preview of the chosen range', () => {
    const onPreviewRequest = vi.fn(() => new Promise<Uint8Array[]>(() => {}))
    mount({ rangeChoice: 'all-current', onPreviewRequest })
    click($$<HTMLInputElement>('input[data-pl="range"]')[1]!)
    click($('input[data-pl="grayscale"]'))
    click($('button[data-pl="preview"]'))
    const expected = createDefaultOptions()
    expected.grayscale = true
    expect(onPreviewRequest).toHaveBeenCalledWith(
      { kind: 'current' },
      expected,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('closes with Cancel and with Escape', () => {
    const props = mount()
    click($('button[data-pl="cancel"]'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    act(() => {
      $('.gs-pl-mask')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(props.onCancel).toHaveBeenCalledTimes(2)
  })
})
