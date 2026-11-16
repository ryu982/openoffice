import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_CHOICE_BRIDGE_KEY, APP_CHOICE_CHANNELS } from '@genoffice/electron-utils/app-choice'
import { GENERATE_CHOICE } from '../src/shared/generate-api'

const PRELOAD_DIR = join(__dirname, '../src/preload')

/** the modules a preload entry loads at run time (type-only imports and electron left out) */
function runtimeImports(file: string): string[] {
  const text = readFileSync(join(PRELOAD_DIR, file), 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/^import\s+(?!type\b)[^'"]*?from\s+'([^']+)'/gm)) {
    if (match[1] !== 'electron') found.add(match[1])
  }
  return [...found]
}

describe('shell preload entries', () => {
  // A module two entries import is split into out/preload/chunks, which a
  // sandboxed preload cannot load: that window comes up blank.
  it('do not import the same module at run time', () => {
    const entries = readdirSync(PRELOAD_DIR).filter((f) => f.endsWith('.ts'))
    const owner = new Map<string, string>()
    const shared: string[] = []
    for (const entry of entries) {
      for (const spec of runtimeImports(entry)) {
        const first = owner.get(spec)
        if (first && first !== entry) shared.push(`${spec} (${first}, ${entry})`)
        else owner.set(spec, entry)
      }
    }
    expect(shared).toEqual([])
  })

  it('the generate window reads the choice on the shared channels', () => {
    expect(GENERATE_CHOICE.get).toBe(APP_CHOICE_CHANNELS.get)
    expect(GENERATE_CHOICE.changed).toBe(APP_CHOICE_CHANNELS.changed)
    expect(GENERATE_CHOICE.bridgeKey).toBe(APP_CHOICE_BRIDGE_KEY)
  })
})
