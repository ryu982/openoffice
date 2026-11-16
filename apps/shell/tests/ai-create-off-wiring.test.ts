import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Opening the documents the AI makes while editors are turned off (editor
 * choice spec 7.2, 7.4, 7.6). index.ts cannot be loaded outside a running
 * Electron, so the wiring is pinned by reading the source. The AI's own
 * create tools refuse a turned-off type before anything is made (tested in
 * the editors and in @genoffice/electron-utils/ai-create-guard).
 */

const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

function callBlock(name: string): string {
  const start = main.indexOf(`${name}({`)
  if (start < 0) throw new Error(`no ${name}`)
  const end = main.indexOf('\n})', start)
  return main.slice(start, end)
}

describe('the agent window', () => {
  it("opens a file the person picks by the agent's output through the gate", () => {
    const agent = callBlock('configureAgentWindow')
    expect(agent).toMatch(
      /openPath: \(path\) =>\s+openGate\.check\(path, 'user', \(picked\) => routeDocumentPath\(picked\)\) \?\?\s+routeDocumentPath\(path\),/,
    )
    expect(agent).not.toMatch(/openPath: \(path\) => routeDocumentPath\(path\),/)
  })
})

describe('the terminal command and MCP are unchanged (spec 7.6)', () => {
  it('the in-app MCP server opens without the gate', () => {
    expect(callBlock('configureMcpRuntime')).toMatch(
      /openPath: \(filePath\) => routeDocumentPath\(filePath\),/,
    )
  })

  it('the control server opens as automation', () => {
    expect(main).toMatch(/openDocument: \(path\) => openDocumentPath\(path, 'automation'\),/)
  })
})

describe("the editors' AI document creation", () => {
  it('goes through the docs-owned creator, which refuses a turned-off type first', () => {
    expect(callBlock('configureSheetsRuntime')).toMatch(/createDocument: createAiDocument,/)
    expect(callBlock('configurePdfRuntime')).toMatch(/createDocument: createAiDocument,/)
  })
})
