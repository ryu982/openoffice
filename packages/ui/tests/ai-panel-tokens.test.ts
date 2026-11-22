import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const readCss = (name: string): string => readFileSync(join(SRC, name), 'utf8')

function extractVars(block: string): Set<string> {
  const vars = new Set<string>()
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    vars.add(m[1]!)
  }
  return vars
}

describe('AI panel design tokens and stylesheet invariants', () => {
  it('defines every new AI panel color/shadow token across light, dark, and system-dark blocks', () => {
    const css = readCss('tokens.css')
    const lightIdx = css.indexOf(':root {')
    const darkIdx = css.indexOf("[data-theme='dark'] {")
    const mediaIdx = css.indexOf('@media (prefers-color-scheme: dark)')
    expect(lightIdx).toBeGreaterThan(-1)
    expect(darkIdx).toBeGreaterThan(lightIdx)
    expect(mediaIdx).toBeGreaterThan(darkIdx)

    const lightBlock = css.slice(lightIdx, darkIdx)
    const darkBlock = css.slice(darkIdx, mediaIdx)
    const mediaBlock = css.slice(mediaIdx)

    const lightVars = extractVars(lightBlock)
    const darkVars = extractVars(darkBlock)
    const mediaVars = extractVars(mediaBlock)

    const requiredAiTokens = [
      '--ai-user-bubble-bg',
      '--ai-user-bubble-border',
      '--ai-card-bg',
      '--ai-card-inset-bg',
      '--ai-composer-bg',
      '--ai-composer-shadow',
      '--ai-composer-focus-ring',
      '--ai-scroll-btn-shadow',
      '--ai-shimmer-base',
      '--ai-shimmer-hi',
      '--ai-btn-disabled-bg',
      '--ai-btn-disabled-ink',
    ]

    for (const token of requiredAiTokens) {
      expect(lightVars.has(token), `light missing ${token}`).toBe(true)
      expect(darkVars.has(token), `dark missing ${token}`).toBe(true)
      expect(mediaVars.has(token), `system-dark missing ${token}`).toBe(true)
    }

    // Every dark-block variable must also exist in the system-dark media block
    for (const token of darkVars) {
      expect(mediaVars.has(token), `system-dark missing ${token}`).toBe(true)
    }
  })

  it('uses system UI sans-serif ahead of Arial for --gs-font-sans', () => {
    const css = readCss('tokens.css')
    const match = css.match(/--gs-font-sans:\s*([^;]+);/)
    expect(match?.[1]).toBeDefined()
    expect(match![1]!.trim().startsWith("'Arial'")).toBe(false)
    expect(match![1]!).toContain('Segoe UI')
  })

  it('keeps shared AI panel CSS stylesheets free of raw hex or rgb colors', () => {
    const files = [
      'ai-panel.css',
      'ai-changes.css',
      'ai-queue-strip.css',
      'ai-model-picker.css',
      'ai-scope-quote.css',
      'ai-usage.css',
      'user-mcp.css',
      'project-panel.css',
      'skill-picker.css',
      'ai-panel-prefs.css',
    ]
    for (const file of files) {
      const stripped = readCss(file).replace(/\/\*[\s\S]*?\*\//g, '')
      const lines = stripped.split('\n')
      for (const line of lines) {
        if (/^\s*--[a-z0-9-]+\s*:/.test(line)) continue
        expect(line, `${file}: raw hex color`).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(line, `${file}: raw rgb/rgba color`).not.toMatch(/\brgba?\s*\(/i)
        expect(line, `${file}: raw hsl/hsla color`).not.toMatch(/\bhsla?\s*\(/i)
      }
    }
  })

  it('keeps MCP permission card buttons calm and neutral (decision 0100)', () => {
    const mcp = readCss('user-mcp.css')
    const btnBlock = mcp.match(/\.ai-mcp-card\s+\.ai-mcp-card-btn\s*\{[^}]*\}/)?.[0] ?? ''
    expect(btnBlock).not.toContain('var(--accent)')
    expect(btnBlock).not.toContain('var(--color-btn-primary)')
  })
})
