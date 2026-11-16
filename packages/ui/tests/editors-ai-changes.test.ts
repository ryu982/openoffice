/**
 * Every editor tells what an AI run changed with the same card, and none
 * keeps the receipts it had before (a toolbar rollback button, a snapshot
 * strip above the composer, an "N applied" chip). This guard reads the
 * renderer sources of the ten editors.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))

const EDITORS = [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
  'html',
  'mindmap',
  'hwp',
  'epub',
  'diagram',
] as const

/** the receipts the editors used before the shared card */
const RETIRED = [
  'RunChangesCard',
  'RollbackButton',
  'ai-versions',
  'ai-version-rollback',
  'ai-auto-applied',
  'ai-rollback-btn',
] as const

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.(tsx?|css)$/.test(name)) out.push(path)
  }
  return out
}

describe('the AI changes card in every editor', () => {
  for (const editor of EDITORS) {
    const files = sources(join(REPO, 'apps', editor, 'src', 'renderer'))
    const texts = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }))

    it(`${editor} renders the shared AiChangesCard`, () => {
      const users = texts.filter(
        ({ text }) => /\bAiChangesCard\b/.test(text) && text.includes("from '@genoffice/ui'"),
      )
      expect(users.length, editor).toBeGreaterThan(0)
    })

    it(`${editor} keeps none of the old receipts`, () => {
      for (const { file, text } of texts) {
        for (const name of RETIRED) {
          expect(text.includes(name), `${file} still has ${name}`).toBe(false)
        }
      }
    })
  }
})
