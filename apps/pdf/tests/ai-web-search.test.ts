import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DRIVE_OUTBOUND_BLOCKED,
  INTERNET_TOOLS_OFF,
  composeWithDrive,
  type AgentMessage,
  type AgentToolCall,
} from '@genoffice/agent-core'
import { AGENT_TOOLS, executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'
import { createPdfSkill } from '../src/renderer/ai/pdf-skill'
import { t } from '../src/renderer/i18n/locale'

const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: name,
  name,
  input,
})

/** web_search needs no document; generate_image its two deps, the run context a few readers */
const deps = (over: Partial<PdfAiDeps> = {}) =>
  ({
    fileName: () => 'report.pdf',
    pageCount: () => 1,
    currentPage: () => 1,
    readOnly: () => false,
    outline: () => null,
    metadata: () => ({}),
    annotationSummary: () => '',
    pendingSummary: () => '',
    selection: () => null,
    imageGenAvailable: () => true,
    generateImage: vi.fn(async () => ({ url: 'https://img.example/generated.png' })),
    ...over,
  }) as unknown as PdfAiDeps

const RESULTS = {
  answer: 'Seoul has about 9.4 million people.',
  results: [
    { title: 'Seoul — Wikipedia', url: 'https://en.wikipedia.org/wiki/Seoul', snippet: 'Capital' },
    { title: 'Statistics Korea', url: 'https://kostat.go.kr/', snippet: 'Population data' },
  ],
  method: 'tavily',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web_search tool definition', () => {
  it('matches the other editors: query required, maxResults optional', () => {
    const def = AGENT_TOOLS.find((d) => d.name === 'web_search')
    expect(def).toBeDefined()
    expect(def!.description).toBe(
      'Search the web for textual information (references/data/facts). Use when you need up-to-date information or are unsure about a fact. Returns titles/links/snippets.',
    )
    expect(def!.inputSchema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
        maxResults: { type: 'integer', description: 'Maximum number of results, default 6' },
      },
      required: ['query'],
    })
  })

  it('tells the model to search instead of inventing and to cite sources', () => {
    const prompt = createPdfSkill(deps()).systemPrompt
    expect(prompt).toContain(
      'When you need up-to-date information, data, or facts beyond the document, use web_search; never fabricate numbers from memory.',
    )
    expect(prompt).toContain(
      'When writing search results into the document, attribute the data source (a link or a source name).',
    )
  })
})

describe('web_search execution', () => {
  it('asks the shared handler with 6 results by default and puts the direct answer first', async () => {
    const webSearch = vi.fn(async () => RESULTS)
    vi.stubGlobal('pdfApi', { webSearch })
    const result = await executePdfTool(deps(), call('web_search', { query: ' seoul population ' }))
    expect(webSearch).toHaveBeenCalledWith('seoul population', 6)
    expect(result.isError).toBeFalsy()
    expect(result.output).toBe(
      'Direct answer: Seoul has about 9.4 million people.\n\n' +
        '1. Seoul — Wikipedia\n   https://en.wikipedia.org/wiki/Seoul\n   Capital\n' +
        '2. Statistics Korea\n   https://kostat.go.kr/\n   Population data',
    )
    expect(result.summary).toBe(t('aiToolWebSearchDone', { query: 'seoul population', count: 2 }))
  })

  it('passes a requested result count through', async () => {
    const webSearch = vi.fn(async () => ({ results: [], method: 'tavily' }))
    vi.stubGlobal('pdfApi', { webSearch })
    const result = await executePdfTool(deps(), call('web_search', { query: 'x', maxResults: 3 }))
    expect(webSearch).toHaveBeenCalledWith('x', 3)
    expect(result.output).toBe('(no results)')
    expect(result.isError).toBeFalsy()
  })

  it('reports a service failure as an error, not as an empty result', async () => {
    vi.stubGlobal('pdfApi', {
      webSearch: async () => ({ results: [], method: 'error', error: 'quota exceeded' }),
    })
    const result = await executePdfTool(deps(), call('web_search', { query: 'x' }))
    expect(result.isError).toBe(true)
    expect(result.output).toBe(
      'web search failed (service error, not an empty result — you may retry): quota exceeded',
    )
    expect(result.summary).toBe(t('aiToolWebSearch'))
  })

  it('refuses an empty query without calling the handler', async () => {
    const webSearch = vi.fn()
    vi.stubGlobal('pdfApi', { webSearch })
    const result = await executePdfTool(deps(), call('web_search', { query: '  ' }))
    expect(result.isError).toBe(true)
    expect(result.output).toBe('query must not be empty')
    expect(webSearch).not.toHaveBeenCalled()
  })

  it('has real card strings', () => {
    expect(t('aiToolWebSearch')).not.toBe('aiToolWebSearch')
    expect(t('aiToolWebSearchDone', { query: 'q', count: 1 })).toContain('q')
  })
})

/**
 * The PDF tools reach the model through the composition the AI panel builds
 * (composeWithDrive over createPdfSkill), so web_search must obey the person's
 * internet-tools switch and the Google Drive block on that path.
 */
describe('web_search behind the internet switch and the Drive block', () => {
  function guarded(opts: { internet: boolean }) {
    let internet = opts.internet
    let history: AgentMessage[] = []
    const webSearch = vi.fn(async () => RESULTS)
    vi.stubGlobal('pdfApi', { webSearch })
    vi.stubGlobal('aiOfficeOutbound', {
      internetToolsEnabled: async () => internet,
      confirmAddresses: async () => true,
    })
    vi.stubGlobal('aiOfficeDriveAi', {
      driveAiEnabled: async () => true,
      driveSearch: async () => ({ ok: true, hits: [] }),
      driveRead: async () => ({ ok: false, error: 'unused' }),
    })
    const skill = composeWithDrive('pdf', '', () => history, [createPdfSkill(deps())])
    return {
      skill,
      webSearch,
      setInternet: (on: boolean) => (internet = on),
      setHistory: (h: AgentMessage[]) => (history = h),
    }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const names = (skill: { tools: { name: string }[] }) => skill.tools.map((d) => d.name)

  it('is offered and runs while internet tools are on', async () => {
    const { skill, webSearch } = guarded({ internet: true })
    await settle()
    expect(names(skill)).toContain('web_search')
    const result = await skill.executeTool(call('web_search', { query: 'seoul' }))
    expect(result.isError).toBeFalsy()
    expect(webSearch).toHaveBeenCalledWith('seoul', 6)
  })

  it('leaves the list and is refused when internet tools are off', async () => {
    const { skill, webSearch } = guarded({ internet: false })
    await settle()
    expect(names(skill)).not.toContain('web_search')
    // the rest of the PDF tools stay
    expect(names(skill)).toContain('read_pages')
    const result = await skill.executeTool(call('web_search', { query: 'seoul' }))
    expect(result.isError).toBe(true)
    expect(result.output).toBe(INTERNET_TOOLS_OFF)
    expect(webSearch).not.toHaveBeenCalled()
  })

  it('is refused in a conversation that read Google Drive content', async () => {
    const { skill, webSearch, setHistory } = guarded({ internet: true })
    await settle()
    setHistory([
      { role: 'user', text: 'summarize my minutes and look up the latest figures' },
      {
        role: 'tool',
        results: [{ id: 'r1', name: 'drive_read', output: 'minutes text', isError: false }],
      },
    ])
    // run start: the Drive skill notices the read
    skill.buildContext?.()
    const result = await skill.executeTool(call('web_search', { query: 'minutes text' }))
    expect(result.isError).toBe(true)
    expect(result.output).toBe(DRIVE_OUTBOUND_BLOCKED)
    expect(webSearch).not.toHaveBeenCalled()
  })

  it('is the composition the AI panel uses', () => {
    const panel = readFileSync(join(__dirname, '../src/renderer/ai/AiPanel.tsx'), 'utf8')
    expect(panel).toMatch(/composeWithDrive\('pdf',[\s\S]{0,120}\[\s*createPdfSkill\(deps\)/)
  })
})

describe('generate_image model input', () => {
  it('declares an optional model the model fills only when the user named one', () => {
    const def = AGENT_TOOLS.find((d) => d.name === 'generate_image')!
    const props = def.inputSchema.properties as Record<
      string,
      { type: string; description: string }
    >
    expect(props.model?.type).toBe('string')
    expect(props.model?.description).toMatch(/only when the user (named|names|asked for)/i)
    expect(def.inputSchema.required).toEqual(['prompt'])
  })

  it('passes a named model through and leaves it out otherwise', async () => {
    const generateImage = vi.fn(async () => ({ url: 'https://img.example/generated.png' }))
    await executePdfTool(
      deps({ generateImage }),
      call('generate_image', { prompt: 'a kite', model: ' gpt-image-2 ' }),
    )
    expect(generateImage).toHaveBeenLastCalledWith({
      prompt: 'a kite',
      aspectRatio: undefined,
      model: 'gpt-image-2',
    })
    await executePdfTool(deps({ generateImage }), call('generate_image', { prompt: 'a kite' }))
    expect(generateImage.mock.calls[1]![0]).toEqual({ prompt: 'a kite', aspectRatio: undefined })
    await executePdfTool(
      deps({ generateImage }),
      call('generate_image', { prompt: 'a kite', model: '  ' }),
    )
    expect(generateImage.mock.calls[2]![0]).toEqual({ prompt: 'a kite', aspectRatio: undefined })
  })

  it("passes the app's note on to the model with the URL", async () => {
    const generateImage = vi.fn(async () => ({
      url: 'https://img.example/generated.png',
      note: 'On the Codex route Codex picks the image model.',
    }))
    const result = await executePdfTool(
      deps({ generateImage }),
      call('generate_image', { prompt: 'a kite', model: 'gpt-image-2' }),
    )
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('https://img.example/generated.png')
    expect(result.output).toContain('On the Codex route Codex picks the image model.')
  })

  it('answers with the usable models when the named one is not on this route', async () => {
    const generateImage = vi.fn(async () => ({
      error: 'That model is not available here. Usable models: gpt-5.5',
    }))
    const result = await executePdfTool(
      deps({ generateImage }),
      call('generate_image', { prompt: 'a kite', model: 'flux-2' }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Usable models: gpt-5.5')
  })
})

describe('image generation unavailable note', () => {
  it('points a ChatGPT plan user at the Codex program', () => {
    const prompt = createPdfSkill(deps({ imageGenAvailable: () => false })).systemPrompt
    expect(prompt).toContain('ChatGPT plan')
    expect(prompt).toContain('Codex program')
    expect(prompt).toContain('Settings > AI > Codex')
    expect(prompt).toMatch(/OpenAI does not allow/)
  })
})
