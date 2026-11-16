/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserSkillView } from '@genoffice/electron-utils/user-skills-channels'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SkillsPane } from '../src/renderer/src/skills/SkillsPane'
import { skillsText, type SkillsStringKey } from '../src/renderer/src/i18n/strings-skills'

/** What a row of Settings → Skills shows and asks: its controls and the delete question */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ko = (key: SkillsStringKey, params?: Record<string, string | number>) =>
  skillsText('ko', key, params)

let host: HTMLDivElement
let root: Root

function view(partial: Partial<UserSkillView> & { id: string }): UserSkillView {
  const [source, name] = partial.id.split(':') as [UserSkillView['source'], string]
  const own = source === 'app'
  return {
    source,
    plugin: undefined,
    name,
    title: name,
    description: `About ${name}`,
    enabled: true,
    invoke: 'auto',
    hidden: false,
    hasScripts: false,
    mcpServers: [],
    template: undefined,
    templateExists: false,
    agentOnly: false,
    unreadable: undefined,
    files: 1,
    bytes: 100,
    github: undefined,
    owned: own,
    can: {
      edit: own,
      copyToMine: !own,
      export: own,
      checkUpdate: false,
      openFolder: true,
      remove: own,
      hide: source === 'builtin',
    },
    shadowedBy: undefined,
    ...partial,
  }
}

function bridge(views: UserSkillView[]) {
  return {
    list: vi.fn(async () => views),
    setState: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    takeDropped: vi.fn(async () => ({ ok: true, preview: null })),
    cancelImport: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => undefined),
    onDropped: vi.fn(() => () => undefined),
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = { openHelp: vi.fn(async () => {}) } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { aiOfficeUserSkills?: unknown }).aiOfficeUserSkills
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
  })
  await flush()
}

function buttonWithText(text: string, scope: ParentNode = document.body) {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

async function renderPane(api: ReturnType<typeof bridge>): Promise<void> {
  ;(window as unknown as { aiOfficeUserSkills?: unknown }).aiOfficeUserSkills = api
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'ko' }, createElement(SkillsPane)))
    await Promise.resolve()
  })
  await flush()
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-skill-id="${id}"]`)

async function askToRemove(id: string): Promise<HTMLElement> {
  await click(row(id)?.querySelector('.skl-more'))
  await click(buttonWithText(ko('actRemove')))
  const question = row(id)?.querySelector<HTMLElement>('.skl-confirm')
  expect(question).toBeTruthy()
  return question!
}

describe('deleting an own skill whose name another source carries', () => {
  const mine = view({ id: 'app:deck' })
  const builtinOff = view({ id: 'builtin:deck', enabled: false })
  const claudeOn = view({ id: 'user:deck' })
  const otherOff = view({ id: 'builtin:weekly', enabled: false })

  it('offers, checked, to turn the off skill of that name back on', async () => {
    const api = bridge([mine, builtinOff, claudeOn, otherOff])
    await renderPane(api)
    const question = await askToRemove('app:deck')

    const options = [...question.querySelectorAll<HTMLLabelElement>('.skl-confirm-option')]
    expect(options.map((option) => option.textContent)).toEqual([
      ko('removeTurnOn', { name: 'deck', source: ko('sourceBuiltin') }),
    ])
    expect(options[0]!.querySelector<HTMLInputElement>('input')!.checked).toBe(true)

    await click(buttonWithText(ko('actRemove'), question))
    expect(api.remove).toHaveBeenCalledWith('app:deck', ['builtin:deck'])
  })

  it('leaves that skill off when the person unchecks the line', async () => {
    const api = bridge([mine, builtinOff])
    await renderPane(api)
    const question = await askToRemove('app:deck')
    await click(question.querySelector('.skl-confirm-option input'))
    await click(buttonWithText(ko('actRemove'), question))
    expect(api.remove).toHaveBeenCalledWith('app:deck', [])
  })

  it('asks nothing more when no skill of that name is off', async () => {
    const api = bridge([mine, claudeOn, otherOff])
    await renderPane(api)
    const question = await askToRemove('app:deck')
    expect(question.querySelector('.skl-confirm-option')).toBeNull()
    await click(buttonWithText(ko('actRemove'), question))
    expect(api.remove).toHaveBeenCalledWith('app:deck', [])
  })
})

describe('when a skill is used, on a skill that is off', () => {
  it('stays on the row, marked as not in effect, and can still be changed', async () => {
    const api = bridge([
      view({ id: 'app:deck', enabled: false, invoke: 'manual' }),
      view({ id: 'app:weekly' }),
    ])
    await renderPane(api)

    const choice = row('app:deck')?.querySelector<HTMLElement>('.skl-invoke')
    expect(choice).toBeTruthy()
    expect(choice!.classList.contains('off')).toBe(true)
    expect(row('app:weekly')?.querySelector('.skl-invoke')?.classList.contains('off')).toBe(false)
    expect(buttonWithText(ko('invokeManual'), choice!)?.getAttribute('aria-pressed')).toBe('true')

    await click(buttonWithText(ko('invokeAuto'), choice!))
    expect(api.setState).toHaveBeenCalledWith('app:deck', { invoke: 'auto' })
  })

  it('is left out for a skill that cannot be read', async () => {
    const api = bridge([view({ id: 'user:broken', enabled: false, unreadable: 'no-frontmatter' })])
    await renderPane(api)
    expect(row('user:broken')).toBeTruthy()
    expect(row('user:broken')?.querySelector('.skl-invoke')).toBeNull()
  })
})
