import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../src/cli'
import { loadTypedSchemas } from '../src/mcp/op-schemas'
import { resolveTools, toolShape } from '../src/mcp/tools'
import { run, tempDir } from './helpers'
import { sampleMap } from './map-fixture'

/**
 * `map read`, `map create --outline`, `guide map` and the MCP tools, without
 * the app: the engine opens and writes every `.xmind` here, and the fixtures
 * are engine-generated in a temp dir.
 */

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  GENOFFICE_AUDIT_LOG: 'off',
  GENOFFICE_USER_DATA: tempDir(),
  GENOFFICE_APP_BIN: 'C:/no/such/IeumOffice.exe',
  ...extra,
})

describe('map read', () => {
  it('prints one `# ` heading per sheet and the outline below it', async () => {
    const file = join(tempDir(), 'sample.xmind')
    await sampleMap(file)
    const r = await run(['map', 'read', file], { env: env() })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('# Plan')
    expect(r.stdout).toContain('- Root')
    expect(r.stdout).toContain('- A')
    expect(r.stdout).toContain('- A1')
  })

  it('--json gives every topic with the ids the ops target', async () => {
    const file = join(tempDir(), 'sample.xmind')
    const ids = await sampleMap(file)
    const r = await run(['map', 'read', file, '--json'], { env: env() })
    expect(r.code).toBe(0)
    const sheet = r.json().detail.sheets[0]
    expect(sheet.title).toBe('Plan')
    expect(sheet.root).toBe(ids.root)
    const byId = new Map<string, Record<string, unknown>>(
      sheet.topics.map((t: { id: string }): [string, Record<string, unknown>] => [t.id, t]),
    )
    expect([...byId.keys()]).toEqual([ids.root, ids.a, ids.a1, ids.b])
    expect(byId.get(ids.root)!.children).toEqual([ids.a, ids.b])
    expect(byId.get(ids.a)!.children).toEqual([ids.a1])
    expect(byId.get(ids.b)).toMatchObject({
      title: 'B',
      note: 'B note',
      link: 'https://example.com/b',
      children: [],
    })
  })

  it('refuses a file that is not .xmind and a .xmind that does not open', async () => {
    const dir = tempDir()
    const wrong = join(dir, 'notes.md')
    writeFileSync(wrong, '# hi')
    const md = await run(['map', 'read', wrong, '--json'], { env: env() })
    expect(md.code).toBe(1)
    expect(md.json()).toMatchObject({ error: 'unsupported' })
    const broken = join(dir, 'broken.xmind')
    writeFileSync(broken, 'not a zip')
    const bad = await run(['map', 'read', broken, '--json'], { env: env() })
    expect(bad.code).toBe(2)
    expect(bad.json()).toMatchObject({ error: 'unsupported' })
  })
})

describe('map create', () => {
  it('builds a map from an outline, and the outline reads back', async () => {
    const dir = tempDir()
    const outline = join(dir, 'plan.md')
    writeFileSync(outline, '# Plan\n\n- Root\n  - A\n    - A1\n  - B\n')
    const r = await run(['map', 'create', '--outline', outline, '--json'], { env: env() })
    expect(r.code).toBe(0)
    expect(r.json().output_path).toContain('plan.xmind')
    const read = await run(['map', 'read', join(dir, 'plan.xmind')], { env: env() })
    expect(read.code).toBe(0)
    expect(read.stdout).toContain('# Plan')
    expect(read.stdout).toContain('- Root')
    expect(read.stdout).toContain('- A1')
  })

  it('refuses --out with no value instead of silently writing the outline name', async () => {
    const dir = tempDir()
    const outline = join(dir, 'plan.md')
    writeFileSync(outline, '# Plan\n\n- Root\n')
    const r = await run(['map', 'create', '--outline', outline, '--out', '--json'], { env: env() })
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({ error: 'missing_argument' })
    expect(r.json().message).toContain('missing --out <path>')
    expect(existsSync(join(dir, 'plan.xmind'))).toBe(false)
  })

  it('writes --out and refuses to overwrite an existing file without --force', async () => {
    const dir = tempDir()
    const outline = join(dir, 'plan.md')
    writeFileSync(outline, '- Lone topic\n')
    const out = join(dir, 'fresh.xmind')
    const first = await run(['map', 'create', '--outline', outline, '--out', out, '--json'], {
      env: env(),
    })
    expect(first.code).toBe(0)
    const again = await run(['map', 'create', '--outline', outline, '--out', out, '--json'], {
      env: env(),
    })
    expect(again.code).toBe(2)
    expect(again.json()).toMatchObject({ error: 'output_exists' })
    const forced = await run(
      ['map', 'create', '--outline', outline, '--out', out, '--force', '--json'],
      { env: env() },
    )
    expect(forced.code).toBe(0)
    const read = await run(['map', 'read', out, '--json'], { env: env() })
    expect(read.json().detail.sheets[0].topics[0].title).toBe('Lone topic')
  })
})

describe('guide map and the MCP tools', () => {
  const OPS = ['add_topic', 'rename_topic', 'move_topic', 'delete_topic', 'set_note', 'set_link']

  it('lists the six ops with their schemas', async () => {
    const text = await run(['guide', 'map'], { env: env() })
    expect(text.code).toBe(0)
    for (const op of OPS) expect(text.stdout).toContain(`  ${op} {`)
    // a duplicated cross-sheet id cannot be targeted at all; do not advise batching
    expect(text.stdout).not.toContain('one sheet per batch')
    expect(text.stdout).toContain('cannot be targeted at all')
    const json = await run(['guide', 'map', '--json'], { env: env() })
    const { ops } = json.json().detail
    expect(ops.map((e: { op: string }) => e.op)).toEqual(OPS)
    for (const entry of ops) {
      expect(entry.schema.type).toBe('object')
      expect(entry.schema.required).toContain('op')
    }
    const one = await run(['guide', 'map', 'delete_topic'], { env: env() })
    expect(one.stdout).toContain('delete_topic')
  })

  it('map_read, map_apply and map_create mirror the command options', async () => {
    const tools = resolveTools(defaultRegistry())
    const byName = new Map(tools.map((t) => [t.name, t]))
    const read = byName.get('map_read')!
    expect(read.readOnly).toBe(true)
    const apply = byName.get('map_apply')!
    expect(apply.params.map((p) => p.key)).toEqual([
      'ops',
      'best_effort',
      'stop_on_error',
      'out',
      'force',
    ])
    const create = byName.get('map_create')!
    expect(create.params.map((p) => [p.key, p.option])).toEqual([
      ['outline', 'outline'],
      ['out', 'out'],
      ['force', 'force'],
    ])

    const typed = await loadTypedSchemas()
    const variants = (
      typed['map-ops'].items as { anyOf: { properties: { op: { enum: string[] } } }[] }
    ).anyOf
    expect(variants.map((v) => v.properties.op.enum[0])).toEqual(OPS)
    const shape = toolShape(apply, 'stdio', typed)
    expect(Object.keys(shape)).toEqual([
      'file',
      'ops',
      'best_effort',
      'stop_on_error',
      'out',
      'force',
    ])
  })
})
