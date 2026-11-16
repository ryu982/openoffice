// @vitest-environment node
/**
 * The AI's create_document while editors are turned off (Settings → Editors
 * and AI, AI on): a type whose editor is off is refused before anything is
 * made or opened, with a reason the AI can pass on; a type whose editor is on
 * is made as before; and every AI request tells the model on the create tool
 * which types are off. Electron, the providers and the CLIs are mocked.
 */
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setAppChoiceSource, type EditorItemId } from '@genoffice/electron-utils/app-choice'
import type { AgentToolDef } from '@genoffice/agent-core'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  windows: 0,
  streamedTools: [] as unknown[],
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'docs-test',
    getVersion: () => '0',
    on: () => {},
    once: () => {},
    whenReady: () => new Promise(() => {}),
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => state.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  // a hidden print window is the first thing a PDF needs: count them
  BrowserWindow: class {
    constructor() {
      state.windows++
      throw new Error('no windows in this test')
    }
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  WebContentsView: class {},
  clipboard: {},
  dialog: {},
  nativeImage: {},
  net: {},
  session: {},
  shell: { showItemInFolder: () => {} },
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
vi.mock('@genoffice/ai-search', () => ({
  createCodexImageGenerator: () => ({ generate: async () => null, models: async () => null }),
  registerCodexImageGenerator: () => {},
}))
vi.mock('@genoffice/ai-provider/subscription', () => ({
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
  // docs-main gates these with the AI switch (editor choice); never called here
  detectSubscriptionLogin: async () => ({}),
  listSubscriptionModels: async () => [],
  subscriptionStatusErrorText: () => '',
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => ({
  shutdownCodexAppServers: () => {},
}))
vi.mock('@genoffice/ai-provider/custom-models', () => ({}))
// no provider runs: the stream records the tools it was handed
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  streamForProvider: async (...args: unknown[]) => {
    state.streamedTools.push(args[4])
  },
}))
vi.mock('../src/main/ai-run', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveAiRun: (settings: unknown) => ({
    ok: true,
    settings,
    provider: 'custom',
    config: { model: 'test-model' },
  }),
}))
vi.mock('../src/main/lazy-media', () => ({ readLazyMedia: async () => null }))
vi.mock('../src/main/lazy-media-inline', () => ({}))

import { createAiDocument, registerAiIpc, setDocsShellHooks } from '../src/main/docs-main'

const off = (...items: EditorItemId[]) =>
  setAppChoiceSource(() => ({ off: items, aiFeatures: true, locked: false }))

function hooks() {
  return {
    openTab: vi.fn(),
    openAiDocTab: vi.fn(),
    openAiDocTabFor: vi.fn(),
    listTabs: () => [],
    focusTab: vi.fn(),
    closeActiveTab: vi.fn(),
    openGeneratedPath: vi.fn(() => true),
    writeNewDocument: vi.fn(async (_id: number, fileName: string) => `/project/${fileName}`),
  }
}

afterEach(() => {
  setAppChoiceSource(null)
  setDocsShellHooks(null)
  state.windows = 0
  state.streamedTools = []
})

describe('createAiDocument with editors turned off', () => {
  it('refuses a Word document while the Word editor is off, opening no tab', async () => {
    off('docs')
    const h = hooks()
    setDocsShellHooks(h)
    const result = await createAiDocument({ type: 'docx', title: 'T', content: '<p>x</p>' }, 7)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('turned off')
    expect(result.error).toContain('Settings → Editors and AI')
    expect(h.openAiDocTab).not.toHaveBeenCalled()
    expect(h.openAiDocTabFor).not.toHaveBeenCalled()
  })

  it('refuses Markdown and HTML before writing anything', async () => {
    off('markdown', 'html')
    const h = hooks()
    setDocsShellHooks(h)
    for (const type of ['md', 'html'] as const) {
      const result = await createAiDocument({ type, title: 'T', content: 'body' }, 7)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('turned off')
    }
    expect(h.writeNewDocument).not.toHaveBeenCalled()
    expect(h.openGeneratedPath).not.toHaveBeenCalled()
  })

  it('refuses a PDF before the print window is made', async () => {
    off('pdf')
    setDocsShellHooks(hooks())
    const result = await createAiDocument({ type: 'pdf', title: 'T', content: '<p>x</p>' }, 7)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('turned off')
    expect(state.windows).toBe(0)
  })

  it('makes the document as before when its editor is on', async () => {
    off('pdf', 'html')
    const h = hooks()
    setDocsShellHooks(h)
    const docx = await createAiDocument({ type: 'docx', title: 'T', content: '<p>x</p>' }, 7)
    expect(docx).toEqual({ ok: true })
    expect(h.openAiDocTabFor).toHaveBeenCalledWith({ title: 'T', html: '<p>x</p>' }, 7)
    const md = await createAiDocument({ type: 'md', title: 'Notes', content: '# x' }, 7)
    expect(md).toEqual({ ok: true, path: '/project/Notes.md' })
    expect(h.openGeneratedPath).toHaveBeenCalledWith('/project/Notes.md')
  })

  it('makes everything while every editor is on', async () => {
    const h = hooks()
    setDocsShellHooks(h)
    const html = await createAiDocument(
      { type: 'html', title: 'Page', content: '<html></html>' },
      7,
    )
    expect(html.ok).toBe(true)
    expect(h.writeNewDocument).toHaveBeenCalled()
  })
})

describe('ai:stream tells the model which types are off', () => {
  const CREATE: AgentToolDef = {
    name: 'create_document',
    description: 'Create a NEW standalone file.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['docx', 'pdf', 'md', 'html'] } },
    },
  }
  const OTHER: AgentToolDef = { name: 'insert_content', description: 'Insert.', inputSchema: {} }
  const sender = {
    id: 41,
    isDestroyed: () => false,
    send: () => {},
    once: () => {},
    on: () => {},
    removeListener: () => {},
  }

  beforeAll(() => registerAiIpc())

  async function stream(): Promise<AgentToolDef[]> {
    await state.handlers.get('ai:stream')!(
      { sender },
      { requestId: 'r1', settings: {}, system: '', messages: [], tools: [CREATE, OTHER] },
    )
    expect(state.streamedTools).toHaveLength(1)
    return state.streamedTools[0] as AgentToolDef[]
  }

  it('names the off types on the create tool, computed for this request', async () => {
    off('docs', 'markdown')
    const tools = await stream()
    expect(tools[0]!.description).toContain("'docx'")
    expect(tools[0]!.description).toContain("'md'")
    expect(tools[0]!.description).not.toContain("'pdf'")
    expect(tools[0]!.description).toContain('Settings → Editors and AI')
    expect(tools[1]).toEqual(OTHER)
  })

  it('hands the tools on unchanged while every editor is on', async () => {
    const tools = await stream()
    expect(tools).toEqual([CREATE, OTHER])
  })
})
