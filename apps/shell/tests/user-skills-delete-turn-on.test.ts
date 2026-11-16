import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUserSkillsService,
  type UserSkillsService,
} from '../src/main/user-skills/user-skills-service'

/**
 * Deleting an own skill that stood in the place of a same-named skill of
 * another source: the person may turn that skill back on with the delete.
 */

let root: string
let home: string
let service: UserSkillsService

function write(dir: string, name: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: About ${name}\n---\nDo it.\n`,
  )
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'skills-delete-'))
  home = join(root, 'home')
  const builtin = join(root, 'builtin')
  write(join(builtin, 'deck'), 'deck')
  write(join(builtin, 'weekly'), 'weekly')
  write(join(home, '.claude', 'skills', 'deck'), 'deck')
  service = createUserSkillsService({
    homeDir: () => home,
    builtinDir: () => builtin,
    settingsPath: () => join(root, 'app-settings.json'),
    tempDir: () => join(root, 'temp'),
    trash: vi.fn(async (path: string) => rmSync(path, { recursive: true, force: true })),
    fetch: () => Promise.reject(new Error('no network in tests')),
  })
  await service.setState('user:deck', { enabled: true })
  // the own skill takes the name: the builtin and the Claude skill are turned off
  const saved = await service.save({
    title: '',
    name: 'deck',
    description: 'My deck',
    body: 'Mine.\n',
    turnOffSameName: true,
  })
  expect(saved).toMatchObject({ ok: true, id: 'app:deck' })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const enabledOf = async (id: string) =>
  (await service.list()).find((view) => view.id === id)?.enabled

describe('deleting an own skill whose name another source carries', () => {
  it('turns the chosen same-named skills back on', async () => {
    expect(await enabledOf('builtin:deck')).toBe(false)
    expect(await enabledOf('user:deck')).toBe(false)

    expect(await service.remove('app:deck', ['builtin:deck'])).toEqual({ ok: true })

    expect(await enabledOf('app:deck')).toBeUndefined()
    expect(await enabledOf('builtin:deck')).toBe(true)
    // not chosen: stays as the person left it
    expect(await enabledOf('user:deck')).toBe(false)
  })

  it('leaves them off when none is chosen', async () => {
    expect(await service.remove('app:deck')).toEqual({ ok: true })
    expect(await enabledOf('builtin:deck')).toBe(false)
    expect(await enabledOf('user:deck')).toBe(false)
  })

  it('passes over a skill of another name', async () => {
    await service.setState('builtin:weekly', { enabled: false })
    expect(await service.remove('app:deck', ['builtin:weekly', 'user:deck'])).toEqual({ ok: true })
    expect(await enabledOf('builtin:weekly')).toBe(false)
    expect(await enabledOf('user:deck')).toBe(true)
  })

  it('turns nothing on when the delete fails', async () => {
    const failing = createUserSkillsService({
      homeDir: () => home,
      builtinDir: () => join(root, 'builtin'),
      settingsPath: () => join(root, 'app-settings.json'),
      tempDir: () => join(root, 'temp'),
      trash: () => Promise.reject(new Error('trash refused')),
      fetch: () => Promise.reject(new Error('no network in tests')),
    })
    expect(await failing.remove('app:deck', ['builtin:deck'])).toMatchObject({ ok: false })
    expect(await enabledOf('builtin:deck')).toBe(false)
  })
})
