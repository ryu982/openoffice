import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { droppedSkillSourceOf } from '@genoffice/ai-provider'
import { handleDroppedFiles } from '../src/main/dropped-files'
import type { DroppedFilesDeps } from '../src/main/dropped-files'
import type { DroppedSkillSource } from '../src/main/user-skills'

function fakeDeps(overrides: Partial<DroppedFilesDeps> = {}): DroppedFilesDeps & {
  opened: string[]
  revealed: ReturnType<typeof vi.fn>
  warned: string[]
  skills: DroppedSkillSource[]
  noSkills: ReturnType<typeof vi.fn>
} {
  const opened: string[] = []
  const revealed = vi.fn()
  const warned: string[] = []
  const skills: DroppedSkillSource[] = []
  const noSkills = vi.fn()
  return {
    opened,
    revealed,
    warned,
    skills,
    noSkills,
    noSkillsFound: noSkills,
    // the core's real judge: a zip is read for its layout
    skillSourceOf: (path) => droppedSkillSourceOf(path, '/no-home'),
    importSkills: (source) => {
      skills.push(source)
    },
    openDocumentPath: vi.fn((path: string) => {
      opened.push(path)
      return true
    }),
    revealShellWindow: revealed,
    showWarning: vi.fn((message: string) => {
      warned.push(message)
    }),
    unsupportedMessage: (exts) => `unsupported: ${exts.join(', ')}`,
    ...overrides,
  }
}

describe('handleDroppedFiles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens every supported path and reveals the shell', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/a.docx', '/tmp/b.xlsx'], deps)
    expect(deps.opened).toEqual(['/tmp/a.docx', '/tmp/b.xlsx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.warned).toEqual([])
  })

  it('still reveals the shell when a path is already open in a tab', async () => {
    const deps = fakeDeps({
      // routeDocumentPath activates the existing tab and returns true either way
      openDocumentPath: vi.fn(() => true),
    })
    await handleDroppedFiles(['/tmp/a.docx'], deps)
    expect(deps.revealed).toHaveBeenCalledOnce()
  })

  it('warns once with the combined extensions for known-unsupported drops', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/old.pps', '/tmp/deck.pages', '/tmp/note.rtf'], deps)
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual(['unsupported: pps, pages, rtf'])
  })

  it('opens the supported files and warns about the rest in a mixed drop', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/new.docx', '/tmp/old.pps'], deps)
    expect(deps.opened).toEqual(['/tmp/new.docx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.warned).toEqual(['unsupported: pps'])
  })

  it('ignores junk payloads and unrecognized file types entirely', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(null, deps)
    await handleDroppedFiles(['/tmp/photo.png', 42, ''], deps)
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual([])
  })
})

describe('handleDroppedFiles with skill files', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function zipAt(name: string, files: Record<string, string>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'dropped-skills-'))
    dirs.push(dir)
    const zip = new JSZip()
    for (const [entry, text] of Object.entries(files)) zip.file(entry, text)
    const path = join(dir, name)
    writeFileSync(path, await zip.generateAsync({ type: 'uint8array' }))
    return path
  }

  const skillMd = '---\nname: report\ndescription: d\n---\nbody\n'

  it('hands a skill zip to the import while a document beside it still opens', async () => {
    const pack = await zipAt('pack.zip', { 'report/SKILL.md': skillMd })
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/a.docx', pack], deps)
    expect(deps.opened).toEqual(['/tmp/a.docx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.skills).toEqual([{ kind: 'zip', file: pack }])
    expect(deps.warned).toEqual([])
  })

  it('hands a SKILL.md to the import instead of the markdown editor', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/dl/SKILL.md', '/dl/notes.md'], deps)
    expect(deps.skills).toEqual([{ kind: 'skill-file', file: '/dl/SKILL.md' }])
    expect(deps.opened).toEqual(['/dl/notes.md'])
  })

  it('says once that no skill was found when the drop is only zips without one', async () => {
    const photos = await zipAt('photos.zip', { 'trip/1.png': 'png', 'report/SKILL.md': skillMd })
    const papers = await zipAt('papers.zip', { 'report.docx': 'doc' })
    const deps = fakeDeps()
    await handleDroppedFiles([photos, papers], deps)
    expect(deps.noSkills).toHaveBeenCalledOnce()
    expect(deps.skills).toEqual([])
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual([])
  })

  it('stays silent about such a zip beside a document that opened', async () => {
    const photos = await zipAt('photos.zip', { 'trip/1.png': 'png' })
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/a.docx', photos], deps)
    expect(deps.opened).toEqual(['/tmp/a.docx'])
    expect(deps.noSkills).not.toHaveBeenCalled()
  })

  it('stays silent about such a zip beside a skill zip or an unsupported file', async () => {
    const photos = await zipAt('photos.zip', { 'trip/1.png': 'png' })
    const pack = await zipAt('pack.zip', { 'report/SKILL.md': skillMd })
    const withSkill = fakeDeps()
    await handleDroppedFiles([photos, pack], withSkill)
    expect(withSkill.skills).toEqual([{ kind: 'zip', file: pack }])
    expect(withSkill.noSkills).not.toHaveBeenCalled()

    const withWarning = fakeDeps()
    await handleDroppedFiles([photos, '/tmp/old.pps'], withWarning)
    expect(withWarning.warned).toEqual(['unsupported: pps'])
    expect(withWarning.noSkills).not.toHaveBeenCalled()
  })

  it('says nothing for a drop that had no zip or SKILL.md at all', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/photo.png'], deps)
    expect(deps.noSkills).not.toHaveBeenCalled()
  })

  it('asks to turn AI on before importing a skill while AI is off', async () => {
    const pack = await zipAt('pack.zip', { 'report/SKILL.md': skillMd })
    const yes = vi.fn(async () => true)
    const accepted = fakeDeps({ aiFeaturesOn: () => false, askAiOnForSkills: yes })
    await handleDroppedFiles([pack], accepted)
    expect(yes).toHaveBeenCalledOnce()
    expect(accepted.skills).toEqual([{ kind: 'zip', file: pack }])

    const no = vi.fn(async () => false)
    const declined = fakeDeps({ aiFeaturesOn: () => false, askAiOnForSkills: no })
    await handleDroppedFiles([pack], declined)
    expect(no).toHaveBeenCalledOnce()
    expect(declined.skills).toEqual([])
    expect(declined.noSkills).not.toHaveBeenCalled()
  })

  it('asks once for several skill files, never with AI on, and not for a zip without one', async () => {
    const a = await zipAt('a.zip', { 'one/SKILL.md': skillMd })
    const b = await zipAt('b.zip', { 'two/SKILL.md': skillMd })
    const ask = vi.fn(async () => true)
    const off = fakeDeps({ aiFeaturesOn: () => false, askAiOnForSkills: ask })
    await handleDroppedFiles([a, b], off)
    expect(ask).toHaveBeenCalledOnce()
    expect(off.skills).toHaveLength(2)

    const onAsk = vi.fn(async () => true)
    const on = fakeDeps({ aiFeaturesOn: () => true, askAiOnForSkills: onAsk })
    await handleDroppedFiles([a], on)
    expect(onAsk).not.toHaveBeenCalled()
    expect(on.skills).toHaveLength(1)

    const photos = await zipAt('photos.zip', { 'trip/1.png': 'png' })
    const empty = vi.fn(async () => true)
    const none = fakeDeps({ aiFeaturesOn: () => false, askAiOnForSkills: empty })
    await handleDroppedFiles([photos], none)
    expect(empty).not.toHaveBeenCalled()
    // the skills page is hidden while AI is off: no notice either
    expect(none.noSkills).not.toHaveBeenCalled()
  })
})

describe('handleDroppedFiles with the batch entry (editors turned off)', () => {
  it('hands every document of the drop over at once and reveals when one opened', async () => {
    const batches: string[][] = []
    const deps = fakeDeps({
      openPaths: vi.fn(async (paths: readonly string[]) => {
        batches.push([...paths])
        return true
      }),
    })
    await handleDroppedFiles(['/tmp/a.docx', '/tmp/b.pptx'], deps)
    expect(batches).toEqual([['/tmp/a.docx', '/tmp/b.pptx']])
    expect(deps.opened).toEqual([])
    expect(deps.revealed).toHaveBeenCalledOnce()
  })

  it('does not reveal the shell when every file was cancelled', async () => {
    const deps = fakeDeps({ openPaths: vi.fn(async () => false) })
    await handleDroppedFiles(['/tmp/b.pptx'], deps)
    expect(deps.revealed).not.toHaveBeenCalled()
  })
})
