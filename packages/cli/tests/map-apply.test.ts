import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'
import { sampleMap, summaryMap, twoSheetMap } from './map-fixture'

/**
 * `map apply`: the six ops through `reconcileSheet`, without the app. The
 * fixture is engine-generated; what the tests watch is that the file's
 * untouched parts stay byte for byte and that a deletion that would take
 * preserved elements is refused with a count.
 */

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  GENOFFICE_AUDIT_LOG: 'off',
  GENOFFICE_USER_DATA: tempDir(),
  GENOFFICE_APP_BIN: 'C:/no/such/IeumOffice.exe',
  ...extra,
})

/** Every archive entry as base64, so two saves can be compared entry by entry. */
async function entries(path: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const out = new Map<string, string>()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out.set(name, await entry.async('base64'))
  }
  return out
}

function differingEntries(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()])
  return [...names].filter((name) => before.get(name) !== after.get(name)).sort()
}

const ops = (list: unknown[]): string => JSON.stringify(list)

describe('map apply', () => {
  it('rename_topic changes the title and nothing but content.json', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const before = await entries(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'rename_topic', id: ids.a, title: 'Renamed' }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code).toBe(0)
    expect(r.json().output_path).toBe(file)
    const read = await run(['map', 'read', file, '--json'], { env: env() })
    const byId = new Map(
      read
        .json()
        .detail.sheets[0].topics.map((t: { id: string; title: string }) => [t.id, t.title]),
    )
    expect(byId.get(ids.a)).toBe('Renamed')
    const after = await entries(file)
    expect(differingEntries(before, after)).toEqual(['content.json'])
  })

  it('a no-op batch writes the file byte for byte as it was', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    await sampleMap(file)
    const before = readFileSync(file)
    const out = join(dir, 'saved.xmind')
    const r = await run(['map', 'apply', file, '--ops', '[]', '--out', out, '--json'], {
      env: env(),
    })
    expect(r.code).toBe(0)
    expect(readFileSync(out).equals(before)).toBe(true)
  })

  it('add_topic inserts after the named branch and reports its new id; set_note and set_link edit values', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const add = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([
          {
            op: 'add_topic',
            parent: ids.root,
            after: ids.a,
            title: 'C',
            note: 'C note',
            link: 'https://example.com/c',
          },
        ]),
        '--json',
      ],
      { env: env() },
    )
    expect(add.code).toBe(0)
    const created = add.json().detail.results[0].created as string
    expect(created).toBeTruthy()
    let read = await run(['map', 'read', file, '--json'], { env: env() })
    const sheet = read.json().detail.sheets[0]
    let byId = new Map(sheet.topics.map((t: { id: string }) => [t.id, t]))
    expect(sheet.topics[0].children).toEqual([ids.a, created, ids.b])
    expect(byId.get(created)).toMatchObject({
      title: 'C',
      note: 'C note',
      link: 'https://example.com/c',
    })

    const edit = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([
          { op: 'set_note', id: created, note: 'changed' },
          { op: 'set_link', id: created, url: '' },
        ]),
        '--json',
      ],
      { env: env() },
    )
    expect(edit.code).toBe(0)
    read = await run(['map', 'read', file, '--json'], { env: env() })
    byId = new Map(read.json().detail.sheets[0].topics.map((t: { id: string }) => [t.id, t]))
    expect(byId.get(created)).toMatchObject({ note: 'changed', link: null })
  })

  it('move_topic moves a branch with everything below it', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'move_topic', id: ids.a1, parent: ids.root, after: ids.b }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code, JSON.stringify(r.json())).toBe(0)
    const read = await run(['map', 'read', file, '--json'], { env: env() })
    const sheet = read.json().detail.sheets[0]
    expect(sheet.topics[0].children).toEqual([ids.a, ids.b, ids.a1])
  })

  it('delete_topic takes a branch out, and everything below it goes with it', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const r = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'delete_topic', id: ids.a }]), '--json'],
      { env: env() },
    )
    // A1 and the floating topic go with A: the guard refuses that below; here it is asked on A itself
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({ error: 'op_rejected', detail: { preserved: 1 } })

    const clean = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'delete_topic', id: ids.b }]), '--json'],
      { env: env() },
    )
    expect(clean.code).toBe(0)
    const read = await run(['map', 'read', file, '--json'], { env: env() })
    const sheet = read.json().detail.sheets[0]
    expect(sheet.topics[0].children).toEqual([ids.a])
    const titles = sheet.topics.map((t: { title: string }) => t.title)
    expect(titles).toEqual(['Root', 'A', 'A1'])
  })

  it('delete_topic refuses a topic that carries preserved elements, with the count', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const before = readFileSync(file)
    const r = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'delete_topic', id: ids.a1 }]), '--json'],
      { env: env() },
    )
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      error: 'op_rejected',
      message: expect.stringContaining('1 element(s) the map preserves'),
      detail: { preserved: 1 },
    })
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('an atomic batch writes nothing when one op is refused; --best-effort writes what applied', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const before = readFileSync(file)
    const batch = [
      { op: 'rename_topic', id: ids.a, title: 'Renamed' },
      { op: 'delete_topic', id: ids.a1 },
    ]
    const atomic = await run(['map', 'apply', file, '--ops', ops(batch), '--json'], { env: env() })
    expect(atomic.code).toBe(1)
    expect(atomic.json()).toMatchObject({
      error: 'op_rejected',
      message: expect.stringContaining('the file is unchanged'),
    })
    expect(readFileSync(file).equals(before)).toBe(true)

    const best = await run(['map', 'apply', file, '--ops', ops(batch), '--best-effort', '--json'], {
      env: env(),
    })
    expect(best.code).toBe(0)
    expect(best.json().status).toBe('partial')
    const read = await run(['map', 'read', file, '--json'], { env: env() })
    const titles = read.json().detail.sheets[0].topics.map((t: { title: string }) => t.title)
    expect(titles).toContain('Renamed')
  })

  it('refuses unknown ops, unknown fields and ids that are not in the map', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const unknown = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'drop_topic', id: ids.a }]), '--json'],
      { env: env() },
    )
    expect(unknown.code).toBe(1)
    expect(unknown.json()).toMatchObject({ error: 'unknown_op' })
    const field = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'rename_topic', id: ids.a, title: 'x', colour: 'red' }]),
        '--json',
      ],
      { env: env() },
    )
    expect(field.code).toBe(1)
    expect(field.json()).toMatchObject({ error: 'invalid_argument' })
    const missing = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'rename_topic', id: 'nope', title: 'x' }]),
        '--json',
      ],
      { env: env() },
    )
    expect(missing.code).toBe(1)
    expect(missing.json()).toMatchObject({ error: 'target_not_found' })
  })

  it('ops in one batch see what earlier ops made', async () => {
    const dir = tempDir()
    const file = join(dir, 'sample.xmind')
    const ids = await sampleMap(file)
    const outline = join(dir, 'batch.json')
    writeFileSync(
      outline,
      ops([
        { op: 'add_topic', parent: ids.root, title: 'New' },
        { op: 'rename_topic', id: 'NEW_ID', title: 'Newer' },
      ]),
    )
    // the second op cannot know the new id, so it is refused: later ops see earlier
    // results only through the ids the caller already had
    const r = await run(['map', 'apply', file, '--ops', `@${outline}`, '--json'], { env: env() })
    expect(r.code).toBe(1)
    expect(r.json().detail.results[0]).toMatchObject({ op: 'add_topic', status: 'ok' })
    expect(r.json().detail.results[1]).toMatchObject({ op: 'rename_topic', status: 'failed' })
  })
})

describe('summary topics', () => {
  /** The summary of one topic as `map read --json` lists it, or undefined. */
  const summaryOf = (topics: { id: string; summaries?: unknown[] }[], id: string) =>
    topics.find((t) => t.id === id)?.summaries

  it('rename_topic renames the summary and delete_topic takes it out with its topic', async () => {
    const dir = tempDir()
    const file = join(dir, 'sums.xmind')
    const ids = await summaryMap(file)
    const renamed = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'rename_topic', id: ids.summary, title: 'Summarised' }]),
        '--json',
      ],
      { env: env() },
    )
    expect(renamed.code, JSON.stringify(renamed.json())).toBe(0)
    let read = await run(['map', 'read', file, '--json'], { env: env() })
    let topics = read.json().detail.sheets[0].topics
    expect(summaryOf(topics, ids.a)).toMatchObject([{ topicId: ids.summary, title: 'Summarised' }])

    const deleted = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'delete_topic', id: ids.summary }]), '--json'],
      { env: env() },
    )
    expect(deleted.code, JSON.stringify(deleted.json())).toBe(0)
    read = await run(['map', 'read', file, '--json'], { env: env() })
    topics = read.json().detail.sheets[0].topics
    expect(summaryOf(topics, ids.a)).toBeUndefined()
    const zip = await JSZip.loadAsync(readFileSync(file))
    const content = await zip.file('content.json')!.async('string')
    expect(content).not.toContain('sum-record-1')
    expect(content).not.toContain('sum-topic-1')
  })

  it('delete_topic of a summary topic goes through the same preserved-elements guard', async () => {
    const dir = tempDir()
    const file = join(dir, 'sums.xmind')
    const ids = await summaryMap(file)
    const before = readFileSync(file)
    // the summary topic has a branch below it: deleting it would take that branch
    const r = await run(
      ['map', 'apply', file, '--ops', ops([{ op: 'delete_topic', id: ids.guarded }]), '--json'],
      { env: env() },
    )
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({
      error: 'op_rejected',
      message: expect.stringContaining('1 element(s) the map preserves'),
      detail: { preserved: 1 },
    })
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('the ops that work on branch topics refuse a summary topic', async () => {
    const dir = tempDir()
    const file = join(dir, 'sums.xmind')
    const ids = await summaryMap(file)
    const refused = [
      { op: 'add_topic', parent: ids.summary, title: 'x' },
      { op: 'move_topic', id: ids.summary, parent: ids.root },
      { op: 'move_topic', id: ids.a1, parent: ids.summary },
      { op: 'set_note', id: ids.summary, note: 'x' },
      { op: 'set_link', id: ids.summary, url: 'https://example.com/x' },
    ]
    for (const op of refused) {
      const r = await run(['map', 'apply', file, '--ops', ops([op]), '--json'], { env: env() })
      expect(r.code, JSON.stringify(r.json())).toBe(1)
      expect(r.json()).toMatchObject({
        error: 'invalid_argument',
        message: expect.stringContaining('is a summary topic'),
      })
    }
  })
})

describe('an id on more than one sheet', () => {
  it('is refused: an op cannot say which sheet it means', async () => {
    const dir = tempDir()
    const file = join(dir, 'two.xmind')
    const ids = await twoSheetMap(file)
    for (const op of [
      { op: 'rename_topic', id: ids.dup, title: 'x' },
      { op: 'set_note', id: ids.dup, note: 'x' },
    ]) {
      const r = await run(['map', 'apply', file, '--ops', ops([op]), '--json'], { env: env() })
      expect(r.code, JSON.stringify(r.json())).toBe(1)
      expect(r.json()).toMatchObject({
        error: 'invalid_argument',
        message: expect.stringContaining('on more than one sheet'),
      })
      expect(r.json().message).toContain('cannot be targeted at all')
    }
  })
})
