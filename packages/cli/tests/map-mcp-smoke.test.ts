import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../src/cli'
import { createContext, disposeContext } from '../src/mcp/run'
import { createMcpServer } from '../src/mcp/server'
import { run, tempDir } from './helpers'

describe('mcp tool list', () => {
  it('serves map_read, map_apply and map_create', async () => {
    const dir = tempDir()
    const ctx = createContext({
      cwd: dir,
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
      log: () => {},
    })
    try {
      const server = await createMcpServer(ctx, { registry: defaultRegistry() })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.connect(a)
      const client = new Client({ name: 'smoke', version: '0' })
      await client.connect(b)
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      console.log(
        'SERVED MAP TOOLS:',
        names.filter((n) => n.startsWith('map_')),
      )
      expect(names).toContain('map_read')
      expect(names).toContain('map_apply')
      expect(names).toContain('map_create')
      await client.close()
    } finally {
      disposeContext(ctx)
    }
  })
})

describe('map_create output lifetime', () => {
  it('refuses a call without out: the scratch default would not survive the server', async () => {
    const dir = tempDir()
    const ctx = createContext({
      cwd: dir,
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
      log: () => {},
    })
    try {
      const server = await createMcpServer(ctx, { registry: defaultRegistry() })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.connect(a)
      const client = new Client({ name: 'smoke', version: '0' })
      await client.connect(b)
      const listed = (await client.listTools()).tools.find((t) => t.name === 'map_create')!
      expect(listed.inputSchema.required).toContain('out')
      const r = await client.callTool({
        name: 'map_create',
        arguments: { outline: '# Plan\n\n- Root\n' },
      })
      expect(r.isError).toBe(true)
      const text = (r.content as { type: string; text?: string }[])
        .map((c) => c.text ?? '')
        .join('\n')
      expect(text).toContain('out')
      // nothing was written beside the materialized outline
      expect(existsSync(join(ctx.scratchDir, 'outline.xmind'))).toBe(false)
      await client.close()
    } finally {
      disposeContext(ctx)
    }
  })

  it('writes to the given out and the map survives disposeContext', async () => {
    const dir = tempDir()
    const ctx = createContext({
      cwd: dir,
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
      log: () => {},
    })
    const out = join(dir, 'plan.xmind')
    const server = await createMcpServer(ctx, { registry: defaultRegistry() })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: 'smoke', version: '0' })
    await client.connect(b)
    const r = await client.callTool({
      name: 'map_create',
      arguments: { outline: '# Plan\n\n- Root\n  - A\n', out },
    })
    expect(r.isError).toBeFalsy()
    await client.close()
    // the whole scratch dir goes here; the map must not go with it
    disposeContext(ctx)
    expect(existsSync(ctx.scratchDir)).toBe(false)
    expect(existsSync(out)).toBe(true)
    const read = await run(['map', 'read', out], {
      env: { ...process.env, GENOFFICE_AUDIT_LOG: 'off' },
    })
    expect(read.code).toBe(0)
    expect(read.stdout).toContain('# Plan')
    expect(read.stdout).toContain('- A')
  })
})
