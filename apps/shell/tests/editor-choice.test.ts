import { describe, expect, it } from 'vitest'
import { HOME_KINDS, defaultHomeKinds } from '../src/shared/home-kinds'
import {
  EDITOR_ITEM_IDS,
  EDITOR_ITEM_HOME_KIND,
  EDITOR_ITEM_TAB_KIND,
  editorItemOfHomeKind,
  editorItemOfTabKind,
  editorPickDue,
  hiddenNewDocumentKinds,
  isLastEditorOn,
  normalizeEditorChoice,
  onboardingSteps,
  setEditorItemOn,
  storedAiFeatures,
  storedEditorChoice,
} from '../src/shared/editor-choice'
import type { TabKind } from '../src/shared/tabs-api'

const TEN_EDITORS = EDITOR_ITEM_IDS.filter((id) => id !== 'pdfTools')

describe('item mapping', () => {
  it('maps each editor to the tab kind that opens its files, and the tool to none', () => {
    expect(EDITOR_ITEM_TAB_KIND).toEqual({
      docs: 'docs',
      sheets: 'sheets',
      slides: 'slides',
      pdf: 'pdf',
      pdfTools: null,
      markdown: 'markdown',
      html: 'html',
      mindmap: 'mindmap',
      diagram: 'diagram',
      hwp: 'hwp',
      epub: 'epub',
    })
  })

  it('finds the item of every document tab kind, none for home and help', () => {
    const kinds: TabKind[] = [
      'docs',
      'sheets',
      'slides',
      'pdf',
      'markdown',
      'html',
      'mindmap',
      'hwp',
      'epub',
      'diagram',
    ]
    for (const kind of kinds) expect(editorItemOfTabKind(kind)).toBe(kind)
    expect(editorItemOfTabKind('home')).toBeNull()
    expect(editorItemOfTabKind('help')).toBeNull()
  })

  it('maps items to new-document kinds; EPUB has none', () => {
    expect(EDITOR_ITEM_HOME_KIND.epub).toBeNull()
    expect(EDITOR_ITEM_HOME_KIND.pdfTools).toBe('pdfTools')
    expect(EDITOR_ITEM_HOME_KIND.docs).toBe('docx')
    const mapped = Object.values(EDITOR_ITEM_HOME_KIND).filter((kind) => kind !== null)
    // every new-document kind belongs to exactly one item
    expect([...mapped].sort()).toEqual([...HOME_KINDS].sort())
    for (const kind of HOME_KINDS) {
      const item = editorItemOfHomeKind(kind)
      expect(item).not.toBeNull()
      expect(EDITOR_ITEM_HOME_KIND[item!]).toBe(kind)
    }
  })
})

describe('normalizing and storing', () => {
  it('drops unknown ids and reads all editors off as all on', () => {
    expect(normalizeEditorChoice({ off: ['hwp', 'zzz'] })).toEqual({ off: ['hwp'] })
    expect(normalizeEditorChoice({ off: TEN_EDITORS })).toEqual({ off: [] })
    expect(normalizeEditorChoice({ off: [...EDITOR_ITEM_IDS] })).toEqual({ off: [] })
    expect(normalizeEditorChoice(null)).toEqual({ off: [] })
  })

  it('stores only what differs from everything on', () => {
    expect(storedEditorChoice({ off: [] })).toEqual({})
    expect(storedEditorChoice({ off: ['epub', 'docs'] })).toEqual({ off: ['docs', 'epub'] })
  })

  it('stores AI only when it is off', () => {
    expect(storedAiFeatures(true)).toBeUndefined()
    expect(storedAiFeatures(false)).toBe(false)
  })
})

describe('turning items on and off', () => {
  it('turns one item off and on again', () => {
    const off = setEditorItemOn({ off: [] }, 'hwp', false)
    expect(off).toEqual({ off: ['hwp'] })
    expect(setEditorItemOn(off, 'hwp', true)).toEqual({ off: [] })
  })

  it('keeps the last editor on, while the PDF tools may go off freely', () => {
    const oneLeft = { off: TEN_EDITORS.filter((id) => id !== 'sheets') }
    expect(isLastEditorOn(oneLeft, 'sheets')).toBe(true)
    expect(isLastEditorOn(oneLeft, 'pdfTools')).toBe(false)
    expect(setEditorItemOn(oneLeft, 'sheets', false)).toEqual(oneLeft)
    expect(setEditorItemOn(oneLeft, 'pdfTools', false).off).toContain('pdfTools')
    expect(isLastEditorOn({ off: [] }, 'sheets')).toBe(false)
    // an item already off is not the last one on
    expect(isLastEditorOn(oneLeft, 'docs')).toBe(false)
  })
})

describe('new-document kinds that are hidden', () => {
  it('joins the hidden kinds and the kinds of items turned off, in home order', () => {
    const homeKinds = { ...defaultHomeKinds(), hidden: ['html' as const] }
    expect(hiddenNewDocumentKinds(homeKinds, { off: ['epub', 'docs', 'pdfTools'] })).toEqual([
      'docx',
      'html',
      'pdfTools',
    ])
    expect(hiddenNewDocumentKinds(defaultHomeKinds(), { off: [] })).toEqual([])
  })
})

describe('first run', () => {
  it('lists the steps with and without AI', () => {
    expect(onboardingSteps(true)).toEqual(['welcome', 'pick', 'connect', 'done'])
    expect(onboardingSteps(false)).toEqual(['welcome', 'pick', 'done'])
  })

  it('shows the one-time picker only to someone past onboarding who has not seen it', () => {
    expect(editorPickDue({ onboardingSeen: true })).toBe(true)
    expect(editorPickDue({ onboardingSeen: true, editorPickSeen: true })).toBe(false)
    expect(editorPickDue({})).toBe(false)
    expect(editorPickDue({ onboardingSeen: 'yes' })).toBe(false)
    expect(editorPickDue({ onboardingSeen: true, editorPickSeen: 'true' })).toBe(true)
  })
})
