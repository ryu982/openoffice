/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_ON_APP_CHOICE_STATE,
  PENDING_APP_CHOICE_STATE,
  aiVisible,
  useAppChoice,
  type AppChoiceSource,
  type AppChoiceState,
} from '../src/use-app-choice'

const off: AppChoiceState = { off: ['hwp'], aiFeatures: false, locked: false }

describe('aiVisible', () => {
  it('follows the AI switch', () => {
    expect(aiVisible(ALL_ON_APP_CHOICE_STATE)).toBe(true)
    expect(aiVisible(off)).toBe(false)
  })
})

describe('useAppChoice', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let seen: AppChoiceState[]

  function Probe(props: { source?: AppChoiceSource }) {
    seen.push(useAppChoice(props.source))
    return null
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    seen = []
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  function fakeSource(answer: Promise<AppChoiceState>) {
    const listeners = new Set<(choice: AppChoiceState) => void>()
    const source: AppChoiceSource = {
      get: () => answer,
      onChange(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    return {
      source,
      emit: (choice: AppChoiceState) => listeners.forEach((l) => l(choice)),
      listeners,
    }
  }

  it('hides AI parts until the first answer, then shows the answer', async () => {
    const { source } = fakeSource(Promise.resolve(off))
    await act(async () => root.render(createElement(Probe, { source })))
    expect(seen[0]).toEqual(PENDING_APP_CHOICE_STATE)
    expect(seen.at(-1)).toEqual(off)
  })

  it('follows changes and stops listening once unmounted', async () => {
    const { source, emit, listeners } = fakeSource(Promise.resolve(ALL_ON_APP_CHOICE_STATE))
    await act(async () => root.render(createElement(Probe, { source })))
    act(() => emit(off))
    expect(seen.at(-1)).toEqual(off)
    act(() => root.render(createElement('div')))
    expect(listeners.size).toBe(0)
  })

  it('keeps a change that arrives before the first answer', async () => {
    let answer!: (choice: AppChoiceState) => void
    const { source, emit } = fakeSource(new Promise((resolve) => (answer = resolve)))
    await act(async () => root.render(createElement(Probe, { source })))
    act(() => emit(off))
    await act(async () => answer(ALL_ON_APP_CHOICE_STATE))
    expect(seen.at(-1)).toEqual(off)
  })

  it('stays all on without a source or when the source fails', async () => {
    await act(async () => root.render(createElement(Probe, {})))
    expect(seen.at(-1)).toEqual(ALL_ON_APP_CHOICE_STATE)
    const { source } = fakeSource(Promise.reject(new Error('no shell')))
    await act(async () => root.render(createElement(Probe, { source })))
    expect(seen.at(-1)).toEqual(ALL_ON_APP_CHOICE_STATE)
  })
})
