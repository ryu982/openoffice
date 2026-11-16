import { describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  AI_ONLY_SECTIONS,
  SETTINGS_SECTION_IDS,
  defaultSettingsSection,
  navSectionOf,
  sectionShown,
  settingsSectionFor,
  shownSettingsSections,
} from '../src/renderer/src/editor-settings/settings-sections'
import { aiOffConfirm, aiOffStart } from '../src/renderer/src/editor-settings/ai-off'
import {
  homeKindsInFirstOrder,
  moveShownHomeKind,
  resetShownHomeKinds,
  shownHomeKinds,
} from '../src/renderer/src/editor-settings/home-kind-rows'
import {
  editorSettingsStrings,
  editorSettingsText,
} from '../src/renderer/src/i18n/strings-editor-settings'
import { HOME_KINDS, defaultHomeKinds, type HomeKindsSettings } from '../src/shared/home-kinds'
import type { AppChoice, AppChoicePatch } from '../src/shared/editor-choice'

describe('which settings sections show', () => {
  it('shows every section while AI is on', () => {
    expect(shownSettingsSections(true)).toEqual([...SETTINGS_SECTION_IDS])
    for (const id of SETTINGS_SECTION_IDS) expect(sectionShown(id, true)).toBe(true)
  })

  it('hides account, AI, AI media and skills while AI is off', () => {
    expect([...AI_ONLY_SECTIONS].sort()).toEqual(['account', 'aiMedia', 'aiModel', 'skills'])
    const shown = shownSettingsSections(false)
    for (const id of AI_ONLY_SECTIONS) {
      expect(shown).not.toContain(id)
      expect(sectionShown(id, false)).toBe(false)
    }
    expect(shown).toEqual(['general', 'editorChoice', 'integrations', 'about'])
  })

  it('keeps the editors and AI section reachable either way (it holds the AI switch)', () => {
    expect(sectionShown('editorChoice', true)).toBe(true)
    expect(sectionShown('editorChoice', false)).toBe(true)
  })

  it('lights the AI entry for the AI media area', () => {
    expect(navSectionOf('aiMedia')).toBe('aiModel')
    expect(navSectionOf('general')).toBe('general')
  })
})

describe('where opening settings lands', () => {
  it('opens the account section with no target while AI is on, general while AI is off', () => {
    expect(defaultSettingsSection(true)).toBe('account')
    expect(defaultSettingsSection(false)).toBe('general')
    for (const none of [undefined, null]) {
      expect(settingsSectionFor(none, true)).toBe('account')
      expect(settingsSectionFor(none, false)).toBe('general')
    }
  })

  it('opens a hidden section as editors and AI while AI is off', () => {
    for (const id of ['account', 'aiModel', 'aiMedia', 'skills'] as const) {
      expect(settingsSectionFor(id, false)).toBe('editorChoice')
      expect(settingsSectionFor(id, true)).toBe(id)
    }
  })

  it('opens a shown section as asked', () => {
    for (const id of ['general', 'editorChoice', 'integrations', 'about'] as const) {
      expect(settingsSectionFor(id, false)).toBe(id)
      expect(settingsSectionFor(id, true)).toBe(id)
    }
  })

  it('treats an unknown section (sent from the main process as a string) as no target', () => {
    expect(settingsSectionFor('nope', true)).toBe('account')
    expect(settingsSectionFor('nope', false)).toBe('general')
  })
})

function fakeApi(count: number) {
  const calls: string[] = []
  const api = {
    aiJobCount: vi.fn(async () => {
      calls.push('count')
      return count
    }),
    stopAllAiJobs: vi.fn(async () => {
      calls.push('stop')
      return count
    }),
    set: vi.fn(async (patch: AppChoicePatch): Promise<AppChoice> => {
      calls.push(`set:${JSON.stringify(patch)}`)
      return { off: [], aiFeatures: patch.aiFeatures ?? true, locked: false }
    }),
  }
  return { api, calls }
}

describe('turning AI off', () => {
  it('turns it off at once when no AI job is running', async () => {
    const { api, calls } = fakeApi(0)
    const step = await aiOffStart(api)
    expect(step).toEqual({ kind: 'done', choice: { off: [], aiFeatures: false, locked: false } })
    expect(calls).toEqual(['count', 'set:{"aiFeatures":false}'])
    expect(api.stopAllAiJobs).not.toHaveBeenCalled()
  })

  it('asks first when AI jobs are running, and changes nothing until answered', async () => {
    const { api, calls } = fakeApi(3)
    expect(await aiOffStart(api)).toEqual({ kind: 'ask', count: 3 })
    expect(calls).toEqual(['count'])
    expect(api.set).not.toHaveBeenCalled()
    expect(api.stopAllAiJobs).not.toHaveBeenCalled()
  })

  it('turns AI off before it stops every job on "stop and turn off"', async () => {
    // off first: a run another tab starts while the stops are awaited is already refused
    const { api, calls } = fakeApi(2)
    const choice = await aiOffConfirm(api)
    expect(choice.aiFeatures).toBe(false)
    expect(calls).toEqual(['set:{"aiFeatures":false}', 'stop'])
  })

  it('answers AI off even when stopping the jobs fails', async () => {
    const { api } = fakeApi(2)
    api.stopAllAiJobs.mockRejectedValueOnce(new Error('gone'))
    expect((await aiOffConfirm(api)).aiFeatures).toBe(false)
  })

  it('stops nothing when AI could not be turned off', async () => {
    const { api } = fakeApi(2)
    api.set.mockRejectedValueOnce(new Error('not saved'))
    await expect(aiOffConfirm(api)).rejects.toThrow('not saved')
    expect(api.stopAllAiJobs).not.toHaveBeenCalled()
  })

  it('reads a failing count as no job running', async () => {
    const { api } = fakeApi(0)
    api.aiJobCount.mockRejectedValueOnce(new Error('gone'))
    expect((await aiOffStart(api)).kind).toBe('done')
  })
})

describe('the home-kinds rows in Settings → General', () => {
  const custom: HomeKindsSettings = {
    order: ['pdf', 'docx', 'xlsx', 'pptx', 'md', 'html', 'xmind', 'drawio', 'hwp', 'pdfTools'],
    hidden: ['xlsx', 'pptx'],
  }

  it('lists only kinds whose item is on, in the stored order', () => {
    expect(shownHomeKinds(custom, [])).toEqual(custom.order)
    expect(shownHomeKinds(custom, ['sheets', 'pdfTools', 'epub'])).toEqual([
      'pdf',
      'docx',
      'pptx',
      'md',
      'html',
      'xmind',
      'drawio',
      'hwp',
    ])
  })

  it('moves a kind past an off neighbour and leaves the off kind where it was', () => {
    // docx, [xlsx off], pptx: pptx up swaps with docx; xlsx keeps index 2
    const shown = shownHomeKinds(custom, ['sheets'])
    const next = moveShownHomeKind(custom, 'pptx', -1, shown)
    expect(next.order).toEqual([
      'pdf',
      'pptx',
      'xlsx',
      'docx',
      'md',
      'html',
      'xmind',
      'drawio',
      'hwp',
      'pdfTools',
    ])
    expect(next.order.indexOf('xlsx')).toBe(custom.order.indexOf('xlsx'))
    expect(next.hidden).toEqual(custom.hidden)
  })

  it('does not move past the ends of the shown list', () => {
    const shown = shownHomeKinds(custom, ['pdf'])
    expect(moveShownHomeKind(custom, 'docx', -1, shown)).toEqual(custom)
    const last = shownHomeKinds(custom, ['pdfTools'])
    expect(moveShownHomeKind(custom, 'hwp', 1, last)).toEqual(custom)
  })

  it('keeps the stored hidden mark of an off kind, so turning it on restores it', () => {
    const shown = shownHomeKinds(custom, ['sheets'])
    const next = moveShownHomeKind(custom, 'md', 1, shown)
    expect(next.hidden).toContain('xlsx')
    expect(shownHomeKinds(next, [])).toContain('xlsx')
  })

  it('resets only the shown kinds to the first order; off kinds keep their places', () => {
    const shown = shownHomeKinds(custom, ['sheets'])
    expect(homeKindsInFirstOrder(shown)).toBe(false)
    const next = resetShownHomeKinds(custom, shown)
    expect(next.order.indexOf('xlsx')).toBe(custom.order.indexOf('xlsx'))
    expect(homeKindsInFirstOrder(shownHomeKinds(next, ['sheets']))).toBe(true)
    expect(next.hidden).toEqual(custom.hidden)
    // everything on: a plain reset to the first order
    expect(resetShownHomeKinds(custom, shownHomeKinds(custom, [])).order).toEqual([...HOME_KINDS])
  })

  it('reads the first order as in order', () => {
    expect(homeKindsInFirstOrder(shownHomeKinds(defaultHomeKinds(), ['docs', 'hwp']))).toBe(true)
  })
})

describe('editor settings strings', () => {
  it('has every key in all languages, translated beyond English', () => {
    const keys = Object.keys(editorSettingsStrings.zh).sort()
    for (const lang of LANGS) {
      const dict = (editorSettingsStrings as Record<string, Record<string, string>>)[lang]
      expect(dict, lang).toBeTruthy()
      expect(Object.keys(dict).sort(), lang).toEqual(keys)
      for (const key of keys) expect(dict[key].trim(), `${lang}.${key}`).not.toBe('')
      if (lang !== 'en') {
        expect(dict.aiOffAsk, lang).not.toBe(editorSettingsStrings.en.aiOffAsk)
      }
    }
  })

  it('puts the job count in the question', () => {
    expect(editorSettingsText('ko', 'aiOffAsk', { count: 2 })).toContain('2')
    expect(editorSettingsText('en', 'aiOffAsk', { count: 4 })).toContain('4')
  })
})
