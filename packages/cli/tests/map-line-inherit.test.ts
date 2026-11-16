import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'
import { LINE_A, styledMap } from './map-fixture'

/**
 * The line inheritance of decision 0102 through `map apply` (add_topic and
 * move_topic): a topic that arrives under a new
 * parent takes the line values the parent has written on itself, on itself and
 * its whole branch; a parent without any leaves the arriving topic as it was.
 * The values are watched in `content.json`, the file's own words.
 */

const env = () => ({
  ...process.env,
  GENOFFICE_AUDIT_LOG: 'off',
  GENOFFICE_USER_DATA: tempDir(),
  GENOFFICE_APP_BIN: 'C:/no/such/IeumOffice.exe',
})

const ops = (list: unknown[]): string => JSON.stringify(list)

/** The line values a saved topic holds in `content.json`, by its id. */
async function savedLine(file: string, id: string): Promise<Record<string, unknown>> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const content = JSON.parse(await zip.file('content.json')!.async('string')) as {
    rootTopic: Record<string, unknown>
  }[]
  const find = (topic: Record<string, unknown>): Record<string, unknown> | null => {
    if (topic.id === id) return topic
    for (const kind of Object.values((topic.children ?? {}) as Record<string, unknown[]>)) {
      for (const child of kind ?? []) {
        const hit = find(child as Record<string, unknown>)
        if (hit) return hit
      }
    }
    return null
  }
  for (const sheet of content) {
    const hit = find(sheet.rootTopic)
    if (hit) return ((hit.style ?? {}) as { properties?: Record<string, unknown> }).properties ?? {}
  }
  throw new Error(`no topic ${id} in ${file}`)
}

describe('a topic that arrives under a new parent (decision 0102)', () => {
  it('add_topic under a topic with line values writes them on the new topic', async () => {
    const dir = tempDir()
    const file = join(dir, 'styled.xmind')
    const ids = await styledMap(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'add_topic', parent: ids.a, title: 'New' }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code, JSON.stringify(r.json())).toBe(0)
    const created = r.json().detail.results[0].created as string
    expect(await savedLine(file, created)).toEqual(LINE_A)
  })

  it('move_topic takes the new parent’s values onto the topic and its whole branch', async () => {
    const dir = tempDir()
    const file = join(dir, 'styled.xmind')
    const ids = await styledMap(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'move_topic', id: ids.c, parent: ids.a }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code, JSON.stringify(r.json())).toBe(0)
    expect(await savedLine(file, ids.c)).toEqual(LINE_A)
    // the branch below takes the same values, the parent's over the keys it sets
    // and the topic's own other keys left as they were
    expect(await savedLine(file, ids.c1)).toEqual({ ...LINE_A, 'line-pattern': 'dot' })
  })

  it('under a parent without direct values the arriving topic keeps its own', async () => {
    const dir = tempDir()
    const file = join(dir, 'styled.xmind')
    const ids = await styledMap(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'move_topic', id: ids.c, parent: ids.b }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code, JSON.stringify(r.json())).toBe(0)
    expect(await savedLine(file, ids.c)).toEqual({})
    expect(await savedLine(file, ids.c1)).toEqual({
      'line-color': '#445566',
      'line-pattern': 'dot',
    })
  })

  it('values the engine does not write are not taken from the parent', async () => {
    const dir = tempDir()
    const file = join(dir, 'styled.xmind')
    const ids = await styledMap(file)
    const r = await run(
      [
        'map',
        'apply',
        file,
        '--ops',
        ops([{ op: 'move_topic', id: ids.c, parent: ids.d }]),
        '--json',
      ],
      { env: env() },
    )
    expect(r.code, JSON.stringify(r.json())).toBe(0)
    // D's 2.5pt width is not one the engine writes and is not taken; its colour is
    expect(await savedLine(file, ids.c)).toEqual({ 'line-color': '#112233' })
    expect(await savedLine(file, ids.c1)).toEqual({
      'line-color': '#112233',
      'line-pattern': 'dot',
    })
  })
})
