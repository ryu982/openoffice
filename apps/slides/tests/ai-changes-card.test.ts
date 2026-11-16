/**
 * The changes card under a slides AI run: it replaces the old "Roll back"
 * toolbar button, counts what the run changed, rolls back through the
 * main-process ring, and hands the run's marks to the app until they go.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderNode, RenderSlide } from '@genoffice/pptx-render'

const agentHarness = vi.hoisted(() => ({
  events: null as null | {
    onDone?: (result: { text: string; cancelled: boolean; turnLimit: boolean }) => void
  },
  run: vi.fn(),
}))

vi.mock('@genoffice/agent-core', async () => {
  const actual =
    await vi.importActual<typeof import('@genoffice/agent-core')>('@genoffice/agent-core')
  return {
    ...actual,
    AgentLoop: class MockAgentLoop {
      busy = false
      constructor(options: { events?: typeof agentHarness.events }) {
        agentHarness.events = options.events ?? null
      }
      run(...args: unknown[]) {
        agentHarness.run(...args)
      }
      cancel() {}
      reset() {}
      restore() {}
    },
  }
})

vi.mock('../src/renderer/ai/transport', () => ({
  createElectronTransport: () => ({}),
}))

// react-konva's node entry requires the native 'canvas' package; these tests do not draw.
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import type { DeckMarks } from '../src/renderer/ai/run-changes'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((provider) => [
      provider.id,
      { apiKey: provider.id === 'anthropic' ? 'test-key' : '', model: provider.defaultModel },
    ]),
  ) as AiSettings['providers'],
}

function node(durableId: string, fill: string): RenderNode {
  return {
    id: durableId,
    type: 'shape',
    sourceId: durableId,
    durableId,
    box: { x: 0, y: 0, w: 10, h: 10, rotationDeg: 0 },
    fill,
  } as unknown as RenderNode
}

const deck = (fill: string, extra: RenderNode[] = []): RenderSlide[] => [
  {
    widthPx: 960,
    heightPx: 540,
    scale: 1,
    background: { kind: 'solid', color: '#ffffff' },
    nodes: [node('e_1', fill), node('e_2', 'x'), ...extra],
    partPath: 'ppt/slides/slide1.xml',
  } as unknown as RenderSlide,
]

let root: Root
let container: HTMLElement
let api: Record<string, ReturnType<typeof vi.fn>>
let nextSnapshot = 1
const marksSeen: Array<DeckMarks | null> = []

function props(slides: RenderSlide[], preset: { text: string; nonce: number } | null) {
  return {
    slides,
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: () => {},
    applyDeck: vi.fn(),
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    onAiMarks: (m: DeckMarks | null) => marksSeen.push(m),
    preset: preset ? { ...preset, autoRun: true } : null,
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

function render(slides: RenderSlide[], preset: { text: string; nonce: number } | null) {
  act(() => root.render(createElement(AiPanel, props(slides, preset))))
}

/** One run: the request goes out, the deck changes under it, the run ends */
async function runOnce(nonce: number, before: RenderSlide[], after: RenderSlide[]) {
  render(before, { text: `request ${nonce}`, nonce })
  await flush()
  render(after, { text: `request ${nonce}`, nonce })
  await act(async () => {
    agentHarness.events!.onDone!({ text: `done ${nonce}`, cancelled: false, turnLimit: false })
  })
  await flush()
}

const cards = () => [...container.querySelectorAll<HTMLElement>('.ai-run-changes')]

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  nextSnapshot = 1
  marksSeen.length = 0
  agentHarness.events = null
  agentHarness.run.mockReset()
  api = {
    beginHistoryBatch: vi.fn(async () => true),
    endHistoryBatch: vi.fn(async () => nextSnapshot++),
    aiSnapshotRestore: vi.fn(async () => deck('a')),
    aiSnapshotAlive: vi.fn(async (ids: number[]) => ids),
    aiLogRunFailure: vi.fn(async () => undefined),
  }
  Object.defineProperty(window, 'slidesApi', { configurable: true, value: api })
  Object.defineProperty(window, 'projectApi', { configurable: true, value: undefined })
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { readAttachmentImage: vi.fn(async () => ({ ok: false })) },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('slides changes card', () => {
  it('a run that changed the deck gets one card with the count, and its elements are marked', async () => {
    await runOnce(1, deck('a'), deck('b', [node('e_3', 'y')]))

    expect(container.querySelector('.ai-rollback-btn')).toBeNull()
    expect(cards()).toHaveLength(1)
    expect(cards()[0]!.dataset.state).toBe('applied')
    expect(cards()[0]!.querySelector('.ai-run-changes-title')!.textContent).toMatch(/2/)
    const last = marksSeen.at(-1)!
    expect([...last.get('ppt/slides/slide1.xml')!].sort()).toEqual(['e_1', 'e_3'])
    // the marks are shown, so the card offers to hide them
    const unmark = cards()[0]!.querySelector<HTMLButtonElement>('[data-action="ai-changes-unmark"]')
    expect(unmark).not.toBeNull()
    act(() => unmark!.click())
    expect(marksSeen.at(-1)).toBeNull()
    expect(cards()[0]!.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
  })

  it('the next run takes the last marks off when it starts', async () => {
    await runOnce(1, deck('a'), deck('b'))
    expect(marksSeen.at(-1)).not.toBeNull()
    render(deck('b'), { text: 'request 2', nonce: 2 })
    await flush()
    expect(marksSeen.at(-1)).toBeNull()
  })

  it('rolling back an older run rolls back the later ones too and clears the marks', async () => {
    await runOnce(1, deck('a'), deck('b'))
    await runOnce(2, deck('b'), deck('c'))
    expect(cards()).toHaveLength(2)
    const [first, second] = cards()
    const firstRevert = first!.querySelector<HTMLButtonElement>(
      '[data-action="ai-changes-revert"]',
    )!
    const secondRevert = second!.querySelector<HTMLButtonElement>(
      '[data-action="ai-changes-revert"]',
    )!
    // only the older card warns that later turns go with it
    expect(firstRevert.title).not.toBe(secondRevert.title)

    await act(async () => firstRevert.click())
    await flush()

    expect(api.aiSnapshotRestore).toHaveBeenCalledWith(1)
    expect(cards().map((c) => c.dataset.state)).toEqual(['reverted', 'reverted'])
    expect(marksSeen.at(-1)).toBeNull()
  })

  it('a point pushed out of the ring turns the card expired; one kept but unusable is refused', async () => {
    await runOnce(1, deck('a'), deck('b'))
    api.aiSnapshotRestore!.mockResolvedValueOnce(null)
    api.aiSnapshotAlive!.mockResolvedValueOnce([])
    await act(async () =>
      cards()[0]!.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!.click(),
    )
    await flush()
    expect(cards()[0]!.dataset.state).toBe('expired')

    await runOnce(2, deck('b'), deck('c'))
    api.aiSnapshotRestore!.mockResolvedValueOnce(null)
    await act(async () =>
      cards()[1]!.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!.click(),
    )
    await flush()
    expect(cards()[1]!.dataset.state).toBe('refused')
  })

  it('a newer run that pushes an older point out of the ring expires its card at once', async () => {
    await runOnce(1, deck('a'), deck('b'))
    api.aiSnapshotAlive!.mockImplementation(async (ids: number[]) => ids.filter((id) => id !== 1))
    await runOnce(2, deck('b'), deck('c'))
    expect(cards().map((c) => c.dataset.state)).toEqual(['expired', 'applied'])
  })

  it('a run that changed nothing gets no card and no marks', async () => {
    api.endHistoryBatch!.mockResolvedValue(null)
    await runOnce(1, deck('a'), deck('a'))
    expect(cards()).toHaveLength(0)
    expect(marksSeen.filter((m) => m !== null)).toHaveLength(0)
  })
})
