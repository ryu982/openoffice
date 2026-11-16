/** @vitest-environment jsdom */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSubscriptionUsage } from '@genoffice/ai-provider/browser'
import {
  mergeLatestSubscriptionUsage,
  subscriptionUsageOf,
  useSubscriptionUsageUpdates,
  type SubscriptionUsageMerge,
  type SubscriptionUsageSource,
} from '../src/use-subscription-usage-updates'

const claudeFive: AiSubscriptionUsage = {
  provider: 'claude',
  window: 'five_hour',
  utilization: 0.9,
  resetsAt: 2_000_000_000_000,
}
const codexFive: AiSubscriptionUsage = {
  provider: 'codex',
  window: 'five_hour',
  utilization: 0.4,
  resetsAt: 2_000_000_000_000,
}

/** a preload bridge stand-in: keeps the listeners so a test can send and count them */
function fakeBridge() {
  const listeners = new Set<(usage: AiSubscriptionUsage[]) => void>()
  const bridge: SubscriptionUsageSource = {
    onUsage(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const send = (payload: unknown) => {
    for (const listener of [...listeners]) listener(payload as AiSubscriptionUsage[])
  }
  return { bridge, listeners, send }
}

describe('useSubscriptionUsageUpdates', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let seen: readonly AiSubscriptionUsage[]

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

  function Panel(props: {
    api: () => SubscriptionUsageSource | undefined
    initial?: AiSubscriptionUsage[]
    merge?: SubscriptionUsageMerge
  }) {
    const [usage, setUsage] = useState<AiSubscriptionUsage[]>(props.initial ?? [])
    useSubscriptionUsageUpdates(props.api, setUsage, props.merge)
    seen = usage
    return null
  }

  function mount(props: Parameters<typeof Panel>[0]) {
    act(() => root.render(createElement(Panel, props)))
  }

  it('merges a payload into the state the chat stream left, keeping the other provider', () => {
    const { bridge, send } = fakeBridge()
    mount({ api: () => bridge, initial: [claudeFive] })
    act(() => send([codexFive]))
    expect(seen).toEqual([claudeFive, codexFive])
    // a newer report of the same window replaces it
    const later = { ...codexFive, utilization: 0.55 }
    act(() => send([later]))
    expect(seen).toEqual([claudeFive, later])
  })

  it("uses the panel's own merge when it has one", () => {
    const { bridge, send } = fakeBridge()
    const merge = vi.fn<SubscriptionUsageMerge>((_known, reported) => [...reported])
    mount({ api: () => bridge, initial: [claudeFive], merge })
    act(() => send([codexFive]))
    expect(merge).toHaveBeenCalledWith([claudeFive], [codexFive])
    expect(seen).toEqual([codexFive])
  })

  it('removes its listener when the panel goes away', () => {
    const { bridge, listeners } = fakeBridge()
    mount({ api: () => bridge })
    expect(listeners.size).toBe(1)
    act(() => root.unmount())
    expect(listeners.size).toBe(0)
    // afterEach unmounts again: a fresh root keeps that harmless
    root = createRoot(host)
  })

  it('subscribes once across re-renders', () => {
    const { bridge, listeners } = fakeBridge()
    const onUsage = vi.spyOn(bridge, 'onUsage')
    mount({ api: () => bridge })
    mount({ api: () => bridge })
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(1)
  })

  it('ignores a payload with nothing well formed in it', () => {
    const { bridge, send } = fakeBridge()
    mount({ api: () => bridge, initial: [claudeFive] })
    act(() => send(null))
    act(() => send([{ provider: 'gemini', window: 'five_hour', utilization: 1, resetsAt: 1 }]))
    act(() => send([]))
    expect(seen).toEqual([claudeFive])
  })

  it('does nothing without a bridge, without a listener, or with a getter that throws', () => {
    mount({ api: () => undefined })
    mount({ api: () => ({}) })
    expect(() =>
      mount({
        api: () => {
          throw new Error('no preload')
        },
      }),
    ).not.toThrow()
    expect(seen).toEqual([])
  })
})

describe('mergeLatestSubscriptionUsage', () => {
  it('keeps one entry per provider and window, the newest one', () => {
    const claudeWeek: AiSubscriptionUsage = { ...claudeFive, window: 'seven_day', utilization: 0.3 }
    const newer = { ...claudeFive, utilization: 0.95 }
    expect(mergeLatestSubscriptionUsage([claudeFive, claudeWeek], [newer, codexFive])).toEqual([
      newer,
      claudeWeek,
      codexFive,
    ])
  })
})

describe('subscriptionUsageOf', () => {
  it('keeps the well-formed entries and copies only their four fields', () => {
    expect(
      subscriptionUsageOf([
        { ...codexFive, extra: 'dropped' },
        { provider: 'codex', window: 'month', utilization: 0.1, resetsAt: 1 },
        { provider: 'codex', window: 'five_hour', utilization: Number.NaN, resetsAt: 1 },
        { provider: 'claude', window: 'seven_day', utilization: 0.2 },
        'text',
        null,
      ]),
    ).toEqual([codexFive])
    expect(subscriptionUsageOf({ provider: 'codex' })).toEqual([])
  })
})
