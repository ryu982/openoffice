/** @vitest-environment jsdom */
/**
 * The document check's hand-off to the AI panel (DocCheckPanel.tsx), in the order the app
 * goes through: the memo column mounts with the document and sets its lock through the
 * panel's bridge, the user opens the check a little later, and clicks "Hand the fixing to
 * the AI" about a second after that. The check read the document as it opened; a second
 * read 1.2 s on, for a change count from before it opened, made the button busy (disabled)
 * under that click, which was lost, and the AI input box stayed empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentDocumentProfile } from '../studio-plugin/agent-plugin.mjs'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import { DocCheckPanel } from '../src/renderer/check/DocCheckPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { withChangeNotes } from '../src/renderer/recovery-flow'
import type { HwpApi } from '../src/shared/ipc'

/** a form with a table inside a table: one violation the rules always find */
const PROFILE = {
  charShapes: [],
  paragraphs: [{ index: 0, text: '교과협의록' }],
  tables: [{ index: 0, anchor: { para: 1 }, rows: 2, cols: 2, nested: true, titleAbove: '' }],
  pictures: [],
} as unknown as AgentDocumentProfile

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.hwpApi = { onLanguageChanged: () => () => {} } as unknown as HwpApi
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  delete (window as { hwpApi?: unknown }).hwpApi
  vi.useRealTimers()
})

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function render(bridge: AgentBridge, revision: number, onHandOff: (request: string) => void) {
  const panel = createElement(DocCheckPanel, {
    bridge,
    format: 'hwp',
    revision,
    onClose: () => {},
    onHandOff,
  })
  act(() => root!.render(createElement(LocaleProvider, { initial: 'en', children: panel })))
}

const handOffButton = () =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Hand the fixing to the AI',
  )

describe('the document check hands its findings to the AI', () => {
  it('does not count the memo column setting its lock as a change of the document', async () => {
    let revision = 0
    const bridge = withChangeNotes(
      {
        setMemoLock: vi.fn(async (locked: boolean) => ({ ok: true as const, locked })),
        listMemos: vi.fn(async () => ({ count: 0, memos: [] })),
        replaceText: vi.fn(async () => ({ ok: true })),
      },
      () => {
        revision += 1
      },
    )
    // what MemoPanel does as it mounts, closed or not
    await bridge.setMemoLock(false)
    await bridge.listMemos()
    expect(revision).toBe(0)
    await bridge.replaceText()
    expect(revision).toBe(2)
  })

  it('reads the document once on opening, so a click a second later still hands off', async () => {
    const documentProfile = vi.fn(async () => PROFILE)
    const bridge = { documentProfile } as unknown as AgentBridge
    const onHandOff = vi.fn()
    root = createRoot(container)
    // the app counted changes before the check opened (an AI run of earlier, or a call
    // that did change the document)
    render(bridge, 2, onHandOff)
    await wait(0)
    expect(documentProfile).toHaveBeenCalledTimes(1)
    expect(handOffButton()?.disabled).toBe(false)

    // past the delay of a read after a change: nothing is read again, the button stays
    await wait(1300)
    expect(documentProfile).toHaveBeenCalledTimes(1)
    expect(handOffButton()?.disabled).toBe(false)
    act(() => handOffButton()!.click())
    expect(onHandOff).toHaveBeenCalledTimes(1)
    expect(onHandOff.mock.calls[0]![0]).toMatch(/문서 점검에서 걸린 항목/)
  })

  it('reads the document again after a change made while it is open', async () => {
    const documentProfile = vi.fn(async () => PROFILE)
    const bridge = { documentProfile } as unknown as AgentBridge
    root = createRoot(container)
    render(bridge, 2, () => {})
    await wait(0)
    render(bridge, 3, () => {})
    await wait(1300)
    expect(documentProfile).toHaveBeenCalledTimes(2)
  })
})
