// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_CHANNELS, PDF_CHANNELS } from '../src/shared/ipc'
import type { PdfApi } from '../src/shared/ipc'

const invoke = vi.fn()
const exposed = new Map<string, unknown>()
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: vi.fn() }))

describe('pdf preload: web search and image requests', () => {
  let api: PdfApi

  beforeEach(async () => {
    invoke.mockReset()
    await import('../src/preload/index')
    api = exposed.get('pdfApi') as PdfApi
  })

  it('sends web searches to the app-wide handler', async () => {
    expect(AI_CHANNELS.webSearch).toBe('ai:web-search')
    invoke.mockResolvedValue({ results: [], method: 'tavily' })
    await api.webSearch('seoul population', 6)
    expect(invoke).toHaveBeenLastCalledWith('ai:web-search', 'seoul population', 6)
  })

  it('carries a named image model to the pdf image handler', async () => {
    invoke.mockResolvedValue({ url: 'file:///fake/out.png' })
    await api.generateImage({ prompt: 'a kite', model: 'gpt-image-2' })
    expect(invoke).toHaveBeenLastCalledWith(PDF_CHANNELS.generateImage, {
      prompt: 'a kite',
      model: 'gpt-image-2',
    })
  })
})
