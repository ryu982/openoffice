/**
 * The changes card of an AI run that changed the book: the run's history
 * entries go back only while they are the top of the tab's history, the
 * translation lock is respected, the changed blocks are counted, and the
 * reader marks them with a highlight that never touches the chapter's DOM
 * (what is read back into the book). The model is a scripted stream; no
 * provider is reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultAiSettings, type AiStreamChunk, type AiStreamRequest } from '@genoffice/ai-provider'
import type { SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import type { BookAiHost } from '../src/renderer/ai/book-tools'
import {
  emptyRunRecord,
  recordOutcome,
  runChangesOf,
  type BookMarks,
} from '../src/renderer/ai/run-changes'
import { EpubEditController, type EditHost } from '../src/renderer/edit/controller'
import { showAiMarks } from '../src/renderer/reader/frame-dom'
import { AI_CHANGED_HIGHLIGHT, viewPrefsCss } from '../src/renderer/reader/view-prefs'
import type { EpubApi, EpubBookSummary } from '../src/shared/ipc'
import { FakeBook, type ChapterSpec } from './helpers/edit-backend'

const P3 = '<p>Alpha one.</p>\n<p>Beta two.</p>\n<p>Gamma three.</p>'

function controllerOf(specs: ChapterSpec[]) {
  const book = new FakeBook(specs)
  const notices: string[] = []
  const host: EditHost = {
    api: book,
    chapterHtml: () => '<html><body></body></html>',
    readingText: () => '',
    showChapter: () => {},
    notify: (n) => void notices.push(n.key),
    changed: () => {},
  }
  return { book, notices, controller: new EpubEditController(host, 5) }
}

describe('recording a run', () => {
  it('marks replaced and inserted blocks, counts deleted ones, and keeps the history entry', async () => {
    const { controller } = controllerOf([{ body: P3 }, { body: '<p>Second.</p>' }])
    const record = emptyRunRecord()
    const groups = [
      {
        spineIndex: 0,
        edits: [
          { op: 'replace' as const, blockId: 'b1', text: 'ALPHA one.' },
          { op: 'delete' as const, blockId: 'b3' },
        ],
      },
      { spineIndex: 1, edits: [{ op: 'insert_after' as const, blockId: 'b1', text: 'New.' }] },
    ]
    const outcome = await controller.applyEditGroups(groups, { atomic: true })
    expect(outcome.ok).toBe(true)
    recordOutcome(record, groups, outcome)
    expect(record.entries).toEqual([outcome.entry])
    expect([...record.marks.get(0)!]).toEqual(['b1'])
    expect(record.marks.get(1)!.size).toBe(1)
    expect(runChangesOf(record)).toMatchObject({ state: 'applied', count: 3 })
  })

  it('a run with no edits has no receipt', () => {
    expect(runChangesOf(emptyRunRecord())).toBeNull()
  })
})

describe('taking a run back', () => {
  it('undoes exactly the run’s entries while they are on top, and they can be redone', async () => {
    const { book, controller } = controllerOf([{ body: P3 }])
    const first = await controller.applyEdits(0, [
      { op: 'replace', blockId: 'b1', text: 'user edit.' },
    ])
    expect(first.ok).toBe(true)
    const afterUser = book.source(0)
    const a = await controller.applyEditGroups([
      { spineIndex: 0, edits: [{ op: 'replace', blockId: 'b2', text: 'AI one.' }] },
    ])
    const b = await controller.applyEditGroups([
      { spineIndex: 0, edits: [{ op: 'replace', blockId: 'b3', text: 'AI two.' }] },
    ])
    expect(await controller.undoEntries([a.entry!, b.entry!])).toBe('reverted')
    expect(book.source(0)).toBe(afterUser)
    // the person's own edit before the run stays
    expect(controller.state().canUndo).toBe(true)
    await controller.redo()
    await controller.redo()
    expect(book.source(0)).toContain('AI two.')
  })

  it('refuses when anything was done after the run', async () => {
    const { book, controller } = controllerOf([{ body: P3 }])
    const run = await controller.applyEditGroups([
      { spineIndex: 0, edits: [{ op: 'replace', blockId: 'b1', text: 'AI.' }] },
    ])
    await controller.applyEdits(0, [{ op: 'replace', blockId: 'b2', text: 'later.' }])
    const before = book.source(0)
    expect(await controller.undoEntries([run.entry!])).toBe('refused')
    expect(book.source(0)).toBe(before)
  })

  it('says expired when the run’s entries are no longer in the history', async () => {
    const { controller } = controllerOf([{ body: P3 }])
    expect(await controller.undoEntries([42])).toBe('expired')
  })

  it('does nothing while the book translation holds the lock', async () => {
    const { book, controller, notices } = controllerOf([{ body: P3 }])
    const run = await controller.applyEditGroups([
      { spineIndex: 0, edits: [{ op: 'replace', blockId: 'b1', text: 'AI.' }] },
    ])
    await controller.setTranslationLock(true)
    const before = book.source(0)
    expect(await controller.undoEntries([run.entry!])).toBe('locked')
    expect(book.source(0)).toBe(before)
    expect(notices).toContain('editLocked')
  })
})

describe('the reader marks', () => {
  interface FakeWindow {
    Highlight: new (...ranges: Range[]) => { ranges: Range[]; priority?: number }
    CSS: { highlights: Map<string, { ranges: Range[] }> }
  }

  function frame(): { doc: Document; registry: Map<string, { ranges: Range[] }> } {
    const doc = document.implementation.createHTMLDocument('c')
    doc.body.innerHTML =
      '<p data-epub-block="b1">One.</p><p data-epub-block="b2">Two.</p><p data-epub-block="b3">Three.</p>'
    const registry = new Map<string, { ranges: Range[] }>()
    const win = {
      Highlight: class {
        ranges: Range[]
        priority?: number
        constructor(...ranges: Range[]) {
          this.ranges = ranges
        }
      },
      CSS: { highlights: registry },
    } satisfies FakeWindow
    Object.defineProperty(doc, 'defaultView', { value: win })
    return { doc, registry }
  }

  it('highlights the changed blocks without touching the chapter’s DOM, and takes the marks off', () => {
    const { doc, registry } = frame()
    const markup = doc.body.innerHTML
    showAiMarks(doc, new Set(['b1', 'b3']))
    const marked = registry.get(AI_CHANGED_HIGHLIGHT)!.ranges.map((r) => r.toString())
    expect(marked).toEqual(['One.', 'Three.'])
    expect(doc.body.innerHTML).toBe(markup)
    showAiMarks(doc, null)
    expect(registry.has(AI_CHANGED_HIGHLIGHT)).toBe(false)
  })

  it('the frame style carries the mark colours from the shared tokens', () => {
    const css = viewPrefsCss(
      { fontScale: 1, lineHeight: null, dark: false },
      {
        paper: 'p',
        ink: 'i',
        nightPaper: 'np',
        nightInk: 'ni',
        nightLink: 'nl',
        sepiaPaper: 'sp',
        sepiaInk: 'si',
        hitBg: 'hb',
        hitInk: 'hi',
        aiChangedBg: 'var-ai-bg',
        aiChangedLine: 'var-ai-line',
      },
    )
    expect(css).toContain(`::highlight(${AI_CHANGED_HIGHLIGHT}) { background-color: var-ai-bg;`)
  })
})

// ── the card in the panel ──

const STATUSES = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
} as SubscriptionStatusMap

/** The stream answers each request with the next scripted reply. */
function scriptedApi(replies: Array<Array<Partial<AiStreamChunk>>>): EpubApi {
  let listener: ((chunk: AiStreamChunk) => void) | null = null
  let n = 0
  return {
    getLanguage: async () => 'en',
    onLanguageChanged: () => () => {},
    getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
    setAiSettings: async () => {},
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: async () => {},
    aiToolCapabilities: async () => ({}),
    readAttachmentImage: async () => ({ ok: false }),
    subscription: {
      statuses: vi.fn(async () => STATUSES),
      recheck: vi.fn(async () => STATUSES),
      onChanged: () => () => {},
    },
    onAiStream: (next: (chunk: AiStreamChunk) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
    aiStream: async (request: AiStreamRequest) => {
      const reply = replies[n++] ?? [{ type: 'delta', text: 'ok' }, { type: 'done' }]
      for (const chunk of reply)
        listener?.({ requestId: request.requestId, ...chunk } as AiStreamChunk)
    },
    aiStreamCancel: async () => {},
  } as unknown as EpubApi
}

function editReply(id: string, blockId: string, text: string): Array<Partial<AiStreamChunk>> {
  return [
    {
      type: 'tool-call',
      toolCall: {
        id,
        name: 'edit_blocks',
        input: { ops: [{ op: 'replace', chapter: 1, blockId, text }] },
      },
    } as Partial<AiStreamChunk>,
    { type: 'done' },
  ]
}

function summaryOf(book: FakeBook): EpubBookSummary {
  return {
    opfPath: 'OEBPS/content.opf',
    version: '3',
    metadata: {
      title: 'A Small Book',
      titles: ['A Small Book'],
      creators: [],
      languages: ['en'],
      identifiers: [],
      uniqueIdentifier: null,
      layout: 'reflowable',
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
      fixedLayout: false,
    })),
    pageProgressionDirection: null,
    toc: { source: 'spine', entries: [] },
    fixedLayout: false,
    verticalWriting: false,
  }
}

let container: HTMLElement
let unmount: () => void = () => {}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  Element.prototype.scrollTo = () => undefined
})
afterEach(() => {
  unmount()
  unmount = () => {}
  document.body.innerHTML = ''
  delete (window as { epubApi?: unknown }).epubApi
  delete (window as { projectApi?: unknown }).projectApi
  vi.unstubAllGlobals()
})

async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountPanel(replies: Array<Array<Partial<AiStreamChunk>>>) {
  const { book, controller } = controllerOf([{ body: P3 }])
  const summary = summaryOf(book)
  const marks: Array<BookMarks | null> = []
  Object.assign(window, {
    epubApi: scriptedApi(replies),
    projectApi: {
      resolveChat: vi.fn(async () => ({ projectId: 'doc', chatId: 'doc-chat' })),
      appendChat: vi.fn(async () => {}),
      loadChat: vi.fn(async () => []),
      rebindChat: vi.fn(async () => null),
    },
  })
  const host: BookAiHost = {
    book: () => summary,
    readChapter: (i) => book.readChapter(i),
    editor: () => controller,
    view: () => null,
    showChangeMarks: (next) => void marks.push(next),
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(AiPanel, { host, filePath: 'C:/b.epub', onCollapse: () => {} }),
      }),
    )
  })
  unmount = () => act(() => root.unmount())
  await settle()
  return { book, controller, marks }
}

async function send(text: string): Promise<void> {
  const box = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
  await settle()
}

const cards = () => [...container.querySelectorAll<HTMLElement>('.ai-run-changes')]
const revertOf = (card: HTMLElement) =>
  card.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!

describe('the changes card in the panel', () => {
  it('a run that changed the book gets the card; its revert takes the run back and the marks off', async () => {
    const { book, marks } = await mountPanel([editReply('c1', 'b2', 'BETA two.')])
    const stored = book.source(0)
    await send('make it loud')
    expect(book.source(0)).toContain('BETA two.')
    expect(cards()).toHaveLength(1)
    expect(cards()[0]!.dataset.state).toBe('applied')
    expect(cards()[0]!.querySelector('.ai-run-changes-title')!.textContent).toContain('1')
    expect([...marks.at(-1)!.get(0)!]).toEqual(['b2'])
    expect(cards()[0]!.querySelector('[data-action="ai-changes-unmark"]')).not.toBeNull()

    await act(async () => revertOf(cards()[0]!).click())
    await settle()
    expect(book.source(0)).toBe(stored)
    expect(cards()[0]!.dataset.state).toBe('reverted')
    expect(marks.at(-1)).toBeNull()
  })

  it('refuses when the person edited after the run, and the next run takes the marks off', async () => {
    const { book, controller, marks } = await mountPanel([
      editReply('c1', 'b2', 'BETA two.'),
      [{ type: 'delta', text: 'nothing to do' }, { type: 'done' }],
    ])
    await send('make it loud')
    await controller.applyEdits(0, [{ op: 'replace', blockId: 'b1', text: 'mine.' }])
    const before = book.source(0)
    await act(async () => revertOf(cards()[0]!).click())
    await settle()
    expect(cards()[0]!.dataset.state).toBe('refused')
    expect(book.source(0)).toBe(before)

    expect(marks.at(-1)).not.toBeNull()
    await send('anything else?')
    expect(marks.at(-1)).toBeNull()
    // a run without edits gets no card
    expect(cards()).toHaveLength(1)
  })
})
