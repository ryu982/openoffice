#!/usr/bin/env node
/**
 * Check that no instruction states an old number of UI languages:
 * `npm run check:lang-count`
 *
 * The type checker and `check:help-langs` already refuse a dictionary or an
 * article that leaves a language out. What they cannot see is prose. Agents
 * and contributors work from AGENTS.md and the docs, and a line that still says
 * "fill all 21 languages" after a 22nd was added is read as an instruction: the
 * new language gets skipped, and the gap only shows up when a later check
 * fails. This reads the count out of `LANGS` and fails on any other count
 * stated as a number of languages.
 *
 * Records are left alone: decisions, tracking notes and implemented plans say
 * what was true when they were written. Dictionaries and help articles are
 * prose in other languages, guarded by their own checks.
 *
 * Tests may not pin the list's length either: `expect(LANGS).toHaveLength(n)`
 * belongs in packages/i18n/tests only, so adding a language changes one list.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const I18N = join(ROOT, 'packages/i18n/src/index.ts')

/** Read out of the source text, the same way check-help-langs does. */
function langCount() {
  const source = readFileSync(I18N, 'utf8')
  const start = source.indexOf('export const LANGS')
  if (start < 0) throw new Error('export const LANGS not found in packages/i18n/src/index.ts')
  const open = source.indexOf('= [', start)
  const body = source.slice(open, source.indexOf(']', open))
  const codes = [...body.matchAll(/'([a-zA-Z-]+)'/g)].map((m) => m[1])
  if (codes.length === 0) throw new Error('no language codes parsed out of LANGS')
  return codes.length
}

const SKIP = [
  /^docs\/tracking\//,
  /^docs\/plans\//,
  /^vendor\//,
  /\/i18n\//,
  /\/help\/topics\//,
  /\.patch$/,
  /^tools\/check-lang-count\.mjs$/,
  /^packages\/i18n\/tests\//,
]
const TEXT = /\.(md|mdx|ts|tsx|mts|cts|js|mjs|cjs|yml|yaml)$/

/**
 * A number of languages, in the forms the docs use. Only counts within
 * NEAR of the real one are read: "Korean and English, 2 languages" or a model
 * that "renders 14-language text" is not about the UI list.
 */
const PATTERNS = [
  /(?<![0-9])(\d{2}) ?개 ?(?:의 )?(?:화면 )?언어/g,
  /언어 ?(\d{2}) ?개/g,
  /화면 언어 (\d{2})(?![0-9])/g,
  /<언어>\.ts` (\d{2})개/g,
  /\((\d{2})개, `zh`/g,
  /(?<![0-9])(\d{2})[- ](?:UI |supported |interface )?languages?\b/gi,
]
const NEAR = 5
const PINNED_LENGTH = /expect\(LANGS\)\.toHaveLength\((\d+)\)/g
/** Cheap gate before the patterns run: a line that names no language is skipped. */
const MENTIONS = /언어|language|LANGS/i
/** Bundles and fixtures, not prose. */
const MAX_BYTES = 512 * 1024

const expected = langCount()
// git grep reads the files through the index in one process; reading every
// tracked file from node is minutes on a slow disk. Exit 1 means no match.
let listed = ''
try {
  listed = execFileSync('git', ['grep', '-l', '-I', '-i', '-E', '언어|language|langs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  if (err.status !== 1) throw err
}
const files = listed.split('\n').filter((f) => f && TEXT.test(f) && !SKIP.some((re) => re.test(f)))

const problems = []
for (const file of files) {
  let text
  try {
    const path = join(ROOT, file)
    if (statSync(path).size > MAX_BYTES) continue
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (!MENTIONS.test(text)) continue
  text.split('\n').forEach((line, i) => {
    if (!MENTIONS.test(line)) return
    for (const re of PATTERNS) {
      for (const m of line.matchAll(re)) {
        const n = Number(m[1])
        if (n !== expected && Math.abs(n - expected) <= NEAR) {
          problems.push(`${file}:${i + 1}: says ${m[1]} languages ("${m[0].trim()}")`)
        }
      }
    }
    for (const m of line.matchAll(PINNED_LENGTH)) {
      problems.push(
        `${file}:${i + 1}: pins LANGS to ${m[1]}; compare with LANGS.length instead (the list is pinned in packages/i18n/tests)`,
      )
    }
  })
}

if (problems.length > 0) {
  console.error(`LANGS has ${expected} UI languages, but:\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`Language count check passed (${expected} UI languages, ${files.length} files read).`)
