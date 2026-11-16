/**
 * The PDF AI panel puts the shared changes card under the reply of a run
 * that changed the document: the run is recorded from the send to its end,
 * the card counts its ops, takes it back through App.tsx and shows the
 * outcome, and offers "Hide marks" only while that run is the marked one. A
 * run that changed nothing gets no card. The main process is a fake bridge.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { IpcStreamChunk } from '@genoffice/agent-core'
import { normalizeAiSettings, type SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { AiPanel, type PdfAiChanges } from '../src/renderer/ai/AiPanel'
import type { PdfAiRun } from '../src/renderer/ai/ai-run-changes'
import type { PdfAppDeps } from '../src/renderer/ai/tools'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const statuses: SubscriptionStatusMap = {
  'claude-code': {
    provider: 'claude-code',
    state: 'ready',
    meteredAccepted: false,
    loginMethod: 'subscription',
  },
  codex: { provider: 'codex', state: 'signed-out', meteredAccepted: false },
}

function fakeBridge() {
  const starts: { requestId: string }[] = []
  let listener: ((chunk: IpcStreamChunk) => void) | null = null
  const settings = {
    ...normalizeAiSettings({}),
    subscriptionNoticeSeen: true,
    pdfSendNoticeSeen: 1,
  }
  const api = {
    getAiSettings: vi.fn(async () => settings),
    setAiSettings: vi.fn(async () => {}),
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: vi.fn(async () => {}),
    onLanguageChanged: () => () => {},
    setAiPanelPrefs: vi.fn(async () => ({})),
    openSourcePath: vi.fn(async () => {}),
    subscription: {
      statuses: vi.fn(async () => statuses),
      recheck: vi.fn(async () => statuses),
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses })),
      onChanged: () => () => {},
      openInstallHelp: vi.fn(async () => {}),
    },
    imageGenerationAvailable: vi.fn(async () => false),
    aiStream: vi.fn(async (request: { requestId: string }) => {
      starts.push(request)
    }),
    aiStreamCancel: vi.fn(async () => {}),
    onAiStream: (next: (chunk: IpcStreamChunk) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
  }
  return {
    api,
    starts,
    push: (chunk: Omit<IpcStreamChunk, 'requestId'>) =>
      listener?.({ requestId: starts.at(-1)!.requestId, ...chunk }),
  }
}

const APP_DEPS = new Proxy(
  {
    fileName: () => 'doc.pdf',
    pageCount: () => 3,
    currentPage: () => 1,
    readOnly: () => false,
    selection: () => null,
    pendingSummary: () => '',
    annotationSummary: () => '',
    metadata: () => ({}),
    outline: () => null,
  } as Record<string, unknown>,
  {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  },
) as unknown as PdfAppDeps

function fakeChanges(run: PdfAiRun | null, verdict: ReturnType<PdfAiChanges['revert']>) {
  const changes = {
    begin: vi.fn(),
    end: vi.fn(() => run),
    revert: vi.fn(() => verdict),
    clearMarks: vi.fn(),
    markedRun: run?.id ?? null,
  }
  return changes satisfies PdfAiChanges
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo = () => {}
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function runOnce(aiChanges: PdfAiChanges) {
  const bridge = fakeBridge()
  vi.stubGlobal('pdfApi', bridge.api)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = (changes: PdfAiChanges) =>
    act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, { api: APP_DEPS, aiChanges: changes, onCollapse: () => {} }),
        ),
      )
    })
  await render(aiChanges)
  await settle()
  await act(async () => (container!.querySelector('.ai-quick-btn') as HTMLElement).click())
  await settle()
  expect(bridge.starts).toHaveLength(1)
  expect(aiChanges.begin).toHaveBeenCalledTimes(1)
  await act(async () => bridge.push({ type: 'done' }))
  await settle()
  return { panel: container, render }
}

const run: PdfAiRun = { id: 7, snaps: [], ops: 4 }

describe('PDF AI panel: the changes card', () => {
  it('shows the run’s op count under its reply and takes it back through App.tsx', async () => {
    const changes = fakeChanges(run, 'reverted')
    const { panel } = await runOnce(changes)
    const card = panel.querySelector<HTMLElement>('.ai-run-changes')
    expect(card?.dataset.state).toBe('applied')
    expect(card?.textContent).toContain('4')
    expect(card?.closest('.ai-msg-assistant')).not.toBeNull()
    await act(async () =>
      panel.querySelector<HTMLElement>('[data-action="ai-changes-revert"]')!.click(),
    )
    expect(changes.revert).toHaveBeenCalledWith(run)
    expect(panel.querySelector<HTMLElement>('.ai-run-changes')?.dataset.state).toBe('reverted')
  })

  it('says so when the run cannot go back: edited since, or its undo point is gone', async () => {
    for (const verdict of ['refused', 'expired'] as const) {
      const changes = fakeChanges(run, verdict)
      const { panel } = await runOnce(changes)
      await act(async () =>
        panel.querySelector<HTMLElement>('[data-action="ai-changes-revert"]')!.click(),
      )
      expect(panel.querySelector<HTMLElement>('.ai-run-changes')?.dataset.state).toBe(verdict)
      await act(async () => root?.unmount())
      container?.remove()
      root = null
    }
  })

  it('offers "Hide marks" only while this run is the marked one', async () => {
    const changes = fakeChanges(run, 'reverted')
    const { panel, render } = await runOnce(changes)
    await act(async () =>
      panel.querySelector<HTMLElement>('[data-action="ai-changes-unmark"]')!.click(),
    )
    expect(changes.clearMarks).toHaveBeenCalledTimes(1)
    await render({ ...changes, markedRun: null })
    expect(panel.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
  })

  it('gives a run that changed nothing no card', async () => {
    const { panel } = await runOnce(fakeChanges(null, 'expired'))
    expect(panel.querySelector('.ai-run-changes')).toBeNull()
  })
})

describe('the marks layer', () => {
  it('is a screen layer of the viewer, not a pending edit', () => {
    const app = readFileSync(resolve(__dirname, '../src/renderer/App.tsx'), 'utf8')
    // drawn from the marks state with the shared look, inside the page view
    expect(app).toMatch(/className="pdf-ai-mark ai-changed-mark"/)
    // never one of the pending-edit buckets that saving, printing and exporting read
    const snapshotBody = app.match(/const snapshot = \(\): EditSnapshot => \(\{([\s\S]*?)\}\)/)?.[1]
    expect(snapshotBody).toBeDefined()
    expect(snapshotBody).not.toMatch(/aiMarks/)
    const save = app.match(/const save = async[\s\S]{0,4000}/)?.[0] ?? ''
    expect(save).not.toMatch(/aiMarks/)
  })
})
