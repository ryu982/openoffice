/**
 * One picture through the Codex subscription, over the app's `codex app-server`
 * client, against a fake app-server. No real Codex is started.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AiRunError } from '../src/run-error'
import {
  CODEX_CONFIG_OVERRIDES,
  codexAppServerLaunchArgs,
  codexThreadStartParams,
  generateCodexImage,
  shutdownCodexAppServers,
  streamCodexAppServer,
  type RpcMessage,
} from '../src/codex-app-server'
import { notifySubscriptionOffChange } from '../src/subscription/launch'
import type { AiSubscriptionUsage } from '../src/types'
import type { CodexImageCall } from '../src/codex-image-parts'
import { NO_REPLY, fakeCodexRuntime, type FakeCodex, type FakeHandler } from './codex-fake'

/** A 1x1 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

const PLUS = { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true }
const FREE = { account: { type: 'chatgpt', planType: 'free' }, requiresOpenaiAuth: true }

const MODELS = {
  data: [
    {
      id: 'gpt-codex-default',
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'high' },
        { reasoningEffort: 'low' },
        { reasoningEffort: 'medium' },
      ],
    },
    { id: 'gpt-other', supportedReasoningEfforts: [{ reasoningEffort: 'minimal' }] },
  ],
  nextCursor: null,
}

interface ImageItemFields {
  id?: string
  status?: string
  result?: string
  fileId?: string
  transparentBackground?: boolean | null
  failure?: unknown
}

function imageItem(fields: ImageItemFields = {}): Record<string, unknown> {
  return {
    type: 'imageGeneration',
    id: fields.id ?? 'ig-1',
    status: fields.status ?? 'completed',
    revisedPrompt: 'an apple',
    result: fields.result ?? PNG.toString('base64'),
    transparentBackground: fields.transparentBackground ?? null,
    failure: fields.failure ?? null,
    // a path in Codex's own folder: the bridge must never open it
    savedPath: '/nowhere/.codex/generated_images/never-read.png',
    generationId: 'gen-1',
    inputImages: [],
    ...(fields.fileId !== undefined ? { fileId: fields.fileId } : {}),
  }
}

const itemCompleted = (threadId: string, item: Record<string, unknown>): RpcMessage => ({
  method: 'item/completed',
  params: { threadId, turnId: 't1', item },
})

const turnCompleted = (threadId: string, status = 'completed', error?: unknown): RpcMessage => ({
  method: 'turn/completed',
  params: {
    threadId,
    turnId: 't1',
    turn: { id: 't1', status, ...(error !== undefined ? { error } : {}) },
  },
})

const agentMessage = (threadId: string, text: string): RpcMessage =>
  itemCompleted(threadId, { type: 'agentMessage', id: 'msg-1', text })

/** A turn handler that sends `messages(threadId)` once the turn has started */
function turnSends(messages: (threadId: string) => RpcMessage[]): FakeHandler {
  return (params, child) => {
    const { threadId } = params as { threadId: string }
    queueMicrotask(() => messages(threadId).forEach((message) => child.send(message)))
    return { turn: { id: 't1' } }
  }
}

const DEFAULTS: Record<string, FakeHandler> = {
  initialize: () => ({ userAgent: 'ieumoffice/0.166.0 (Windows 10.0.26200; x86_64) test' }),
  'account/read': () => PLUS,
  'config/read': () => ({ config: {} }),
  'model/list': () => MODELS,
  'thread/start': () => ({
    thread: { id: 'th-img' },
    activePermissionProfile: { id: 'genoffice' },
  }),
  'mcpServerStatus/list': () => ({ data: [], nextCursor: null }),
  'thread/delete': () => ({}),
  'turn/interrupt': () => ({}),
  'turn/start': turnSends((threadId) => [
    itemCompleted(threadId, imageItem()),
    agentMessage(threadId, 'Done.'),
    turnCompleted(threadId),
  ]),
}

let restore: (() => void) | undefined

function harness(overrides: Record<string, FakeHandler> = {}) {
  const h = fakeCodexRuntime(DEFAULTS, overrides)
  restore = h.restore
  return h
}

afterEach(() => {
  shutdownCodexAppServers()
  restore?.()
  restore = undefined
})

const call = (fields: Partial<CodexImageCall> = {}): CodexImageCall => ({
  prompt: 'A red apple on white, flat style',
  ...fields,
})

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to fail')
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

function threadDir(child: FakeCodex): string {
  return String(child.paramsOf('thread/start')?.cwd)
}

describe('Codex image: success', () => {
  it('returns the bytes of the picture in the item, never its saved path', async () => {
    const h = harness()
    const outcome = await generateCodexImage(call())
    expect(outcome).toEqual({ kind: 'image', bytes: new Uint8Array(PNG), mime: 'image/png' })
    const child = h.child()
    // one disposable thread, deleted afterwards, its folder too
    expect(child.allParamsOf('thread/start')).toHaveLength(1)
    expect(child.paramsOf('thread/delete')).toEqual({ threadId: 'th-img' })
    expect(existsSync(threadDir(child))).toBe(false)
  })

  it('takes the first picture when a turn makes several', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ id: 'ig-1', result: JPEG.toString('base64') })),
        itemCompleted(threadId, imageItem({ id: 'ig-2' })),
        turnCompleted(threadId),
      ]),
    })
    const outcome = await generateCodexImage(call())
    expect(outcome).toEqual({ kind: 'image', bytes: new Uint8Array(JPEG), mime: 'image/jpeg' })
  })

  it('skips an item still in progress (no data yet) and takes the completed one', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ status: 'in_progress', result: '' })),
        itemCompleted(threadId, imageItem({ id: 'ig-2' })),
        turnCompleted(threadId),
      ]),
    })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image', mime: 'image/png' })
  })

  it('sends the prompt as given, then the size, quality and background asked for', async () => {
    const h = harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ transparentBackground: true })),
        turnCompleted(threadId),
      ]),
    })
    const prompt = '흰 배경의 빨간 사과, 平面 스타일'
    await generateCodexImage(
      call({ prompt, aspectRatio: '16:9', imageSize: '2k', transparent: true }),
    )
    const input = h.child().paramsOf('turn/start')!.input as Array<Record<string, unknown>>
    expect(input).toHaveLength(1)
    const text = String(input[0]!.text)
    expect(input[0]!.type).toBe('text')
    expect(text.startsWith(`${prompt}\n`)).toBe(true)
    expect(text).toContain('size: 1536x1024')
    expect(text).toContain('quality: high')
    expect(text).toMatch(/background: transparent/)
  })

  it('maps the other shapes and detail levels, and leaves quality to Codex when none is given', async () => {
    const h = harness()
    await generateCodexImage(call({ aspectRatio: '9:16', imageSize: '0.5k' }))
    await generateCodexImage(call({ aspectRatio: 'auto' }))
    const texts = h
      .child()
      .allParamsOf('turn/start')
      .map((params) => String((params.input as Array<{ text?: string }>).at(-1)!.text))
    expect(texts[0]).toContain('size: 1024x1536')
    expect(texts[0]).toContain('quality: low')
    expect(texts[1]).toContain('size: 1024x1024')
    expect(texts[1]).not.toContain('quality:')
  })

  it('passes on the usage windows Codex reports during the call', async () => {
    const window = { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_794_469_543 }
    harness({
      'turn/start': turnSends((threadId) => [
        {
          method: 'account/rateLimits/updated',
          params: { rateLimits: { limitId: 'codex', primary: window } },
        },
        itemCompleted(threadId, imageItem()),
        turnCompleted(threadId),
      ]),
    })
    const usage: AiSubscriptionUsage[][] = []
    await generateCodexImage(call({ onUsage: (windows) => usage.push(windows) }))
    expect(usage).toEqual([
      [{ provider: 'codex', window: 'five_hour', utilization: 0.4, resetsAt: 1_794_469_543_000 }],
    ])
  })

  it('ignores the items of another thread running in the same process', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted('th-chat', imageItem({ result: JPEG.toString('base64') })),
        itemCompleted(threadId, imageItem()),
        turnCompleted(threadId),
      ]),
    })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image', mime: 'image/png' })
  })
})

describe('Codex image: the thread it runs in', () => {
  it('starts the process with the chat overrides and the image tool off by default', async () => {
    const h = harness()
    await generateCodexImage(call())
    expect(h.spawns).toHaveLength(1)
    expect(h.spawns[0]!.args).toEqual(codexAppServerLaunchArgs())
    const overrides = h.spawns[0]!.args.filter((_, index, args) => args[index - 1] === '-c')
    for (const override of CODEX_CONFIG_OVERRIDES) expect(overrides).toContain(override)
    expect(overrides).toContain('features.image_generation=false')
    expect(h.spawns[0]!.options.shell).toBeUndefined()
  })

  it('locks the image thread like a chat thread, with the image tool alone turned on', async () => {
    const h = harness({
      'config/read': () => ({ config: { mcp_servers: { files: { command: 'x' } } } }),
      'mcpServerStatus/list': () => ({
        data: [{ name: 'files', runtimeStatus: 'disabled', tools: {} }],
        nextCursor: null,
      }),
    })
    await generateCodexImage(call())
    const child = h.child()
    const thread = child.paramsOf('thread/start')!
    const dir = threadDir(child)
    expect(thread).toMatchObject({
      approvalPolicy: 'never',
      ephemeral: true,
      model: 'gpt-codex-default',
      config: {
        default_permissions: 'genoffice',
        permissions: { genoffice: { filesystem: { ':minimal': 'read', [dir]: 'read' } } },
        mcp_servers: { files: { enabled: false } },
        features: {
          hooks: false,
          plugins: false,
          apps: false,
          memories: false,
          image_generation: true,
        },
      },
    })
    expect(thread).not.toHaveProperty('sandbox')
    expect(String(thread.baseInstructions)).toMatch(/exactly one picture/)
    expect(String(thread.baseInstructions)).toMatch(/built-in image generation tool/)
    // Codex itself confirmed the thread has no MCP server before the turn
    const methods = child.methods()
    expect(methods.indexOf('mcpServerStatus/list')).toBeLessThan(methods.indexOf('turn/start'))
    expect(child.paramsOf('turn/start')).not.toHaveProperty('outputSchema')
  })

  it('falls back to the read-only sandbox when the permission profile does not hold', async () => {
    const h = harness({ 'thread/start': () => ({ thread: { id: 'th-img' } }) })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image' })
    const starts = h.child().allParamsOf('thread/start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({
      sandbox: 'read-only',
      ephemeral: true,
      approvalPolicy: 'never',
      config: { features: { image_generation: true, hooks: false } },
    })
    expect(starts[1]!.config).not.toHaveProperty('default_permissions')
  })

  it('runs the model the caller names, then the configured one, then the listed default', async () => {
    const h = harness()
    await generateCodexImage(call({ model: ' gpt-other ', configuredModel: 'gpt-set' }))
    await generateCodexImage(call({ configuredModel: 'gpt-set' }))
    await generateCodexImage(call())
    const models = h
      .child()
      .allParamsOf('thread/start')
      .map((params) => params.model)
    expect(models).toEqual(['gpt-other', 'gpt-set', 'gpt-codex-default'])
  })

  it('runs at the lowest effort the model takes, and at the default when it lists none', async () => {
    const h = harness()
    await generateCodexImage(call())
    await generateCodexImage(call({ model: 'gpt-other' }))
    await generateCodexImage(call({ model: 'gpt-unlisted' }))
    const efforts = h
      .child()
      .allParamsOf('turn/start')
      .map((params) => params.effort)
    expect(efforts).toEqual(['low', 'minimal', undefined])
  })

  it('refuses when an MCP server is still attached, and ends the process', async () => {
    const h = harness({
      'mcpServerStatus/list': () => ({
        data: [{ name: 'files', runtimeStatus: 'connected', tools: {} }],
        nextCursor: null,
      }),
    })
    const error = await failure(generateCodexImage(call()))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({ kind: 'unsafe-tools', provider: 'codex' })
    expect(h.child().methods()).not.toContain('turn/start')
    expect(h.treeKills).toEqual([h.child()])
  })

  it('refuses when Codex cannot report its MCP servers', async () => {
    const h = harness({
      'config/read': () => {
        throw { code: -32601, message: 'Method not found' }
      },
    })
    expect(await failure(generateCodexImage(call()))).toMatchObject({ kind: 'unsafe-tools' })
    expect(h.child().methods()).not.toContain('thread/start')
  })
})

describe('Codex image: reference pictures', () => {
  it('writes them to the thread folder and sends them as local images before the text', async () => {
    let seen: Array<{ path: string; bytes: Buffer | null }> = []
    const h = harness({
      'turn/start': (params, child) => {
        const input = (params as { input: Array<Record<string, unknown>> }).input
        seen = input
          .filter((entry) => entry.type === 'localImage')
          .map((entry) => {
            const path = String(entry.path)
            return { path, bytes: existsSync(path) ? readFileSync(path) : null }
          })
        return turnSends((threadId) => [
          itemCompleted(threadId, imageItem()),
          turnCompleted(threadId),
        ])(params, child)
      },
    })
    await generateCodexImage(
      call({
        prompt: 'Remove the background',
        references: [
          { bytes: new Uint8Array(PNG), mime: 'image/png' },
          { bytes: new Uint8Array(JPEG), mime: 'image/jpeg' },
        ],
      }),
    )
    const child = h.child()
    const dir = threadDir(child)
    expect(seen).toHaveLength(2)
    expect(seen.map((entry) => entry.bytes)).toEqual([PNG, JPEG])
    for (const entry of seen) expect(entry.path.startsWith(dir)).toBe(true)
    expect(seen[0]!.path).toMatch(/\.png$/)
    expect(seen[1]!.path).toMatch(/\.jpg$/)
    const input = child.paramsOf('turn/start')!.input as Array<Record<string, unknown>>
    expect(input.map((entry) => entry.type)).toEqual(['localImage', 'localImage', 'text'])
    expect(String(input[2]!.text)).toContain('2 attached pictures')
    // the files go with the folder when the call ends
    expect(existsSync(dir)).toBe(false)
  })
})

describe('Codex image: transparency', () => {
  it('refuses an opaque picture when transparency was asked for', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ transparentBackground: false })),
        turnCompleted(threadId),
      ]),
    })
    const outcome = await generateCodexImage(call({ transparent: true }))
    expect(outcome).toMatchObject({ kind: 'refused' })
    expect((outcome as { message: string }).message).toMatch(/transparent/i)
  })

  it('refuses a picture whose transparency Codex does not report', async () => {
    harness()
    expect(await generateCodexImage(call({ transparent: true }))).toMatchObject({
      kind: 'refused',
    })
  })

  it('takes a transparent picture, and an opaque one when transparency was not asked for', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ transparentBackground: true })),
        turnCompleted(threadId),
      ]),
    })
    expect(await generateCodexImage(call({ transparent: true }))).toMatchObject({ kind: 'image' })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image' })
  })
})

describe('Codex image: the picture data', () => {
  it('reports an older protocol that gives only a file id as needing an update', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(threadId, imageItem({ result: '', fileId: 'file-1' })),
        turnCompleted(threadId),
      ]),
    })
    const error = await failure(generateCodexImage(call()))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({ kind: 'needs-update', provider: 'codex' })
  })

  it('refuses data of an unknown format and data over the size limit', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(
          threadId,
          imageItem({ result: Buffer.from('not a picture').toString('base64') }),
        ),
        turnCompleted(threadId),
      ]),
    })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'refused' })
    shutdownCodexAppServers()
    restore?.()
    harness()
    expect(await generateCodexImage(call({ maxBytes: 10 }))).toMatchObject({ kind: 'refused' })
  })

  it('never reads the saved copy Codex keeps in its own folder', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/codex-app-server.ts', import.meta.url)),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/savedPath/)
    expect(code).not.toMatch(/generated_images/)
    expect(code).not.toMatch(/readFile/)
  })
})

describe('Codex image: limits and failures', () => {
  it('maps a used-up limit on the picture to rate-limit with the reset time Codex gave', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(
          threadId,
          imageItem({
            status: 'failed',
            result: '',
            failure: { type: 'usageLimitExceeded', limitId: 'codex', resetsAt: 1_794_469_543 },
          }),
        ),
        turnCompleted(threadId),
      ]),
    })
    const error = await failure(generateCodexImage(call()))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({
      kind: 'rate-limit',
      provider: 'codex',
      resetsAt: 1_794_469_543_000,
    })
  })

  it('maps a turn that failed on the usage limit like a chat turn', async () => {
    const exhausted = { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_794_469_600 }
    harness({
      'turn/start': turnSends((threadId) => [
        {
          method: 'account/rateLimits/updated',
          params: { rateLimits: { limitId: 'codex', primary: exhausted } },
        },
        turnCompleted(threadId, 'failed', {
          message: 'You have hit your usage limit',
          codexErrorInfo: 'usageLimitExceeded',
        }),
      ]),
    })
    expect(await failure(generateCodexImage(call()))).toMatchObject({
      kind: 'rate-limit',
      resetsAt: 1_794_469_600_000,
    })
  })

  it('refuses, without an error code, a picture Codex failed for another reason', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        itemCompleted(
          threadId,
          imageItem({ status: 'failed', result: '', failure: { type: 'contentPolicy' } }),
        ),
        turnCompleted(threadId),
      ]),
    })
    const outcome = await generateCodexImage(call())
    expect(outcome).toMatchObject({ kind: 'refused' })
    expect((outcome as { message: string }).message).toContain('contentPolicy')
  })

  it('refuses, without an error code, a turn that failed for another reason', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        turnCompleted(threadId, 'failed', { message: 'The model refused the request' }),
      ]),
    })
    const outcome = await generateCodexImage(call())
    expect(outcome).toMatchObject({ kind: 'refused' })
    expect((outcome as { message: string }).message).toContain('The model refused the request')
  })

  it('reports signed out on a turn Codex rejected for the login', async () => {
    harness({
      'turn/start': turnSends((threadId) => [
        turnCompleted(threadId, 'failed', {
          message: 'Unauthorized',
          codexErrorInfo: 'unauthorized',
        }),
      ]),
    })
    expect(await failure(generateCodexImage(call()))).toMatchObject({ kind: 'signed-out' })
  })
})

describe('Codex image: no picture', () => {
  const noPicture: FakeHandler = turnSends((threadId) => [
    agentMessage(threadId, 'I cannot draw pictures in this session, sorry.'),
    turnCompleted(threadId),
  ])

  it('on the free plan: unavailable, the plan has no image tool', async () => {
    harness({ 'account/read': () => FREE, 'turn/start': noPicture })
    const outcome = await generateCodexImage(call())
    expect(outcome).toMatchObject({ kind: 'unavailable', reason: 'free-plan' })
    expect((outcome as { message: string }).message).toMatch(/Plus/)
  })

  it('on a paid plan: refused, with a short piece of what Codex said', async () => {
    harness({ 'turn/start': noPicture })
    const outcome = await generateCodexImage(call())
    expect(outcome).toMatchObject({ kind: 'refused' })
    expect((outcome as { message: string }).message).toContain('I cannot draw pictures')
  })

  it('does not look at the plan when a picture came', async () => {
    harness({ 'account/read': () => FREE })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image' })
  })
})

describe('Codex image: before any thread', () => {
  it.each([
    ['an API key', { account: { type: 'apiKey' }, requiresOpenaiAuth: true }],
    ['an unknown login', { account: { type: 'somethingElse' }, requiresOpenaiAuth: true }],
    ['another model provider', { account: null, requiresOpenaiAuth: false }],
  ])('is unavailable on %s, which is not a subscription', async (_label, account) => {
    const h = harness({ 'account/read': () => account })
    expect(await generateCodexImage(call())).toMatchObject({
      kind: 'unavailable',
      reason: 'not-subscription',
    })
    expect(h.child().methods()).not.toContain('thread/start')
  })

  it('reports a signed-out Codex', async () => {
    const h = harness({ 'account/read': () => ({ account: null, requiresOpenaiAuth: true }) })
    const error = await failure(generateCodexImage(call()))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({ kind: 'signed-out', provider: 'codex' })
    expect(h.child().methods()).not.toContain('thread/start')
  })

  it('reports a Codex older than the floor as needing an update', async () => {
    const h = harness({
      initialize: () => ({ userAgent: 'codex_cli_rs/0.165.9 (Windows 10.0.26200; x86_64)' }),
    })
    const error = await failure(generateCodexImage(call()))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({ kind: 'needs-update', provider: 'codex' })
    expect(h.child().methods()).not.toContain('thread/start')
  })

  it('goes on with a Codex whose version it cannot read', async () => {
    harness({ initialize: () => ({ userAgent: 'something' }) })
    expect(await generateCodexImage(call())).toMatchObject({ kind: 'image' })
  })

  it('reports a missing program as not installed', async () => {
    harness({
      initialize: (_params, child) => {
        queueMicrotask(() =>
          child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
        )
        return NO_REPLY
      },
    })
    expect(await failure(generateCodexImage(call()))).toMatchObject({ kind: 'not-installed' })
  })

  it('is unavailable while Codex is off in this app, without starting it', async () => {
    const h = harness()
    expect(await generateCodexImage(call({ codexOff: true }))).toMatchObject({
      kind: 'unavailable',
      reason: 'off',
    })
    notifySubscriptionOffChange({ provider: 'codex', off: true })
    try {
      expect(await generateCodexImage(call())).toMatchObject({
        kind: 'unavailable',
        reason: 'off',
      })
    } finally {
      notifySubscriptionOffChange({ provider: 'codex', off: false })
    }
    expect(h.children).toHaveLength(0)
  })
})

describe('Codex image: cancel and timeout', () => {
  const hanging: FakeHandler = () => ({ turn: { id: 't1' } })

  it('interrupts the turn on cancel and removes the thread and its folder', async () => {
    const h = harness({ 'turn/start': hanging })
    const controller = new AbortController()
    const pending = failure(
      generateCodexImage(
        call({
          signal: controller.signal,
          references: [{ bytes: new Uint8Array(PNG), mime: 'image/png' }],
        }),
      ),
    )
    while (!h.children[0]?.methods().includes('turn/start')) await settle()
    const dir = threadDir(h.child())
    expect(existsSync(dir)).toBe(true)
    controller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
    await settle()
    const child = h.child()
    expect(child.paramsOf('turn/interrupt')).toEqual({ threadId: 'th-img', turnId: 't1' })
    expect(child.paramsOf('thread/delete')).toEqual({ threadId: 'th-img' })
    expect(existsSync(dir)).toBe(false)
    // a cancelled call leaves no process behind once nothing else uses it
    expect(h.treeKills).toEqual([child])
  })

  it('does not start Codex for a call cancelled before it began', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort()
    expect(await failure(generateCodexImage(call({ signal: controller.signal })))).toMatchObject({
      name: 'AbortError',
    })
    expect(h.children).toHaveLength(0)
  })

  it('times out, interrupts the turn and cleans up', async () => {
    const h = harness({ 'turn/start': hanging })
    const error = await failure(generateCodexImage(call({ timeoutMs: 50 })))
    expect(error).toBeInstanceOf(AiRunError)
    expect(error).toMatchObject({ kind: 'timeout', provider: 'codex' })
    await settle()
    const child = h.child()
    expect(child.methods()).toContain('turn/interrupt')
    expect(child.paramsOf('thread/delete')).toEqual({ threadId: 'th-img' })
    expect(existsSync(threadDir(child))).toBe(false)
  })
})

describe('Codex chat threads keep the image tool off', () => {
  it('in the chat thread parameters, in both permission modes', () => {
    const config = { apiKey: '', model: 'gpt-x' }
    for (const mode of ['profile', 'read-only'] as const) {
      const params = codexThreadStartParams(config, '/tmp/x', mode)
      expect(params.config).toMatchObject({
        features: {
          hooks: false,
          plugins: false,
          apps: false,
          memories: false,
          image_generation: false,
        },
      })
    }
  })

  it('in the thread a chat run starts, and in the process it runs in', async () => {
    const answer = JSON.stringify({ text: 'hello', toolCalls: [] })
    const h = harness({
      'turn/start': turnSends((threadId) => [
        agentMessage(threadId, answer),
        turnCompleted(threadId),
      ]),
    })
    await streamCodexAppServer(
      { apiKey: '', model: 'gpt-x' },
      'system',
      [{ role: 'user', text: 'draw a cat' }],
      [],
      1024,
      {
        signal: new AbortController().signal,
        onDelta: () => undefined,
        onToolCall: () => undefined,
      },
    )
    const thread = h.child().paramsOf('thread/start')!
    expect(thread.config).toMatchObject({ features: { image_generation: false } })
    expect(String(thread.baseInstructions)).not.toMatch(/image generation tool/)
    expect(h.spawns[0]!.args).toContain('features.image_generation=false')
  })
})
