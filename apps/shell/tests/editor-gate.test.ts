import { describe, expect, it, vi } from 'vitest'
import {
  createEditorGate,
  decideOpen,
  restoreQuestions,
  type EditorGateDeps,
  type GateMessageBox,
  type OpenOrigin,
} from '../src/main/editor-gate'
import type { AppChoice, AppChoicePatch, EditorItemId } from '../src/shared/editor-choice'

describe('decideOpen', () => {
  const origins: OpenOrigin[] = ['user', 'automation', 'ai', 'restore']

  it('opens a file whose editor is on, from every origin', () => {
    for (const origin of origins) {
      expect(decideOpen({ origin, item: 'docs', off: ['slides'], alreadyOpen: false })).toBe('open')
    }
  })

  it('lets the router answer a file no editor owns', () => {
    expect(decideOpen({ origin: 'user', item: null, off: ['docs'], alreadyOpen: false })).toBe(
      'open',
    )
  })

  it('decides a turned-off editor by who asked', () => {
    const off: EditorItemId[] = ['slides']
    const table: Array<[OpenOrigin, string]> = [
      ['user', 'ask'],
      ['restore', 'ask'],
      ['automation', 'open-without-asking'],
      ['ai', 'refuse'],
    ]
    for (const [origin, expected] of table) {
      expect(decideOpen({ origin, item: 'slides', off, alreadyOpen: false })).toBe(expected)
    }
  })

  it('brings an already open file forward without asking, whoever asked', () => {
    for (const origin of origins) {
      expect(decideOpen({ origin, item: 'slides', off: ['slides'], alreadyOpen: true })).toBe(
        'open-without-asking',
      )
    }
  })
})

describe('restoreQuestions', () => {
  it('groups the turned-off items, in order, and skips the rest', () => {
    const questions = restoreQuestions(
      [
        { key: 's0', item: 'docs' },
        { key: 's1', item: 'slides' },
        { key: 's2', item: 'hwp' },
        { key: 's3', item: 'slides' },
        { key: 's4', item: null },
      ],
      ['slides', 'hwp'],
    )
    expect([...questions]).toEqual([
      ['slides', ['s1', 's3']],
      ['hwp', ['s2']],
    ])
  })
})

const EXT_ITEM: Record<string, EditorItemId> = {
  docx: 'docs',
  pptx: 'slides',
  hwp: 'hwp',
  pdf: 'pdf',
}

function harness(off: EditorItemId[], answers: number[] = [], opts: { aiFeatures?: boolean } = {}) {
  let choice: AppChoice = { off: [...off], aiFeatures: opts.aiFeatures ?? true, locked: false }
  const boxes: GateMessageBox[] = []
  const patches: AppChoicePatch[] = []
  const pending: Array<(n: number) => void> = []
  const openPaths = new Set<string>()
  const deps: EditorGateDeps = {
    choice: () => choice,
    setChoice: (patch) => {
      patches.push(patch)
      choice = {
        off: patch.off ?? choice.off,
        aiFeatures: patch.aiFeatures ?? choice.aiFeatures,
        locked: false,
      }
      return choice
    },
    itemOfPath: (path) => EXT_ITEM[path.split('.').pop() ?? ''] ?? null,
    isOpen: (path) => openPaths.has(path),
    showMessageBox: (box) => {
      boxes.push(box)
      if (answers.length > 0) return Promise.resolve(answers.shift() ?? 1)
      return new Promise<number>((resolve) => pending.push(resolve))
    },
    lang: () => 'en',
  }
  const opened: string[] = []
  const open = vi.fn((path: string) => {
    opened.push(path)
    return true
  })
  return {
    gate: createEditorGate(deps),
    boxes,
    patches,
    pending,
    openPaths,
    opened,
    open,
    choice: () => choice,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('one file', () => {
  it('lets an on editor through at once', () => {
    const h = harness(['slides'])
    expect(h.gate.check('/a.docx', 'user', h.open)).toBeNull()
    expect(h.boxes).toEqual([])
  })

  it('asks for a turned-off editor and opens after "Turn on and open"', async () => {
    const h = harness(['slides'], [0])
    expect(h.gate.check('/deck.pptx', 'user', h.open)).toBe(true)
    expect(h.opened).toEqual([])
    await flush()
    expect(h.boxes).toHaveLength(1)
    expect(h.boxes[0].message).toBe('PowerPoint editor is turned off. Turn it on and open?')
    expect(h.boxes[0].detail).toBe('deck.pptx')
    expect(h.boxes[0].buttons).toEqual(['Turn on and open', 'Cancel'])
    expect(h.boxes[0].cancelId).toBe(1)
    // turned on through the choice service before the file opens
    expect(h.patches).toEqual([{ off: [] }])
    expect(h.opened).toEqual(['/deck.pptx'])
  })

  it('opens nothing and changes nothing after Cancel', async () => {
    const h = harness(['slides'], [1])
    expect(await h.gate.openOne('/deck.pptx', 'user', h.open)).toBe(false)
    expect(h.opened).toEqual([])
    expect(h.patches).toEqual([])
    expect(h.choice().off).toEqual(['slides'])
  })

  it('never asks the terminal / MCP and refuses the AI', async () => {
    const h = harness(['slides'])
    expect(h.gate.check('/deck.pptx', 'automation', h.open)).toBeNull()
    expect(h.gate.check('/deck.pptx', 'ai', h.open)).toBe(false)
    expect(await h.gate.openOne('/deck.pptx', 'ai', h.open)).toBe(false)
    expect(h.boxes).toEqual([])
  })

  it('brings an already open file forward without a question', () => {
    const h = harness(['slides'])
    h.openPaths.add('/deck.pptx')
    expect(h.gate.check('/deck.pptx', 'user', h.open)).toBeNull()
    expect(h.boxes).toEqual([])
  })

  it('waits for the answer on the awaiting path', async () => {
    const h = harness(['hwp'])
    const result = h.gate.openOne('/a.hwp', 'user', h.open)
    await flush()
    expect(h.boxes).toHaveLength(1)
    h.pending.shift()?.(0)
    expect(await result).toBe(true)
    expect(h.opened).toEqual(['/a.hwp'])
  })
})

describe('several files at once', () => {
  it('opens the on editors at once and asks once per turned-off editor with the count', async () => {
    const h = harness(['slides', 'hwp'], [0, 1])
    const result = await h.gate.openMany(
      ['/a.docx', '/b.pptx', '/c.pptx', '/d.hwp', '/e.pdf'],
      'user',
      h.open,
    )
    expect(result).toBe(true)
    expect(h.boxes.map((b) => b.message)).toEqual([
      'PowerPoint editor is turned off. Turn it on and open?',
      'Hangul (HWP) editor is turned off. Turn it on and open?',
    ])
    expect(h.boxes[0].detail).toBe('2 files will open in it.')
    expect(h.boxes[1].detail).toBe('d.hwp')
    // the PowerPoint files after "turn on", the Hangul one cancelled
    expect(h.opened).toEqual(['/a.docx', '/e.pdf', '/b.pptx', '/c.pptx'])
    expect(h.choice().off).toEqual(['hwp'])
  })

  it('answers false when every file was cancelled (the launch shows Home)', async () => {
    const h = harness(['slides'], [1])
    expect(await h.gate.openMany(['/a.pptx', '/b.pptx'], 'user', h.open)).toBe(false)
    expect(h.boxes).toHaveLength(1)
    expect(h.opened).toEqual([])
  })

  it('lets a later open of the same editor join the question already up', async () => {
    const h = harness(['slides'])
    expect(h.gate.check('/a.pptx', 'user', h.open)).toBe(true)
    expect(h.gate.check('/b.pptx', 'user', h.open)).toBe(true)
    await flush()
    expect(h.boxes).toHaveLength(1)
    expect(h.boxes[0].detail).toBe('2 files will open in it.')
    h.pending.shift()?.(0)
    await flush()
    expect(h.opened).toEqual(['/a.pptx', '/b.pptx'])
  })

  it('shows one question at a time and skips one whose editor was turned on meanwhile', async () => {
    const h = harness(['slides'])
    const first = h.gate.askTurnOn('slides')
    const second = h.gate.askTurnOn('slides')
    await flush()
    expect(h.boxes).toHaveLength(1)
    h.pending.shift()?.(0)
    expect(await first).toBe('turn-on')
    expect(await second).toBe('turn-on')
    expect(h.boxes).toHaveLength(1)
  })
})

describe('the three-button question', () => {
  it('answers each button and turns on only for the first', async () => {
    const h = harness(['docs'], [1, 2, 0])
    expect(await h.gate.askTurnOnOrFileOnly('docs', { fileName: '/x/out.docx' })).toBe('file-only')
    expect(h.boxes[0].buttons).toEqual(['Turn on and open', 'Create the file only', 'Cancel'])
    expect(h.boxes[0].cancelId).toBe(2)
    expect(await h.gate.askTurnOnOrFileOnly('docs')).toBe('cancel')
    expect(h.choice().off).toEqual(['docs'])
    expect(await h.gate.askTurnOnOrFileOnly('docs')).toBe('turn-on')
    expect(h.choice().off).toEqual([])
  })
})

describe('restoring at launch', () => {
  it('answers at once with nothing refused when nothing is off', () => {
    const h = harness([])
    const refused = h.gate.askRestore([{ key: 's0', item: 'docs' }])
    expect(refused).toBeInstanceOf(Set)
    expect([...(refused as Set<string>)]).toEqual([])
  })

  it('asks once per turned-off item and refuses every tab of a cancelled one', async () => {
    const h = harness(['slides', 'hwp'], [1, 0])
    const refused = await h.gate.askRestore([
      { key: 's0', item: 'slides' },
      { key: 's1', item: 'hwp' },
      { key: 's2', item: 'slides' },
      { key: 's3', item: 'docs' },
    ])
    expect(h.boxes).toHaveLength(2)
    expect(h.boxes[0].detail).toBe('2 files will open in it.')
    expect([...refused]).toEqual(['s0', 's2'])
    expect(h.choice().off).toEqual(['slides'])
  })

  it('does not ask again in the same run about an item refused once', async () => {
    const h = harness(['slides'], [1])
    await h.gate.askRestore([{ key: 's0', item: 'slides' }])
    const again = await h.gate.askRestore([{ key: '/memory/a.pptx', item: 'slides' }])
    expect(h.boxes).toHaveLength(1)
    expect([...again]).toEqual(['/memory/a.pptx'])
  })
})

describe('a skill dropped while AI is off', () => {
  it('turns AI on after "Turn on AI and import"', async () => {
    const h = harness([], [0], { aiFeatures: false })
    expect(await h.gate.askAiOnForSkills()).toBe(true)
    expect(h.boxes[0].message).toBe('AI is turned off. Turn on AI and import the skill?')
    expect(h.boxes[0].buttons).toEqual(['Turn on AI and import', 'Cancel'])
    expect(h.patches).toEqual([{ aiFeatures: true }])
  })

  it('keeps AI off after Cancel, and does not ask while AI is on', async () => {
    const off = harness([], [1], { aiFeatures: false })
    expect(await off.gate.askAiOnForSkills()).toBe(false)
    expect(off.patches).toEqual([])
    const on = harness([])
    expect(await on.gate.askAiOnForSkills()).toBe(true)
    expect(on.boxes).toEqual([])
  })
})
