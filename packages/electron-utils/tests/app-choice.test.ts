import { afterEach, describe, expect, it } from 'vitest'
import {
  ALL_ON_APP_CHOICE,
  APP_CHOICE_CHANNELS,
  APP_CHOICE_KEYS,
  EDITOR_ITEM_IDS,
  EDITOR_ONLY_ITEM_IDS,
  aiFeaturesOn,
  allEditorsOff,
  appChoice,
  appChoiceFromSettings,
  editorOffList,
  isEditorItemId,
  isEditorItemOff,
  isToolItem,
  normalizeAiFeatures,
  normalizeAppChoice,
  normalizeEditorOff,
  setAppChoiceSource,
} from '../src/app-choice'

afterEach(() => setAppChoiceSource(null))

const TEN_EDITORS = [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
  'html',
  'mindmap',
  'diagram',
  'hwp',
  'epub',
]

describe('editor items', () => {
  it('lists eleven items in a fixed order, ten editors and one tool', () => {
    expect(EDITOR_ITEM_IDS).toEqual([
      'docs',
      'sheets',
      'slides',
      'pdf',
      'pdfTools',
      'markdown',
      'html',
      'mindmap',
      'diagram',
      'hwp',
      'epub',
    ])
    expect(EDITOR_ONLY_ITEM_IDS).toEqual(TEN_EDITORS)
    expect(EDITOR_ITEM_IDS.filter(isToolItem)).toEqual(['pdfTools'])
  })

  it('knows its ids', () => {
    expect(isEditorItemId('pdfTools')).toBe(true)
    expect(isEditorItemId('docx')).toBe(false)
    expect(isEditorItemId(3)).toBe(false)
  })
})

describe('reading the stored choice', () => {
  it('reads absent or empty values as everything on', () => {
    expect(normalizeEditorOff(undefined)).toEqual([])
    expect(normalizeEditorOff({})).toEqual([])
    expect(normalizeEditorOff({ off: [] })).toEqual([])
    expect(normalizeEditorOff('docs')).toEqual([])
    expect(normalizeEditorOff([])).toEqual([])
  })

  it('drops unknown ids and duplicates and keeps the fixed order', () => {
    expect(normalizeEditorOff({ off: ['epub', 'nope', 'docs', 'epub', 7] })).toEqual([
      'docs',
      'epub',
    ])
  })

  it('reads all ten editors off as everything on, with or without the tool', () => {
    expect(normalizeEditorOff({ off: TEN_EDITORS })).toEqual([])
    expect(normalizeEditorOff({ off: [...EDITOR_ITEM_IDS] })).toEqual([])
    // only the PDF tools on still means no editor is on
    expect(allEditorsOff(editorOffList({ off: TEN_EDITORS }))).toBe(true)
    expect(allEditorsOff(editorOffList({ off: TEN_EDITORS.slice(1) }))).toBe(false)
  })

  it('keeps the tool alone off', () => {
    expect(normalizeEditorOff({ off: ['pdfTools'] })).toEqual(['pdfTools'])
  })

  it('reads AI as on unless it is exactly false', () => {
    expect(normalizeAiFeatures(undefined)).toBe(true)
    expect(normalizeAiFeatures(true)).toBe(true)
    expect(normalizeAiFeatures('false')).toBe(true)
    expect(normalizeAiFeatures(0)).toBe(true)
    expect(normalizeAiFeatures(false)).toBe(false)
  })

  it('reads the whole app-settings object', () => {
    expect(appChoiceFromSettings({})).toEqual(ALL_ON_APP_CHOICE)
    expect(
      appChoiceFromSettings({
        [APP_CHOICE_KEYS.editors]: { off: ['hwp', 'pdfTools'] },
        [APP_CHOICE_KEYS.aiFeatures]: false,
        theme: 'dark',
      }),
    ).toEqual({ off: ['pdfTools', 'hwp'], aiFeatures: false, locked: false })
  })

  it('normalizes a value sent over IPC', () => {
    expect(normalizeAppChoice(null)).toEqual(ALL_ON_APP_CHOICE)
    expect(normalizeAppChoice({ off: ['epub', 'x'], aiFeatures: false, locked: true })).toEqual({
      off: ['epub'],
      aiFeatures: false,
      locked: false,
    })
  })
})

describe('the source editor mains read', () => {
  it('answers everything on and AI on while no source is set', () => {
    expect(appChoice()).toEqual(ALL_ON_APP_CHOICE)
    expect(aiFeaturesOn()).toBe(true)
    expect(isEditorItemOff('docs')).toBe(false)
  })

  it('answers what the shell source gives', () => {
    setAppChoiceSource(() => ({ off: ['docs'], aiFeatures: false, locked: false }))
    expect(aiFeaturesOn()).toBe(false)
    expect(isEditorItemOff('docs')).toBe(true)
    expect(isEditorItemOff('sheets')).toBe(false)
  })

  it('falls back to everything on when the source throws', () => {
    setAppChoiceSource(() => {
      throw new Error('settings unreadable')
    })
    expect(appChoice()).toEqual(ALL_ON_APP_CHOICE)
  })

  it('hands out copies, never the shared default', () => {
    const a = appChoice()
    a.off.push('docs')
    expect(appChoice().off).toEqual([])
    expect(ALL_ON_APP_CHOICE.off).toEqual([])
  })
})

describe('channels', () => {
  it('names every channel under app: once', () => {
    const names = Object.values(APP_CHOICE_CHANNELS)
    for (const name of names) expect(name).toMatch(/^app:[a-z-]+$/)
    expect(new Set(names).size).toBe(names.length)
  })
})
