import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubSkillUpdateCheck } from '@genoffice/ai-provider'
import {
  createUserSkillsService,
  type UserSkillsService,
} from '../src/main/user-skills/user-skills-service'

/**
 * Earlier versions of an own skill (decision 0129): what keeps one, going
 * back byte for byte, and that a replaced skill stays in the app instead of
 * going to the OS trash.
 */

let root: string
let home: string
let service: UserSkillsService
let trash: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>

const appDir = () => join(home, '.ieumoffice', 'skills')
const historyDir = () => join(home, '.ieumoffice', 'skill-history')
const settingsFile = () => join(root, 'app-settings.json')

function skillMd(name: string, extra = '', body = 'Do it.\n') {
  return `---\nname: ${name}\ndescription: About ${name}\n${extra}---\n${body}`
}

function write(dir: string, files: Record<string, string | Uint8Array>) {
  for (const [rel, data] of Object.entries(files)) {
    const path = join(dir, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, data)
  }
}

/** Every file under a folder with its bytes, by its path inside the folder */
function bytesOf(dir: string): Record<string, string> {
  const found: Record<string, string> = {}
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else found[relative(dir, path).replace(/\\/g, '/')] = readFileSync(path).toString('base64')
    }
  }
  walk(dir)
  return found
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-history-'))
  home = join(root, 'home')
  trash = vi.fn(async (path: string) => rmSync(path, { recursive: true, force: true }))
  service = createUserSkillsService({
    homeDir: () => home,
    builtinDir: () => undefined,
    settingsPath: settingsFile,
    tempDir: () => join(root, 'temp'),
    trash,
    fetch: () => Promise.reject(new Error('no network in tests')),
  })
  write(join(appDir(), 'deck'), {
    'SKILL.md': skillMd('deck', 'metadata:\n  ieum-editors: slides\n', 'First.\n'),
    'reference/colors.md': '# Colors\n',
    'assets/logo.bin': new Uint8Array([0, 1, 2, 255, 254, 13, 10]),
    '.ieum-source.json':
      '{"kind":"github","repo":"owner/repo","ref":"main","path":"","commit":"aaaa","installedAt":"2026-11-10T00:00:00Z","contentHash":"x"}\n',
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const edit = (body: string, more: Partial<Parameters<UserSkillsService['save']>[0]> = {}) =>
  service.save({ id: 'app:deck', title: '', description: 'About deck', body, ...more })

async function versionsOf(id: string) {
  const answer = await service.versions(id)
  if (!answer.ok) throw new Error(`versions failed: ${answer.reason}`)
  return answer.versions
}

/** A folder outside the app's skills folder holding the given skills, as a zip would unpack */
function incoming(skills: Record<string, string>): string {
  const folder = mkdtempSync(join(root, 'incoming-'))
  for (const [name, text] of Object.entries(skills)) write(join(folder, name), { 'SKILL.md': text })
  return folder
}

async function installAll(folder: string, onCollision: Record<string, 'replace' | 'skip'> = {}) {
  const imported = await service.prepare({ kind: 'folder', folder })
  return service.install(imported, {
    selected: imported.candidates.map((candidate) => candidate.key),
    onCollision,
  })
}

describe('editing an own skill', () => {
  it('goes back to the first version byte for byte after two edits', async () => {
    const first = bytesOf(join(appDir(), 'deck'))

    expect(await edit('Second.\n')).toMatchObject({ ok: true })
    write(join(appDir(), 'deck'), { 'reference/colors.md': '# Other colors\n' })
    const second = bytesOf(join(appDir(), 'deck'))
    expect(await edit('Third.\n', { editors: ['docs', 'sheets'] })).toMatchObject({ ok: true })
    rmSync(join(appDir(), 'deck', 'assets', 'logo.bin'))
    write(join(appDir(), 'deck'), { 'notes/extra.md': 'extra\n' })
    const third = bytesOf(join(appDir(), 'deck'))
    expect(third).not.toEqual(first)

    const kept = await versionsOf('app:deck')
    expect(kept.map((version) => version.reason)).toEqual(['edit', 'edit'])
    expect(kept.every((version) => version.bytes > 0)).toBe(true)

    const oldest = kept.at(-1)!
    expect(await service.restoreVersion('app:deck', oldest.id)).toEqual({
      ok: true,
      id: 'app:deck',
    })
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(first)

    // going back kept what was there, so that can be had again too
    const after = await versionsOf('app:deck')
    expect(after.map((version) => version.reason)).toEqual(['restore', 'edit', 'edit'])
    await service.restoreVersion('app:deck', after[0]!.id)
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(third)
    await service.restoreVersion('app:deck', kept[0]!.id)
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(second)
    expect(trash).not.toHaveBeenCalled()
  })

  it('keeps the person’s settings across a restore; where it is used is what that file says', async () => {
    await service.setState('app:deck', { enabled: false, invoke: 'manual' })
    await edit('Second.\n', { editors: ['docs'] })
    expect((await service.list()).find((view) => view.id === 'app:deck')?.editors).toEqual(['docs'])

    const [version] = await versionsOf('app:deck')
    await service.restoreVersion('app:deck', version!.id)
    expect((await service.list()).find((view) => view.id === 'app:deck')).toMatchObject({
      enabled: false,
      invoke: 'manual',
      editors: ['slides'],
    })
  })

  it('keeps no version for a new skill, or for a save that changes nothing', async () => {
    const made = await service.save({
      title: '',
      name: 'fresh',
      description: 'New',
      body: 'Body.\n',
    })
    expect(made).toMatchObject({ ok: true, id: 'app:fresh' })
    expect(await versionsOf('app:fresh')).toEqual([])

    const text = readFileSync(join(appDir(), 'fresh', 'SKILL.md'), 'utf8')
    await service.save({ id: 'app:fresh', title: '', description: 'New', body: 'Body.\n' })
    expect(readFileSync(join(appDir(), 'fresh', 'SKILL.md'), 'utf8')).toBe(text)
    expect(await versionsOf('app:fresh')).toEqual([])
    expect(existsSync(historyDir())).toBe(false)
  })

  it('keeps a version when the AI’s skill card changes an own skill', async () => {
    const before = bytesOf(join(appDir(), 'deck'))
    const saved = await service.saveFromCard({
      targetId: 'app:deck',
      title: '',
      name: 'deck',
      description: 'About deck',
      body: 'From the card.\n',
    })
    expect(saved).toMatchObject({ ok: true, id: 'app:deck' })
    const [version] = await versionsOf('app:deck')
    expect(version).toMatchObject({ reason: 'edit' })
    await service.restoreVersion('app:deck', version!.id)
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(before)
  })

  it('takes the versions along when the skill is renamed, and a version from before brings the old name back', async () => {
    await service.setState('app:deck', { invoke: 'manual' })
    const first = bytesOf(join(appDir(), 'deck'))
    expect(await edit('Second.\n', { name: 'slides-deck' })).toEqual({
      ok: true,
      id: 'app:slides-deck',
    })
    expect(readdirSync(historyDir())).toEqual(['slides-deck'])
    const [version] = await versionsOf('app:slides-deck')
    expect(version).toMatchObject({ reason: 'edit' })

    expect(await service.restoreVersion('app:slides-deck', version!.id)).toEqual({
      ok: true,
      id: 'app:deck',
    })
    expect(readdirSync(appDir())).toEqual(['deck'])
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(first)
    expect(readdirSync(historyDir())).toEqual(['deck'])
    expect((await service.list()).find((view) => view.id === 'app:deck')?.invoke).toBe('manual')
    expect((await versionsOf('app:deck')).map((kept) => kept.reason)).toEqual(['restore', 'edit'])
  })

  it('does not bring an old name back over another own skill that has taken it', async () => {
    await edit('Second.\n', { name: 'slides-deck' })
    write(join(appDir(), 'deck'), { 'SKILL.md': skillMd('deck', '', 'Another.\n') })
    const [version] = await versionsOf('app:slides-deck')
    expect(await service.restoreVersion('app:slides-deck', version!.id)).toMatchObject({
      ok: false,
      reason: 'name-taken',
    })
    expect(readFileSync(join(appDir(), 'deck', 'SKILL.md'), 'utf8')).toContain('Another.')
    expect(readFileSync(join(appDir(), 'slides-deck', 'SKILL.md'), 'utf8')).toContain('Second.')
    expect(await versionsOf('app:slides-deck')).toHaveLength(1)
  })
})

describe('looking at and tidying versions', () => {
  it('tells what going back would change', async () => {
    await edit('Second.\n')
    write(join(appDir(), 'deck'), { 'reference/new.md': 'new\n' })
    const [version] = await versionsOf('app:deck')
    const answer = await service.compareVersion('app:deck', version!.id)
    expect(answer).toMatchObject({ ok: true, diff: { same: false } })
    if (!answer.ok) return
    expect(answer.diff.skillMd.filter((line) => line.kind === 'added')).toEqual([
      { kind: 'added', text: 'First.' },
    ])
    expect(answer.diff.skillMd.filter((line) => line.kind === 'removed')).toEqual([
      { kind: 'removed', text: 'Second.' },
    ])
    expect(answer.diff.files).toEqual([{ rel: 'reference/new.md', change: 'removed' }])
    // comparing leaves nothing behind
    expect(readdirSync(join(root, 'temp'))).toEqual([])
  })

  it('removes one version when the person asks', async () => {
    await edit('Second.\n')
    await edit('Third.\n')
    const kept = await versionsOf('app:deck')
    expect(await service.removeVersion('app:deck', kept[1]!.id)).toEqual({ ok: true })
    expect((await versionsOf('app:deck')).map((version) => version.id)).toEqual([kept[0]!.id])
    expect(await service.removeVersion('app:deck', kept[1]!.id)).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(trash).not.toHaveBeenCalled()
  })

  it('answers only for own skills and for versions that are there', async () => {
    write(join(home, '.claude', 'skills', 'theirs'), { 'SKILL.md': skillMd('theirs') })
    expect(await service.versions('user:theirs')).toMatchObject({ ok: false, reason: 'not-owned' })
    expect(await service.restoreVersion('user:theirs', 'x')).toMatchObject({
      ok: false,
      reason: 'not-owned',
    })
    expect(await service.restoreVersion('app:deck', '../../outside')).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(await service.compareVersion('app:deck', '20200101T000000000Z-edit')).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(readdirSync(appDir())).toEqual(['deck'])
  })
})

describe('a skill that another version replaces', () => {
  it('is kept as a version, not sent to the trash, and can be had back', async () => {
    await service.setState('app:deck', { enabled: false, invoke: 'manual' })
    const before = bytesOf(join(appDir(), 'deck'))

    const done = await installAll(incoming({ deck: skillMd('deck', '', 'Replaced.\n') }), {
      deck: 'replace',
    })
    expect(done).toMatchObject({ ok: true })
    expect(readFileSync(join(appDir(), 'deck', 'SKILL.md'), 'utf8')).toContain('Replaced.')
    expect(trash).not.toHaveBeenCalled()
    // nothing of the swap is left in the skills folder
    expect(readdirSync(appDir())).toEqual(['deck'])

    const [version] = await versionsOf('app:deck')
    expect(version).toMatchObject({ reason: 'replace' })
    await service.restoreVersion('app:deck', version!.id)
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(before)
    expect((await service.list()).find((view) => view.id === 'app:deck')).toMatchObject({
      enabled: false,
      invoke: 'manual',
    })
  })

  it('leaves no version behind when the install does not go through', async () => {
    write(join(appDir(), 'weekly'), { 'SKILL.md': skillMd('weekly') })
    const folder = incoming({ deck: skillMd('deck', '', 'New.\n'), weekly: skillMd('weekly') })
    // weekly's name is taken and no choice is given for it: nothing is installed
    expect(await installAll(folder, { deck: 'replace' })).toMatchObject({
      ok: false,
      reason: 'needs-choice',
    })
    expect(readFileSync(join(appDir(), 'deck', 'SKILL.md'), 'utf8')).toContain('First.')
    expect(await versionsOf('app:deck')).toEqual([])
    expect(existsSync(join(historyDir(), 'deck'))).toBe(false)
  })

  it('is kept when a copy of another source’s skill overwrites it', async () => {
    write(join(home, '.claude', 'skills', 'deck'), {
      'SKILL.md': skillMd('deck', '', 'Theirs.\n'),
    })
    expect(await service.copyToMine('user:deck', true)).toEqual({ ok: true, id: 'app:deck' })
    expect(trash).not.toHaveBeenCalled()
    expect((await versionsOf('app:deck')).map((version) => version.reason)).toEqual(['replace'])
  })

  it('is kept by a GitHub update, under the new name when the update renames the skill', async () => {
    const before = bytesOf(join(appDir(), 'deck'))
    const folder = incoming({ deck: skillMd('deck-two', '', 'Updated.\n') })
    const update = await service.prepare({ kind: 'folder', folder: join(folder, 'deck') })
    const check: Extract<GitHubSkillUpdateCheck, { status: 'changed' }> = {
      status: 'changed',
      record: {
        kind: 'github',
        repo: 'owner/repo',
        ref: 'main',
        path: '',
        commit: 'a'.repeat(40),
        installedAt: '2026-11-10T00:00:00Z',
        contentHash: 'x',
      },
      commit: 'b'.repeat(40),
      locallyEdited: false,
      changedFiles: [{ rel: 'SKILL.md', change: 'modified' }],
      update,
    }
    expect(await service.applyUpdate('app:deck', check)).toEqual({ ok: true, id: 'app:deck-two' })
    expect(trash).not.toHaveBeenCalled()

    const [version] = await versionsOf('app:deck-two')
    expect(version).toMatchObject({ reason: 'update' })
    expect(await service.restoreVersion('app:deck-two', version!.id)).toEqual({
      ok: true,
      id: 'app:deck',
    })
    expect(bytesOf(join(appDir(), 'deck'))).toEqual(before)
  })
})

describe('deleting an own skill', () => {
  it('sends its folder and its versions to the trash from where they are', async () => {
    await edit('Second.\n')
    expect(await service.remove('app:deck')).toEqual({ ok: true })
    expect(trash.mock.calls.map(([path]) => path)).toEqual([
      join(historyDir(), 'deck'),
      join(appDir(), 'deck'),
    ])
  })

  it('sends only the folder when there are no versions', async () => {
    expect(await service.remove('app:deck')).toEqual({ ok: true })
    expect(trash.mock.calls.map(([path]) => path)).toEqual([join(appDir(), 'deck')])
  })
})
