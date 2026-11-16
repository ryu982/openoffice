/** @vitest-environment jsdom */
// The sheets Print dialog with the shared layout panel: no paper or fit field
// (the sheet's own settings size the pages), collate locked on while an option
// is on, the layout diagram in place of the page preview only while the faces
// are rearranged, Print taking the plain route at the defaults and the arranged
// route otherwise, and defaults again on the next open.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import type { PrintPreviewHost } from '../src/renderer/page-layout-actions'
import { PrintDialog } from '../src/renderer/PrintDialog'
import { hostFor } from './print-layout-host'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  setModuleLang('en')
  ;(window as unknown as { desktopApi: unknown }).desktopApi = {
    onLanguageChanged: () => () => undefined,
    printLayout: {
      onProgress: () => () => undefined,
      cancel: vi.fn().mockResolvedValue(undefined),
      getLabelSpec: vi.fn().mockResolvedValue(null),
      setLabelSpec: vi.fn().mockResolvedValue({ ok: true }),
    },
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as { desktopApi?: unknown }).desktopApi
  vi.unstubAllGlobals()
})

/// The real host over a fake sheet, with the outputs replaced by spies.
function spiedHost() {
  const host = hostFor(null)
  const print = vi.fn<PrintPreviewHost['print']>().mockResolvedValue('Sent to the printer.')
  const printArranged = vi
    .fn<PrintPreviewHost['printArranged']>()
    .mockResolvedValue('Sent to the printer.')
  const spied: PrintPreviewHost = {
    ...host,
    listPrinters: async () => [{ name: 'Office printer', displayName: 'Office printer' }],
    print,
    printArranged,
    setMessage: vi.fn(),
  }
  return { host: spied, print, printArranged }
}

async function settle(ms = 250): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function open(host: PrintPreviewHost, onClose = vi.fn()): Promise<void> {
  act(() => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(PrintDialog, { host, onClose, onPageSetup: vi.fn(), revision: 0 }),
      }),
    )
  })
  // the job builds a beat after the dialog opens
  await settle()
}

const $ = <T extends Element>(selector: string) => container.querySelector<T>(selector)

function collateBox(): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].find(
    (node) => node.textContent?.trim() === 'Collate',
  )
  const box = label?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!box) throw new Error('no collate field')
  return box
}

function chooseMode(mode: string): void {
  const radio = $<HTMLInputElement>(`input[data-pl="mode"][value="${mode}"]`)
  if (!radio) throw new Error(`no ${mode} mode`)
  act(() => radio.click())
}

function clickPrint(): void {
  act(() => $<HTMLButtonElement>('[data-print-action="print"]')!.click())
}

describe('sheets Print dialog with the layout panel', () => {
  it('shows the panel without its paper and fit fields', async () => {
    await open(spiedHost().host)
    expect($('[data-pl="mode"]')).not.toBeNull()
    expect($('[data-pl="grayscale"]')).not.toBeNull()
    expect($('[data-pl="paper"]')).toBeNull()
    expect($('[data-pl="fit"]')).toBeNull()
  })

  it('at the defaults Print takes the plain route with the dialog values', async () => {
    const { host, print, printArranged } = spiedHost()
    await open(host)
    act(() => collateBox().click())
    expect(collateBox().checked).toBe(false)
    expect(collateBox().disabled).toBe(false)
    clickPrint()
    await settle(0)
    expect(printArranged).not.toHaveBeenCalled()
    expect(print).toHaveBeenCalledTimes(1)
    expect(print.mock.calls[0]![1]).toEqual({
      deviceName: '',
      copies: 1,
      collate: false,
      pages: null,
    })
  })

  it('a rearranging option locks collate on, swaps in the diagram and prints arranged', async () => {
    const { host, print, printArranged } = spiedHost()
    await open(host)
    act(() => collateBox().click())
    expect($('[data-print-preview="pages"]')!.hasAttribute('hidden')).toBe(false)
    expect($('[data-print-preview="schematic"]')).toBeNull()

    chooseMode('nup')
    expect(collateBox().checked).toBe(true)
    expect(collateBox().disabled).toBe(true)
    expect($('[data-print-preview="schematic"]')).not.toBeNull()
    expect($('[data-print-preview="pages"]')!.hasAttribute('hidden')).toBe(true)

    clickPrint()
    await settle(0)
    expect(print).not.toHaveBeenCalled()
    expect(printArranged).toHaveBeenCalledTimes(1)
    const [, output, options] = printArranged.mock.calls[0]!
    expect(output).toMatchObject({ deviceName: '', copies: 1, pages: null })
    expect(options.mode).toBe('nup')

    // back to one page per sheet: the page preview returns, collate unlocks
    chooseMode('single')
    expect($('[data-print-preview="schematic"]')).toBeNull()
    expect($('[data-print-preview="pages"]')!.hasAttribute('hidden')).toBe(false)
    expect(collateBox().disabled).toBe(false)
    expect(collateBox().checked).toBe(false)
  })

  it('grayscale alone keeps the page preview but still prints arranged', async () => {
    const { host, print, printArranged } = spiedHost()
    await open(host)
    act(() => $<HTMLInputElement>('[data-pl="grayscale"]')!.click())
    expect($('[data-print-preview="schematic"]')).toBeNull()
    expect(collateBox().disabled).toBe(true)
    clickPrint()
    await settle(0)
    expect(print).not.toHaveBeenCalled()
    expect(printArranged.mock.calls[0]![2].grayscale).toBe(true)
  })

  it('opens with the defaults again after a print with options', async () => {
    const { host } = spiedHost()
    await open(host)
    chooseMode('booklet')
    expect($<HTMLInputElement>('input[data-pl="mode"][value="booklet"]')!.checked).toBe(true)
    act(() => root.render(createElement('div')))
    await open(host)
    expect($<HTMLInputElement>('input[data-pl="mode"][value="single"]')!.checked).toBe(true)
    expect($('[data-print-preview="schematic"]')).toBeNull()
  })
})
