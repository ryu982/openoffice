import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultAiSettings, type AiStreamChunk, type AiStreamRequest } from '@genoffice/ai-provider'
import type { SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { AI_CHANGES_LABELS } from '@genoffice/ui'
import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { aiStrings } from '../src/renderer/i18n/strings-ai'

/**
 * The changes card under the reply of a run that changed the page: one per
 * changing run, the count the app reports, the marks it controls, and the
 * snapshot rollback it drives. The provider is never reached: the stream
 * channel plays scripted chunks back.
 */

const LABELS = AI_CHANGES_LABELS.zh
const DOC = '<!doctype html><html><head><title>T</title></head><body><h1>Hello</h1></body></html>'
const READY: SubscriptionStatusMap = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
}
const H1_SID = buildParseMap(DOC, 1, null).elements.find((e) => e.tag === 'h1')!.sid

type Script = Array<Array<Partial<AiStreamChunk>>>

/** the model's turns, in order: an edit turn calls apply_ops, the turn after it answers */
const editRun = (): Script => [
  [
    {
      type: 'tool-call',
      toolCall: {
        id: 'c-edit',
        name: 'apply_ops',
        input: { ops: [{ op: 'set_text', sid: H1_SID, text: 'Hi' }] },
      },
    },
    { type: 'done' },
  ],
  [{ type: 'delta', text: 'Done.' }, { type: 'done' }],
]
const answerRun = (): Script => [[{ type: 'delta', text: 'It says Hello.' }, { type: 'done' }]]

function fakeMain() {
  const script: Script = []
  let streamListener: ((chunk: AiStreamChunk) => void) | null = null
  const settings = { ...defaultAiSettings(), subscriptionNoticeSeen: true }
  const htmlApi = {
    getAiSettings: async () => settings,
    setAiSettings: async () => undefined,
    onAiSettingsChanged: () => () => undefined,
    openAiModelSettings: vi.fn(async () => undefined),
    setAiPanelPrefs: vi.fn(async () => ({})),
    subscription: {
      statuses: vi.fn(async () => READY),
      recheck: vi.fn(async () => READY),
      onChanged: () => () => undefined,
    },
    onAiStream: (listener: (chunk: AiStreamChunk) => void) => {
      streamListener = listener
      return () => {
        streamListener = null
      }
    },
    aiStream: async (request: AiStreamRequest) => {
      for (const chunk of script.shift() ?? [{ type: 'done' }]) {
        streamListener?.({ requestId: request.requestId, ...chunk } as AiStreamChunk)
      }
    },
    aiStreamCancel: async () => undefined,
  }
  return { htmlApi, script }
}

function fakeDeps() {
  const map = buildParseMap(DOC, 1, null)
  const calls: string[] = []
  const restored: string[] = []
  const deps: HtmlAiDeps = {
    access: {
      getText: () => DOC,
      getVersion: () => 1,
      getMap: () => map,
      getLastManualVersion: () => 0,
      getFilePath: () => null,
      getSelectedSid: () => null,
      applyOps: () => ({ ok: true, ranges: [[0, 1]] }),
      replaceAll: () => undefined,
    },
    getSnapshot: () => ({ text: `${DOC}<!-- ${restored.length + calls.length} -->` }),
    restoreSnapshot: (snapshot) => {
      restored.push(snapshot.text)
    },
    onPrompt: () => undefined,
    onRunDone: () => undefined,
    clearHighlights: () => {
      calls.push('clear')
    },
    changedPlaces: () => 2,
    navigateTo: () => undefined,
    onBriefConfirmed: () => undefined,
    previewDraft: () => undefined,
  }
  return { deps, calls, restored }
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollTo = () => undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as { htmlApi?: unknown }).htmlApi
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function render(deps: HtmlAiDeps, marksShown: boolean) {
  act(() =>
    root.render(
      createElement(AiPanel, {
        deps,
        filePath: null,
        editQueue: [],
        onQueueEditInstruction: () => undefined,
        onQueueRemove: () => undefined,
        onQueueClear: () => undefined,
        onQueueFocus: () => undefined,
        onQueueConsume: () => undefined,
        onCollapse: () => undefined,
        marksShown,
      }),
    ),
  )
}

async function mount(marksShown = true) {
  const main = fakeMain()
  Object.assign(window, { htmlApi: main.htmlApi })
  const fake = fakeDeps()
  render(fake.deps, marksShown)
  await settle()
  return { ...main, ...fake }
}

async function send(text: string) {
  const composer = host.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(composer, text)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => host.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
  await settle()
}

const cards = () => [...host.querySelectorAll('.ai-run-changes')]
const states = () => cards().map((card) => card.getAttribute('data-state'))
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  act(() => (el as HTMLElement).click())
  await settle()
}

describe('the changes card of an html run', () => {
  it('replaces the snapshot footer with one card under the run, counted by the app', async () => {
    const main = await mount()
    main.script.push(...editRun())
    await send('shorter title')

    expect(host.querySelector('.ai-versions')).toBeNull()
    expect(states()).toEqual(['applied'])
    expect(cards()[0]!.querySelector('.ai-run-changes-title')!.textContent).toBe(
      LABELS.changedCount(2),
    )
    // the marks went at the start of the run, and stay after it
    expect(main.calls).toEqual(['clear'])
    await click(host.querySelector('[data-action="ai-changes-unmark"]'))
    expect(main.calls).toEqual(['clear', 'clear'])
    expect(states()).toEqual(['applied'])
  })

  it('offers to take the marks off only while the app shows them', async () => {
    const main = await mount(false)
    main.script.push(...editRun())
    await send('shorter title')
    expect(states()).toEqual(['applied'])
    expect(host.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    render(main.deps, true)
    await settle()
    expect(host.querySelector('[data-action="ai-changes-unmark"]')).not.toBeNull()
  })

  it('takes an older run back with the later ones, and a run without changes gets no card', async () => {
    const main = await mount()
    main.script.push(...editRun())
    await send('first')
    main.script.push(...answerRun())
    await send('what does it say?')
    main.script.push(...editRun())
    await send('second')

    expect(states()).toEqual(['applied', 'applied'])
    const [first, second] = cards()
    expect(first!.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    expect(second!.querySelector('[data-action="ai-changes-unmark"]')).not.toBeNull()
    const revertFirst = first!.querySelector<HTMLButtonElement>(
      '[data-action="ai-changes-revert"]',
    )!
    expect(revertFirst.title).toBe(LABELS.revertLaterTitle)

    const clearsBefore = main.calls.length
    await click(revertFirst)
    // the snapshot from before the first run's first change
    expect(main.restored).toHaveLength(1)
    expect(main.restored[0]).toContain('<!-- 1 -->')
    expect(states()).toEqual(['reverted', 'reverted'])
    expect(main.calls.length).toBe(clearsBefore + 1)
  })

  it('turns a card expired once its snapshot is pushed out of the ring of 20', async () => {
    const main = await mount()
    for (let i = 0; i < 21; i++) {
      main.script.push(...editRun())
      await send(`edit ${i}`)
    }
    const all = states()
    expect(all).toHaveLength(21)
    expect(all[0]).toBe('expired')
    expect(all.slice(1).every((state) => state === 'applied')).toBe(true)
    expect(cards()[0]!.querySelector('[data-action="ai-changes-revert"]')).toBeNull()
  })

  it('drops the cards and the marks with a new chat', async () => {
    const main = await mount()
    main.script.push(...editRun())
    await send('shorter title')
    expect(cards()).toHaveLength(1)
    const before = main.calls.length
    await click(host.querySelector(`.ai-header-btn[aria-label="${aiStrings.zh.aiNewChat}"]`))
    expect(cards()).toHaveLength(0)
    expect(main.calls.length).toBeGreaterThan(before)
  })
})
