/**
 * The generator the app and the command line register for Codex: it reads the
 * settings file on every call and hands one picture to `generateCodexImage`.
 * The Codex calls are fakes here; nothing starts a real Codex.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AiSubscriptionUsage, CodexImageCall, CodexImageOutcome } from '@genoffice/ai-provider'
import { createCodexImageGenerator } from '../src/codex-image-subscription'
import { writeSettings } from './routing-helpers'

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const IMAGE: CodexImageOutcome = { kind: 'image', bytes: PNG, mime: 'image/png' }

function fakes() {
  const generate = vi.fn(async (_call: CodexImageCall): Promise<CodexImageOutcome> => IMAGE)
  const listModels = vi.fn(async (_cliPath?: string) => ({
    models: ['gpt-5.5', 'gpt-5.4-mini'],
    defaultModel: 'gpt-5.5',
  }))
  return { generate, listModels }
}

const CODEX = {
  providers: { codex: { apiKey: '', model: 'gpt-5.4-mini', cliPath: '  C:/tools/codex.exe ' } },
}

describe('createCodexImageGenerator', () => {
  it('hands the request, the Codex program and model of the settings to one Codex picture', async () => {
    const { generate, listModels } = fakes()
    const path = writeSettings(CODEX)
    const generator = createCodexImageGenerator({
      settingsPath: () => path,
      generate,
      listModels,
    })
    const signal = new AbortController().signal
    const reference = { bytes: PNG, mime: 'image/png' }
    const outcome = await generator.generate({
      prompt: '사과 한 알',
      aspectRatio: '16:9',
      imageSize: '2k',
      transparent: true,
      references: [reference],
      model: 'gpt-5.5',
      signal,
    })
    expect(outcome).toBe(IMAGE)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]![0]).toMatchObject({
      prompt: '사과 한 알',
      aspectRatio: '16:9',
      imageSize: '2k',
      transparent: true,
      references: [reference],
      model: 'gpt-5.5',
      configuredModel: 'gpt-5.4-mini',
      cliPath: 'C:/tools/codex.exe',
      codexOff: false,
      signal,
    })
    expect(listModels).not.toHaveBeenCalled()
  })

  it('reads the settings again on every call', async () => {
    const { generate, listModels } = fakes()
    let path = writeSettings(CODEX)
    const generator = createCodexImageGenerator({ settingsPath: () => path, generate, listModels })
    await generator.generate({ prompt: 'one' })
    path = writeSettings({ providers: { codex: { apiKey: '', model: '' } } })
    await generator.generate({ prompt: 'two' })
    expect(generate.mock.calls[0]![0].configuredModel).toBe('gpt-5.4-mini')
    expect(generate.mock.calls[1]![0].configuredModel).toBe('')
    expect(generate.mock.calls[1]![0].cliPath).toBeUndefined()
  })

  it('tells the Codex call that Codex is turned off in this app', async () => {
    const { generate, listModels } = fakes()
    const path = writeSettings({ ...CODEX, subscriptionOff: { codex: true } })
    const generator = createCodexImageGenerator({ settingsPath: () => path, generate, listModels })
    await generator.generate({ prompt: 'a logo' })
    expect(generate.mock.calls[0]![0].codexOff).toBe(true)
  })

  it('passes the usage Codex reports to the function the app gave, and none from the command line', async () => {
    const usage: AiSubscriptionUsage[] = [
      { provider: 'codex', window: 'five_hour', utilization: 0.4, resetsAt: Date.now() + 60_000 },
    ]
    const { listModels } = fakes()
    const generate = vi.fn(async (call: CodexImageCall): Promise<CodexImageOutcome> => {
      call.onUsage?.(usage)
      return IMAGE
    })
    const path = writeSettings(CODEX)
    const onUsage = vi.fn()
    const app = createCodexImageGenerator({
      settingsPath: () => path,
      onUsage,
      generate,
      listModels,
    })
    await app.generate({ prompt: 'a logo' })
    expect(onUsage).toHaveBeenCalledWith(usage)
    const cli = createCodexImageGenerator({ settingsPath: () => path, generate, listModels })
    await cli.generate({ prompt: 'a logo' })
    expect(generate.mock.calls[1]![0].onUsage).toBeUndefined()
  })

  it('lists the Codex models through the configured Codex program', async () => {
    const { generate, listModels } = fakes()
    const path = writeSettings(CODEX)
    const generator = createCodexImageGenerator({ settingsPath: () => path, generate, listModels })
    expect(await generator.models()).toEqual(['gpt-5.5', 'gpt-5.4-mini'])
    expect(listModels).toHaveBeenCalledWith('C:/tools/codex.exe')
  })

  it('starts no Codex for the model list while Codex is turned off in this app', async () => {
    const { generate, listModels } = fakes()
    const path = writeSettings({ ...CODEX, subscriptionOff: { codex: true } })
    const generator = createCodexImageGenerator({ settingsPath: () => path, generate, listModels })
    expect(await generator.models()).toBeNull()
    expect(listModels).not.toHaveBeenCalled()
  })
})
