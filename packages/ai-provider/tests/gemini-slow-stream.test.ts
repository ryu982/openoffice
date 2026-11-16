import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { GEMINI_TAIL_AFTER_CALLS_MS } from '../src/protocols/gemini'
import { streamForProvider } from '../src/stream'
import { AI_CHAT_RESPONSE_TIMEOUT_MS, AI_CONNECT_TIMEOUT_MS, AiTimeoutError } from '../src/watchdog'

/**
 * The Gemini free tier, measured on gemini-4-hydrogen (2026-11-15): the
 * response headers come with the first chunk, 18 to 90 s after the request,
 * and the last chunk (an empty text part with the finishReason) came up to
 * 301 s after the chunk that carried the whole function call. The connect
 * phase therefore waits like a non-streaming call, and silence after a
 * delivered call ends the turn with that call.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const CALL_CHUNK = `data: ${JSON.stringify({
  candidates: [{ content: { parts: [{ functionCall: { name: 'edit', args: { at: 'p1' } } }] } }],
  usageMetadata: { promptTokenCount: 14433, candidatesTokenCount: 29 },
})}\n\n`
const TEXT_CHUNK = `data: ${JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'Half an answ' }] } }],
})}\n\n`

/** a fetch whose response never arrives; the request fails when its signal aborts */
function hangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    ),
  )
}

/** a fetch that answers with `chunks` and then keeps the stream open until aborted */
function stallingFetch(chunks: string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          init.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }),
  )
}

function run(signal = new AbortController().signal) {
  const toolCalls: AgentToolCall[] = []
  const usage: unknown[] = []
  let settled: { ok: true } | { ok: false; error: unknown } | undefined
  const done = streamForProvider(
    'gemini',
    { apiKey: 'k', model: 'gemini-4-hydrogen' },
    'sys',
    [{ role: 'user', text: 'edit the document' }],
    [{ name: 'edit', description: 'edit', inputSchema: { type: 'object', properties: {} } }],
    1000,
    {
      signal,
      onDelta: () => undefined,
      onToolCall: (call) => toolCalls.push(call),
      onUsage: (u) => usage.push(u),
    },
  ).then(
    () => {
      settled = { ok: true }
    },
    (error: unknown) => {
      settled = { ok: false, error }
    },
  )
  return { toolCalls, usage, done, settled: () => settled }
}

describe('Gemini stream on a slow free tier', () => {
  it('waits past the streaming connect timeout for the first chunk', async () => {
    hangingFetch()
    const turn = run()

    await vi.advanceTimersByTimeAsync(AI_CONNECT_TIMEOUT_MS + 30_000)
    expect(turn.settled()).toBeUndefined()

    await vi.advanceTimersByTimeAsync(AI_CHAT_RESPONSE_TIMEOUT_MS - AI_CONNECT_TIMEOUT_MS - 30_000)
    await turn.done
    expect(turn.settled()).toMatchObject({ ok: false })
    const settled = turn.settled()
    expect(settled && !settled.ok && settled.error).toBeInstanceOf(AiTimeoutError)
  })

  it('ends the turn with a delivered call when the finish chunk does not come', async () => {
    stallingFetch([CALL_CHUNK])
    const turn = run()

    await vi.advanceTimersByTimeAsync(GEMINI_TAIL_AFTER_CALLS_MS - 1)
    expect(turn.settled()).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    await turn.done
    expect(turn.settled()).toEqual({ ok: true })
    expect(turn.toolCalls.map((c) => [c.name, c.input])).toEqual([['edit', { at: 'p1' }]])
    expect(turn.usage).toEqual([{ inputTokens: 14433, outputTokens: 29 }])
  })

  it('still fails a stream that stalls in the middle of a text answer', async () => {
    stallingFetch([TEXT_CHUNK])
    const turn = run()

    await vi.advanceTimersByTimeAsync(GEMINI_TAIL_AFTER_CALLS_MS * 2)
    expect(turn.settled()).toBeUndefined()

    await vi.runOnlyPendingTimersAsync()
    await turn.done
    const settled = turn.settled()
    expect(settled && !settled.ok && settled.error).toBeInstanceOf(AiTimeoutError)
  })

  it('reports a stop pressed while waiting after a call as a failure, not a finished turn', async () => {
    stallingFetch([CALL_CHUNK])
    const stop = new AbortController()
    const turn = run(stop.signal)

    await vi.advanceTimersByTimeAsync(GEMINI_TAIL_AFTER_CALLS_MS / 2)
    stop.abort()
    await vi.advanceTimersByTimeAsync(0)
    await turn.done
    expect(turn.settled()).toMatchObject({ ok: false })
  })
})
