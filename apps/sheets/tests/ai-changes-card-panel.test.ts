/** @vitest-environment jsdom */
/**
 * The sheets AI panel shows a run that changed the workbook with the shared
 * changes card (in place of the old "N changes applied / Undo" chip): its
 * count, its revert, "Hide marks" only while the grid marks the run, and the
 * states App.tsx gives it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAiSettings } from '@genoffice/ai-provider/browser'
import { LANGS } from '@genoffice/i18n'
import { AI_CHANGES_LABELS } from '@genoffice/ui'

import {
  AiChatPanel,
  type AiChatMessage,
  type AiPanelSubscription,
} from '../src/renderer/ai/AiChatPanel'
import type { AiRunReceipt } from '../src/renderer/ai/ai-run-receipt'

const subscription: AiPanelSubscription = {
  settings: normalizeAiSettings({ providers: {}, subscriptionNoticeSeen: true }),
  statuses: {},
  connectChoice: null,
  connectAttention: 0,
  noticeDue: false,
  admitQueued: () => true,
  busy: false,
  actions: {
    onInstall: vi.fn(),
    onLogin: vi.fn(),
    onRecheck: vi.fn(),
    onAcceptMetered: vi.fn(),
    onOpenInstallHelp: vi.fn(),
  },
  refresh: vi.fn(),
  usage: [],
  inputTruncated: false,
  onDismissTruncated: vi.fn(),
  onAcknowledgeNotice: vi.fn(),
  onContinueWith: vi.fn(),
}

const guard = { kind: 'adapter', revision: 2, steps: 1 } as const
const reply = (autoApplied: AiRunReceipt): AiChatMessage => ({
  role: 'assistant',
  text: 'Filled column B.',
  tools: [],
  autoApplied,
})

let host: HTMLDivElement
let root: Root
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
  vi.unstubAllGlobals()
})

function render(
  chat: readonly AiChatMessage[],
  handlers: {
    onRevertChanges?: (index: number) => Promise<void>
    onClearMarks?: () => void
    aiBusy?: boolean
  } = {},
) {
  act(() =>
    root.render(
      createElement(AiChatPanel, {
        isOpen: true,
        hasContent: true,
        chat,
        attachments: [],
        attachNotice: null,
        onPickAttachments: () => undefined,
        onAddAttachmentPaths: () => undefined,
        onAddPastedImage: () => undefined,
        onRemoveAttachment: () => undefined,
        prompt: '',
        preview: null,
        aiBusy: handlers.aiBusy ?? false,
        subscription,
        onPromptChange: () => undefined,
        onSend: () => undefined,
        onStop: () => undefined,
        onNewChat: () => undefined,
        onRevertChanges: handlers.onRevertChanges ?? (async () => undefined),
        onClearMarks: handlers.onClearMarks ?? (() => undefined),
        scopeRange: null,
        scopeColumns: null,
        scopeLocked: false,
        onScopeDismiss: () => undefined,
        onCitation: () => undefined,
        onExpand: () => undefined,
        onCollapse: () => undefined,
      }),
    ),
  )
}

const card = () => host.querySelector<HTMLElement>('.ai-run-changes')
const revertButton = () =>
  host.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')
const unmarkButton = () =>
  host.querySelector<HTMLButtonElement>('[data-action="ai-changes-unmark"]')

describe('sheets AI panel: the changes card', () => {
  it('shows the count, reverts the run of that message, hides marks while shown, and renders Copy without Retry', async () => {
    const onRevertChanges = vi.fn(async () => undefined)
    const onClearMarks = vi.fn()
    render(
      [
        { role: 'user', text: 'fill B', tools: [] },
        reply({ opCount: 12, undoSteps: 1, guard, marked: true }),
      ],
      { onRevertChanges, onClearMarks },
    )
    expect(card()?.dataset.state).toBe('applied')
    expect(card()?.textContent).toContain('12')
    expect(host.querySelector('.ai-auto-applied')).toBeNull()
    expect(host.querySelectorAll('.ai-reply-footer-btn')).toHaveLength(1)
    await act(async () => revertButton()!.click())
    expect(onRevertChanges).toHaveBeenCalledWith(1)
    act(() => unmarkButton()!.click())
    expect(onClearMarks).toHaveBeenCalledTimes(1)
  })

  it('offers no "Hide marks" once the grid dropped them, and no revert while a run is busy', () => {
    render([reply({ opCount: 2, undoSteps: 1, guard, marked: false })], { aiBusy: true })
    expect(unmarkButton()).toBeNull()
    expect(revertButton()?.disabled).toBe(true)
  })

  it('becomes expired, not gone, when the batch kept no undo entry or a save reset the stack', () => {
    render([reply({ opCount: 2, undoSteps: 0 })])
    expect(card()?.dataset.state).toBe('expired')
    expect(revertButton()).toBeNull()
    render([reply({ opCount: 2, undoSteps: 1, guard, state: 'expired' })])
    expect(card()?.dataset.state).toBe('expired')
  })

  it('shows the outcome App.tsx gave it', () => {
    for (const state of ['reverted', 'partial', 'refused'] as const) {
      render([reply({ opCount: 2, undoSteps: 1, guard, state })])
      expect(card()?.dataset.state).toBe(state)
      expect(revertButton()).toBeNull()
    }
  })
})

describe('the old chip is gone', () => {
  const dir = resolve(__dirname, '../src/renderer')
  it('leaves no key, class or style behind', () => {
    const panel = readFileSync(resolve(dir, 'ai/AiChatPanel.tsx'), 'utf8')
    const css = readFileSync(resolve(dir, 'styles.css'), 'utf8')
    for (const name of ['ai-auto-applied', 'ai-undo-btn']) {
      expect(panel).not.toContain(name)
      expect(css).not.toContain(name)
    }
    for (const lang of LANGS) {
      const strings = readFileSync(resolve(dir, `i18n/ai/${lang}.ts`), 'utf8')
      expect(strings, lang).not.toMatch(/^\s+(aiAutoApplied|aiUndo|aiUndoTitle):/m)
      expect(AI_CHANGES_LABELS[lang].revert.length, lang).toBeGreaterThan(0)
    }
  })
})
