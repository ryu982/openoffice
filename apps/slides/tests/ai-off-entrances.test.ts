// @vitest-environment jsdom
/**
 * AI turned off in Settings: the slides window draws none of its AI entrances
 * (the AI dock and its rail, the ribbon's AI group, the stage's AI bar,
 * Review ▸ Proofing) and turning AI on brings them back live. The real App
 * boots a blank deck; the shell's switch is a fake of the preload bridge.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'

// react-konva's node entry requires the native 'canvas' package; nothing here draws
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { App } from '../src/renderer/App'
import { t } from '../src/renderer/i18n/locale'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const blankSlide = () => ({
  widthPx: 1280,
  heightPx: 720,
  scale: 1,
  nodes: [],
  background: { kind: 'color', color: '#ffffff' },
})

/** Minimal slidesApi: enough for App to boot into the editor on a blank deck. */
function makeSlidesApi() {
  const explicit: Record<string, unknown> = {
    consumePendingOpen: () => Promise.resolve(null),
    newBlank: () => Promise.resolve({ path: '', slides: [blankSlide()], defaultFont: 'Arial' }),
    isDirty: () => Promise.resolve(false),
    getRecentFiles: () => Promise.resolve([]),
    getAiSettings: () => Promise.resolve(null),
    getSections: () => Promise.resolve([]),
    getComments: () => Promise.resolve([]),
    getNotes: () => Promise.resolve(''),
    getAnimations: () => Promise.resolve([]),
    getTransition: () => Promise.resolve(null),
    listFonts: () => Promise.resolve([]),
  }
  const fallbacks = new Map<string, unknown>()
  return new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (!fallbacks.has(prop)) {
        fallbacks.set(prop, prop.startsWith('on') ? () => () => {} : () => Promise.resolve(null))
      }
      return fallbacks.get(prop)
    },
  })
}

/** The shell's switch as the preload exposes it, with the push side in hand. */
function fakeChoice(aiFeatures: boolean) {
  const listeners = new Set<(choice: AppChoiceState) => void>()
  const source: AppChoiceSource = {
    get: () => Promise.resolve({ off: [], aiFeatures, locked: false }),
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    source,
    push: (next: boolean) => {
      for (const listener of listeners) listener({ off: [], aiFeatures: next, locked: false })
    },
  }
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1336,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800,
  })
  ;(window as unknown as { slidesApi: unknown }).slidesApi = makeSlidesApi()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  delete (window as { aiOfficeEditorChoice?: unknown }).aiOfficeEditorChoice
})

async function bootApp(aiFeatures: boolean) {
  const choice = fakeChoice(aiFeatures)
  ;(window as { aiOfficeEditorChoice?: AppChoiceSource }).aiOfficeEditorChoice = choice.source
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(App)))
  await settle()
  expect(container.querySelector('.stage-wrap'), 'editor should boot into a blank deck').not.toBe(
    null,
  )
  return { el: container, push: choice.push }
}

/** The AI parts a person could reach on the Home tab and the stage */
function aiParts(el: HTMLElement) {
  return {
    ribbonEntries: el.querySelectorAll('.ai-entry').length,
    stageBar: el.querySelector('.stage-ai-bar') !== null,
    dock: el.querySelector('.ai-dock') !== null,
    rail: el.querySelector('.ai-rail') !== null,
  }
}

function openTab(el: HTMLElement, labelKey: Parameters<typeof t>[0]) {
  const tab = [...el.querySelectorAll<HTMLButtonElement>('button.ribbon-tab')].find(
    (b) => b.textContent === t(labelKey),
  )
  expect(tab, `ribbon tab ${labelKey}`).toBeDefined()
  act(() => tab!.click())
}

const proofing = (el: HTMLElement) => (el.textContent ?? '').includes(t('ribbonGroupProofing'))

describe('slides AI entrances follow the AI switch', () => {
  it('with AI on, the dock rail, ribbon AI group and stage AI bar are drawn', async () => {
    const { el } = await bootApp(true)
    expect(aiParts(el)).toEqual({ ribbonEntries: 4, stageBar: true, dock: true, rail: true })
  })

  it('with AI off, none is drawn; turning AI on brings them back live', async () => {
    const { el, push } = await bootApp(false)
    expect(aiParts(el)).toEqual({ ribbonEntries: 0, stageBar: false, dock: false, rail: false })
    // the rest of the Home tab is still there
    expect(el.querySelectorAll('.rb-big').length).toBeGreaterThan(0)

    await act(async () => push(true))
    expect(aiParts(el)).toEqual({ ribbonEntries: 4, stageBar: true, dock: true, rail: true })

    await act(async () => push(false))
    expect(aiParts(el)).toEqual({ ribbonEntries: 0, stageBar: false, dock: false, rail: false })
  })

  it('Review ▸ Proofing (AI spell check and translate) follows the switch', async () => {
    const { el, push } = await bootApp(false)
    openTab(el, 'ribbonTabReview')
    expect(proofing(el)).toBe(false)
    expect((el.textContent ?? '').includes(t('ribbonGroupComments'))).toBe(true)

    await act(async () => push(true))
    expect(proofing(el)).toBe(true)
  })
})
