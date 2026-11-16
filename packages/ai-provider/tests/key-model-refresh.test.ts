import { describe, expect, it, vi } from 'vitest'
import { OPENROUTER_FREE_MODELS } from '../src/free-ai'
import {
  KEY_MODEL_RELIST_AFTER_MS,
  createKeyModelRefresher,
  withKeyProviderModels,
  withListedFreeModel,
  withStoredKeyModels,
} from '../src/key-model-refresh'
import { defaultAiSettings } from '../src/providers'
import type { AiProviderId, AiSettings } from '../src/types'

/**
 * When the main process lists a key provider's models and what reaches the
 * settings file (decision 0087): once per run, again on a changed key, never
 * for a provider without one, and a list the renderer sends is never written.
 * A list a day old is asked again, and a free connection left on a model the
 * list no longer has moves to a tested one that it has (decision 0138).
 */

function settingsWith(keys: Partial<Record<AiProviderId, string>>): AiSettings {
  return defaultAiSettings(keys)
}

/** an in-memory settings file with the refresher's read/write */
function store(initial: AiSettings) {
  let file = initial
  const writes: AiSettings[] = []
  return {
    get file() {
      return file
    },
    set file(next: AiSettings) {
      file = next
    },
    writes,
    deps: {
      read: () => file,
      write: (update: (latest: AiSettings) => AiSettings) => {
        const next = update(file)
        if (next === file) return
        file = next
        writes.push(next)
      },
    },
  }
}

describe('createKeyModelRefresher', () => {
  it('lists each provider with a key once, and writes what it got', async () => {
    const s = store(settingsWith({ gemini: 'AIza-1', openai: 'sk-1' }))
    const list = vi.fn(async (provider: AiProviderId) =>
      provider === 'gemini' ? ['gemini-4-argon'] : ['gpt-5.7'],
    )
    const refresher = createKeyModelRefresher({ ...s.deps, list })

    refresher.refreshChanged()
    refresher.refreshChanged()
    await refresher.idle()

    expect(list.mock.calls.map((c) => c[0]).sort()).toEqual(['gemini', 'openai'])
    expect(s.file.providers.gemini.models).toEqual(['gemini-4-argon'])
    expect(s.file.providers.openai.models).toEqual(['gpt-5.7'])
    // a provider without a key is not contacted
    expect(s.file.providers.anthropic.models).toBeUndefined()
  })

  it('lists again when the key changes, and not when it does not', async () => {
    const s = store(settingsWith({ gemini: 'AIza-1' }))
    const list = vi.fn(async (_provider: AiProviderId, _config: { apiKey: string }) => [
      'gemini-4-argon',
    ])
    const refresher = createKeyModelRefresher({ ...s.deps, list })
    refresher.refreshChanged()
    await refresher.idle()

    s.file = withStoredKeyModels(
      { ...s.file, provider: 'gemini' }, // another field changed: no new listing
      s.file,
    )
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(1)

    s.file = {
      ...s.file,
      providers: { ...s.file.providers, gemini: { ...s.file.providers.gemini, apiKey: 'AIza-2' } },
    }
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1]![1]).toMatchObject({ apiKey: 'AIza-2' })
  })

  it('keeps the stored list when there is no answer', async () => {
    const s = store(withKeyProviderModels(settingsWith({ gemini: 'AIza-1' }), 'gemini', ['old']))
    const refresher = createKeyModelRefresher({ ...s.deps, list: async () => null })
    refresher.refreshChanged()
    await refresher.idle()
    expect(s.file.providers.gemini.models).toEqual(['old'])
    expect(s.writes).toHaveLength(0)
  })

  it('drops an answer for a key that was replaced while it was on its way', async () => {
    const s = store(settingsWith({ gemini: 'AIza-1' }))
    let answer!: (models: string[]) => void
    const list = vi.fn(() => new Promise<string[] | null>((resolve) => (answer = resolve)))
    const refresher = createKeyModelRefresher({ ...s.deps, list })
    refresher.refreshChanged()
    s.file = {
      ...s.file,
      providers: { ...s.file.providers, gemini: { ...s.file.providers.gemini, apiKey: 'AIza-2' } },
    }
    answer(['for-the-old-key'])
    await refresher.idle()
    expect(s.file.providers.gemini.models).toBeUndefined()
  })

  it('writes nothing when the list is unchanged', async () => {
    const s = store(withKeyProviderModels(settingsWith({ gemini: 'AIza-1' }), 'gemini', ['a', 'b']))
    const refresher = createKeyModelRefresher({ ...s.deps, list: async () => ['a', 'b'] })
    refresher.refreshChanged()
    await refresher.idle()
    expect(s.writes).toHaveLength(0)
  })

  it('lists an unchanged key again once its list is a day old, and not before', async () => {
    const s = store(settingsWith({ gemini: 'AIza-1' }))
    let clock = 1_000_000
    let asked = 0
    const list = vi.fn(async () =>
      ++asked === 1 ? ['gemini-4-argon'] : ['gemini-4-argon', 'gemini-5-neon'],
    )
    const refresher = createKeyModelRefresher({ ...s.deps, list, now: () => clock })

    refresher.refreshChanged()
    await refresher.idle()
    clock += KEY_MODEL_RELIST_AFTER_MS - 1
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(1)

    clock += 1
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(2)
    // the model released meanwhile is in the file without a restart
    expect(s.file.providers.gemini.models).toEqual(['gemini-4-argon', 'gemini-5-neon'])

    // the day counts from the last asking, not from the first
    clock += KEY_MODEL_RELIST_AFTER_MS - 1
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('counts a day on a clock that was set back as well', async () => {
    const s = store(settingsWith({ gemini: 'AIza-1' }))
    let clock = 10 * KEY_MODEL_RELIST_AFTER_MS
    const list = vi.fn(async () => ['gemini-4-argon'])
    const refresher = createKeyModelRefresher({ ...s.deps, list, now: () => clock })
    refresher.refreshChanged()
    await refresher.idle()
    clock -= KEY_MODEL_RELIST_AFTER_MS
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('never lists a provider without a key, however old the run', async () => {
    const s = store(settingsWith({}))
    let clock = 0
    const list = vi.fn(async () => ['x'])
    const refresher = createKeyModelRefresher({ ...s.deps, list, now: () => clock })
    refresher.refreshChanged()
    clock += 3 * KEY_MODEL_RELIST_AFTER_MS
    refresher.refreshChanged()
    await refresher.idle()
    expect(list).not.toHaveBeenCalled()
  })

  it('moves a free connection off a model that is gone from the list it just got', async () => {
    const [first, second] = OPENROUTER_FREE_MODELS
    const initial = settingsWith({ openrouter: 'sk-or-v1-x' })
    initial.providers.openrouter = { ...initial.providers.openrouter, model: first! }
    const s = store(initial)
    const list = vi.fn(async () => [second!, 'anthropic/claude-opus-6'])
    const refresher = createKeyModelRefresher({ ...s.deps, list })
    refresher.refreshChanged()
    await refresher.idle()
    expect(s.file.providers.openrouter.model).toBe(second)
    expect(s.file.providers.openrouter.apiKey).toBe('sk-or-v1-x')
    // one write carries the list and the move together
    expect(s.writes).toHaveLength(1)
  })

  it('moves it on a list that did not change, when the stored model is not in it', async () => {
    // a build without the move stored this list; the next asking gets the same one
    const [first, second] = OPENROUTER_FREE_MODELS
    const initial = withKeyProviderModels(
      settingsWith({ openrouter: 'sk-or-v1-x' }),
      'openrouter',
      [second!],
    )
    initial.providers.openrouter = { ...initial.providers.openrouter, model: first! }
    const s = store(initial)
    const refresher = createKeyModelRefresher({ ...s.deps, list: async () => [second!] })
    refresher.refreshChanged()
    await refresher.idle()
    expect(s.file.providers.openrouter.model).toBe(second)
  })

  it('leaves a paid OpenRouter model and every other provider where the user put them', async () => {
    const initial = settingsWith({ openrouter: 'sk-or-v1-x', gemini: 'AIza-1' })
    initial.providers.openrouter = {
      ...initial.providers.openrouter,
      model: 'openai/gpt-withdrawn',
    }
    initial.providers.gemini = { ...initial.providers.gemini, model: 'gemini-withdrawn' }
    const s = store(initial)
    const list = vi.fn(async (provider: AiProviderId) =>
      provider === 'openrouter' ? [OPENROUTER_FREE_MODELS[0]!] : ['gemini-4-argon'],
    )
    const refresher = createKeyModelRefresher({ ...s.deps, list })
    refresher.refreshChanged()
    await refresher.idle()
    // a different paid model bills differently: that choice stays the user's
    expect(s.file.providers.openrouter.model).toBe('openai/gpt-withdrawn')
    expect(s.file.providers.gemini.model).toBe('gemini-withdrawn')
  })

  it('survives a settings file it cannot read', () => {
    const list = vi.fn()
    const refresher = createKeyModelRefresher({
      read: () => {
        throw new Error('EBUSY')
      },
      write: () => undefined,
      list,
    })
    expect(() => refresher.refreshChanged()).not.toThrow()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('withListedFreeModel', () => {
  it('returns the same settings when there is nothing to move', () => {
    const [first] = OPENROUTER_FREE_MODELS
    const connected = settingsWith({ openrouter: 'sk-or-v1-x' })
    connected.providers.openrouter = { ...connected.providers.openrouter, model: first! }
    // no list yet
    expect(withListedFreeModel(connected)).toBe(connected)
    // still listed
    const listed = withKeyProviderModels(connected, 'openrouter', [first!])
    expect(withListedFreeModel(listed)).toBe(listed)
    // every tested model is gone: an untried one is not picked for the user
    const none = withKeyProviderModels(connected, 'openrouter', ['acme/untested:free'])
    expect(withListedFreeModel(none)).toBe(none)
  })
})

describe('withStoredKeyModels', () => {
  it("takes every provider's list from the file, whatever the renderer sent", () => {
    const stored = withKeyProviderModels(settingsWith({ gemini: 'k' }), 'gemini', [
      'gemini-4-argon',
    ])
    const sent = withKeyProviderModels(settingsWith({ gemini: 'k' }), 'openai', ['planted'])
    const next = withStoredKeyModels(sent, stored)
    expect(next.providers.gemini.models).toEqual(['gemini-4-argon'])
    expect(next.providers.openai.models).toBeUndefined()
  })
})
