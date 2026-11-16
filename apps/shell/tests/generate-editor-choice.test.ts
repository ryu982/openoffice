import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { ConvertKind, GenerateHandoff } from '../src/shared/generate-api'
import { convertedFileOf, type ConvertedDocument } from '../src/main/generate/convert'
import { generateAiView } from '../src/renderer/src/generate/ai-off'
import {
  GenerateSession,
  type GenerateEditor,
  type GenerateEditorAnswer,
  type GenerateSessionDeps,
  type MaterialRef,
} from '../src/main/generate/session'

/**
 * The generate window while editors and AI can be turned off (editor choice
 * spec 7.3, 8.1): "make" asks before anything is read or converted while the
 * new document's editor is off ([Turn on and open] [Cancel] for the AI kinds;
 * also [Create the file only] for a conversion), cancel leaves nothing, "file
 * only" writes the result instead of opening a tab, and an AI "make" is
 * refused while AI is off.
 */

const p = (name: string) => join(tmpdir(), 'gen-editor-choice', name)

function harness(answer: GenerateEditorAnswer, options: { aiOn?: boolean } = {}) {
  const events: string[] = []
  const handoffs: GenerateHandoff[] = []
  const opened: ConvertedDocument[] = []
  const saved: ConvertedDocument[] = []
  let closed = 0
  let release: (() => void) | null = null
  const asked: Array<{ editor: GenerateEditor; withFileOnly: boolean; source?: string }> = []
  const deps: GenerateSessionDeps = {
    lang: () => 'en',
    inspect: async (path) => {
      events.push(`inspect ${path.split(/[\\/]/).pop()}`)
      const name = path.split(/[\\/]/).pop()!
      return {
        key: path,
        name,
        path,
        ext: name.split('.').pop()!,
        sizeBytes: 10,
        unsaved: false,
        textLength: 10,
      }
    },
    pathOfUntitled: async () => null,
    saveActionFor: async () => 'save',
    saveMaterial: async () => 'saved',
    showUntitled: async () => {},
    openTargetTab: (h) => {
      events.push('open target tab')
      handoffs.push(h)
    },
    convert: async (kind: ConvertKind) => {
      events.push(`convert ${kind}`)
      return {
        ok: true as const,
        content: {
          kind: 'mindmap-to-markdown' as const,
          target: 'markdown' as const,
          markdown: 'x',
        },
      }
    },
    openConvertedTab: (doc) => {
      events.push('open converted tab')
      opened.push(doc)
    },
    saveConvertedFile: async (doc) => {
      events.push('save file')
      saved.push(doc)
    },
    askEditor: (editor, withFileOnly, source) => {
      events.push('ask')
      asked.push({ editor, withFileOnly, ...(source ? { source } : {}) })
      return new Promise((resolve) => {
        release = () => resolve(answer)
      })
    },
    aiOn: () => options.aiOn ?? true,
    push: () => {},
    close: () => {
      closed++
    },
    newId: () => 'id-1',
    now: () => 1,
    recheckDelayMs: 0,
  }
  return {
    deps,
    events,
    handoffs,
    opened,
    saved,
    asked,
    answer: () => release?.(),
    closedCount: () => closed,
  }
}

async function start(h: ReturnType<typeof harness>, refs: MaterialRef[]) {
  const session = new GenerateSession(h.deps, { refs })
  await session.refresh()
  h.events.length = 0
  return session
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('the AI "make" for a kind whose editor is off', () => {
  it('asks the two-button question for that kind before anything is read', async () => {
    const h = harness('open')
    const s = await start(h, [{ path: p('a.docx') }])
    s.setKind('mindmap')
    const making = s.make('a map please')
    await tick()
    expect(h.events).toEqual(['ask'])
    expect(h.asked).toEqual([{ editor: 'mindmap', withFileOnly: false }])
    h.answer()
    expect(await making).toBe(true)
    expect(h.events).toEqual(['ask', 'inspect a.docx', 'inspect a.docx', 'open target tab'])
    expect(h.handoffs[0]!.target).toBe('mindmap')
  })

  it('cancel opens nothing and keeps the window', async () => {
    const h = harness('cancel')
    const s = await start(h, [{ path: p('a.docx') }])
    const making = s.make('')
    await tick()
    h.answer()
    expect(await making).toBe(false)
    expect(h.events).toEqual(['ask'])
    expect(h.handoffs).toEqual([])
    expect(h.closedCount()).toBe(0)
    expect(s.state().making).toBe(false)
  })

  it('is refused without a question while AI is off', async () => {
    const h = harness('open', { aiOn: false })
    const s = await start(h, [{ path: p('a.docx') }])
    expect(await s.make('slides')).toBe(false)
    expect(h.events).toEqual([])
    expect(h.handoffs).toEqual([])
  })
})

describe('a conversion without AI into an editor that is off', () => {
  it('asks the three-button question, with the source, before reading or converting', async () => {
    const h = harness('open')
    const s = await start(h, [{ path: p('plan.xmind') }])
    s.setConvert('mindmap-to-markdown')
    const making = s.make('')
    await tick()
    expect(h.events).toEqual(['ask'])
    expect(h.asked).toEqual([{ editor: 'markdown', withFileOnly: true, source: p('plan.xmind') }])
    h.answer()
    expect(await making).toBe(true)
    expect(h.events.slice(-2)).toEqual(['convert mindmap-to-markdown', 'open converted tab'])
    expect(h.saved).toEqual([])
  })

  it('still works while AI is off', async () => {
    const h = harness('open', { aiOn: false })
    const s = await start(h, [{ path: p('plan.xmind') }])
    s.setConvert('mindmap-to-slides')
    const making = s.make('')
    await tick()
    h.answer()
    expect(await making).toBe(true)
    expect(h.asked[0]!.editor).toBe('slides')
    expect(h.opened).toHaveLength(1)
  })

  it('cancel converts nothing and leaves no file', async () => {
    const h = harness('cancel')
    const s = await start(h, [{ path: p('plan.xmind') }])
    s.setConvert('mindmap-to-markdown')
    const making = s.make('')
    await tick()
    h.answer()
    expect(await making).toBe(false)
    expect(h.events).toEqual(['ask'])
    expect(h.saved).toEqual([])
    expect(h.opened).toEqual([])
    expect(h.closedCount()).toBe(0)
  })

  it('"create the file only" writes the result instead of opening a tab, and closes', async () => {
    const h = harness('file-only')
    const s = await start(h, [{ path: p('plan.xmind') }])
    s.setConvert('mindmap-to-markdown')
    const making = s.make('')
    await tick()
    h.answer()
    expect(await making).toBe(true)
    expect(h.events.slice(-2)).toEqual(['convert mindmap-to-markdown', 'save file'])
    expect(h.opened).toEqual([])
    expect(h.saved[0]!.sources).toEqual([p('plan.xmind')])
    expect(h.closedCount()).toBe(1)
  })

  it('offers no "file only" when the window cannot write one', async () => {
    const h = harness('open')
    delete h.deps.saveConvertedFile
    const s = await start(h, [{ path: p('notes.md') }])
    s.setConvert('markdown-to-mindmap')
    const making = s.make('')
    await tick()
    h.answer()
    await making
    expect(h.asked[0]).toMatchObject({ editor: 'mindmap', withFileOnly: false })
  })
})

describe('the file a conversion makes for "create the file only"', () => {
  it('is named after its source with the target extension', async () => {
    const md = await convertedFileOf(
      { kind: 'mindmap-to-markdown', target: 'markdown', markdown: '# 제목\n' },
      '/maps/plan.xmind',
      'Untitled',
    )
    expect(md.fileName).toBe('plan.md')
    expect(new TextDecoder().decode(md.bytes)).toBe('# 제목\n')

    const deck = new Uint8Array([1, 2, 3])
    const pptx = await convertedFileOf(
      { kind: 'mindmap-to-slides', target: 'slides', deck, slideCount: 1 },
      '/maps/plan.xmind',
      'Untitled',
    )
    expect(pptx).toEqual({ fileName: 'plan.pptx', bytes: deck })
  })

  it('writes a map as a real .xmind file', async () => {
    const map = await convertedFileOf(
      { kind: 'markdown-to-mindmap', target: 'mindmap', outline: '# Plan\n\n- One\n- Two\n' },
      '/notes/plan.md',
      'Untitled',
    )
    expect(map.fileName).toBe('plan.xmind')
    // a zip archive
    expect([...map.bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
  })
})

describe('the window without the editor-choice wiring', () => {
  it('never asks', async () => {
    const h = harness('cancel')
    delete h.deps.askEditor
    const s = await start(h, [{ path: p('a.docx') }])
    const spy = vi.fn()
    h.deps.openTargetTab = spy
    expect(await s.make('x')).toBe(true)
    expect(spy).toHaveBeenCalled()
  })
})

describe('what the window draws while AI is on or off (spec 8.1)', () => {
  const base = {
    mode: 'ai' as const,
    conversions: [] as ConvertKind[],
    canMake: true,
    making: false,
  }

  it('AI on: as before', () => {
    expect(generateAiView(base, true)).toEqual({
      showAi: true,
      aiOffHint: null,
      canMake: true,
      pickConversion: null,
    })
  })

  it('AI off: no AI "make"; the first conversion on offer is chosen', () => {
    const conversions: ConvertKind[] = ['mindmap-to-markdown', 'mindmap-to-slides']
    expect(generateAiView({ ...base, conversions }, false)).toEqual({
      showAi: false,
      aiOffHint: 'genAiOffConvert',
      canMake: false,
      pickConversion: 'mindmap-to-markdown',
    })
    expect(generateAiView({ ...base, conversions, mode: 'convert' }, false)).toMatchObject({
      canMake: true,
      pickConversion: null,
    })
  })

  it('AI off with nothing to convert: says how, and makes nothing', () => {
    expect(generateAiView(base, false)).toEqual({
      showAi: false,
      aiOffHint: 'genAiOffNoConversion',
      canMake: false,
      pickConversion: null,
    })
  })

  it('chooses nothing while a "make" is running', () => {
    expect(
      generateAiView({ ...base, conversions: ['markdown-to-mindmap'], making: true }, false)
        .pickConversion,
    ).toBeNull()
  })
})
