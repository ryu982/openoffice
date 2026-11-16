/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type {
  UserSkillVersionDiff,
  UserSkillVersionView,
  UserSkillView,
} from '@genoffice/electron-utils/user-skills-channels'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SkillsPane } from '../src/renderer/src/skills/SkillsPane'
import { skillsText, type SkillsStringKey } from '../src/renderer/src/i18n/strings-skills'

/**
 * The earlier versions of an own skill in its view and edit screens (decision
 * 0129): the list, what going back would change, going back, and deleting one.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ko = (key: SkillsStringKey, params?: Record<string, string | number>) =>
  skillsText('ko', key, params)

let host: HTMLDivElement
let root: Root

function view(id: string): UserSkillView {
  const [source, name] = id.split(':') as [UserSkillView['source'], string]
  const own = source === 'app'
  return {
    id,
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
  }
}

const NEWER: UserSkillVersionView = {
  id: '20261110T093000000Z-replace',
  at: '2026-11-10T09:30:00.000Z',
  reason: 'replace',
  bytes: 2048,
}
const OLDER: UserSkillVersionView = {
  id: '20261109T080000000Z-edit',
  at: '2026-11-09T08:00:00.000Z',
  reason: 'edit',
  bytes: 1024,
}

const DIFF: UserSkillVersionDiff = {
  same: false,
  skillMd: [
    { kind: 'gap', text: '4' },
    { kind: 'same', text: '---' },
    { kind: 'removed', text: 'Second.' },
    { kind: 'added', text: 'First.' },
  ],
  files: [
    { rel: 'assets/logo.bin', change: 'added' },
    { rel: 'reference/new.md', change: 'removed' },
    { rel: 'reference/colors.md', change: 'modified' },
  ],
}

function bridge(versions: UserSkillVersionView[], overrides: Record<string, unknown> = {}) {
  let kept = versions
  return {
    list: vi.fn(async () => [view('app:deck'), view('user:theirs')]),
    read: vi.fn(async (id: string) => ({
      ok: true,
      skill: {
        id,
        name: id.split(':')[1],
        title: id.split(':')[1],
        description: 'About it',
        body: 'Body.\n',
        template: undefined,
        files: [{ rel: 'SKILL.md', size: 10 }],
      },
    })),
    checkName: vi.fn(async () => ({ ok: true })),
    setState: vi.fn(async () => ({ ok: true })),
    versions: vi.fn(async () => ({ ok: true, versions: kept })),
    compareVersion: vi.fn(async () => ({ ok: true, diff: DIFF })),
    restoreVersion: vi.fn(async () => ({ ok: true, id: 'app:deck' })),
    removeVersion: vi.fn(async (_id: string, versionId: string) => {
      kept = kept.filter((version) => version.id !== versionId)
      return { ok: true }
    }),
    takeDropped: vi.fn(async () => ({ ok: true, preview: null })),
    cancelImport: vi.fn(async () => {}),
    openFolder: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => undefined),
    onDropped: vi.fn(() => () => undefined),
    ...overrides,
  }
}

type Bridge = ReturnType<typeof bridge>

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

async function openFromMenu(api: Bridge, id: string, action: SkillsStringKey): Promise<void> {
  ;(window as unknown as { aiOfficeUserSkills?: unknown }).aiOfficeUserSkills = api
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'ko' }, createElement(SkillsPane)))
    await Promise.resolve()
  })
  await flush()
  await click(document.querySelector(`[data-skill-id="${id}"] .skl-more`))
  await click(buttonWithText(ko(action)))
  await flush()
}

const section = () => document.querySelector<HTMLElement>('[data-skill-versions]')
const rows = () => [...(section()?.querySelectorAll<HTMLElement>('.skl-version') ?? [])]

describe('the earlier versions of an own skill', () => {
  it('lists them newest first with when, why and how large, and what they take in all', async () => {
    const api = bridge([NEWER, OLDER])
    await openFromMenu(api, 'app:deck', 'actEdit')
    expect(api.versions).toHaveBeenCalledWith('app:deck')
    expect(rows().map((row) => row.dataset.versionId)).toEqual([NEWER.id, OLDER.id])
    expect(rows()[0]!.textContent).toContain(ko('versionReasonReplace'))
    expect(rows()[0]!.textContent).toContain('2 KB')
    expect(rows()[0]!.querySelector('.skl-version-when')?.textContent).toBe(
      new Date(NEWER.at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }),
    )
    expect(rows()[1]!.textContent).toContain(ko('versionReasonEdit'))
    expect(section()?.querySelector('[data-skill-versions-total]')?.textContent).toBe(
      ko('versionsTotal', { n: 2, size: '3 KB' }),
    )
  })

  it('says where versions come from when there are none yet', async () => {
    await openFromMenu(bridge([]), 'app:deck', 'actView')
    expect(section()?.textContent).toContain(ko('versionsNone'))
    expect(rows()).toHaveLength(0)
  })

  it('is not there for a skill of another source', async () => {
    const api = bridge([NEWER])
    await openFromMenu(api, 'user:theirs', 'actView')
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    expect(section()).toBeNull()
    expect(api.versions).not.toHaveBeenCalled()
  })

  it('shows what going back would change, then goes back and says so', async () => {
    const api = bridge([NEWER, OLDER])
    await openFromMenu(api, 'app:deck', 'actEdit')
    await click(buttonWithText(ko('versionCompare'), rows()[1]!))
    expect(api.compareVersion).toHaveBeenCalledWith('app:deck', OLDER.id)

    const lines = [...rows()[1]!.querySelectorAll<HTMLElement>('.skl-diff-line')]
    expect(lines.map((line) => `${line.dataset.kind}:${line.textContent}`)).toEqual([
      `gap: ${ko('versionDiffGap', { n: 4 })}`,
      'same: ---',
      'removed:−Second.',
      'added:+First.',
    ])
    const files = [...rows()[1]!.querySelectorAll('[data-version-files] li')]
    expect(files.map((file) => file.textContent)).toEqual([
      `assets/logo.bin${ko('versionFileAdded')}`,
      `reference/new.md${ko('versionFileRemoved')}`,
      `reference/colors.md${ko('versionFileModified')}`,
    ])
    expect(rows()[1]!.querySelector('[data-version-note]')?.textContent).toBe(
      ko('versionRestoreNote'),
    )

    await click(buttonWithText(ko('versionRestore'), rows()[1]!))
    expect(api.restoreVersion).toHaveBeenCalledWith('app:deck', OLDER.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toBe(ko('versionRestored'))
  })

  it('does not go back over text the person has not saved', async () => {
    const api = bridge([OLDER])
    await openFromMenu(api, 'app:deck', 'actEdit')
    const body = document.querySelector<HTMLTextAreaElement>('.skl-textarea-body')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        body,
        'Typed and not saved.',
      )
      body.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await click(buttonWithText(ko('versionCompare'), rows()[0]!))
    expect(rows()[0]!.querySelector('[data-version-note]')?.textContent).toBe(
      ko('versionRestoreUnsaved'),
    )
    const restore = buttonWithText(ko('versionRestore'), rows()[0]!) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    await click(restore)
    expect(api.restoreVersion).not.toHaveBeenCalled()
  })

  it('says so when a version holds what the skill holds now, with nothing to go back to', async () => {
    const api = bridge([OLDER], {
      compareVersion: vi.fn(async () => ({
        ok: true,
        diff: { same: true, skillMd: [], files: [] },
      })),
    })
    await openFromMenu(api, 'app:deck', 'actView')
    await click(buttonWithText(ko('versionCompare'), rows()[0]!))
    expect(rows()[0]!.querySelector('[data-version-same]')?.textContent).toBe(ko('versionSame'))
    expect((buttonWithText(ko('versionRestore'), rows()[0]!) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('deletes one version only after asking', async () => {
    const api = bridge([NEWER, OLDER])
    await openFromMenu(api, 'app:deck', 'actEdit')
    await click(buttonWithText(ko('versionCompare'), rows()[0]!))
    await click(buttonWithText(ko('versionRemove'), rows()[0]!))
    expect(api.removeVersion).not.toHaveBeenCalled()
    expect(rows()[0]!.textContent).toContain(ko('versionRemoveAsk'))

    await click(buttonWithText(ko('cancel'), rows()[0]!))
    expect(rows()[0]!.textContent).not.toContain(ko('versionRemoveAsk'))
    expect(api.removeVersion).not.toHaveBeenCalled()

    await click(buttonWithText(ko('versionRemove'), rows()[0]!))
    await click(buttonWithText(ko('versionRemove'), rows()[0]!))
    expect(api.removeVersion).toHaveBeenCalledWith('app:deck', NEWER.id)
    expect(rows().map((row) => row.dataset.versionId)).toEqual([OLDER.id])
  })

  it('says why when going back is refused, and stays open', async () => {
    const api = bridge([OLDER], {
      restoreVersion: vi.fn(async () => ({ ok: false, reason: 'name-taken' })),
    })
    await openFromMenu(api, 'app:deck', 'actView')
    await click(buttonWithText(ko('versionCompare'), rows()[0]!))
    await click(buttonWithText(ko('versionRestore'), rows()[0]!))
    expect(section()?.querySelector('[role="alert"]')?.textContent).toBe(ko('nameTaken'))
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  })
})

describe('the words about earlier versions', () => {
  const keys: SkillsStringKey[] = [
    'versionsTitle',
    'versionsNone',
    'versionsTotal',
    'versionReasonEdit',
    'versionReasonReplace',
    'versionReasonUpdate',
    'versionReasonRestore',
    'versionCompare',
    'versionRestore',
    'versionRestoreNote',
    'versionRestoreUnsaved',
    'versionRemove',
    'versionRemoveAsk',
    'versionSame',
    'versionDiffLegend',
    'versionDiffGap',
    'versionFileAdded',
    'versionFileRemoved',
    'versionFileModified',
    'versionRestored',
    'replacedKept',
    'removeTurnOn',
  ]

  it('are written in every screen language, with the values they carry', () => {
    for (const lang of LANGS) {
      for (const key of keys) {
        const text = skillsText(lang, key, { n: 3, size: '9 KB', name: 'deck', source: 'SRC' })
        expect(text.trim(), `${lang} ${key}`).not.toBe('')
        expect(text, `${lang} ${key}`).not.toMatch(/[{}]/)
      }
      expect(skillsText(lang, 'versionsTotal', { n: 3, size: '9 KB' }), lang).toContain('9 KB')
      expect(skillsText(lang, 'versionDiffGap', { n: 41 }), lang).toContain('41')
      expect(skillsText(lang, 'versionDiffLegend'), lang).toMatch(/\+.*−/)
      const turnOn = skillsText(lang, 'removeTurnOn', { name: 'deck', source: 'SRC' })
      expect(turnOn, lang).toContain('deck')
      expect(turnOn, lang).toContain('SRC')
    }
  })
})
