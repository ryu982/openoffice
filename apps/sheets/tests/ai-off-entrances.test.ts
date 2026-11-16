// @vitest-environment jsdom
/**
 * AI turned off in Settings: the sheet window draws none of its AI entrances
 * (the ribbon's AI group, Review ▸ Translate, the cell menu's Ask AI), and
 * turning AI on brings them back. The ribbon and the menu entry are the real
 * ones; only Univer's own "is a sheet focused" signal is stubbed.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BehaviorSubject, of, type Observable } from 'rxjs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@univerjs/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@univerjs/ui')>()),
  getMenuHiddenObservable: () => of(false),
}))

import type { IAccessor } from '@univerjs/core'
import { Ribbon } from '../src/renderer/ExcelShell'
import { aiMenuHidden$, cellContextMenuLayout, toMenuItem } from '../src/renderer/cell-context-menu'
import { t } from '../src/renderer/i18n/locale'

type RibbonProps = Parameters<typeof Ribbon>[0]

const baseProps = (activeTab: RibbonProps['activeTab'], aiOn: boolean): RibbonProps => ({
  activeTab,
  selectionFormat: null,
  formatPainterActive: false,
  sheetHasContent: true,
  sheetProtected: false,
  workbookProtected: false,
  spellcheckOn: true,
  formulaBarVisible: true,
  crossHighlightVisible: false,
  pageLayout: { showGridlines: true, showHeadings: true, rightToLeft: false },
  selectedChart: null,
  selectedShape: null,
  selectedTable: null,
  outlineSummary: { below: true, right: true },
  onCommand: () => {},
  onAiRun: () => {},
  aiOn,
  aiOpen: false,
  onAiToggle: () => {},
  onListNames: () => [],
  calcManual: false,
  showFormulas: false,
  onRefreshPivot: () => null,
  onIsSelectionInPivot: () => false,
})

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  aiMenuHidden$.next(false)
})

function renderRibbon(activeTab: RibbonProps['activeTab'], aiOn: boolean): HTMLDivElement {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() => root!.render(createElement(Ribbon, baseProps(activeTab, aiOn))))
  return host
}

const translateTool = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-tip]')].find(
    (node) => node.getAttribute('data-tip') === t('appTranslateTitle'),
  ) ?? null

describe('sheets ribbon while AI is turned off', () => {
  it('Home: the AI group is drawn with AI on, gone with it off, back when on again', () => {
    const el = renderRibbon('Home', true)
    expect(el.querySelectorAll('.ai-entry')).toHaveLength(3)

    renderRibbon('Home', false)
    expect(el.querySelectorAll('.ai-entry')).toHaveLength(0)
    expect(el.textContent).toContain(t('appPaste'))
    expect(el.textContent).not.toContain(t('aiAnalyzeBtn'))

    renderRibbon('Home', true)
    expect(el.querySelectorAll('.ai-entry')).toHaveLength(3)
  })

  it('Review: Translate (an AI run) follows the switch, the other review tools stay', () => {
    const el = renderRibbon('Review', true)
    expect(translateTool(el)).not.toBeNull()

    renderRibbon('Review', false)
    expect(translateTool(el)).toBeNull()
    expect(el.querySelector('.ribbon-tool, button')).not.toBeNull()

    renderRibbon('Review', true)
    expect(translateTool(el)).not.toBeNull()
  })
})

describe('cell menu Ask AI while AI is turned off', () => {
  const askAi = () => {
    const node = cellContextMenuLayout().find((entry) => entry.id === 'genoffice.ctx.ask-ai')
    expect(node?.aiOnly).toBe(true)
    return toMenuItem({} as IAccessor, node!)
  }
  const latest = (hidden$: Observable<boolean> | undefined): boolean => {
    let value: boolean | undefined
    hidden$?.subscribe((next) => (value = next)).unsubscribe()
    return value!
  }

  it('hides with AI off and shows again with AI on, live', () => {
    const item = askAi()
    expect(latest(item.hidden$)).toBe(false)
    aiMenuHidden$.next(true)
    expect(latest(item.hidden$)).toBe(true)
    aiMenuHidden$.next(false)
    expect(latest(item.hidden$)).toBe(false)
  })

  it('leaves the entries that do not use AI alone', () => {
    aiMenuHidden$.next(true)
    const others = cellContextMenuLayout().filter((entry) => !entry.aiOnly)
    expect(others.length).toBeGreaterThan(0)
    for (const node of others) expect(latest(toMenuItem({} as IAccessor, node).hidden$)).toBe(false)
  })

  it('is fed by a BehaviorSubject, so a menu built after the switch already knows', () => {
    expect(aiMenuHidden$).toBeInstanceOf(BehaviorSubject)
    aiMenuHidden$.next(true)
    expect(latest(askAi().hidden$)).toBe(true)
  })
})
