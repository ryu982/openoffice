/**
 * AI turned off (Settings) in the EPUB editor, against a fake preload API
 * and a fake editor-choice bridge: while AI is off there is no AI panel, no
 * rail, no "Translate book" button, and the menu's "Translate book" opens
 * nothing; turning AI on brings them back without reopening the tab, and
 * turning it off again takes them away. No model is reached.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { epubAssetBase } from '../src/shared/asset-url'
import type { EpubApi, EpubBookSummary, EpubMenuCommand } from '../src/shared/ipc'
import { FakeBook } from './helpers/edit-backend'

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (window as { projectApi?: unknown }).projectApi
  delete (window as { aiOfficeEditorChoice?: unknown }).aiOfficeEditorChoice
})

function fakeApi(fixedLayout: boolean) {
  const book = new FakeBook([{ body: '<p>One.</p>' }, { body: '<p>Two.</p>' }])
  const summary: EpubBookSummary = {
    opfPath: 'OEBPS/content.opf',
    version: '3',
    metadata: {
      title: 'A Small Book',
      titles: ['A Small Book'],
      creators: [],
      languages: ['en'],
      identifiers: [],
      uniqueIdentifier: null,
      layout: fixedLayout ? 'pre-paginated' : 'reflowable',
      primaryWritingMode: null,
    },
    manifest: [],
    spine: book.chapters.map((c, index) => ({
      index,
      idref: `c${index}`,
      path: c.path,
      mediaType: 'application/xhtml+xml',
      linear: true,
      properties: [],
      layout: null,
      fixedLayout,
    })),
    pageProgressionDirection: null,
    toc: { source: 'spine', entries: [] },
    fixedLayout,
    verticalWriting: false,
  }
  const aiStream = vi.fn(async () => {})
  const menu: { handler: ((command: EpubMenuCommand) => void) | null } = { handler: null }
  const noop = () => () => {}
  const api = {
    consumePending: async () => 'C:/books/a.epub',
    openFile: async () => ({
      status: 'ok' as const,
      book: summary,
      assetBase: epubAssetBase('0123abcd'),
      docHash: 'h',
      readOnly: fixedLayout ? ('fixed-layout-book' as const) : null,
    }),
    readChapter: book.readChapter,
    applyEdits: book.applyEdits,
    replaceRanges: book.replaceRanges,
    setTranslationLock: book.setTranslationLock,
    setDirty: book.setDirty,
    getReadingState: async () => ({
      position: null,
      viewPrefs: { fontScale: 1, lineHeight: null, dark: false },
    }),
    setReadPosition: () => {},
    setViewPrefs: async () => ({ fontScale: 1, lineHeight: null, dark: false }),
    onViewPrefsChanged: noop,
    onSaveRequest: noop,
    sendSaveRequestAck: () => {},
    onCloseSaveRequest: noop,
    sendCloseSaveResult: () => {},
    onMenuCommand: (handler: (command: EpubMenuCommand) => void) => {
      menu.handler = handler
      return () => {}
    },
    onChromePressed: noop,
    onLanguageChanged: noop,
    onFileRenamed: noop,
    openLink: async () => true,
    getAiSettings: async () => ({}),
    onAiSettingsChanged: noop,
    getAiPanelPrefs: async () => ({}),
    onAiPanelPrefsChanged: noop,
    aiStream,
    aiStreamCancel: async () => {},
    onAiStream: noop,
  } as unknown as EpubApi
  return { api, aiStream, menu }
}

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await act(() => new Promise((r) => setTimeout(r, 5)))
}

async function mount(api: EpubApi): Promise<HTMLElement> {
  window.epubApi = api
  const resolveChat = vi.fn(async () => ({ projectId: 'p', chatId: 'c' }))
  window.projectApi = {
    resolveChat,
    appendChat: vi.fn(async () => {}),
    loadChat: vi.fn(async () => []),
    rebindChat: vi.fn(async () => null),
  } as unknown as NonNullable<typeof window.projectApi>
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    )
  })
  await settle()
  return container
}

/** the editor-choice bridge the preload exposes: read and follow only */
function choiceBridge(aiFeatures: boolean) {
  type Choice = { off: string[]; aiFeatures: boolean; locked: false }
  const listeners = new Set<(choice: Choice) => void>()
  ;(window as { aiOfficeEditorChoice?: unknown }).aiOfficeEditorChoice = {
    get: async (): Promise<Choice> => ({ off: [], aiFeatures, locked: false }),
    onChange: (listener: (choice: Choice) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return async (on: boolean) => {
    await act(async () => {
      for (const listener of listeners) listener({ off: [], aiFeatures: on, locked: false })
    })
    await settle()
  }
}

const aiParts = (el: HTMLElement) => ({
  dock: el.querySelector('.ai-dock'),
  translate: el.querySelector('[data-action="translate-book"]'),
})

describe('the EPUB editor while AI is turned off', () => {
  it('shows no AI panel, rail or book translation, and gets them back when AI is on', async () => {
    const setAi = choiceBridge(false)
    const { api, aiStream } = fakeApi(false)
    const el = await mount(api)
    expect(aiParts(el)).toEqual({ dock: null, translate: null })
    // the book itself is there
    expect(el.querySelector('.epub-reader')).not.toBeNull()

    await setAi(true)
    expect(aiParts(el).dock).not.toBeNull()
    expect(aiParts(el).translate).not.toBeNull()

    await setAi(false)
    expect(aiParts(el)).toEqual({ dock: null, translate: null })
    expect(aiStream).not.toHaveBeenCalled()
  })

  it("the menu's Translate book opens nothing while AI is off", async () => {
    choiceBridge(false)
    const { api, menu } = fakeApi(false)
    const el = await mount(api)
    await act(async () => menu.handler?.('translate-book'))
    await settle()
    expect(el.querySelector('.bt-dialog, [role="dialog"]')).toBeNull()
  })

  it("the menu's Translate book opens the window while AI is on", async () => {
    choiceBridge(true)
    const { api, menu } = fakeApi(false)
    const el = await mount(api)
    await act(async () => menu.handler?.('translate-book'))
    await settle()
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('turning AI off closes an open translation window', async () => {
    const setAi = choiceBridge(true)
    const { api, menu } = fakeApi(false)
    const el = await mount(api)
    await act(async () => menu.handler?.('translate-book'))
    await settle()
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    await setAi(false)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    // turning AI on again shows the button, not the closed window
    await setAi(true)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(el.querySelector('[data-action="translate-book"]')).not.toBeNull()
  })
})
