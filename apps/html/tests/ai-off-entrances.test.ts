// Settings › Editors and AI: while AI is off the HTML ribbon has no AI entry
// (assistant, restyle, theme, summarize); turning AI back on brings them back
// without a reload. The choice comes in through the same provider main.tsx
// mounts, fed by a fake of the preload's read-and-hear bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiVisibilityProvider } from '../src/renderer/ai-visibility'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

const choice = (aiFeatures: boolean): AppChoiceState => ({ off: [], aiFeatures, locked: false })

function fakeSource(current: AppChoiceState) {
  const listeners = new Set<(c: AppChoiceState) => void>()
  const source: AppChoiceSource = {
    get: async () => current,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    change(next: AppChoiceState) {
      current = next
      for (const listener of listeners) listener(next)
    },
  }
}

async function renderRibbon(source: AppChoiceSource, initial: AppChoiceState) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ribbon = createElement(Ribbon, {
    disabled: false,
    dirty: false,
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onFind: vi.fn(),
    autoSave: false,
    onToggleAutoSave: vi.fn(),
    aiOpen: false,
    onToggleAi: vi.fn(),
    onAiPreset: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    view: 'preview' as const,
    onView: vi.fn(),
    canInsert: true,
    onInsert: vi.fn(),
    canvasMode: 'edit' as const,
    onPresent: vi.fn(),
  })
  await act(async () => {
    root.render(createElement(AiVisibilityProvider, { source, initial, children: ribbon }))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

describe('HTML ribbon AI entrances follow the AI switch', () => {
  it('shows none while AI is off, and all four once AI is turned on', async () => {
    const bridge = fakeSource(choice(false))
    const container = await renderRibbon(bridge.source, choice(false))
    expect(container.querySelector('.ai-entry')).toBeNull()
    // the insert row and the rest of the band are still there
    expect(container.querySelector('.ribbon-body .ribbon-group')).not.toBeNull()

    await act(async () => bridge.change(choice(true)))
    expect(container.querySelectorAll('.ai-entry').length).toBe(4)

    await act(async () => bridge.change(choice(false)))
    expect(container.querySelector('.ai-entry')).toBeNull()
  })

  it('draws no AI entry before the first answer when the start value is off', async () => {
    const silent: AppChoiceSource = { get: () => new Promise(() => {}), onChange: () => () => {} }
    const container = await renderRibbon(silent, choice(false))
    expect(container.querySelector('.ai-entry')).toBeNull()
  })
})
