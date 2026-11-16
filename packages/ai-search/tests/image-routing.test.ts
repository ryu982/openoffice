import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  generateImageWithProvider: vi.fn(),
}))

import {
  AiRunError,
  codexImageGenerationAvailable,
  generateImageWithProvider,
  setCodexImageGenerationAvailable,
} from '@genoffice/ai-provider'
import { readGeneratedImage } from '@genoffice/electron-utils/generated-images'
import { registerCodexImageGenerator, type CodexImageGenerator } from '../src/codex-image-generator'
import { generateImageTool } from '../src/media-tools'
import type { AiToolCallContext } from '../src/tool-routing'
import { dataUrl, keyMedia, status, tempDir, writeSettings } from './routing-helpers'

const keyGen = vi.mocked(generateImageWithProvider)
const codexGen = vi.fn<CodexImageGenerator['generate']>()
const codexModels = vi.fn<CodexImageGenerator['models']>()

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const screen = (codex?: ReturnType<typeof status>): AiToolCallContext => ({
  path: 'screen',
  statuses: codex ? { codex } : {},
})
const READY_CODEX = () => ({ context: screen(status('codex', 'ready')) })

beforeEach(() => {
  keyGen.mockReset()
  codexGen.mockReset()
  codexModels.mockReset()
  keyGen.mockResolvedValue({ bytes: PNG, mime: 'image/png' })
  codexGen.mockResolvedValue({ kind: 'image', bytes: PNG, mime: 'image/png' })
  codexModels.mockResolvedValue(['gpt-5.5', 'gpt-5.4-mini'])
  setCodexImageGenerationAvailable(true)
  registerCodexImageGenerator({ generate: codexGen, models: codexModels })
})

afterEach(() => {
  setCodexImageGenerationAvailable(false)
  registerCodexImageGenerator(null)
})

describe('generate_image backend at request start', () => {
  it('never starts Codex turned off in this app, even on a status that still says ready', async () => {
    const settings = writeSettings({
      media: keyMedia({ imageProvider: 'codex' }, 'openai'),
      subscriptionOff: { codex: true },
    })
    const r = await generateImageTool(
      settings,
      { prompt: 'poster', aspectRatio: '16:9', imageSize: '2k' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r.error).toBeUndefined()
    expect(codexGen).not.toHaveBeenCalled()
    expect(keyGen).toHaveBeenCalledTimes(1)
  })

  it('uses the selected Codex subscription when it is ready, even with a key provider filled in', async () => {
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') })
    const r = await generateImageTool(
      settings,
      { prompt: '한글 포스터', aspectRatio: '16:9', imageSize: '2k' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r.error).toBeUndefined()
    expect(readGeneratedImage(r.url!)?.mime).toBe('image/png')
    expect(codexGen).toHaveBeenCalledTimes(1)
    expect(codexGen.mock.calls[0]![0]).toMatchObject({
      prompt: '한글 포스터',
      aspectRatio: '16:9',
      imageSize: '2k',
    })
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('hands the caller abort signal to the Codex generator', async () => {
    const controller = new AbortController()
    await generateImageTool(
      writeSettings(),
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')), signal: controller.signal },
    )
    expect(codexGen.mock.calls[0]![0].signal).toBe(controller.signal)
  })

  it.each(['signed-out', 'not-installed', 'checking', 'error'] as const)(
    'falls to a filled-in key provider when the selected Codex is %s',
    async (state) => {
      const settings = writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'gemini') })
      const r = await generateImageTool(
        settings,
        { prompt: 'a logo', aspectRatio: '1:1' },
        { context: screen(status('codex', state)) },
      )
      expect(r.url).toMatch(/^file:/)
      expect(keyGen).toHaveBeenCalledTimes(1)
      expect(keyGen.mock.calls[0]![0]).toBe('gemini')
      expect(keyGen.mock.calls[0]![2]).toMatchObject({ prompt: 'a logo', aspectRatio: '1:1' })
      expect(codexGen).not.toHaveBeenCalled()
    },
  )

  it('answers "unavailable" when the selected Codex cannot run and no key provider is filled in', async () => {
    const r = await generateImageTool(
      writeSettings({ media: { imageProvider: 'codex', providers: {} } }),
      { prompt: 'a logo' },
      { context: screen(status('codex', 'signed-out')) },
    )
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBe('unavailable')
    expect(r.error).toMatch(/Settings/)
    expect(codexGen).not.toHaveBeenCalled()
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('uses a ready Codex when the selected key provider is not filled in', async () => {
    const settings = writeSettings({ media: { imageProvider: 'openai', providers: {} } })
    const r = await generateImageTool(
      settings,
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r.url).toMatch(/^file:/)
    expect(codexGen).toHaveBeenCalledTimes(1)
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('keeps a selected key provider that can run, whatever Codex is doing', async () => {
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'gemini' }, 'gemini') })
    await generateImageTool(
      settings,
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(keyGen.mock.calls[0]![0]).toBe('gemini')
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('takes the first filled-in key provider in catalog order', async () => {
    // written in reverse: the catalog lists gemini before doubao before qwen
    const settings = writeSettings({
      media: keyMedia({ imageProvider: 'codex' }, 'qwen', 'doubao', 'gemini'),
    })
    await generateImageTool(settings, { prompt: 'a logo' }, { context: screen() })
    expect(keyGen).toHaveBeenCalledTimes(1)
    expect(keyGen.mock.calls[0]![0]).toBe('gemini')
  })

  it('never generates on a metered Codex login, accepted or not', async () => {
    const metered = status('codex', 'metered', { loginMethod: 'metered', meteredAccepted: true })
    const accepted = { meteredAccepted: { codex: true } }
    const none = await generateImageTool(
      writeSettings(accepted),
      { prompt: 'a logo' },
      { context: screen(metered) },
    )
    expect(none.errorCode).toBe('unavailable')
    const key = await generateImageTool(
      writeSettings({ ...accepted, media: keyMedia({ imageProvider: 'codex' }, 'openai') }),
      { prompt: 'a logo' },
      { context: screen(metered) },
    )
    expect(key.url).toMatch(/^file:/)
    expect(keyGen.mock.calls[0]![0]).toBe('openai')
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('treats Codex as absent while no generator is registered', async () => {
    registerCodexImageGenerator(null)
    const ready = screen(status('codex', 'ready'))
    const none = await generateImageTool(writeSettings(), { prompt: 'a logo' }, { context: ready })
    expect(none.errorCode).toBe('unavailable')
    // no "connect Codex" step for a process that cannot run it; the ChatGPT plan sentence stays
    expect(none.error).not.toMatch(/connect Codex with a subscription login/)
    expect(none.error).toMatch(/same ChatGPT account \(Settings > AI > Codex\)/)
    const key = await generateImageTool(
      writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') }),
      { prompt: 'a logo' },
      { context: ready },
    )
    expect(key.url).toMatch(/^file:/)
    expect(keyGen).toHaveBeenCalledTimes(1)
  })

  it('treats Codex as absent in a build that does not announce Codex image generation', async () => {
    setCodexImageGenerationAvailable(false)
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r.errorCode).toBe('unavailable')
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('gives a caller that passes no context the key route only', async () => {
    const none = await generateImageTool(writeSettings(), { prompt: 'a logo' })
    expect(none.errorCode).toBe('unavailable')
    const key = await generateImageTool(
      writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') }),
      { prompt: 'a logo' },
      { mediaRoots: [] },
    )
    expect(key.url).toMatch(/^file:/)
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('reads an unknown provider id in the settings file as the default selection', async () => {
    const settings = writeSettings({
      media: keyMedia({ imageProvider: 'retired-provider' }, 'openai'),
    })
    await generateImageTool(
      settings,
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(codexGen).toHaveBeenCalledTimes(1)
    expect(keyGen).not.toHaveBeenCalled()
  })
})

describe('generate_image failing midway', () => {
  it('ends in the Codex error without trying a key provider', async () => {
    const resetsAt = Date.now() + 60_000
    codexGen.mockRejectedValueOnce(
      new AiRunError('rate-limit', 'Codex usage limit reached', { provider: 'codex', resetsAt }),
    )
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') })
    const r = await generateImageTool(
      settings,
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r).toEqual({
      error: 'Codex usage limit reached',
      errorCode: 'rate-limit',
      resetsAt,
    })
    expect(codexGen).toHaveBeenCalledTimes(1)
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('ends in the key provider error without trying Codex', async () => {
    keyGen.mockRejectedValueOnce(new Error('the image model refused the prompt'))
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'openai' }, 'openai') })
    const r = await generateImageTool(
      settings,
      { prompt: 'a logo' },
      { context: screen(status('codex', 'ready')) },
    )
    expect(r).toEqual({ error: 'the image model refused the prompt' })
    expect(keyGen).toHaveBeenCalledTimes(1)
    expect(codexGen).not.toHaveBeenCalled()
  })
})

describe('generate_image on the Codex route: how the Codex call ended', () => {
  it('stores the picture it got and answers with its file URL', async () => {
    const r = await generateImageTool(writeSettings(), { prompt: 'a logo' }, READY_CODEX())
    expect(Object.keys(r)).toEqual(['url'])
    expect(readGeneratedImage(r.url!)?.mime).toBe('image/png')
  })

  it('answers "unavailable" on a free plan and hides the route for the requests after it', async () => {
    const message =
      'Codex on this ChatGPT plan has no image generation tool: ChatGPT Plus or a higher plan is needed.'
    codexGen.mockResolvedValueOnce({ kind: 'unavailable', reason: 'free-plan', message })
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') })
    const r = await generateImageTool(settings, { prompt: 'a logo' }, READY_CODEX())
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBe('unavailable')
    expect(r.error).toContain(message)
    expect(keyGen).not.toHaveBeenCalled()
    expect(codexImageGenerationAvailable()).toBe(false)
    // the next request starts on what is left: the key provider
    const next = await generateImageTool(settings, { prompt: 'a logo' }, READY_CODEX())
    expect(next.url).toMatch(/^file:/)
    expect(codexGen).toHaveBeenCalledTimes(1)
    expect(keyGen).toHaveBeenCalledTimes(1)
  })

  it.each(['not-subscription', 'off'] as const)(
    'answers "unavailable" on %s and keeps the route',
    async (reason) => {
      codexGen.mockResolvedValueOnce({ kind: 'unavailable', reason, message: `because ${reason}` })
      const r = await generateImageTool(writeSettings(), { prompt: 'a logo' }, READY_CODEX())
      expect(r.errorCode).toBe('unavailable')
      expect(r.error).toContain(`because ${reason}`)
      expect(codexImageGenerationAvailable()).toBe(true)
    },
  )

  it('ends a refused picture in its sentence with no error code, the route kept', async () => {
    const message =
      'Codex did not make the picture with a transparent background, so it was not inserted.'
    codexGen.mockResolvedValueOnce({ kind: 'refused', message })
    const settings = writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') })
    const r = await generateImageTool(
      settings,
      { prompt: 'an icon', transparentBackground: true },
      READY_CODEX(),
    )
    expect(r).toEqual({ error: message })
    expect(codexGen.mock.calls[0]![0].transparent).toBe(true)
    expect(keyGen).not.toHaveBeenCalled()
    expect(codexImageGenerationAvailable()).toBe(true)
  })

  it.each([
    ['needs-update', 'Codex must be updated'],
    ['not-installed', 'Codex is not installed'],
    ['signed-out', 'Codex is signed out'],
    ['unsafe-tools', 'Codex kept an MCP server'],
    ['timeout', 'Codex did not finish the picture within 300 seconds'],
  ] as const)('turns a thrown %s into its error code', async (kind, message) => {
    codexGen.mockRejectedValueOnce(new AiRunError(kind, message, { provider: 'codex' }))
    const r = await generateImageTool(writeSettings(), { prompt: 'a logo' }, READY_CODEX())
    expect(r).toEqual({ error: message, errorCode: kind })
  })

  it('answers a cancel as an error instead of throwing', async () => {
    const abort = new Error('Codex app-server request was cancelled')
    abort.name = 'AbortError'
    codexGen.mockRejectedValueOnce(abort)
    const r = await generateImageTool(writeSettings(), { prompt: 'a logo' }, READY_CODEX())
    expect(r.error).toBe('Codex app-server request was cancelled')
    expect(r.url).toBeUndefined()
  })
})

describe('reference pictures on the Codex route', () => {
  it('loads them under the media budget and hands their bytes to Codex', async () => {
    const r = await generateImageTool(
      writeSettings(),
      {
        prompt: 'remove the background',
        referenceImageUrls: [dataUrl(8), dataUrl(6, 'image/jpeg')],
      },
      READY_CODEX(),
    )
    expect(r.url).toMatch(/^file:/)
    const references = codexGen.mock.calls[0]![0].references!
    expect(references.map((ref) => [ref.mime, ref.bytes.byteLength])).toEqual([
      ['image/png', 8],
      ['image/jpeg', 6],
    ])
  })

  it('refuses a request over the item budget before Codex starts', async () => {
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', referenceImageUrls: Array.from({ length: 13 }, () => dataUrl(8)) },
      READY_CODEX(),
    )
    expect(r.error).toBe(
      'Too many media items in one request (13, limit 12); analyze them in smaller batches',
    )
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('refuses a local file outside the allowed folders before Codex starts', async () => {
    const outside = join(tempDir(), 'secret.png')
    writeFileSync(outside, PNG)
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', referenceImageUrls: [outside] },
      { ...READY_CODEX(), mediaRoots: [tempDir()] },
    )
    expect(r.error).toMatch(/outside the allowed directories/)
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('hands no references when the request names none', async () => {
    await generateImageTool(writeSettings(), { prompt: 'a logo' }, READY_CODEX())
    expect(codexGen.mock.calls[0]![0].references ?? []).toEqual([])
  })
})

describe('a model the request names, on a key route', () => {
  const openai = () => writeSettings({ media: keyMedia({ imageProvider: 'openai' }, 'openai') })
  const usedModel = () => keyGen.mock.calls[0]![1].imageModel

  it.each([undefined, '', '   '])('uses the stored model for %j', async (model) => {
    const r = await generateImageTool(openai(), { prompt: 'a logo', model })
    expect(r).not.toHaveProperty('note')
    expect(usedModel()).toBe('openai-image')
  })

  it('uses a model of the provider catalog for this request only, matched without case', async () => {
    const settings = openai()
    const r = await generateImageTool(settings, { prompt: 'a logo', model: '  GPT-Image-1.5 ' })
    expect(r.url).toMatch(/^file:/)
    expect(r).not.toHaveProperty('note')
    expect(usedModel()).toBe('gpt-image-1.5')
    await generateImageTool(settings, { prompt: 'a logo' })
    expect(keyGen.mock.calls[1]![1].imageModel).toBe('openai-image')
  })

  it('uses the image model stored for the provider', async () => {
    await generateImageTool(openai(), { prompt: 'a logo', model: 'OPENAI-IMAGE' })
    expect(usedModel()).toBe('openai-image')
  })

  it('refuses another provider model without switching to that provider', async () => {
    // Gemini is filled in too: a model name must never move the request there
    const settings = writeSettings({
      media: keyMedia({ imageProvider: 'openai' }, 'openai', 'gemini'),
    })
    const r = await generateImageTool(settings, {
      prompt: 'a logo',
      model: 'gemini-3-pro-image',
    })
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBeUndefined()
    expect(r.error).toMatch(/belongs to Gemini/)
    expect(r.error).toMatch(/Settings > AI > Advanced/)
    expect(r.error).toMatch(/gpt-image-2/)
    expect(r.error).toMatch(/openai-image/)
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('refuses a model it knows nowhere and lists the models of the route', async () => {
    const r = await generateImageTool(openai(), { prompt: 'a logo', model: 'fal-bria-rmbg' })
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBeUndefined()
    expect(r.error).toMatch(/fal-bria-rmbg/)
    expect(r.error).toMatch(/gpt-image-2\.5-sunburst/)
    expect(r.error).not.toMatch(/belongs to/)
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('keeps the provider alpha control in the one request', async () => {
    await generateImageTool(openai(), {
      prompt: 'a logo',
      model: 'gpt-image-2',
      transparentBackground: true,
    })
    expect(keyGen).toHaveBeenCalledTimes(1)
    expect(keyGen.mock.calls[0]![2]).toMatchObject({ transparent: true })
    expect(keyGen.mock.calls[0]![2]).not.toHaveProperty('model')
  })
})

describe('a model the request names, on the Codex route', () => {
  it('draws a gpt-image name with a note that Codex picks the image model, listing nothing', async () => {
    // gpt-image-2 is also in the OpenAI key catalog: the gpt-image row is checked first
    const r = await generateImageTool(
      writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'openai') }),
      { prompt: 'a logo', model: ' GPT-Image-2 ' },
      READY_CODEX(),
    )
    expect(r.url).toMatch(/^file:/)
    expect(r.note).toMatch(/Codex picks its own image model/)
    expect(codexGen.mock.calls[0]![0]).not.toHaveProperty('model')
    expect(codexModels).not.toHaveBeenCalled()
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('runs the picture thread on a Codex model Codex lists, matched without case', async () => {
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', model: ' GPT-5.4-MINI' },
      READY_CODEX(),
    )
    expect(r.url).toMatch(/^file:/)
    expect(r).not.toHaveProperty('note')
    expect(codexGen.mock.calls[0]![0].model).toBe('gpt-5.4-mini')
  })

  it('passes no model when none is named and lists nothing', async () => {
    await generateImageTool(writeSettings(), { prompt: 'a logo', model: '  ' }, READY_CODEX())
    expect(codexGen.mock.calls[0]![0]).not.toHaveProperty('model')
    expect(codexModels).not.toHaveBeenCalled()
  })

  it('refuses a key provider model without moving to that provider', async () => {
    const r = await generateImageTool(
      writeSettings({ media: keyMedia({ imageProvider: 'codex' }, 'gemini') }),
      { prompt: 'a logo', model: 'Gemini-3-Pro-Image' },
      READY_CODEX(),
    )
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBeUndefined()
    expect(r.error).toMatch(/belongs to Gemini/)
    expect(r.error).toMatch(/Settings > AI > Advanced/)
    expect(r.error).toMatch(/gpt-5\.5, gpt-5\.4-mini/)
    expect(codexGen).not.toHaveBeenCalled()
    expect(keyGen).not.toHaveBeenCalled()
  })

  it('refuses a name it knows nowhere and lists the Codex models', async () => {
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', model: 'fal-bria-rmbg' },
      READY_CODEX(),
    )
    expect(r.url).toBeUndefined()
    expect(r.errorCode).toBeUndefined()
    expect(r.error).toMatch(/fal-bria-rmbg/)
    expect(r.error).toMatch(/gpt-5\.5, gpt-5\.4-mini/)
    expect(r.error).not.toMatch(/belongs to/)
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('answers "unavailable" when Codex is turned off before the list is read', async () => {
    codexModels.mockResolvedValueOnce(null)
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', model: 'gpt-5.5' },
      READY_CODEX(),
    )
    expect(r.errorCode).toBe('unavailable')
    expect(codexGen).not.toHaveBeenCalled()
  })

  it('ends in the error of a model list Codex could not give', async () => {
    codexModels.mockRejectedValueOnce(
      new AiRunError('signed-out', 'Codex is signed out', { provider: 'codex' }),
    )
    const r = await generateImageTool(
      writeSettings(),
      { prompt: 'a logo', model: 'gpt-5.5' },
      READY_CODEX(),
    )
    expect(r).toEqual({ error: 'Codex is signed out', errorCode: 'signed-out' })
    expect(codexGen).not.toHaveBeenCalled()
  })
})

describe('generate_image input checks', () => {
  it('rejects an empty prompt before choosing a backend', async () => {
    const r = await generateImageTool(writeSettings(), { prompt: '   ' })
    expect(r).toEqual({ error: 'prompt must not be empty' })
  })

  it('still bounds the reference count on the key route', async () => {
    const r = await generateImageTool(
      writeSettings({ media: keyMedia({ imageProvider: 'openai' }, 'openai') }),
      { prompt: 'a logo', referenceImageUrls: Array.from({ length: 13 }, () => dataUrl(8)) },
    )
    expect(r.error).toBe(
      'Too many media items in one request (13, limit 12); analyze them in smaller batches',
    )
    expect(keyGen).not.toHaveBeenCalled()
  })
})
