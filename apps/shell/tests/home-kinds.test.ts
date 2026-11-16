import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HOME_KINDS,
  defaultHomeKinds,
  moveHomeKind,
  normalizeHomeKinds,
  setHomeKindHidden,
  storedHomeKinds,
  visibleHomeKinds,
} from '../src/shared/home-kinds'

const src = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('reading the homeKinds setting', () => {
  it('starts with every kind shown in the first order', () => {
    for (const raw of [undefined, null, 'docx', [], { order: 'docx', hidden: 3 }]) {
      expect(normalizeHomeKinds(raw)).toEqual({ order: [...HOME_KINDS], hidden: [] })
    }
  })

  it('drops unknown and repeated ids', () => {
    const value = normalizeHomeKinds({
      order: ['pdf', 'nope', 'pdf', 'docx'],
      hidden: ['xlsx', 'xlsx', 'epub', 7],
    })
    expect(value.order.filter((kind) => kind === 'pdf')).toHaveLength(1)
    expect(value.order).not.toContain('nope')
    expect(value.order).toHaveLength(HOME_KINDS.length)
    expect(value.hidden).toEqual(['xlsx'])
  })

  it('puts a kind missing from a saved order beside the kind before it', () => {
    // a saved order from a version without `hwp`: it lands right after `drawio`
    const saved = HOME_KINDS.filter((kind) => kind !== 'hwp').reverse()
    const { order } = normalizeHomeKinds({ order: saved })
    expect(order[order.indexOf('drawio') + 1]).toBe('hwp')
    // a saved order from before the diagram editor: `drawio` lands right after `xmind`
    const beforeDiagram = HOME_KINDS.filter((kind) => kind !== 'drawio').reverse()
    const { order: withDiagram } = normalizeHomeKinds({ order: beforeDiagram })
    expect(withDiagram[withDiagram.indexOf('xmind') + 1]).toBe('drawio')
    // with nothing before it in the first order, it goes first
    const { order: noDocx } = normalizeHomeKinds({ order: ['pdf', 'xlsx'] })
    expect(noDocx[0]).toBe('docx')
    expect(noDocx).toHaveLength(HOME_KINDS.length)
  })

  it('keeps hidden kinds in the shown order', () => {
    const value = normalizeHomeKinds({ order: ['pdf', 'docx'], hidden: ['docx', 'pdf'] })
    expect(value.hidden).toEqual(['pdf', 'docx'])
  })
})

describe('the stored value', () => {
  it('holds only what differs from the first state', () => {
    expect(storedHomeKinds(defaultHomeKinds())).toEqual({})
    const hidden = setHomeKindHidden(defaultHomeKinds(), 'hwp', true)
    expect(storedHomeKinds(hidden)).toEqual({ hidden: ['hwp'] })
    const moved = moveHomeKind(defaultHomeKinds(), 'pdf', -1)
    expect(storedHomeKinds(moved).order?.slice(-3)).toEqual(['pdf', 'hwp', 'pdfTools'])
  })

  it('reads back to the same value', () => {
    const value = setHomeKindHidden(moveHomeKind(defaultHomeKinds(), 'md', 1), 'xlsx', true)
    expect(normalizeHomeKinds(storedHomeKinds(value))).toEqual(value)
  })
})

describe('changing the list', () => {
  it('moves a kind one place and stops at either end', () => {
    const first = defaultHomeKinds()
    expect(moveHomeKind(first, 'docx', -1)).toBe(first)
    expect(moveHomeKind(first, 'pdfTools', 1)).toBe(first)
    expect(moveHomeKind(first, 'xlsx', -1).order.slice(0, 2)).toEqual(['xlsx', 'docx'])
  })

  it('hides and shows without touching the order', () => {
    const hidden = setHomeKindHidden(defaultHomeKinds(), 'pptx', true)
    expect(hidden.order).toEqual([...HOME_KINDS])
    expect(visibleHomeKinds(hidden)).not.toContain('pptx')
    expect(visibleHomeKinds(setHomeKindHidden(hidden, 'pptx', false))).toEqual([...HOME_KINDS])
  })

  it('can hide every kind', () => {
    let value = defaultHomeKinds()
    for (const kind of HOME_KINDS) value = setHomeKindHidden(value, kind, true)
    expect(visibleHomeKinds(value)).toEqual([])
  })
})

describe('where the setting applies', () => {
  const main = src('../src/main/index.ts')

  it('builds every shell "new" menu from the setting', () => {
    // the "+" menu, home's File menu and the macOS Dock menu
    expect(main.match(/\.\.\.newDocumentMenuItems\(/g)).toHaveLength(3)
    // no menu lists the new-document entries by hand any more
    expect(main.match(/label: tm\('menuNewDoc'\)/g)).toBeNull()
    expect(main.match(/'menuNewDoc'/g)).toHaveLength(1)
  })

  it('stores the value, rebuilds the menus and tells home', () => {
    const handler = main.slice(main.indexOf('ipcMain.handle(HOME_KINDS_CHANNELS.set'))
    const body = handler.slice(0, handler.indexOf('\n  })\n'))
    expect(body).toMatch(/storedHomeKinds\(normalizeHomeKinds\(raw\)\)/)
    expect(body).toMatch(/applyMenuFor\('home'\)/)
    expect(body).toMatch(/installDockMenu\(\)/)
    expect(body).toMatch(/HOME_KINDS_CHANNELS\.changed/)
  })

  it('leaves turned-off editors out of every "new" list and rebuilds the menus on a change', () => {
    const menu = main.slice(main.indexOf('function newDocumentMenuItems('))
    const body = menu.slice(0, menu.indexOf('\n}\n'))
    expect(body).toMatch(/hiddenNewDocumentKinds\(homeKinds, appChoice\(\)\)/)
    expect(body).toMatch(
      /visibleHomeKinds\(homeKinds\)\.filter\(\(kind\) => !offKinds\.includes\(kind\)\)/,
    )
    // Ctrl+N / ⌘N is the File menu's first entry, so it follows the same list
    expect(main).toMatch(/newDocumentMenuItems\(\{ section: true, accelerator: 'CmdOrCtrl\+N' \}\)/)
    const change = main.slice(main.indexOf('editorChoice.onChange('))
    const onChange = change.slice(0, change.indexOf('\n})\n'))
    expect(onChange).toMatch(/applyMenuFor\(linkMenuKind\(\) \?\? 'home'\)/)
    expect(onChange).toMatch(/installDockMenu\(\)/)
    const home = src('../src/renderer/src/Home.tsx')
    expect(home).toMatch(/useAppChoice\(choiceSource\)/)
    expect(home).toMatch(
      /hiddenNewDocumentKinds\(homeKinds, \{ off: appChoice\.off\.filter\(isEditorItemId\) \}\)/,
    )
  })

  it('draws home cards from the setting', () => {
    const home = src('../src/renderer/src/Home.tsx')
    expect(home).toMatch(/visibleHomeKinds\(homeKinds\)/)
    expect(home).toMatch(/shownKinds\.map\(/)
    expect(home).not.toMatch(/NEW_ITEMS/)
  })
})
