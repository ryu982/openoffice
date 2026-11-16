import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')

/** Every module specifier (static, re-export, dynamic) in a source file. */
function specifiers(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1])
  return found
}

describe('./plan module graph', () => {
  it('pulls in only relative modules of this package (no Node, Electron or PDF library)', () => {
    const seen = new Set<string>()
    const outside: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('./') && !spec.startsWith('../')) {
          outside.push(`${file}: ${spec}`)
          continue
        }
        visit(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`))
      }
    }
    visit(resolve(SRC, 'plan.ts'))
    expect(outside).toEqual([])
    expect(seen.size).toBeGreaterThan(1)
    expect([...seen].some((f) => f.endsWith('arrange.ts'))).toBe(false)
  })

  it('the package exports keep "./plan" pointing at plan.ts', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, '../package.json'), 'utf8'))
    expect(pkg.exports['./plan']).toBe('./src/plan.ts')
    expect(pkg.exports['.']).toBe('./src/index.ts')
  })
})
