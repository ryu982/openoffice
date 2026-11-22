import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OBSIDIAN_LISTED_TOOLS,
  obsidianServerInstructions,
} from '../src/main/mcp-client/obsidian-tools'
import {
  executeObsidianTool,
  listVaultNotesForPicker,
  suggestVaultName,
  validateVaultFolder,
  type ObsidianVaultDeps,
  type VaultEntryLike,
} from '../src/main/mcp-client/obsidian-vault'

let rootDir: string
let vaultA: string
let vaultB: string
let outsideDir: string

function makeDeps(overrides: Partial<ObsidianVaultDeps> = {}): ObsidianVaultDeps {
  return {
    isFileOpen: () => false,
    hasUnsavedChanges: () => false,
    parseFileToText: async (absPath) => ({
      ok: true,
      text: await readFile(absPath, 'utf8'),
    }),
    trashItem: vi.fn(async (absPath) => {
      await rm(absPath)
    }),
    ...overrides,
  }
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'ieum-obsidian-test-'))
  vaultA = join(rootDir, 'Personal')
  vaultB = join(rootDir, 'Work')
  outsideDir = join(rootDir, 'Outside')
  await mkdir(join(vaultA, '.obsidian'), { recursive: true })
  await mkdir(join(vaultA, 'Projects'), { recursive: true })
  await mkdir(vaultB, { recursive: true })
  await mkdir(outsideDir, { recursive: true })

  await writeFile(join(vaultA, '.obsidian', 'workspace.json'), '{"secret":true}', 'utf8')
  await writeFile(join(vaultA, '.hidden.md'), '# Hidden', 'utf8')
  await writeFile(join(vaultA, 'plain.txt'), 'not markdown', 'utf8')
  await writeFile(
    join(vaultA, 'Welcome.md'),
    '---\ntags: [daily, overview]\nauthor: Alice\n---\n# Welcome\n\nSee [[Roadmap]] and [[Projects/Alpha|Alpha Project]] and [[MissingNote]].\n\nBody text with #planning.\n',
    'utf8',
  )
  await writeFile(
    join(vaultA, 'Roadmap.md'),
    '# Roadmap\n\n## Q1\n- Item 1\n\n## Q2\n- Item 2\n',
    'utf8',
  )
  await writeFile(
    join(vaultA, 'Projects', 'Alpha.md'),
    '# Alpha\n\nStatus: active #alpha\n',
    'utf8',
  )
  await writeFile(join(vaultB, 'Sprint.md'), '# Sprint\n\nWork note #work\n', 'utf8')
  await writeFile(join(outsideDir, 'Secret.md'), '# Outside secret\n', 'utf8')
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

describe('OBSIDIAN_LISTED_TOOLS metadata', () => {
  it('defines all 7 tools with readOnlyHint on read tools and destructiveHint on modify/delete tools', () => {
    const byName = new Map(OBSIDIAN_LISTED_TOOLS.map((t) => [t.name, t]))
    expect([...byName.keys()]).toEqual([
      'list_notes',
      'search_notes',
      'read_note',
      'create_note',
      'append_note',
      'update_note',
      'delete_note',
    ])
    expect(byName.get('list_notes')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('search_notes')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('read_note')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('create_note')?.annotations?.readOnlyHint).not.toBe(true)
    expect(byName.get('create_note')?.annotations?.destructiveHint).toBe(false)
    expect(byName.get('append_note')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('update_note')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('delete_note')?.annotations?.destructiveHint).toBe(true)
    expect(obsidianServerInstructions([{ name: 'Personal' }, { name: 'Work' }])).toContain(
      'Personal',
    )
  })
})

describe('validateVaultFolder & suggestVaultName', () => {
  it('accepts a valid vault folder, detects .obsidian presence, and blocks home/drive/protected folders', async () => {
    const homeDir = join(rootDir, 'FakeHome')
    const userData = join(homeDir, 'AppData', 'IeumOffice')
    await mkdir(userData, { recursive: true })
    await mkdir(join(homeDir, '.codex'), { recursive: true })

    const okWithObs = await validateVaultFolder(vaultA, { homeDir, userData })
    expect(okWithObs.ok).toBe(true)
    if (okWithObs.ok) {
      expect(okWithObs.hasObsidianDir).toBe(true)
      expect(okWithObs.suggestedName).toBe('Personal')
    }

    const okNoObs = await validateVaultFolder(vaultB, { homeDir, userData })
    expect(okNoObs.ok).toBe(true)
    if (okNoObs.ok) {
      expect(okNoObs.hasObsidianDir).toBe(false)
    }

    const homeBlocked = await validateVaultFolder(homeDir, { homeDir, userData })
    expect(homeBlocked.ok).toBe(false)

    const codexBlocked = await validateVaultFolder(join(homeDir, '.codex'), { homeDir, userData })
    expect(codexBlocked.ok).toBe(false)

    const parentOfHomeBlocked = await validateVaultFolder(rootDir, { homeDir, userData })
    expect(parentOfHomeBlocked.ok).toBe(false)
  })

  it('suggests case-insensitively unique vault names', () => {
    expect(suggestVaultName('Notes', ['notes', 'Notes-2'])).toBe('Notes-3')
    expect(suggestVaultName('  ', [])).toBe('Vault')
  })
})

describe('security boundaries', () => {
  const vaults = (): VaultEntryLike[] => [
    { id: 'a', name: 'Personal', path: vaultA, enabled: true },
  ]

  it('rejects path traversal, absolute paths, .obsidian, hidden files, and non-.md files', async () => {
    const deps = makeDeps()
    for (const badPath of [
      '../Outside/Secret.md',
      join(outsideDir, 'Secret.md'),
      '.obsidian/workspace.json',
      '.obsidian/note.md',
      '.hidden.md',
      'plain.txt',
      '',
    ]) {
      const readRes = await executeObsidianTool('read_note', { path: badPath }, vaults(), deps)
      expect(readRes.isError, `read_note(${badPath})`).toBe(true)
      const createRes = await executeObsidianTool(
        'create_note',
        { path: badPath, content: 'x' },
        vaults(),
        deps,
      )
      expect(createRes.isError, `create_note(${badPath})`).toBe(true)
    }
  })

  it('rejects hardlinks (nlink > 1) and symlinks/junctions', async () => {
    const deps = makeDeps()
    const hardLinked = join(vaultA, 'HardLinked.md')
    await link(join(outsideDir, 'Secret.md'), hardLinked)

    const hardRead = await executeObsidianTool(
      'read_note',
      { path: 'HardLinked.md' },
      vaults(),
      deps,
    )
    expect(hardRead.isError).toBe(true)
    const hardUpdate = await executeObsidianTool(
      'update_note',
      { path: 'HardLinked.md', content: 'pwn' },
      vaults(),
      deps,
    )
    expect(hardUpdate.isError).toBe(true)

    const symDir = join(vaultA, 'LinkedDir')
    let symlinkCreated = false
    try {
      await symlink(outsideDir, symDir, 'junction')
      symlinkCreated = true
    } catch {
      // skip symlink assertion only if OS disallows junction/symlink creation
    }
    if (symlinkCreated) {
      const symRead = await executeObsidianTool(
        'read_note',
        { path: 'LinkedDir/Secret.md' },
        vaults(),
        deps,
      )
      expect(symRead.isError).toBe(true)
      const listed = await executeObsidianTool('list_notes', {}, vaults(), deps)
      expect(listed.output).not.toContain('Secret.md')
    }
  })

  it('refuses append/update/delete on open tabs and read_note on unsaved open tabs', async () => {
    const target = join(vaultA, 'Roadmap.md')
    const deps = makeDeps({
      isFileOpen: (p) => p.toLowerCase() === target.toLowerCase(),
      hasUnsavedChanges: (p) => p.toLowerCase() === target.toLowerCase(),
    })

    expect(
      (await executeObsidianTool('read_note', { path: 'Roadmap.md' }, vaults(), deps)).isError,
    ).toBe(true)
    expect(
      (
        await executeObsidianTool(
          'append_note',
          { path: 'Roadmap.md', content: 'x' },
          vaults(),
          deps,
        )
      ).isError,
    ).toBe(true)
    expect(
      (
        await executeObsidianTool(
          'update_note',
          { path: 'Roadmap.md', content: 'x' },
          vaults(),
          deps,
        )
      ).isError,
    ).toBe(true)
    expect(
      (await executeObsidianTool('delete_note', { path: 'Roadmap.md' }, vaults(), deps)).isError,
    ).toBe(true)
    expect(deps.trashItem).not.toHaveBeenCalled()
  })

  it('runs read_note through parseFileToText so redaction marks stay withheld', async () => {
    const deps = makeDeps({
      parseFileToText: vi.fn(async () => ({
        ok: true,
        text: '# Welcome\nSecret is {{redacted}}.\nSee [[Roadmap]].',
      })),
    })
    const res = await executeObsidianTool('read_note', { path: 'Welcome.md' }, vaults(), deps)
    expect(res.isError).toBe(false)
    expect(deps.parseFileToText).toHaveBeenCalledTimes(1)
    expect(res.output).toContain('{{redacted}}')
    expect(res.output).toContain('Roadmap.md')
  })

  it('moves notes to OS trash on delete_note and NEVER falls back to unlink when trashItem fails', async () => {
    const failTrash = vi.fn(async () => {
      throw new Error('trash unavailable')
    })
    const deps = makeDeps({ trashItem: failTrash })
    const res = await executeObsidianTool('delete_note', { path: 'Roadmap.md' }, vaults(), deps)
    expect(res.isError).toBe(true)
    expect(failTrash).toHaveBeenCalledTimes(1)
    // File must still exist on disk
    expect(await readFile(join(vaultA, 'Roadmap.md'), 'utf8')).toContain('# Roadmap')
  })
})

describe('7 Obsidian tools & multi-vault rules', () => {
  const twoVaults = (): VaultEntryLike[] => [
    { id: 'a', name: 'Personal', path: vaultA, enabled: true },
    { id: 'b', name: 'Work', path: vaultB, enabled: true },
  ]

  it('lists and searches across all active vaults when 2+ vaults are active, and requires vault for single-note tools', async () => {
    const deps = makeDeps()
    const listAll = await executeObsidianTool('list_notes', {}, twoVaults(), deps)
    expect(listAll.isError).toBe(false)
    expect(listAll.output).toContain('Personal')
    expect(listAll.output).toContain('Work')
    expect(listAll.output).toContain('Welcome.md')
    expect(listAll.output).toContain('Sprint.md')
    expect(listAll.output).not.toContain('.hidden.md')
    expect(listAll.output).not.toContain('plain.txt')

    const searchTag = await executeObsidianTool(
      'search_notes',
      { query: 'Alice' },
      twoVaults(),
      deps,
    )
    expect(searchTag.isError).toBe(false)
    expect(searchTag.output).toContain('Welcome.md')

    // Missing vault param when 2 vaults are active -> error naming active vaults
    const readMissingVault = await executeObsidianTool(
      'read_note',
      { path: 'Welcome.md' },
      twoVaults(),
      deps,
    )
    expect(readMissingVault.isError).toBe(true)
    expect(readMissingVault.output).toContain('Personal')
    expect(readMissingVault.output).toContain('Work')

    // With explicit vault param -> succeeds and resolves wikilinks
    const readOk = await executeObsidianTool(
      'read_note',
      { vault: 'personal', path: 'Welcome.md' },
      twoVaults(),
      deps,
    )
    expect(readOk.isError).toBe(false)
    expect(readOk.output).toContain('Roadmap.md')
    expect(readOk.output).toContain('Projects/Alpha.md')

    // Unknown/disabled vault rejected
    const readUnknown = await executeObsidianTool(
      'read_note',
      { vault: 'DisabledVault', path: 'Welcome.md' },
      twoVaults(),
      deps,
    )
    expect(readUnknown.isError).toBe(true)
  })

  it('supports create_note (no overwrite + subfolder creation), append_note (EOF & heading), update_note, and delete_note', async () => {
    const singleVault: VaultEntryLike[] = [
      { id: 'a', name: 'Personal', path: vaultA, enabled: true },
    ]
    const deps = makeDeps()

    // create_note creates subfolder and refuses overwrite
    const created = await executeObsidianTool(
      'create_note',
      { path: 'Meetings/2026-11-21.md', content: '# Sync\n\n## Notes\n- Start\n' },
      singleVault,
      deps,
    )
    expect(created.isError).toBe(false)
    const dup = await executeObsidianTool(
      'create_note',
      { path: 'Meetings/2026-11-21.md', content: 'overwrite' },
      singleVault,
      deps,
    )
    expect(dup.isError).toBe(true)

    // append_note under heading
    const appended = await executeObsidianTool(
      'append_note',
      { path: 'Roadmap.md', heading: 'Q1', content: '- Item 1b' },
      singleVault,
      deps,
    )
    expect(appended.isError).toBe(false)
    const afterAppend = await readFile(join(vaultA, 'Roadmap.md'), 'utf8')
    expect(afterAppend.indexOf('- Item 1b')).toBeLessThan(afterAppend.indexOf('## Q2'))

    // update_note targeted replacement
    const updated = await executeObsidianTool(
      'update_note',
      { path: 'Roadmap.md', old_text: '- Item 2', new_text: '- Item 2 (done)' },
      singleVault,
      deps,
    )
    expect(updated.isError).toBe(false)
    expect(await readFile(join(vaultA, 'Roadmap.md'), 'utf8')).toContain('- Item 2 (done)')

    // delete_note calls trashItem
    const deleted = await executeObsidianTool(
      'delete_note',
      { path: 'Meetings/2026-11-21.md' },
      singleVault,
      deps,
    )
    expect(deleted.isError).toBe(false)
    expect(deps.trashItem).toHaveBeenCalledTimes(1)

    // Picker helper returns safe .md notes across vaults
    const pickerNotes = await listVaultNotesForPicker(twoVaults())
    expect(pickerNotes.some((n) => n.vaultId === 'a' && n.relPath === 'Welcome.md')).toBe(true)
    expect(pickerNotes.some((n) => n.vaultId === 'b' && n.relPath === 'Sprint.md')).toBe(true)
    expect(pickerNotes.some((n) => n.relPath.includes('.obsidian'))).toBe(false)
  })

  it('uses parseFileToText and skips unsaved open notes in search_notes and list_notes', async () => {
    const secretFile = join(vaultA, 'Secret.md')
    const unsavedFile = join(vaultA, 'Draft.md')
    await writeFile(secretFile, '# Secret\nTOPSECRET_RAW_TOKEN #hidden-tag', 'utf8')
    await writeFile(unsavedFile, '# Draft\nUNSAVED_DISK_TOKEN #draft-tag', 'utf8')

    const singleVault = [twoVaults()[0]!]
    const deps = makeDeps({
      hasUnsavedChanges: (p) => p.toLowerCase() === unsavedFile.toLowerCase(),
      parseFileToText: async (p) => {
        const raw = await readFile(p, 'utf8')
        return {
          ok: true,
          text: raw
            .replace('TOPSECRET_RAW_TOKEN', '{{redacted}}')
            .replace('#hidden-tag', '{{redacted-tag}}'),
        }
      },
    })

    const searchSecret = await executeObsidianTool(
      'search_notes',
      { query: 'TOPSECRET_RAW_TOKEN' },
      singleVault,
      deps,
    )
    expect(searchSecret.isError).toBe(false)
    expect(searchSecret.output).toBe('No notes matched "TOPSECRET_RAW_TOKEN".')

    const searchSecretByTitle = await executeObsidianTool(
      'search_notes',
      { query: 'Secret' },
      singleVault,
      deps,
    )
    expect(searchSecretByTitle.isError).toBe(false)
    expect(searchSecretByTitle.output).toContain('Secret.md')
    expect(searchSecretByTitle.output).toContain('{{redacted}}')
    expect(searchSecretByTitle.output).not.toContain('TOPSECRET_RAW_TOKEN')

    const searchUnsaved = await executeObsidianTool(
      'search_notes',
      { query: 'UNSAVED_DISK_TOKEN' },
      singleVault,
      deps,
    )
    expect(searchUnsaved.isError).toBe(false)
    expect(searchUnsaved.output).toBe('No notes matched "UNSAVED_DISK_TOKEN".')

    const searchUnsavedByTitle = await executeObsidianTool(
      'search_notes',
      { query: 'Draft' },
      singleVault,
      deps,
    )
    expect(searchUnsavedByTitle.isError).toBe(false)
    expect(searchUnsavedByTitle.output).not.toContain('UNSAVED_DISK_TOKEN')

    const listed = await executeObsidianTool('list_notes', {}, singleVault, deps)
    expect(listed.isError).toBe(false)
    expect(listed.output).not.toContain('#hidden-tag')
    expect(listed.output).not.toContain('#draft-tag')
  })
})
