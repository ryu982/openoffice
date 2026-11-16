import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { normalizeAiSettings, type SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { AI_CHANGES_LABELS } from '@genoffice/ui'
import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'
import { markDocSeen } from '../src/renderer/ai/tools'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { strings } from '../src/renderer/i18n/strings'

// The changes card under the reply of a run that changed the note, and the
// marks it controls, against a real editor and a fake preload bridge. No
// provider is called: the test plays the main process's chunks back.

type Chunk = Record<string, unknown> & { type: string }

const LABELS = AI_CHANGES_LABELS.zh
const READY = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
} as SubscriptionStatusMap

function installBridge() {
  const settings = { ...normalizeAiSettings(undefined), subscriptionNoticeSeen: true }
  const streamListeners = new Set<(chunk: Chunk) => void>()
  const requests: Array<{ requestId: string }> = []
  const api = {
    getAiSettings: vi.fn(async () => settings),
    setAiSettings: vi.fn(async () => {}),
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: vi.fn(async () => {}),
    setAiPanelPrefs: vi.fn(async () => ({})),
    aiStream: vi.fn(async (request: { requestId: string }) => {
      requests.push(request)
    }),
    aiStreamCancel: vi.fn(async () => {}),
    onAiStream: (listener: (chunk: Chunk) => void) => {
      streamListeners.add(listener)
      return () => streamListeners.delete(listener)
    },
    aiSubscription: {
      statuses: vi.fn(async () => READY),
      recheck: vi.fn(async () => READY),
      onChanged: () => () => {},
    },
    aiToolCapabilities: vi.fn(async () => ({ imageGeneration: { available: false } })),
  }
  Object.defineProperty(window, 'markdownApi', { configurable: true, value: api })
  Object.defineProperty(window, 'projectApi', { configurable: true, value: undefined })
  return {
    requests,
    emit: (chunk: Chunk) => {
      const requestId = requests.at(-1)!.requestId
      for (const listener of [...streamListeners]) listener({ requestId, ...chunk })
    },
  }
}

const mounted: Array<{ root: Root; container: HTMLElement; editor: Editor }> = []

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountPanel(markdown: string) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  const restored: string[] = []
  const deps: MarkdownAiDeps = {
    getEditor: () => editor,
    getFrontmatter: () => '',
    setFrontmatter: () => {},
    getSnapshot: () => ({ body: editor.getMarkdown(), frontmatter: '' }),
    restoreSnapshot: (snapshot) => {
      restored.push(snapshot.body)
      editor.commands.setContent(snapshot.body, { contentType: 'markdown' })
      // the model reads the note again before its next index edit
      markDocSeen(editor)
    },
    onRunDone: () => {},
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(AiPanel, { deps, filePath: null, onCollapse: () => {} })))
  mounted.push({ root, container, editor })
  await settle()
  return { container, editor, restored }
}

async function send(container: HTMLElement, text: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
  await settle()
}

/** one run: the model replaces `find` in block `block`, then answers */
async function runEdit(
  bridge: ReturnType<typeof installBridge>,
  container: HTMLElement,
  block: number,
  find: string,
  replace: string,
): Promise<void> {
  await send(container, `change ${find}`)
  const ops = [{ op: 'replaceText', target: { start: block }, find, replace }]
  act(() => {
    bridge.emit({
      type: 'tool-call',
      toolCall: { id: `c-${find}`, name: 'apply_ops', input: { ops } },
    })
    bridge.emit({ type: 'done' })
  })
  await settle()
  act(() => {
    bridge.emit({ type: 'delta', text: 'Done.' })
    bridge.emit({ type: 'done' })
  })
  await settle()
}

const cards = (container: HTMLElement) => [...container.querySelectorAll('.ai-run-changes')]
const states = (container: HTMLElement) =>
  cards(container).map((card) => card.getAttribute('data-state'))
const marked = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.ai-changed-mark')].map((el) => el.textContent)
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  act(() => (el as HTMLElement).click())
  await settle()
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => {
  for (const { root, container, editor } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  }
  vi.unstubAllGlobals()
})

describe('the changes card of a markdown run', () => {
  it('counts the changed blocks and keeps the marks after the run until they are taken off', async () => {
    const bridge = installBridge()
    const { container, editor } = await mountPanel('alpha\n\nbeta')
    await runEdit(bridge, container, 0, 'alpha', 'ALPHA')

    expect(states(container)).toEqual(['applied'])
    expect(cards(container)[0]!.querySelector('.ai-run-changes-title')!.textContent).toBe(
      LABELS.changedCount(1),
    )
    // the run is over and the marks are still there; the old snapshot footer is gone
    expect(marked(editor)).toEqual(['ALPHA'])
    expect(container.querySelector('.ai-versions')).toBeNull()

    await click(container.querySelector('[data-action="ai-changes-unmark"]'))
    expect(marked(editor)).toEqual([])
    expect(container.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    // the run itself stays applied and can still be taken back
    expect(states(container)).toEqual(['applied'])
    expect(editor.getMarkdown()).toContain('ALPHA')
  })

  it('marks only the newest run, and taking an older run back takes the later ones with it', async () => {
    const bridge = installBridge()
    const { container, editor, restored } = await mountPanel('alpha\n\nbeta')
    await runEdit(bridge, container, 0, 'alpha', 'ALPHA')
    await runEdit(bridge, container, 1, 'beta', 'BETA')

    expect(states(container)).toEqual(['applied', 'applied'])
    expect(marked(editor)).toEqual(['BETA'])
    const [first, second] = cards(container)
    // the clear button belongs to the run whose changes are marked
    expect(first!.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    expect(second!.querySelector('[data-action="ai-changes-unmark"]')).not.toBeNull()
    const revertFirst = first!.querySelector<HTMLButtonElement>(
      '[data-action="ai-changes-revert"]',
    )!
    expect(revertFirst.title).toBe(LABELS.revertLaterTitle)
    expect(
      second!.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!.title,
    ).toBe(LABELS.revertTitle)

    await click(revertFirst)
    expect(restored).toHaveLength(1)
    expect(editor.getMarkdown()).toContain('alpha')
    expect(editor.getMarkdown()).toContain('beta')
    expect(states(container)).toEqual(['reverted', 'reverted'])
    expect(marked(editor)).toEqual([])
  })

  it('takes the marks off when the next run starts and when a new chat begins', async () => {
    const bridge = installBridge()
    const { container, editor } = await mountPanel('alpha\n\nbeta')
    await runEdit(bridge, container, 0, 'alpha', 'ALPHA')
    expect(marked(editor)).toEqual(['ALPHA'])

    await send(container, 'what does it say?')
    expect(marked(editor)).toEqual([])
    act(() => {
      bridge.emit({ type: 'delta', text: 'It says ALPHA.' })
      bridge.emit({ type: 'done' })
    })
    await settle()
    // a run that changed nothing gets no card
    expect(cards(container)).toHaveLength(1)

    await runEdit(bridge, container, 1, 'beta', 'BETA')
    expect(marked(editor)).toEqual(['BETA'])
    await click(container.querySelector(`.ai-header-btn[aria-label="${strings.zh.aiNewChat}"]`))
    expect(cards(container)).toHaveLength(0)
    expect(marked(editor)).toEqual([])
  })

  it('turns a card expired once its snapshot is pushed out of the ring of 20', async () => {
    const bridge = installBridge()
    const { container } = await mountPanel('w0')
    for (let i = 0; i < 21; i++) await runEdit(bridge, container, 0, `w${i}`, `w${i + 1}`)
    const all = states(container)
    expect(all).toHaveLength(21)
    expect(all[0]).toBe('expired')
    expect(all.slice(1).every((state) => state === 'applied')).toBe(true)
    expect(cards(container)[0]!.querySelector('[data-action="ai-changes-revert"]')).toBeNull()
    expect(cards(container)[0]!.querySelector('.ai-run-changes-note')!.textContent).toBe(
      LABELS.expired.replace('Ctrl+Z', navigator.platform.includes('Mac') ? '⌘Z' : 'Ctrl+Z'),
    )
  })
})
