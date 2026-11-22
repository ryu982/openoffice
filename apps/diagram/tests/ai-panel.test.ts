/**
 * The diagram's AI panel against a scripted main process and a fake draw.io:
 * the model's answers are written out here as stream chunks, so no provider
 * is ever reached. The settings resolve to a subscription provider (Claude is
 * `ready`), which is exactly why the stream channel below is a fake: nothing
 * in these tests can start a `claude` or `codex` program.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  defaultAiSettings,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
} from '@genoffice/ai-provider'
import type { SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { LANGS, PRODUCT_NAME, type Lang } from '@genoffice/i18n'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { aiStrings } from '../src/renderer/i18n/strings-ai'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { diagramAiHost, type DiagramFrameHost } from '../src/renderer/ai/AiDock'
import type { DiagramApi } from '../src/shared/ipc'
import { fakeFrame } from './helpers/fake-drawio'

const statuses: SubscriptionStatusMap = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
}

const ready = (): AiSettings => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true })

type Reply = (request: AiStreamRequest, nth: number) => Array<Partial<AiStreamChunk>>

function fakeApi(reply: Reply) {
  let streamListener: ((chunk: AiStreamChunk) => void) | null = null
  const requests: AiStreamRequest[] = []
  const titles: string[] = []
  const api = {
    getLanguage: async () => 'en' as Lang,
    onLanguageChanged: () => () => {},
    getAiSettings: async () => ready(),
    setAiSettings: async () => {},
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: async () => {},
    getAiPanelPrefs: async () => ({}),
    onAiPanelPrefsChanged: () => () => {},
    setProvisionalTitle: (title: string) => void titles.push(title),
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    readAttachmentImage: async () => ({ ok: false }),
    subscription: {
      statuses: vi.fn(async () => statuses),
      recheck: vi.fn(async () => statuses),
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses })),
      onChanged: () => () => {},
      openInstallHelp: vi.fn(async () => undefined),
    },
    onAiStream: (listener: (chunk: AiStreamChunk) => void) => {
      streamListener = listener
      return () => {
        streamListener = null
      }
    },
    // the one way a run reaches a model: scripted here, no program is started
    aiStream: async (request: AiStreamRequest) => {
      requests.push(request)
      for (const chunk of reply(request, requests.length)) {
        streamListener?.({ requestId: request.requestId, ...chunk } as AiStreamChunk)
      }
    },
    aiStreamCancel: async () => {},
  }
  return { api: api as unknown as DiagramApi, requests, titles }
}

const toolCall = (name: string, input: Record<string, unknown>) => [
  { type: 'tool-call', toolCall: { id: 'call-1', name, input } },
  { type: 'done' },
]

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
  delete (window as { diagramApi?: unknown }).diagramApi
  vi.unstubAllGlobals()
})

async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(
  api: DiagramApi,
  fake: ReturnType<typeof fakeFrame>,
  host: DiagramFrameHost = diagramAiHost({ client: () => fake.frame, ready: () => true }),
): Promise<void> {
  ;(window as unknown as { diagramApi: DiagramApi }).diagramApi = api
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(AiPanel, { host, filePath: null, onCollapse: () => {} }),
      }),
    )
  })
  unmount = () => act(() => root.unmount())
  await settle()
}

async function sendMessage(text: string): Promise<void> {
  const box = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
  await settle(24)
}

/** the cards under the replies of runs that changed the diagram */
const cards = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.ai-run-changes')]

const revertButton = (card: HTMLElement) =>
  card.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')

describe('a run', () => {
  it('sends the page on screen as text with the diagram tools, and no picture', async () => {
    const drawio = fakeFrame()
    drawio.drawio.selected = ['a']
    const { api, requests, titles } = fakeApi(() => [
      { type: 'delta', text: 'Two shapes.' },
      { type: 'done' },
    ])
    await mount(api, drawio)
    await sendMessage('what is on this page?')
    expect(requests).toHaveLength(1)
    const request = requests[0] as AiStreamRequest & {
      system: string
      tools: Array<{ name: string }>
      messages: Array<{ role: string; content?: unknown; images?: unknown }>
    }
    expect(request.tools.map((tool) => tool.name).sort()).toEqual(
      ['apply_diagram_ops', 'read_attachment', 'read_diagram', 'read_url', 'web_search'].sort(),
    )
    expect(request.system).toContain(`${PRODUCT_NAME} Diagram`)
    const sent = JSON.stringify(request.messages)
    expect(sent).toContain('<diagram_page>')
    expect(sent).toContain('Selected: a')
    expect(sent).toContain('a | Start')
    // the model never gets a picture of the diagram
    expect(request.messages.some((message) => message.images !== undefined)).toBe(false)
    expect(sent).not.toMatch(/data:image|"type":"image"/)
    // an untitled diagram takes its tab name from the first request
    expect(titles).toEqual(['what is on this page?'])
  })

  it('applies a mixed call as one bridge request, and the turn is taken back in one go', async () => {
    const drawio = fakeFrame()
    const before = drawio.drawio.snapshot()
    const { api, requests } = fakeApi((_request, nth) =>
      nth === 1
        ? toolCall('apply_diagram_ops', {
            ops: [
              { op: 'insert_mermaid', text: 'graph LR\n  Go --> Stop' },
              { op: 'update', id: 'a', label: 'Begin' },
            ],
          })
        : [{ type: 'delta', text: 'Drew it.' }, { type: 'done' }],
    )
    await mount(api, drawio)
    await sendMessage('draw a flow')
    expect(requests).toHaveLength(2)
    expect(drawio.calls.filter((op) => op === 'applyBatch')).toHaveLength(1)
    expect(drawio.drawio.history).toHaveLength(1)
    expect(JSON.stringify(requests[1]!.messages)).toContain('Applied 2 op(s) as one undo step.')
    expect(container.textContent).toContain('Drew a Mermaid diagram')

    // one card under the run's reply: the drawing's four cells and the renamed shape, marked on screen
    expect(cards()).toHaveLength(1)
    expect(cards()[0]!.closest('.ai-msg-assistant')?.textContent).toContain('Drew it.')
    expect(cards()[0]!.textContent).toContain('Changes made to the document: 5')
    expect(drawio.marks().sort()).toEqual(
      ['p1:a', 'p1:drawio-1', 'p1:drawio-2', 'p1:drawio-3', 'p1:drawio-4'].sort(),
    )
    // marking is not a change: draw.io's history holds the call alone
    expect(drawio.drawio.history).toHaveLength(1)

    await act(async () => revertButton(cards()[0]!)!.click())
    await settle()
    expect(drawio.drawio.snapshot()).toBe(before)
    expect(cards()[0]!.dataset.state).toBe('reverted')
    expect(revertButton(cards()[0]!)).toBeNull()
    expect(drawio.marks()).toEqual([])
  })

  it('marks only the last run, hides the marks on request, and takes later runs back with an earlier one', async () => {
    const drawio = fakeFrame()
    const before = drawio.drawio.snapshot()
    const { api } = fakeApi((_request, nth) => {
      if (nth === 1)
        return toolCall('apply_diagram_ops', { ops: [{ op: 'update', id: 'a', label: 'One' }] })
      if (nth === 3) {
        return toolCall('apply_diagram_ops', {
          ops: [
            { op: 'add_shape', id: 'n', label: 'New', x: 0, y: 200 },
            { op: 'delete', ids: ['b'] },
          ],
        })
      }
      return [{ type: 'delta', text: `Done ${nth}.` }, { type: 'done' }]
    })
    await mount(api, drawio)
    await sendMessage('rename a')
    expect(drawio.marks()).toEqual(['p1:a'])
    await sendMessage('add one, drop b')
    // the new run's marks replace the last run's; a removed cell has no mark, but counts
    expect(drawio.marks()).toEqual(['p1:n'])
    expect(cards()).toHaveLength(2)
    expect(cards()[1]!.textContent).toContain('Changes made to the document: 3')
    expect(cards()[0]!.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    expect(revertButton(cards()[0]!)!.getAttribute('title')).toBe(
      'Undo this turn and every AI turn after it',
    )

    act(() =>
      cards()[1]!.querySelector<HTMLButtonElement>('[data-action="ai-changes-unmark"]')!.click(),
    )
    await settle()
    expect(drawio.marks()).toEqual([])
    expect(cards()[1]!.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()

    await act(async () => revertButton(cards()[0]!)!.click())
    await settle()
    expect(drawio.drawio.snapshot()).toBe(before)
    expect(cards().map((card) => card.dataset.state)).toEqual(['reverted', 'reverted'])
  })

  it('says so when the diagram was changed after the run, and leaves it as it is', async () => {
    const drawio = fakeFrame()
    const { api } = fakeApi((_request, nth) =>
      nth === 1
        ? toolCall('apply_diagram_ops', { ops: [{ op: 'update', id: 'a', label: 'AI' }] })
        : [{ type: 'delta', text: 'Renamed.' }, { type: 'done' }],
    )
    await mount(api, drawio)
    await sendMessage('rename a')
    // the person edits after the AI
    drawio.drawio.beginUpdate()
    drawio.drawio.renamePage('p1', 'Mine')
    drawio.drawio.endUpdate()
    const edited = drawio.drawio.snapshot()

    await act(async () => revertButton(cards()[0]!)!.click())
    await settle()
    expect(drawio.drawio.snapshot()).toBe(edited)
    expect(cards()[0]!.dataset.state).toBe('refused')
    expect(cards()[0]!.textContent).toContain('Ctrl+Z')
  })

  it('a new run and a new chat take the marks off', async () => {
    const drawio = fakeFrame()
    const { api } = fakeApi((_request, nth) =>
      nth === 1 || nth === 4
        ? toolCall('apply_diagram_ops', { ops: [{ op: 'update', id: 'a', label: `Run ${nth}` }] })
        : [{ type: 'delta', text: 'Done.' }, { type: 'done' }],
    )
    await mount(api, drawio)
    await sendMessage('rename a')
    expect(drawio.marks()).toEqual(['p1:a'])
    await sendMessage('just talk')
    expect(drawio.marks()).toEqual([])
    expect(cards()).toHaveLength(1)

    await sendMessage('rename it again')
    expect(drawio.marks()).toEqual(['p1:a'])
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click())
    await settle()
    expect(drawio.marks()).toEqual([])
    expect(cards()).toHaveLength(0)
  })

  it('draws the marks again when draw.io starts anew (a language change), and keeps them off once hidden', async () => {
    const first = fakeFrame()
    let frame = first
    let up = true
    const host = diagramAiHost({ client: () => frame.frame, ready: () => up })
    const { api } = fakeApi((_request, nth) =>
      nth === 1
        ? toolCall('apply_diagram_ops', { ops: [{ op: 'update', id: 'a', label: 'AI' }] })
        : [{ type: 'delta', text: 'Renamed.' }, { type: 'done' }],
    )
    await mount(api, first, host)
    await sendMessage('rename a')
    expect(first.marks()).toEqual(['p1:a'])
    const unmark = () =>
      cards()[0]!.querySelector<HTMLButtonElement>('[data-action="ai-changes-unmark"]')

    // the frame restarts with the same diagram: a new bridge that has no marks
    up = false
    frame = fakeFrame(first.drawio)
    host.frameReady()
    expect(frame.calls).not.toContain('markCells')
    up = true
    await act(async () => host.frameReady())
    await settle()
    expect(frame.marks()).toEqual(['p1:a'])
    // the card's "Hide marks" still means what it says, and marking is not a change
    expect(unmark()).not.toBeNull()
    expect(first.drawio.history).toHaveLength(1)

    // hidden while draw.io starts again: the next frame comes up without them
    up = false
    frame = fakeFrame(first.drawio)
    act(() => unmark()!.click())
    await settle()
    expect(unmark()).toBeNull()
    up = true
    await act(async () => host.frameReady())
    await settle()
    expect(frame.marks()).toEqual([])
    expect(frame.calls.filter((op) => op === 'markCells')).toHaveLength(0)
  })

  it('reports a refused call to the model and leaves the diagram as it was', async () => {
    const drawio = fakeFrame()
    const before = drawio.drawio.snapshot()
    const { api, requests } = fakeApi((_request, nth) =>
      nth === 1
        ? toolCall('apply_diagram_ops', {
            ops: [
              { op: 'add_shape', label: 'Fine', x: 0, y: 200 },
              { op: 'delete', ids: ['nope'] },
            ],
          })
        : [{ type: 'delta', text: 'One op was refused.' }, { type: 'done' }],
    )
    await mount(api, drawio)
    await sendMessage('change it')
    expect(JSON.stringify(requests[1]!.messages)).toContain('Nothing was changed')
    expect(drawio.calls).not.toContain('applyBatch')
    expect(drawio.drawio.snapshot()).toBe(before)
    expect(container.textContent).toContain('The diagram was not changed')
    expect(cards()).toHaveLength(0)
    expect(drawio.calls).not.toContain('markCells')
  })
})

describe('the panel strings', () => {
  it('has the same keys in every UI language, filled and translated', () => {
    const keys = Object.keys(aiStrings.zh).sort()
    expect(Object.keys(aiStrings)).toHaveLength(LANGS.length)
    for (const lang of LANGS) {
      expect(Object.keys(aiStrings[lang]).sort(), lang).toEqual(keys)
      for (const key of keys) {
        expect(aiStrings[lang][key as keyof typeof aiStrings.zh], `${lang}.${key}`).not.toBe('')
      }
      if (lang !== 'en') {
        expect(aiStrings[lang].aiEmptyBody, lang).not.toBe(aiStrings.en.aiEmptyBody)
        expect(aiStrings[lang].aiToolApplyOpsFailed, lang).not.toBe(
          aiStrings.en.aiToolApplyOpsFailed,
        )
      }
    }
  })
})
