/**
 * A stand-in for the `codex app-server` child: it answers RPC requests from a
 * handler table and records them, so a test sees what the bridge asked without
 * a real Codex. Nothing here starts a program.
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { SpawnOptions } from 'node:child_process'
import { setCodexAppServerRuntime, type RpcMessage } from '../src/codex-app-server'
import type { SubscriptionProgram } from '../src/subscription/locate'
import type { SubscriptionChildLike } from '../src/subscription/process'

export const FAKE_PROGRAM: SubscriptionProgram = {
  provider: 'codex',
  command: '/opt/codex/bin/codex',
  prefixArgs: [],
  env: {},
  entry: '/opt/codex/bin/codex',
  source: 'path',
}

export type FakeHandler = (params: unknown, child: FakeCodex) => unknown

/** Returned by a handler that leaves its request unanswered */
export const NO_REPLY = Symbol('no reply')

export class FakeCodex extends EventEmitter implements SubscriptionChildLike {
  // no pid: the shared child registry and the real tree kill both skip a child without one
  readonly pid = undefined
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly requests: Array<{ method: string; params: unknown }> = []
  killed = 0
  private buffer = ''

  constructor(private readonly handlers: Record<string, FakeHandler>) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) this.receive(JSON.parse(line) as RpcMessage)
    })
  }

  kill(): boolean {
    this.killed++
    return true
  }

  send(message: RpcMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  methods(): string[] {
    return this.requests.map((request) => request.method)
  }

  paramsOf(method: string): Record<string, unknown> | undefined {
    return this.requests.find((request) => request.method === method)?.params as
      Record<string, unknown> | undefined
  }

  allParamsOf(method: string): Array<Record<string, unknown>> {
    return this.requests
      .filter((request) => request.method === method)
      .map((request) => request.params as Record<string, unknown>)
  }

  private receive(message: RpcMessage): void {
    if (typeof message.method !== 'string' || message.id === undefined) return
    this.requests.push({ method: message.method, params: message.params })
    const handler = this.handlers[message.method]
    if (!handler) {
      this.send({ id: message.id, error: { code: -32601, message: 'Method not found' } })
      return
    }
    try {
      const result = handler(message.params, this)
      if (result !== NO_REPLY) this.send({ id: message.id, result })
    } catch (error) {
      this.send({ id: message.id, error })
    }
  }
}

export interface FakeHarness {
  children: FakeCodex[]
  spawns: Array<{ command: string; args: string[]; options: SpawnOptions }>
  treeKills: unknown[]
  /** the only child, once exactly one was started */
  child(): FakeCodex
  /** puts the real runtime back */
  restore(): void
}

/**
 * Replace the bridge's runtime with fakes. `handlers` adds to or replaces the
 * defaults, which answer like a signed-in ChatGPT plan with no MCP server.
 */
export function fakeCodexRuntime(
  defaults: Record<string, FakeHandler>,
  overrides: Record<string, FakeHandler> = {},
): FakeHarness {
  const handlers = { ...defaults, ...overrides }
  const state: FakeHarness = {
    children: [],
    spawns: [],
    treeKills: [],
    child() {
      if (state.children.length !== 1) {
        throw new Error(`expected one Codex child, found ${state.children.length}`)
      }
      return state.children[0]!
    },
    restore: () => undefined,
  }
  state.restore = setCodexAppServerRuntime({
    resolve: async () => FAKE_PROGRAM,
    spawn: (command, args, options) => {
      const child = new FakeCodex(handlers)
      state.children.push(child)
      state.spawns.push({ command, args, options })
      return child
    },
    killTree: (target) => {
      state.treeKills.push(target)
    },
  })
  return state
}
