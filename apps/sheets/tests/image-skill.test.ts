import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImageSkill, IMAGE_GEN_OFF_NOTE } from '../src/renderer/ai/image-skill'

function stubDesktopApi(api: Record<string, unknown>): void {
  vi.stubGlobal('window', { desktopApi: api })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function call(name: string, input: Record<string, unknown>) {
  return { id: 'call-1', name, input }
}

describe('image skill: image_search', () => {
  it('rejects an empty query', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('image_search', {}))
    expect(result.isError).toBe(true)
  })

  it('surfaces backend failures as errors, not empty galleries', async () => {
    stubDesktopApi({
      imageSearch: vi.fn().mockResolvedValue({ images: [], method: 'error', error: 'quota' }),
    })
    const result = await createImageSkill().executeTool(call('image_search', { query: 'cat' }))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('quota')
    expect(result.output).toContain('not an empty result')
  })

  it('lists numbered direct URLs with pixel sizes', async () => {
    const imageSearch = vi.fn().mockResolvedValue({
      method: 'serper',
      images: [
        {
          title: 'Golden retriever',
          imageUrl: 'https://img.example.com/dog.jpg',
          sourceUrl: 'https://example.com',
          source: 'example',
          width: 800,
          height: 600,
        },
      ],
    })
    stubDesktopApi({ imageSearch })
    const result = await createImageSkill().executeTool(
      call('image_search', { query: 'dog', maxResults: 3 }),
    )
    expect(imageSearch).toHaveBeenCalledWith('dog', 3)
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('1. Golden retriever [800x600]')
    expect(result.output).toContain('https://img.example.com/dog.jpg')
  })
})

describe('image skill: generate_image', () => {
  it('rejects an empty prompt', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('generate_image', {}))
    expect(result.isError).toBe(true)
  })

  it('propagates generation errors (e.g. not logged in)', async () => {
    stubDesktopApi({
      generateImage: vi.fn().mockResolvedValue({ error: 'The account is not logged in' }),
    })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'a chart mascot' }),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('not logged in')
  })

  it('returns the generated URL with insertion guidance', async () => {
    const generateImage = vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/gen/1.png' })
    stubDesktopApi({ generateImage })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'minimal logo', aspectRatio: '1:1' }),
    )
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'minimal logo', aspectRatio: '1:1' })
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('https://cdn.example.com/gen/1.png')
    expect(result.output).toContain('add_image')
  })

  it("passes the image tool's note on to the model with the URL", async () => {
    const generateImage = vi.fn().mockResolvedValue({
      url: 'https://cdn.example.com/gen/1.png',
      note: 'Codex picks the image model on this route',
    })
    stubDesktopApi({ generateImage })
    const result = await createImageSkill().executeTool(
      call('generate_image', { prompt: 'minimal logo', model: 'gpt-image-2' }),
    )
    expect(result.isError).toBeUndefined()
    expect(result.output).toContain('\nNote: Codex picks the image model on this route')
  })
})

describe('image skill: generate_image model and availability', () => {
  it('passes a model the user named to the channel and offers it as an optional input', async () => {
    const generateImage = vi.fn().mockResolvedValue({ error: 'stop here' })
    stubDesktopApi({ generateImage })
    const skill = createImageSkill()
    const tool = skill.tools.find((entry) => entry.name === 'generate_image')!
    expect(tool.inputSchema.properties).toHaveProperty('model')
    expect(tool.inputSchema.required).toEqual(['prompt'])
    await skill.executeTool(call('generate_image', { prompt: 'a kite', model: 'gpt-image-2' }))
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'a kite', model: 'gpt-image-2' })
  })

  it('hides generate_image without a route and tells the model the ChatGPT plan path', () => {
    const off = createImageSkill(() => false)
    expect(off.tools.map((entry) => entry.name)).not.toContain('generate_image')
    expect(off.systemPrompt).toContain(IMAGE_GEN_OFF_NOTE)
    expect(IMAGE_GEN_OFF_NOTE).toContain('Codex program signed in with the same ChatGPT account')
    expect(IMAGE_GEN_OFF_NOTE).toContain('OpenAI does not allow it')
    expect(createImageSkill(() => true).systemPrompt).not.toContain(IMAGE_GEN_OFF_NOTE)
  })
})

describe('image skill: attached images', () => {
  it('names the image attachments so the model can pass the exact file name', () => {
    const skill = createImageSkill(
      () => true,
      () => [
        { name: 'chart.png', path: 'C:/tmp/chart.png', ext: 'png', sizeBytes: 10 },
        { name: 'notes.txt', path: 'C:/tmp/notes.txt', ext: 'txt', sizeBytes: 10 },
        { name: 'photo.jpg', path: 'C:/tmp/photo.jpg', ext: 'jpg', sizeBytes: 10 },
      ],
    )
    expect(skill.systemPrompt).toContain('chart.png, photo.jpg')
    expect(skill.systemPrompt).not.toContain('notes.txt')
    expect(skill.systemPrompt).toContain('add_image')
    expect(skill.systemPrompt).toContain('attachment')
  })

  it('adds nothing when the chat has no image attachments', () => {
    const skill = createImageSkill(
      () => true,
      () => [{ name: 'notes.txt', path: 'C:/tmp/notes.txt', ext: 'txt', sizeBytes: 10 }],
    )
    expect(skill.systemPrompt).not.toContain('Images attached to this chat')
  })
})

describe('image skill: unknown tool', () => {
  it('fails closed', async () => {
    stubDesktopApi({})
    const result = await createImageSkill().executeTool(call('delete_everything', {}))
    expect(result.isError).toBe(true)
  })
})
