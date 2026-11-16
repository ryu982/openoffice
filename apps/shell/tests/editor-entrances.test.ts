import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import {
  askBeforeEditorEntrance,
  askBeforeMakeAndOpen,
  setEditorEntranceAsker,
  type EditorEntranceAsker,
} from '@genoffice/electron-utils/editor-entrance'
import { createEditorEntrances, type EditorEntrancesDeps } from '../src/main/editor-entrances'
import { writeDocumentFileOnly } from '../src/main/document-file-only'
import { createEditorGate, type GateMessageBox } from '../src/main/editor-gate'
import type { AppChoice, EditorItemId } from '../src/shared/editor-choice'
import { editorPromptStrings } from '../src/renderer/src/i18n/strings-editor-prompt'

/**
 * Entrances inside other features (editor choice spec 7.3): they ask before
 * any work while the editor they need is off, with the gate's own questions;
 * an export into a turned-off editor is shown in its folder without a
 * question; the editor mains reach the questions through the asker.
 */

function setup(off: EditorItemId[], answer = 0, open: string[] = []) {
  let choice: AppChoice = { off: [...off], aiFeatures: true, locked: false }
  const boxes: GateMessageBox[] = []
  const gate = createEditorGate({
    choice: () => choice,
    setChoice: (patch) => {
      choice = { ...choice, ...(patch.off ? { off: patch.off } : {}) }
      return choice
    },
    itemOfPath: () => null,
    isOpen: () => false,
    showMessageBox: async (box) => {
      boxes.push(box)
      return answer
    },
    lang: () => 'ko',
  })
  const revealed: string[] = []
  const deps: EditorEntrancesDeps = {
    gate: () => gate,
    isOff: (item) => choice.off.includes(item),
    itemOfPath: (path) =>
      path.endsWith('.docx')
        ? 'docs'
        : path.endsWith('.md')
          ? 'markdown'
          : path.endsWith('.pdf')
            ? 'pdf'
            : null,
    isOpen: (path) => open.includes(path),
    reveal: (path) => revealed.push(path),
    lang: () => 'ko',
  }
  return { entrances: createEditorEntrances(deps), boxes, revealed, choice: () => choice }
}

const ko = editorPromptStrings.ko

describe('a feature that makes a file and opens it', () => {
  it('goes ahead without a question while the editor is on', async () => {
    const { entrances, boxes } = setup([])
    expect(await entrances.makeAndOpen('docs', { fileName: '/in/report.pdf' })).toBe('open')
    expect(boxes).toHaveLength(0)
  })

  it('asks the three-button question, with the file and what "file only" does', async () => {
    const { entrances, boxes } = setup(['docs'], 2)
    expect(await entrances.makeAndOpen('docs', { fileName: '/in/report.pdf' })).toBe('cancel')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.buttons).toEqual([ko.turnOnAndOpen, ko.fileOnly, ko.cancel])
    expect(boxes[0]!.cancelId).toBe(2)
    expect(boxes[0]!.message).toBe(ko.offMessage.replace('{item}', ko.item_docs))
    expect(boxes[0]!.detail).toBe(`report.pdf\n${ko.fileOnlyDetail}`)
  })

  it('"turn on and open" turns the editor on before it answers open', async () => {
    const { entrances, choice } = setup(['docs', 'hwp'], 0)
    expect(await entrances.makeAndOpen('docs')).toBe('open')
    expect(choice().off).toEqual(['hwp'])
  })

  it('"create the file only" leaves the editor off', async () => {
    const { entrances, choice } = setup(['docs'], 1)
    expect(await entrances.makeAndOpen('docs')).toBe('file-only')
    expect(choice().off).toEqual(['docs'])
  })

  it('does not ask about a file that is open already', async () => {
    const { entrances, boxes } = setup(['markdown'], 2, ['/notes/a.md'])
    expect(await entrances.makeAndOpen('markdown', { path: '/notes/a.md' })).toBe('open')
    expect(await entrances.editorEntrance('markdown', { path: '/notes/a.md' })).toBe(true)
    expect(boxes).toHaveLength(0)
  })
})

describe('an entrance that needs the editor itself', () => {
  it('asks the two-button question and says why', async () => {
    const { entrances, boxes, choice } = setup(['pdfTools'], 1)
    expect(await entrances.editorEntrance('pdfTools')).toBe(false)
    expect(boxes[0]!.buttons).toEqual([ko.turnOnAndOpen, ko.cancel])
    expect(boxes[0]!.detail).toBe(ko.entranceDetail.replace('{item}', ko.item_pdfTools))
    expect(choice().off).toEqual(['pdfTools'])
  })

  it('turns it on and goes ahead', async () => {
    const { entrances, choice } = setup(['mindmap'], 0)
    expect(await entrances.editorEntrance('mindmap')).toBe(true)
    expect(choice().off).toEqual([])
  })
})

describe('exports and made files: a tab, or the folder while the editor is off', () => {
  it('opens in a tab while the editor is on, or for a file no editor owns', () => {
    const { entrances, revealed } = setup(['pdf'])
    const open = vi.fn(() => true)
    expect(entrances.opensInTab('/out/a.docx')).toBe(true)
    expect(entrances.opensInTab('/out/a.zip')).toBe(true)
    expect(entrances.openOrReveal('/out/a.docx', open)).toBe(true)
    expect(open).toHaveBeenCalledWith('/out/a.docx')
    expect(revealed).toEqual([])
  })

  it('shows the file in its folder, without a question, while the editor is off', () => {
    const { entrances, revealed, boxes } = setup(['pdf'])
    const open = vi.fn(() => true)
    expect(entrances.opensInTab('/out/a.pdf')).toBe(false)
    expect(entrances.openOrReveal('/out/a.pdf', open)).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(revealed).toEqual(['/out/a.pdf'])
    expect(boxes).toHaveLength(0)
  })

  it('a file still open in a tab of the turned-off editor goes to that tab', () => {
    const { entrances, revealed } = setup(['pdf'], 0, ['/out/a.pdf'])
    const open = vi.fn(() => true)
    expect(entrances.openOrReveal('/out/a.pdf', open)).toBe(true)
    expect(open).toHaveBeenCalled()
    expect(revealed).toEqual([])
  })
})

describe('a result that exists already (PDF tools)', () => {
  it('cancel opens and shows nothing', async () => {
    const { entrances, revealed } = setup(['pdf'], 2)
    const open = vi.fn(() => true)
    expect(await entrances.openExisting('/out/m.pdf', open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(revealed).toEqual([])
  })

  it('"create the file only" shows it in its folder', async () => {
    const { entrances, revealed } = setup(['pdf'], 1)
    const open = vi.fn(() => true)
    expect(await entrances.openExisting('/out/m.pdf', open)).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(revealed).toEqual(['/out/m.pdf'])
  })

  it('"turn on and open" opens it', async () => {
    const { entrances, choice } = setup(['pdf'], 0)
    const open = vi.fn(() => true)
    expect(await entrances.openExisting('/out/m.pdf', open)).toBe(true)
    expect(open).toHaveBeenCalledWith('/out/m.pdf')
    expect(choice().off).toEqual([])
  })
})

describe('the asker the editor mains use', () => {
  afterEach(() => {
    setEditorEntranceAsker(null)
    setAppChoiceSource(null)
  })

  const fakeAsker = (): EditorEntranceAsker & {
    makeAndOpen: ReturnType<typeof vi.fn>
    editorEntrance: ReturnType<typeof vi.fn>
  } => ({
    makeAndOpen: vi.fn(async () => 'file-only' as const),
    editorEntrance: vi.fn(async () => false),
  })

  it('goes ahead with no shell answering (an editor on its own)', async () => {
    setAppChoiceSource(() => ({ off: ['docs'], aiFeatures: true, locked: false }))
    expect(await askBeforeMakeAndOpen('docs')).toBe('open')
    expect(await askBeforeEditorEntrance('docs')).toBe(true)
  })

  it('does not ask while the editor is on', async () => {
    const asker = fakeAsker()
    setEditorEntranceAsker(asker)
    setAppChoiceSource(() => ({ off: ['hwp'], aiFeatures: true, locked: false }))
    expect(await askBeforeMakeAndOpen('docs')).toBe('open')
    expect(await askBeforeEditorEntrance('markdown')).toBe(true)
    expect(asker.makeAndOpen).not.toHaveBeenCalled()
    expect(asker.editorEntrance).not.toHaveBeenCalled()
  })

  it("hands a turned-off editor's question to the shell", async () => {
    const asker = fakeAsker()
    setEditorEntranceAsker(asker)
    setAppChoiceSource(() => ({ off: ['docs', 'markdown'], aiFeatures: true, locked: false }))
    expect(await askBeforeMakeAndOpen('docs', { fileName: 'a.docx' })).toBe('file-only')
    expect(asker.makeAndOpen).toHaveBeenCalledWith('docs', { fileName: 'a.docx' })
    expect(await askBeforeEditorEntrance('markdown')).toBe(false)
  })
})

describe('"create the file only" for a document that would open as a new tab', () => {
  const rig = (project: string | null = null) => {
    const writes: Array<{ where: string; fileName: string; bytes: Uint8Array }> = []
    const revealed: string[] = []
    const deps = {
      fileBase: (title: string) => title.replaceAll('/', '_'),
      htmlToDocx: vi.fn(async (html: string) => new TextEncoder().encode(`DOCX:${html}`)),
      writeInProject: async (_owner: number, fileName: string, bytes: Uint8Array) => {
        if (!project) return null
        writes.push({ where: 'project', fileName, bytes })
        return `${project}/${fileName}`
      },
      writeInDefaultFolder: async (fileName: string, bytes: Uint8Array) => {
        writes.push({ where: 'default', fileName, bytes })
        return `/docs/${fileName}`
      },
      reveal: (path: string) => revealed.push(path),
    }
    return { deps, writes, revealed }
  }

  it('writes Markdown as it is into the default folder and shows it', async () => {
    const r = rig()
    expect(
      await writeDocumentFileOnly(r.deps, { type: 'md', title: 'a/b', content: '# x' }, 3),
    ).toEqual({ ok: true, path: '/docs/a_b.md' })
    expect(new TextDecoder().decode(r.writes[0]!.bytes)).toBe('# x')
    expect(r.revealed).toEqual(['/docs/a_b.md'])
  })

  it('converts Word HTML and prefers the project folder', async () => {
    const r = rig('/proj')
    const result = await writeDocumentFileOnly(
      r.deps,
      { type: 'docx', title: 'Notes', content: '<p>x</p>' },
      3,
    )
    expect(result).toEqual({ ok: true, path: '/proj/Notes.docx' })
    expect(r.deps.htmlToDocx).toHaveBeenCalledWith('<p>x</p>')
    expect(r.writes.map((w) => w.where)).toEqual(['project'])
  })

  it('refuses other types and empty content without writing', async () => {
    const r = rig()
    expect(
      (await writeDocumentFileOnly(r.deps, { type: 'pdf', title: 't', content: 'x' }, 1)).ok,
    ).toBe(false)
    expect(
      (await writeDocumentFileOnly(r.deps, { type: 'md', title: 't', content: '  ' }, 1)).ok,
    ).toBe(false)
    expect(r.writes).toEqual([])
    expect(r.revealed).toEqual([])
  })
})
