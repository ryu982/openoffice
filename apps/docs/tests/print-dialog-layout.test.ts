// The word editor's print dialog with the shared page layout panel (decision
// 0141): with every option at its default and a page range, Print calls the
// current print exactly as before; any option, or a printed selection, takes
// the new route with the job PDF of the chosen pages only. The duplex field
// follows odd/even and booklet, and collate stays on while the route is new.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { appStrings } from '../src/renderer/i18n/strings-app'

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  document.body.replaceChildren()
  delete (window as unknown as { desktop?: unknown }).desktop
})

function previewPages(n: number): HTMLElement[] {
  const root = document.createElement('div')
  root.className = 'pagination-preview'
  const pages: HTMLElement[] = []
  for (let i = 0; i < n; i++) {
    const page = document.createElement('div')
    page.className = 'pv-page'
    page.style.width = '816px'
    page.style.height = '1056px'
    root.appendChild(page)
    pages.push(page)
  }
  document.body.appendChild(root)
  return pages
}

function mockDesktop() {
  const printLayout = {
    preview: vi.fn(async () => ({ ok: true as const, faces: [] })),
    print: vi.fn(async (_req: unknown) => ({ ok: true as const })),
    savePdf: vi.fn(async (_req: unknown) => ({ ok: true as const, path: 'out.pdf' })),
    cancel: vi.fn(async () => undefined),
    onProgress: vi.fn(() => () => undefined),
    getLabelSpec: vi.fn(async () => null),
    setLabelSpec: vi.fn(async () => ({ ok: false as const, error: 'x' })),
  }
  const desktop = {
    print: vi.fn(async (_scale?: number, _job?: unknown, _paper?: unknown) => ({ ok: true })),
    listPrinters: vi.fn(async () => [{ name: 'P1', displayName: 'Printer 1' }]),
    printLayout,
  }
  ;(window as unknown as { desktop: unknown }).desktop = desktop
  return desktop
}

type Props = Parameters<typeof PrintDialog>[0]

async function mount(pageCount: number, extra: Partial<Props> = {}) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoResizeObserver
  const pages = previewPages(pageCount)
  const desktop = mockDesktop()
  const onClose = vi.fn()
  const setStatus = vi.fn()
  const buildPageJob = vi.fn(async (_pages: number[]) => ({
    ok: true as const,
    parts: ['UEFHRQ=='],
  }))
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root: Root
  await act(async () => {
    root = createRoot(host)
    root.render(
      createElement(PrintDialog, {
        onClose,
        setStatus,
        buildPageJob,
        docName: 'doc.docx',
        ...extra,
      }),
    )
  })
  // the dialog polls the preview's sheet count until it holds still
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)
  const click = async (el: Element | null) => {
    expect(el).not.toBeNull()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
  }
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
  }
  const setValue = async (el: HTMLInputElement | HTMLSelectElement | null, value: string) => {
    expect(el).not.toBeNull()
    const proto =
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el!.dispatchEvent(
        new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      )
    })
  }
  const printButton = () => q<HTMLButtonElement>('.modal-actions .primary')
  const duplex = () => q<HTMLSelectElement>('[data-print="duplex"]')!
  const collate = () => q<HTMLInputElement>('[data-print="collate"]')!
  const mode = (m: string) => q<HTMLInputElement>(`[data-pl="mode"][value="${m}"]`)
  const sides = (s: string) => q<HTMLInputElement>(`[data-pl="sides"][value="${s}"]`)
  const range = (r: string) => q<HTMLInputElement>(`[data-print="range-${r}"]`)
  const cleanup = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  const m = {
    host,
    pages,
    desktop,
    onClose,
    setStatus,
    buildPageJob,
    q,
    click,
    settle,
    setValue,
    printButton,
    duplex,
    collate,
    mode,
    sides,
    range,
    cleanup,
  }
  cleanups.push(cleanup)
  return m
}

describe('print dialog: default options keep the current print', () => {
  it('calls desktop.print with the same arguments as before', async () => {
    const m = await mount(3)
    await m.click(m.printButton())
    expect(m.desktop.print).toHaveBeenCalledTimes(1)
    expect(m.desktop.print.mock.calls[0]).toEqual([
      1,
      { deviceName: '', copies: 1, collate: true, duplex: 'simplex' },
      undefined,
    ])
    expect(m.desktop.printLayout.print).not.toHaveBeenCalled()
    expect(m.buildPageJob).not.toHaveBeenCalled()
    expect(m.onClose).toHaveBeenCalled()
  })

  it('prints the user’s own printer choices and range unchanged', async () => {
    const m = await mount(3)
    let skipped: boolean[] = []
    m.desktop.print.mockImplementation(async () => {
      skipped = m.pages.map((p) => p.classList.contains('pv-print-skip'))
      return { ok: true }
    })
    await m.setValue(m.q('.print-copies'), '2')
    await m.click(m.collate())
    await m.setValue(m.duplex(), 'longEdge')
    await m.click(m.range('custom'))
    await m.setValue(m.q('.print-range-input'), '2-3')
    await m.click(m.printButton())
    expect(m.desktop.print.mock.calls[0]).toEqual([
      1,
      { deviceName: '', copies: 2, collate: false, duplex: 'longEdge' },
      undefined,
    ])
    expect(skipped).toEqual([true, false, false])
    expect(m.pages.some((p) => p.classList.contains('pv-print-skip'))).toBe(false)
  })

  it('leaves the system dialog choice as it was', async () => {
    const m = await mount(2)
    await m.setValue(m.q('select.print-select'), '\u0000system-dialog')
    await m.click(m.printButton())
    expect(m.desktop.print.mock.calls[0]).toEqual([1, { deviceName: null }, undefined])
  })
})

describe('print dialog: options take the new route', () => {
  it('prints the job PDF of the chosen pages with the in-app printer', async () => {
    const m = await mount(3)
    await m.click(m.q('[data-pl="reverse"]'))
    await m.click(m.printButton())
    expect(m.desktop.print).not.toHaveBeenCalled()
    expect(m.buildPageJob).toHaveBeenCalledWith([0, 1, 2])
    const req = m.desktop.printLayout.print.mock.calls[0]![0] as {
      options: { reverse: boolean }
      editor: unknown
      job: unknown
    }
    expect(req.options.reverse).toBe(true)
    expect(req.editor).toEqual({ parts: ['UEFHRQ=='], name: 'doc.docx' })
    expect(req.job).toEqual({ deviceName: '', copies: 1, collate: true, duplex: 'simplex' })
    expect(m.onClose).toHaveBeenCalled()
  })

  it('leaves pages outside the range out of the job', async () => {
    const m = await mount(4)
    await m.click(m.q('[data-pl="grayscale"]'))
    await m.click(m.range('custom'))
    await m.setValue(m.q('.print-range-input'), '2, 4')
    await m.click(m.printButton())
    expect(m.buildPageJob).toHaveBeenCalledWith([1, 3])
    await m.click(m.range('current'))
    await m.click(m.printButton())
    expect(m.buildPageJob).toHaveBeenLastCalledWith([0])
  })

  it('opens the system dialog when no printer is chosen in the app', async () => {
    const m = await mount(2)
    await m.setValue(m.q('select.print-select'), '\u0000system-dialog')
    await m.click(m.mode('nup'))
    await m.click(m.printButton())
    const req = m.desktop.printLayout.print.mock.calls[0]![0] as { job: unknown }
    expect(req.job).toEqual({ deviceName: null })
  })

  it('keeps the dialog open and says why when the job fails', async () => {
    const m = await mount(2)
    m.desktop.printLayout.print.mockResolvedValueOnce({ ok: false, error: 'boom' } as never)
    await m.click(m.q('[data-pl="reverse"]'))
    await m.click(m.printButton())
    await m.settle()
    expect(m.onClose).not.toHaveBeenCalled()
    expect(m.host.textContent).toContain('boom')
  })

  it('saves the arranged PDF with the same job', async () => {
    const m = await mount(2)
    await m.click(m.mode('booklet'))
    await m.click(m.q('[data-pl="save-pdf"]'))
    await m.settle()
    const req = m.desktop.printLayout.savePdf.mock.calls[0]![0] as { editor: unknown }
    expect(req.editor).toEqual({ parts: ['UEFHRQ=='], name: 'doc.docx' })
  })
})

describe('print dialog: duplex and collate follow the options', () => {
  it('turns duplex off for odd/even, short edge for a booklet, and restores it', async () => {
    const m = await mount(4)
    await m.setValue(m.duplex(), 'longEdge')
    await m.click(m.mode('booklet'))
    expect(m.duplex().value).toBe('shortEdge')
    await m.click(m.mode('single'))
    expect(m.duplex().value).toBe('longEdge')
    await m.click(m.sides('odd'))
    expect(m.duplex().value).toBe('simplex')
    await m.click(m.sides('all'))
    expect(m.duplex().value).toBe('longEdge')
  })

  it('does not restore a duplex value the user changed meanwhile', async () => {
    const m = await mount(4)
    await m.click(m.sides('even'))
    expect(m.duplex().value).toBe('simplex')
    await m.setValue(m.duplex(), 'shortEdge')
    await m.click(m.sides('all'))
    expect(m.duplex().value).toBe('shortEdge')
  })

  it('locks collate on while an option is on', async () => {
    const m = await mount(2)
    await m.setValue(m.q('.print-copies'), '3')
    await m.click(m.collate())
    expect(m.collate().checked).toBe(false)
    await m.click(m.q('[data-pl="grayscale"]'))
    expect(m.collate().checked).toBe(true)
    expect(m.collate().disabled).toBe(true)
    await m.click(m.printButton())
    const req = m.desktop.printLayout.print.mock.calls[0]![0] as { job: { collate: boolean } }
    expect(req.job.collate).toBe(true)
    // off again: the user's own choice comes back
    await m.click(m.q('[data-pl="grayscale"]'))
    expect(m.collate().checked).toBe(false)
    expect(m.collate().disabled).toBe(false)
  })
})

describe('print dialog: the selection', () => {
  it('cannot be chosen without a selection', async () => {
    const m = await mount(2)
    expect(m.range('selection')!.disabled).toBe(true)
  })

  it('prints only the laid-out selection, always on the new route', async () => {
    const prepareSelection = vi.fn(async () => ({
      ok: true as const,
      parts: ['U0VM'],
      pages: [
        { widthPt: 612, heightPt: 792 },
        { widthPt: 612, heightPt: 792 },
      ],
    }))
    const m = await mount(5, { prepareSelection })
    expect(m.range('selection')!.disabled).toBe(false)
    await m.click(m.range('selection'))
    await m.settle()
    expect(prepareSelection).toHaveBeenCalledTimes(1)
    expect(m.q('.print-page-count')!.textContent).toMatch(/2/)
    await m.click(m.printButton())
    expect(m.desktop.print).not.toHaveBeenCalled()
    expect(m.buildPageJob).not.toHaveBeenCalled()
    const req = m.desktop.printLayout.print.mock.calls[0]![0] as {
      options: { mode: string }
      editor: unknown
      job: { collate: boolean }
    }
    expect(req.options.mode).toBe('single')
    expect(req.editor).toEqual({ parts: ['U0VM'], name: 'doc.docx' })
    expect(req.job.collate).toBe(true)
  })

  it('says why the selection could not be laid out', async () => {
    const prepareSelection = vi.fn(async () => ({ ok: false as const, error: 'no luck' }))
    const m = await mount(2, { prepareSelection })
    await m.click(m.range('selection'))
    await m.settle()
    expect(m.host.textContent).toContain('no luck')
    expect(m.printButton()!.disabled).toBe(true)
  })
})

describe('print dialog strings', () => {
  const KEYS = [
    'appPrintRangeSelection',
    'appPrintSelectionPreparing',
    'appPrintSelectionFailed',
  ] as const
  it('exist in every language and are translated', () => {
    const table = appStrings as unknown as Record<string, Record<string, string>>
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(table[lang]?.[key], `${lang}.${key}`).toBeTruthy()
        if (lang !== 'en') expect(table[lang]![key], `${lang}.${key}`).not.toBe(table.en![key])
      }
    }
  })
})
