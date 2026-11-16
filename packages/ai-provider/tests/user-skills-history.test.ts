import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSkillHistory,
  diffSkillVersion,
  diffTextLines,
  foldDiffLines,
  sameSkillFolderBytes,
  type SkillHistory,
} from '../src/user-skills/history'

/** The store of an own skill's earlier versions: what is kept, listed, read back and moved */

let root: string
let skillDir: string
let history: SkillHistory
let clock: number

const historyDir = () => join(root, 'skill-history')

function put(rel: string, data: string | Uint8Array) {
  const path = join(skillDir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
}

async function plantZip(id: string, entries: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, text] of Object.entries(entries)) zip.file(name, text)
  mkdirSync(join(historyDir(), 'deck'), { recursive: true })
  writeFileSync(
    join(historyDir(), 'deck', `${id}.zip`),
    await zip.generateAsync({ type: 'uint8array' }),
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-history-'))
  skillDir = join(root, 'skills', 'deck')
  clock = Date.UTC(2026, 10, 10, 9, 30, 0, 0)
  history = createSkillHistory({
    dir: historyDir(),
    tempDir: join(root, 'temp'),
    now: () => new Date(clock),
  })
  put('SKILL.md', '---\nname: deck\ndescription: Decks\n---\nFirst.\n')
  put('reference/colors.md', '# Colors\n')
  put('assets/logo.bin', new Uint8Array([0, 1, 2, 255, 254]))
  put('.ieum-source.json', '{"kind":"github"}\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('keeping a version', () => {
  it('writes one zip named by time and reason, the skill folder under its name', async () => {
    const kept = await history.keep(skillDir, 'deck', 'edit')
    expect(kept).toMatchObject({
      id: '20261110T093000000Z-edit',
      at: '2026-11-10T09:30:00.000Z',
      reason: 'edit',
    })
    expect(readdirSync(join(historyDir(), 'deck'))).toEqual(['20261110T093000000Z-edit.zip'])

    const zip = await JSZip.loadAsync(
      readFileSync(join(historyDir(), 'deck', '20261110T093000000Z-edit.zip')),
    )
    const names = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort()
    expect(names).toEqual([
      'deck/.ieum-source.json',
      'deck/SKILL.md',
      'deck/assets/logo.bin',
      'deck/reference/colors.md',
    ])
    expect((await history.list('deck'))[0]!.bytes).toBe(kept!.bytes)
  })

  it('keeps nothing when the newest version already holds these files', async () => {
    await history.keep(skillDir, 'deck', 'edit')
    clock += 1000
    expect(await history.keep(skillDir, 'deck', 'update')).toBeUndefined()
    expect(await history.list('deck')).toHaveLength(1)

    put('SKILL.md', '---\nname: deck\ndescription: Decks\n---\nSecond.\n')
    clock += 1000
    expect(await history.keep(skillDir, 'deck', 'update')).toMatchObject({ reason: 'update' })
    expect((await history.list('deck')).map((version) => version.reason)).toEqual([
      'update',
      'edit',
    ])
  })

  it('names two versions of one moment apart, newest first', async () => {
    await history.keep(skillDir, 'deck', 'edit')
    put('SKILL.md', 'changed\n')
    await history.keep(skillDir, 'deck', 'replace')
    expect((await history.list('deck')).map((version) => version.id)).toEqual([
      '20261110T093000001Z-replace',
      '20261110T093000000Z-edit',
    ])
  })

  it('lists none for a skill without versions, and passes over files that are not versions', async () => {
    expect(await history.list('deck')).toEqual([])
    mkdirSync(join(historyDir(), 'deck'), { recursive: true })
    writeFileSync(join(historyDir(), 'deck', 'notes.txt'), 'mine')
    writeFileSync(join(historyDir(), 'deck', '20261110T093000000Z-other.zip'), 'x')
    expect(await history.list('deck')).toEqual([])
  })

  it('files a skill by its name without case, and refuses what is not a skill name', async () => {
    await history.keep(skillDir, 'Deck', 'edit')
    expect(await history.list('deck')).toHaveLength(1)
    await expect(history.keep(skillDir, '../deck', 'edit')).rejects.toMatchObject({
      kind: 'failed',
    })
    await expect(history.list('a/b')).rejects.toMatchObject({ kind: 'failed' })
  })
})

describe('reading a version back', () => {
  it('gives every file back byte for byte', async () => {
    const kept = await history.keep(skillDir, 'deck', 'edit')
    const out = join(root, 'out')
    await history.extract('deck', kept!.id, out)
    expect(await sameSkillFolderBytes(skillDir, out)).toBe(true)
    expect(readFileSync(join(out, 'assets', 'logo.bin'))).toEqual(Buffer.from([0, 1, 2, 255, 254]))
    expect(readFileSync(join(out, '.ieum-source.json'), 'utf8')).toBe('{"kind":"github"}\n')
  })

  it('refuses an identifier that is not a version, and a version that is not there', async () => {
    await history.keep(skillDir, 'deck', 'edit')
    await expect(history.extract('deck', '../../x', join(root, 'o1'))).rejects.toMatchObject({
      kind: 'not-found',
    })
    await expect(
      history.extract('deck', '20200101T000000000Z-edit', join(root, 'o2')),
    ).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('refuses a kept zip whose entries would leave the folder', async () => {
    await plantZip('20261110T093000000Z-edit', { 'deck/SKILL.md': 'ok', '../escape.txt': 'no' })
    await expect(
      history.extract('deck', '20261110T093000000Z-edit', join(root, 'out')),
    ).rejects.toMatchObject({ kind: 'unsafe' })
  })

  it('refuses a kept zip that holds no skill', async () => {
    await plantZip('20261110T093000000Z-edit', { 'deck/readme.txt': 'no skill here' })
    await expect(
      history.extract('deck', '20261110T093000000Z-edit', join(root, 'out')),
    ).rejects.toMatchObject({ kind: 'unsafe' })
  })
})

describe('taking versions away and moving them', () => {
  it('removes one version, and the folder with the last', async () => {
    const first = await history.keep(skillDir, 'deck', 'edit')
    put('SKILL.md', 'changed\n')
    clock += 1000
    const second = await history.keep(skillDir, 'deck', 'edit')
    await history.remove('deck', first!.id)
    expect((await history.list('deck')).map((version) => version.id)).toEqual([second!.id])
    await history.remove('deck', second!.id)
    expect(readdirSync(historyDir())).toEqual([])
    await expect(history.remove('deck', second!.id)).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('follows a renamed skill, joining versions already under the new name', async () => {
    const first = await history.keep(skillDir, 'deck', 'edit')
    await history.follow('deck', 'slides')
    expect(await history.list('deck')).toEqual([])
    expect((await history.list('slides')).map((version) => version.id)).toEqual([first!.id])

    put('SKILL.md', 'changed\n')
    clock += 1000
    const second = await history.keep(skillDir, 'deck', 'edit')
    await history.follow('deck', 'slides')
    expect((await history.list('slides')).map((version) => version.id)).toEqual([
      second!.id,
      first!.id,
    ])
    expect(readdirSync(historyDir())).toEqual(['slides'])
    // a skill with no versions has nothing to follow
    await history.follow('nothing', 'slides')
  })
})

describe('comparing versions', () => {
  it('tells which lines only one side has', () => {
    expect(diffTextLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ])
    expect(diffTextLines('same', 'same')).toEqual([{ kind: 'same', text: 'same' }])
    expect(diffTextLines('a\nb', 'b\nc').map((line) => line.kind)).toEqual([
      'removed',
      'same',
      'added',
    ])
  })

  it('folds unchanged runs, keeping lines around each change', () => {
    const before = Array.from({ length: 12 }, (_, i) => `line ${i}`)
    const after = [...before]
    after[6] = 'changed'
    const folded = foldDiffLines(diffTextLines(before.join('\n'), after.join('\n')))
    expect(folded.map((line) => `${line.kind}:${line.text}`)).toEqual([
      'gap:4',
      'same:line 4',
      'same:line 5',
      'removed:line 6',
      'added:changed',
      'same:line 7',
      'same:line 8',
      'gap:3',
    ])
    expect(foldDiffLines(diffTextLines('a\nb', 'a\nb'))).toEqual([])
  })

  it('lists what going back changes: SKILL.md by line, other files by name', async () => {
    const kept = await history.keep(skillDir, 'deck', 'edit')
    const version = join(root, 'version')
    await history.extract('deck', kept!.id, version)

    put('SKILL.md', '---\nname: deck\ndescription: Decks\n---\nSecond.\n')
    put('reference/colors.md', '# Other colors\n')
    put('reference/new.md', 'new\n')
    rmSync(join(skillDir, 'assets', 'logo.bin'))
    put('.ieum-source.json', '{"kind":"github","commit":"2"}\n')

    const diff = await diffSkillVersion(skillDir, version)
    expect(diff.skillMd.filter((line) => line.kind !== 'same' && line.kind !== 'gap')).toEqual([
      { kind: 'removed', text: 'Second.' },
      { kind: 'added', text: 'First.' },
    ])
    expect(diff.files).toEqual([
      { rel: 'assets/logo.bin', change: 'added' },
      { rel: 'reference/colors.md', change: 'modified' },
      { rel: 'reference/new.md', change: 'removed' },
    ])
  })
})
