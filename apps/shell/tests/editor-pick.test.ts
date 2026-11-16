/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { EditorChoiceList } from '../src/renderer/src/editor-choice/EditorChoiceList'
import { OneTimeEditorPick } from '../src/renderer/src/editor-choice/OneTimeEditorPick'
import type { OneTimeEditorPickDeps } from '../src/renderer/src/editor-choice/OneTimeEditorPick'
import {
  homeTabActive,
  oneTimePickVisible,
  openEditorItems,
  waitForLaunchSettled,
} from '../src/renderer/src/editor-choice/one-time-pick'
import {
  EDITOR_ITEM_NAME_KEYS,
  editorItemName,
  editorPickStrings,
  editorPickText,
} from '../src/renderer/src/i18n/strings-editor-pick'
import { LocaleProvider } from '../src/renderer/src/locale'
import { EDITOR_ITEM_IDS, type EditorItemId } from '../src/shared/editor-choice'
import type { TabSummary } from '../src/shared/tabs-api'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(element: ReturnType<typeof createElement>): void {
  act(() => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, element))
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function click(selector: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button, selector).not.toBeNull()
  await act(async () => {
    button!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const switchOf = (item: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`[data-item="${item}"] [role="switch"]`)!

const tab = (id: string, kind: TabSummary['kind'], active = false): TabSummary => ({
  id,
  kind,
  title: id,
  closable: kind !== 'home',
  active,
})

describe('one-time picker rules', () => {
  it('shows only when due, after the launch settled, on the home tab, and once', () => {
    const base = { due: true, launchSettled: true, homeActive: true, done: false }
    expect(oneTimePickVisible(base)).toBe(true)
    expect(oneTimePickVisible({ ...base, due: false })).toBe(false)
    expect(oneTimePickVisible({ ...base, launchSettled: false })).toBe(false)
    expect(oneTimePickVisible({ ...base, homeActive: false })).toBe(false)
    expect(oneTimePickVisible({ ...base, done: true })).toBe(false)
  })

  it('reads home as active when no tab or the home tab is in front', () => {
    expect(homeTabActive([])).toBe(true)
    expect(homeTabActive([tab('home', 'home', true), tab('a', 'docs')])).toBe(true)
    expect(homeTabActive([tab('home', 'home'), tab('a', 'docs', true)])).toBe(false)
  })

  it('names the items whose editor has tabs open; home and the manual are none', () => {
    const items = openEditorItems([
      tab('home', 'home', true),
      tab('help', 'help'),
      tab('a', 'docs'),
      tab('b', 'docs'),
      tab('c', 'epub'),
    ])
    expect([...items].sort()).toEqual(['docs', 'epub'])
  })

  it('waits for the launch list: settled at once when there is nothing to ask', async () => {
    const getLaunchRecoveryList = vi.fn(async () => null)
    await waitForLaunchSettled({ getLaunchRecoveryList })
    expect(getLaunchRecoveryList).toHaveBeenCalledTimes(1)
    await waitForLaunchSettled({ getLaunchRecoveryList: async () => [] })
    // no bridge (an older preload) or a failing one: nothing to wait for
    await waitForLaunchSettled(undefined)
    await waitForLaunchSettled({
      getLaunchRecoveryList: async () => {
        throw new Error('gone')
      },
    })
  })

  it('waits for the launch list: settled once its answer was applied', async () => {
    const row = { id: 'x' } as never
    const answers: unknown[] = [[row], [row], null]
    const getLaunchRecoveryList = vi.fn(async () => answers.shift() as never)
    const sleep = vi.fn(async () => undefined)
    await waitForLaunchSettled({ getLaunchRecoveryList }, { sleep })
    expect(getLaunchRecoveryList).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})

describe('editor pick strings', () => {
  it('have every key in every language, translated', () => {
    const keys = Object.keys(editorPickStrings.zh).sort()
    for (const lang of LANGS) {
      expect(Object.keys(editorPickStrings[lang]).sort(), lang).toEqual(keys)
      for (const key of keys) {
        expect(
          editorPickStrings[lang][key as keyof typeof editorPickStrings.zh].trim(),
          `${lang} ${key}`,
        ).not.toBe('')
      }
    }
    for (const key of ['pickTitle', 'pickBody', 'pickLastEditor', 'pickOpenDocs'] as const) {
      expect(new Set(LANGS.map((lang) => editorPickText(lang, key))).size, key).toBe(LANGS.length)
    }
  })

  it('name each of the eleven items', () => {
    expect(Object.keys(EDITOR_ITEM_NAME_KEYS).sort()).toEqual([...EDITOR_ITEM_IDS].sort())
    expect(editorItemName('ko', 'docs')).toBe('워드')
    expect(editorItemName('ko', 'hwp')).toBe('한글')
    expect(editorItemName('en', 'pdfTools')).toBe('PDF tools')
  })
})

describe('EditorChoiceList', () => {
  function Harness(props: {
    initialOff?: EditorItemId[]
    openItems?: ReadonlySet<EditorItemId>
    onAi?: (on: boolean) => void
  }) {
    const [off, setOff] = useState<EditorItemId[]>(props.initialOff ?? [])
    const [ai, setAi] = useState(true)
    return createElement(EditorChoiceList, {
      off,
      aiFeatures: ai,
      onOffChange: setOff,
      onAiFeaturesChange: (on: boolean) => {
        props.onAi?.(on)
        setAi(on)
      },
      ...(props.openItems ? { openItems: props.openItems } : {}),
    })
  }

  it('turns items off and on, and leaves the last editor on with its reason', async () => {
    render(
      createElement(Harness, {
        initialOff: ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html', 'mindmap', 'diagram'],
      }),
    )
    expect(switchOf('hwp').disabled).toBe(false)
    await click('[data-item="hwp"] [role="switch"]')
    expect(switchOf('hwp').getAttribute('aria-checked')).toBe('false')
    expect(switchOf('epub').disabled).toBe(true)
    const reason = host.querySelector<HTMLElement>('[data-item="epub"] .ec-row-reason')!
    expect(reason.textContent).toBe(editorPickText('en', 'pickLastEditor'))
    // the switch says why it cannot move
    expect(switchOf('epub').getAttribute('aria-describedby')).toBe(reason.id)
    // clicking the disabled switch changes nothing
    await act(async () => {
      switchOf('epub').click()
      await Promise.resolve()
    })
    expect(switchOf('epub').getAttribute('aria-checked')).toBe('true')
  })

  it('reports the AI switch separately', async () => {
    const onAi = vi.fn()
    render(createElement(Harness, { onAi }))
    await click('[data-item="ai"] [role="switch"]')
    expect(onAi).toHaveBeenCalledWith(false)
    expect(switchOf('ai').getAttribute('aria-checked')).toBe('false')
  })

  it('marks the items that have documents open', () => {
    render(createElement(Harness, { openItems: new Set<EditorItemId>(['sheets']) }))
    const marks = Array.from(host.querySelectorAll<HTMLElement>('.ec-row-open')).map(
      (el) => el.closest<HTMLElement>('[data-item]')!.dataset.item,
    )
    expect(marks).toEqual(['sheets'])
    expect(host.querySelector('.ec-row-open')!.textContent).toBe(
      editorPickText('en', 'pickOpenDocs'),
    )
  })
})

describe('OneTimeEditorPick', () => {
  function fakeDeps(
    options: {
      due?: boolean
      tabs?: TabSummary[]
      launchSettled?: Promise<void>
    } = {},
  ) {
    let tabsListener: ((tabs: TabSummary[]) => void) | null = null
    const deps = {
      choice: {
        pickDue: vi.fn(async () => options.due ?? true),
        set: vi.fn(async (patch: { off?: EditorItemId[]; aiFeatures?: boolean }) => ({
          off: patch.off ?? [],
          aiFeatures: patch.aiFeatures ?? true,
          locked: false as const,
        })),
        markPickSeen: vi.fn(async () => undefined),
      },
      tabs: {
        list: vi.fn(async () => options.tabs ?? [tab('home', 'home', true)]),
        onChanged: vi.fn((listener: (tabs: TabSummary[]) => void) => {
          tabsListener = listener
          return () => {
            tabsListener = null
          }
        }),
      },
      launchSettled: () => options.launchSettled ?? Promise.resolve(),
    }
    return {
      deps: deps as typeof deps & OneTimeEditorPickDeps,
      pushTabs: async (tabs: TabSummary[]) => {
        await act(async () => {
          tabsListener?.(tabs)
          await Promise.resolve()
        })
      },
    }
  }

  const dialog = () => host.querySelector<HTMLElement>('.ec-pick-dialog')

  it('stays away when it is not due', async () => {
    const { deps } = fakeDeps({ due: false })
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(dialog()).toBeNull()
  })

  it('comes up on the home tab once the launch has settled, everything on', async () => {
    let release!: () => void
    const launchSettled = new Promise<void>((resolve) => {
      release = resolve
    })
    const { deps } = fakeDeps({ launchSettled })
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(dialog()).toBeNull()
    await act(async () => {
      release()
      await Promise.resolve()
    })
    await settle()
    expect(dialog()).not.toBeNull()
    const switches = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
    expect(switches).toHaveLength(12)
    expect(switches.every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(dialog()!.textContent).toContain(editorPickText('en', 'pickOneTimeTitle'))
  })

  it('waits while an editor tab is in front and comes up when home is', async () => {
    const { deps, pushTabs } = fakeDeps({
      tabs: [tab('home', 'home'), tab('a', 'slides', true)],
    })
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(dialog()).toBeNull()
    await pushTabs([tab('home', 'home', true), tab('a', 'slides')])
    expect(dialog()).not.toBeNull()
    // the open slides are marked
    expect(host.querySelector('[data-item="slides"] .ec-row-open')).not.toBeNull()
    expect(host.querySelector('[data-item="docs"] .ec-row-open')).toBeNull()
    // and it steps aside again under an editor tab, keeping what was switched
    await click('[data-item="docs"] [role="switch"]')
    await pushTabs([tab('home', 'home'), tab('a', 'slides', true)])
    expect(dialog()).toBeNull()
    await pushTabs([tab('home', 'home', true), tab('a', 'slides')])
    expect(switchOf('docs').getAttribute('aria-checked')).toBe('false')
  })

  it('marks itself seen as soon as it shows, before any answer', async () => {
    // spec 5: quitting the app with it open does not bring it back next launch
    const { deps } = fakeDeps()
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(dialog()).not.toBeNull()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    expect(deps.choice.set).not.toHaveBeenCalled()
  })

  it('is not marked seen while it waits under an editor tab', async () => {
    const { deps, pushTabs } = fakeDeps({
      tabs: [tab('home', 'home'), tab('a', 'slides', true)],
    })
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(deps.choice.markPickSeen).not.toHaveBeenCalled()
    await pushTabs([tab('home', 'home', true), tab('a', 'slides')])
    await settle()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    // stepping aside and coming back is the same showing
    await pushTabs([tab('home', 'home'), tab('a', 'slides', true)])
    await pushTabs([tab('home', 'home', true), tab('a', 'slides')])
    await settle()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
  })

  it('marks itself seen again on close when the first mark failed', async () => {
    const { deps } = fakeDeps()
    deps.choice.markPickSeen.mockRejectedValueOnce(new Error('not written'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    await click('.ec-pick-close')
    await settle()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(2)
    expect(dialog()).toBeNull()
    warn.mockRestore()
  })

  it('saves the switches and marks itself seen', async () => {
    const { deps } = fakeDeps()
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    await click('[data-item="markdown"] [role="switch"]')
    await click('[data-item="ai"] [role="switch"]')
    await click('.ec-pick-save')
    await settle()
    expect(deps.choice.set).toHaveBeenCalledWith({ off: ['markdown'], aiFeatures: false })
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('closing keeps the values and still marks itself seen', async () => {
    const { deps } = fakeDeps()
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    await click('[data-item="markdown"] [role="switch"]')
    await click('.ec-pick-close')
    await settle()
    expect(deps.choice.set).not.toHaveBeenCalled()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('Escape closes it like the close button', async () => {
    const { deps } = fakeDeps()
    render(createElement(OneTimeEditorPick, { deps }))
    await settle()
    const overlay = host.querySelector<HTMLElement>('.ec-pick-overlay')!
    await act(async () => {
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })
    await settle()
    expect(deps.choice.set).not.toHaveBeenCalled()
    expect(deps.choice.markPickSeen).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })
})
