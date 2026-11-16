/**
 * Print from the whole editor screen (decision 0141): Print makes the page of
 * the sheet on screen, then opens the small print dialog. With nothing changed
 * there the page goes to the print exactly as before; with a page layout
 * option on, the same page goes to the shared print layout.
 *
 * jsdom lays nothing out, so the still copy of the sheet is stood in for here;
 * the page is made from it by the real `snapshotPage`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Lang } from '@genoffice/i18n'
import { printLayoutText } from '@genoffice/ui'
import { createDefaultOptions, paperSizePt } from '@genoffice/print-layout/plan'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { snapshotPage } from '../src/renderer/export/render'
import type { MapSnapshot } from '../src/renderer/export/snapshot'
import { MAP_PRINT_PAGES } from '../src/renderer/export/PrintDialog'
import type { MindmapApi, MindmapPrintJob, OpenFileResult } from '../src/shared/ipc'
import { documentOf, plainSheet } from './helpers/fixtures'
import { until } from './helpers/wait'

const stand = vi.hoisted(() => ({ snapshot: null as MapSnapshot | null, made: 0 }))

vi.mock('../src/renderer/export/snapshot', async (original) => ({
  ...(await original<typeof import('../src/renderer/export/snapshot')>()),
  snapshotSheet: async () => {
    stand.made++
    return stand.snapshot
  },
}))

function fakeSnapshot(): MapSnapshot {
  const element = document.createElement('div')
  element.className = 'mm-card mm-export'
  element.textContent = '중심 토픽'
  return { element, width: 600, height: 400, ground: '#fdfcf8', pictures: new Map() }
}

type LayoutAnswer =
  { ok: true; canceled?: true } | { ok: true; path: string } | Record<string, unknown>

interface Fake {
  api: MindmapApi
  prints: unknown[]
  layout: { kind: string; request: { options: unknown; editor: MindmapPrintJob } }[]
  answer: LayoutAnswer
  canceled: number
  emitPrint(): void
}

function fakeApi(file: OpenFileResult, lang: Lang): Fake {
  const handlers: Record<string, ((...args: never[]) => void) | undefined> = {}
  const on =
    (name: string) =>
    (handler: (...args: never[]) => void): (() => void) => {
      handlers[name] = handler
      return () => {
        handlers[name] = undefined
      }
    }
  const layoutCall = (kind: string) => async (request: never) => {
    fake.layout.push({ kind, request })
    return fake.answer
  }
  const fake: Fake = {
    prints: [],
    layout: [],
    answer: { ok: true },
    canceled: 0,
    emitPrint: () => (handlers.print as (() => void) | undefined)?.(),
    api: {
      consumePending: async () => 'C:/maps/test.xmind',
      openFile: async () => file,
      save: async () => ({ ok: true, path: 'C:/maps/test.xmind' }),
      setDirty: () => {},
      onSaveRequest: on('save'),
      sendSaveRequestAck: () => {},
      onCloseSaveRequest: on('close'),
      sendCloseSaveResult: () => {},
      onFileRenamed: on('renamed'),
      openLink: async () => true,
      onMenuCommand: on('menu'),
      getLanguage: async () => lang,
      onLanguageChanged: on('language'),
      getTheme: async () => 'system' as const,
      onThemeChanged: on('theme'),
      getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
      onAutoSaveDefaultChanged: on('autosave'),
      onChromePressed: on('chrome'),
      onOutlineRequest: on('outline'),
      sendOutlineResult: () => {},
      onBytesRequest: on('bytes'),
      sendBytesResult: () => {},
      onExportRequest: on('export'),
      onPrintRequest: on('print'),
      print: async (request: unknown) => {
        fake.prints.push(request)
        return { ok: true }
      },
      printLayout: {
        preview: layoutCall('preview'),
        print: layoutCall('print'),
        savePdf: layoutCall('save'),
        cancel: async () => {
          fake.canceled++
        },
        onProgress: () => () => {},
        getLabelSpec: async () => null,
        setLabelSpec: async () => ({ ok: false, error: 'not here' }),
      },
    } as unknown as MindmapApi,
  }
  return fake
}

let container: HTMLElement
let unmount: () => void = () => {}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  stand.snapshot = fakeSnapshot()
  stand.made = 0
})
afterEach(() => {
  unmount()
  unmount = () => {}
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(lang: Lang = 'en'): Promise<Fake> {
  const bytes = await (await documentOf(plainSheet())).save()
  const fake = fakeApi({ status: 'ok', bytes }, lang)
  ;(window as unknown as { mindmapApi: MindmapApi }).mindmapApi = fake.api
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang, children: createElement(App) }))
  })
  unmount = () => act(() => root.unmount())
  await until(() => container.querySelector('.map-container') !== null, 'the map to open')
  await settle()
  return fake
}

const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]')

async function openPrint(fake: Fake): Promise<void> {
  await act(async () => fake.emitPrint())
  await until(() => dialog() !== null, 'the print dialog')
}

async function click(selector: string): Promise<void> {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  await act(async () => element.click())
  await settle()
}

const status = (): string => container.querySelector('.mm-save-status')!.textContent ?? ''

describe('Print with nothing changed in the dialog', () => {
  it('opens the dialog first, then hands the print exactly the page it was handed before', async () => {
    const fake = await mount()
    await openPrint(fake)
    // the page is made when Print is asked for; nothing is printed until the dialog says so
    expect(stand.made).toBe(1)
    expect(fake.prints).toEqual([])
    // one page: no range to choose
    expect(document.querySelector('[data-pl="range"]')).toBeNull()

    await click('button[data-pl="print"]')
    await until(() => fake.prints.length === 1, 'the print')
    // the same call as before the dialog: `{ html: snapshotPage(snapshot) }` and nothing else
    expect(fake.prints).toEqual([{ html: snapshotPage(fakeSnapshot()) }])
    expect(Object.keys(fake.prints[0] as object)).toEqual(['html'])
    expect(fake.layout).toEqual([])
    expect(dialog()).toBeNull()
  })

  it('Cancel prints nothing', async () => {
    const fake = await mount()
    await openPrint(fake)
    await click('button[data-pl="cancel"]')
    expect(dialog()).toBeNull()
    expect(fake.prints).toEqual([])
    expect(fake.layout).toEqual([])
  })

  it('a sheet that cannot be copied opens no dialog and tells the user', async () => {
    const fake = await mount()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stand.snapshot = null
    await act(async () => fake.emitPrint())
    await until(() => status() === 'Could not print', 'the message')
    expect(dialog()).toBeNull()
    expect(fake.prints).toEqual([])
  })
})

describe('Print with a page layout option on', () => {
  it('sends the same page to the shared print layout, and not to the plain print', async () => {
    const fake = await mount()
    await openPrint(fake)
    await click('input[data-pl="mode"][value="poster"]')
    await click('button[data-pl="print"]')
    await until(() => fake.layout.length === 1, 'the arranged print')
    const expected = createDefaultOptions()
    expected.mode = 'poster'
    expect(fake.layout[0]).toEqual({
      kind: 'print',
      request: {
        options: expected,
        // the page the plain print would have printed: the map in its own colours
        editor: { html: snapshotPage(fakeSnapshot()), suggestedName: 'test' },
      },
    })
    expect(fake.prints).toEqual([])
    expect(dialog()).toBeNull()
  })

  it('saves the arranged PDF from the same page and says so', async () => {
    const fake = await mount()
    await openPrint(fake)
    await click('input[data-pl="grayscale"]')
    fake.answer = { ok: true, path: 'C:/out/test.pdf' }
    await click('button[data-pl="save-pdf"]')
    await until(() => status() === 'Exported', 'the message')
    expect(fake.layout.map((each) => each.kind)).toEqual(['save'])
    expect(fake.layout[0]!.request.editor.html).toBe(snapshotPage(fakeSnapshot()))
    expect(dialog()).toBeNull()
  })

  it('a failed arranged print stays in the dialog with the reason in the app language', async () => {
    const fake = await mount('ko')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await openPrint(fake)
    expect(document.querySelector('.gs-pl-dialog-title')!.textContent).toBe(
      printLayoutText('ko', 'dialogTitle'),
    )
    await click('input[data-pl="reverse"]')
    fake.answer = { ok: false, error: 'the printer went away' }
    await click('button[data-pl="print"]')
    await until(
      () => document.querySelector('[data-pl="job-error"]')?.textContent === '인쇄하지 못했습니다',
      'the reason',
    )
    expect(dialog()).not.toBeNull()
    expect(fake.prints).toEqual([])
  })

  it('a canceled arranged job says nothing and leaves the dialog open', async () => {
    const fake = await mount()
    await openPrint(fake)
    await click('input[data-pl="reverse"]')
    fake.answer = { ok: false, aborted: true }
    await click('button[data-pl="print"]')
    await until(() => fake.layout.length === 1, 'the arranged print')
    await settle()
    expect(document.querySelector('[data-pl="job-error"]')).toBeNull()
    expect(dialog()).not.toBeNull()
  })
})

describe('the layout diagram', () => {
  it('knows the job without making it: one landscape A4 page', () => {
    const a4 = paperSizePt('A4')
    expect(MAP_PRINT_PAGES).toEqual([{ widthPt: a4.heightPt, heightPt: a4.widthPt }])
    expect(MAP_PRINT_PAGES[0]!.widthPt).toBeCloseTo(841.89, 1)
    expect(MAP_PRINT_PAGES[0]!.heightPt).toBeCloseTo(595.28, 1)
  })

  it('shows a 2 x 2 poster of the one page as four tiles', async () => {
    const fake = await mount()
    await openPrint(fake)
    await click('input[data-pl="mode"][value="poster"]')
    expect(document.querySelectorAll('[data-pl-face]')).toHaveLength(4)
    // no layout job ran to draw it
    expect(fake.layout).toEqual([])
  })
})
