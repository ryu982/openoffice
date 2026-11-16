/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateWindowApi, GenerateWindowState } from '../src/shared/generate-api'
import { editorPromptStrings } from '../src/renderer/src/i18n/strings-editor-prompt'

/**
 * The generate window while AI is off (editor choice spec 8.1): the AI
 * "make" (its kinds, request and AI notices) is not drawn, the conversions
 * without AI stay, and the first one on offer is chosen. With AI on, the
 * window is as before.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function stateWith(overrides: Partial<GenerateWindowState> = {}): GenerateWindowState {
  return {
    lang: 'en',
    kind: 'slides',
    mode: 'ai',
    convertKind: null,
    conversions: [],
    redactionNotice: false,
    materials: [{ key: 'k', name: 'plan.xmind', path: '/plan.xmind', state: 'ready' }],
    readyCount: 1,
    totalBytes: 10,
    notices: { usage: true, longMaterial: false },
    tooMany: false,
    canMake: true,
    checking: false,
    making: false,
    saving: [],
    failure: null,
    convertProblem: null,
    limits: { maxMaterials: 10, maxMaterialMb: 20, maxImageMb: 10, maxConvertSlides: 50 },
    ...overrides,
  }
}

let host: HTMLDivElement
let root: Root
let api: GenerateWindowApi & {
  setConvert: ReturnType<typeof vi.fn>
  make: ReturnType<typeof vi.fn>
}
let current: GenerateWindowState
let aiFeatures = true
let GenerateWindow: () => ReactElement

const w = window as unknown as Record<string, unknown>
// read once by the window module as it loads: answers whatever the test set
w.aiOfficeEditorChoice = {
  get: async () => ({ off: [], aiFeatures, locked: false }),
  onChange: () => () => {},
}
w.aiOfficeGenerateWindow = {
  getState: async () => current,
  onState: () => () => {},
  getTheme: async () => 'light',
  onThemeChanged: () => () => {},
  setKind: async () => {},
  setConvert: (kind: unknown) => api.setConvert(kind),
  addMaterials: async () => {},
  removeMaterial: async () => {},
  saveMaterial: async () => {},
  refresh: async () => {},
  make: (text: unknown) => api.make(text),
  cancel: async () => {},
}

beforeAll(async () => {
  ;({ GenerateWindow } = await import('../src/renderer/src/generate/GenerateWindow'))
}, 180_000)

async function render(state: GenerateWindowState, ai: boolean) {
  current = state
  aiFeatures = ai
  api = { setConvert: vi.fn(async () => {}), make: vi.fn(async () => true) } as never
  await act(async () => {
    root.render(createElement(GenerateWindow))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('AI on', () => {
  it('shows the AI kinds, the request and the AI notices', async () => {
    await render(stateWith(), true)
    expect(host.querySelectorAll('[data-kind]')).toHaveLength(3)
    expect(host.querySelector<HTMLElement>('#gen-request')?.closest('section')?.hidden).toBe(false)
    expect(host.querySelector('[data-testid="gen-notices"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="gen-ai-off"]')).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('[data-testid="gen-make"]')?.disabled).toBe(false)
  })
})

describe('AI off', () => {
  it('hides the AI "make" and keeps the conversions, choosing the first', async () => {
    await render(stateWith({ conversions: ['mindmap-to-markdown', 'mindmap-to-slides'] }), false)
    expect(host.querySelectorAll('[data-kind]')).toHaveLength(0)
    expect(host.querySelectorAll('[data-convert]')).toHaveLength(2)
    expect(host.querySelector<HTMLElement>('#gen-request')?.closest('section')?.hidden).toBe(true)
    expect(host.querySelector('[data-testid="gen-notices"]')).toBeNull()
    expect(host.querySelector('[data-testid="gen-ai-off"]')?.textContent).toBe(
      editorPromptStrings.en.genAiOffConvert,
    )
    expect(api.setConvert).toHaveBeenCalledWith('mindmap-to-markdown')
    // still in AI mode until the choice lands: nothing to make yet
    expect(host.querySelector<HTMLButtonElement>('[data-testid="gen-make"]')?.disabled).toBe(true)
  })

  it('makes a chosen conversion', async () => {
    await render(
      stateWith({
        mode: 'convert',
        convertKind: 'mindmap-to-slides',
        conversions: ['mindmap-to-markdown', 'mindmap-to-slides'],
        notices: { usage: false, longMaterial: false },
      }),
      false,
    )
    expect(api.setConvert).not.toHaveBeenCalled()
    const make = host.querySelector<HTMLButtonElement>('[data-testid="gen-make"]')!
    expect(make.disabled).toBe(false)
    await act(async () => make.click())
    expect(api.make).toHaveBeenCalledWith('')
  })

  it('says how to convert when no conversion is on offer, and makes nothing', async () => {
    await render(stateWith({ conversions: [] }), false)
    expect(host.querySelector('[data-testid="gen-ai-off"]')?.textContent).toBe(
      editorPromptStrings.en.genAiOffNoConversion,
    )
    const make = host.querySelector<HTMLButtonElement>('[data-testid="gen-make"]')!
    expect(make.disabled).toBe(true)
    expect(api.setConvert).not.toHaveBeenCalled()
  })
})
