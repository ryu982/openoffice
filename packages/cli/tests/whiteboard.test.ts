import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli'

function captureCli(argv: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  let out = ''
  let err = ''
  return runCli(argv, {
    cwd,
    env: { ...env, GENOFFICE_AUDIT_LOG: 'off' },
    io: {
      stdout: (t) => {
        out += t
      },
      stderr: (t) => {
        err += t
      },
    },
  }).then((code) => ({
    code,
    out,
    err,
    json: () => JSON.parse(out),
  }))
}

describe('CLI whiteboard commands', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-wb-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates, reads, edits, converts to markdown, and prints guide locally via WASM', async () => {
    const outPath = join(dir, 'plan.whiteboard')
    const template = JSON.stringify({
      schemaVersion: 1,
      title: 'Q2 Kickoff',
      pages: [
        {
          key: 'p1',
          title: 'Goals',
          blocks: [
            { type: 'title', key: 'hdr', text: 'Q2 Goals' },
            { type: 'sticky', key: 's1', text: 'Ship Whiteboard' },
          ],
        },
      ],
    })
    const created = await captureCli(
      ['create', '--type', 'whiteboard', '--template', template, '--out', outPath, '--json'],
      dir,
    )
    expect(created.code).toBe(0)
    expect(created.json().status).toBe('ok')

    const read1 = await captureCli(['whiteboard', 'read', outPath, '--json'], dir)
    expect(read1.code).toBe(0)
    expect(read1.json().detail.pages[0].objects.length).toBe(2)

    const ops = JSON.stringify([
      { op: 'add', id: 'l1', kind: 'link', url: 'https://example.com', title: 'Reference' },
    ])
    const applied = await captureCli(
      ['whiteboard', 'apply', outPath, '--ops', ops, '--json'],
      dir,
    )
    expect(applied.code).toBe(0)
    expect(applied.json().detail.changed).toBe(true)
    expect(applied.json().detail.created).toEqual(['l1'])

    const mdPath = join(dir, 'plan.md')
    const converted = await captureCli(
      ['convert', outPath, '--to', 'md', '--out', mdPath, '--json'],
      dir,
    )
    expect(converted.code).toBe(0)
    const md = readFileSync(mdPath, 'utf8')
    expect(md).toContain('Ship Whiteboard')
    expect(md).toContain('[Reference](https://example.com)')

    const guide = await captureCli(['guide', 'whiteboard', '--json'], dir)
    expect(guide.code).toBe(0)
    expect(guide.json().detail.domain).toBe('whiteboard')
    expect(guide.json().detail.ops.map((o: { op: string }) => o.op)).toContain('set_page_format')
  })

  it('rejects .excalidraw* with exit code 2 unsupported', async () => {
    const exPath = join(dir, 'sketch.excalidraw')
    writeFileSync(exPath, JSON.stringify({ type: 'excalidraw', elements: [] }))
    const res = await captureCli(['whiteboard', 'read', exPath, '--json'], dir)
    expect(res.code).toBe(2)
    expect(res.json().error).toBe('unsupported')

    const conv = await captureCli(['convert', exPath, '--to', 'md', '--json'], dir)
    expect(conv.code).toBe(2)
    expect(conv.json().error).toBe('unsupported')
  })

  it('returns exit code 4 app_unavailable when converting to pdf without the app binary', async () => {
    const outPath = join(dir, 'a.whiteboard')
    const ops = JSON.stringify([{ op: 'add', kind: 'sticky', text: 'Hello' }])
    const mk = await captureCli(
      ['create', '--type', 'whiteboard', '--ops', ops, '--out', outPath, '--json'],
      dir,
    )
    expect(mk.code).toBe(0)

    const conv = await captureCli(
      ['convert', outPath, '--to', 'pdf', '--out', join(dir, 'a.pdf'), '--json'],
      dir,
      { ...process.env, GENOFFICE_APP_BIN: join(dir, 'does-not-exist-bin') },
    )
    expect(conv.code).toBe(4)
    expect(conv.json().error).toBe('app_unavailable')
  })
})
