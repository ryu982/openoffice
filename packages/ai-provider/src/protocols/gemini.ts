import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import { aiFetch } from '../fetch'
import { httpBodyDetail } from '../http-error'
import { opencodeSessionHeaders } from '../providers'
import type { AiChatResponse, AiProviderConfig, AiTokenUsage } from '../types'
import { AI_CHAT_RESPONSE_TIMEOUT_MS, createStreamWatchdog, type StreamWatchdog } from '../watchdog'
import { toGeminiSchema } from './gemini-schema'
import {
  endpointUrl,
  isPlainObject,
  jsonBodyInsteadOfSse,
  readCappedResponseText,
  sseErrorText,
  sseDataEvents,
  throwIfCreditsNotice,
  throwIfToolCountOverBudget,
  usageCount,
  type StreamCallbacks,
} from './shared'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiUsage {
  promptTokenCount?: unknown
  candidatesTokenCount?: unknown
  cachedContentTokenCount?: unknown
}

/** Merge a Gemini usageMetadata object into an accumulator (every stream chunk carries
 * one; the last chunk's counts are the turn's totals). */
function mergeGeminiUsage(target: AiTokenUsage, usage: GeminiUsage | undefined): void {
  if (!usage) return
  const input = usageCount(usage.promptTokenCount)
  const output = usageCount(usage.candidatesTokenCount)
  const cached = usageCount(usage.cachedContentTokenCount)
  if (input !== undefined) target.inputTokens = input
  if (output !== undefined) target.outputTokens = output
  if (cached !== undefined) target.cacheReadTokens = cached
}

// Gemini 3 rejects a model turn whose first functionCall lacks its thoughtSignature;
// calls that never had one (other provider's history) go back with Google's bypass sentinel.
const SKIP_SIGNATURE = 'skip_thought_signature_validator'

interface GeminiPart {
  text?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
  thoughtSignature?: string
  /** snake_case spelling some gateways forward verbatim */
  thought_signature?: string
}

function geminiToolCall(part: GeminiPart): AgentToolCall {
  const signature = part.thoughtSignature ?? part.thought_signature
  const args: unknown = part.functionCall?.args
  const inputError =
    args === undefined || isPlainObject(args)
      ? undefined
      : `tool input must be a JSON object; raw: ${JSON.stringify(args).slice(0, 500)}`
  return {
    id: crypto.randomUUID(),
    name: part.functionCall?.name ?? '',
    input: isPlainObject(args) ? args : {},
    ...(inputError ? { inputError } : {}),
    ...(signature ? { signature } : {}),
  }
}

function geminiContents(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user') {
      if (!m.images?.length) return { role: 'user', parts: [{ text: m.text }] }
      return {
        role: 'user',
        parts: [
          ...(m.text ? [{ text: m.text }] : []),
          ...m.images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
        ],
      }
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const [i, call] of (m.toolCalls ?? []).entries()) {
        const signature = call.signature ?? (i === 0 ? SKIP_SIGNATURE : undefined)
        parts.push({
          functionCall: { name: call.name, args: call.input },
          ...(signature ? { thoughtSignature: signature } : {}),
        })
      }
      // Gemini rejects model turns with empty parts lists.
      if (parts.length === 0) parts.push({ text: '(no content)' })
      return { role: 'model', parts }
    }
    return {
      role: 'user',
      parts: m.results.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.output } : { result: r.output },
        },
      })),
    }
  })
}

/**
 * Emits a complete (non-streamed) Gemini response delivered as a plain JSON body.
 * `streamGenerateContent` without SSE framing yields an array of chunks; a gateway
 * may also send a single `generateContent`-shaped object — handle both.
 */
function emitGeminiJsonMessage(bodyText: string, cb: StreamCallbacks): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new Error(`Gemini returned an unparseable JSON body: ${httpBodyDetail(bodyText)}`)
  }
  const events = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
    candidates?: Array<{
      content?: { parts?: GeminiPart[] }
      finishReason?: string
    }>
    promptFeedback?: { blockReason?: string }
    usageMetadata?: GeminiUsage
    error?: { message?: string } | string
  }>
  let emitted = false
  let toolCallCount = 0
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  const usage: AiTokenUsage = {}
  for (const event of events) {
    if (event.error) throw new Error(sseErrorText(event.error, 'Gemini error'))
    if (event.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
    }
    mergeGeminiUsage(usage, event.usageMetadata)
    const finishReason = event.candidates?.[0]?.finishReason
    if (finishReason === 'MAX_TOKENS') stopReason = 'max_tokens'
    else if (finishReason && finishReason !== 'STOP') abnormalFinish = finishReason
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) {
        emitted = true
        cb.onDelta(part.text)
      }
      if (part.functionCall?.name) {
        emitted = true
        // A complete JSON body carries the whole turn at once, so the per-turn
        // tool budget of the streamed path has to be applied here as well
        throwIfToolCountOverBudget(++toolCallCount, 'gemini')
        cb.onToolCall(geminiToolCall(part))
      }
    }
  }
  if (!emitted) {
    throw new Error(
      abnormalFinish
        ? `Gemini returned no content (finishReason=${abnormalFinish})`
        : `Gemini returned no content: ${httpBodyDetail(bodyText)}`,
    )
  }
  if (stopReason) cb.onStopReason?.(stopReason)
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) cb.onUsage?.(usage)
}

/** Per-endpoint request shaping resolved from the provider registry. */
export interface GeminiRequestOptions {
  omitTemperature?: boolean | undefined
}

/**
 * How long a stream may stay silent after it delivered a function call before
 * the turn is taken as done. Gemini sends each call whole; what follows it is
 * a chunk with an empty text part and the finishReason. On the free tier that
 * last chunk came 0.3 to 22 s after the call, and once 301 s (2026-11-15,
 * gemini-4-hydrogen), which tripped the idle timeout and failed a turn whose
 * call had already arrived.
 */
export const GEMINI_TAIL_AFTER_CALLS_MS = 30_000

export async function streamGemini(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  baseUrl = GEMINI_BASE_URL,
  options: GeminiRequestOptions = {},
): Promise<void> {
  // The response headers of streamGenerateContent come with the first chunk,
  // so the connect phase waits for the model as a non-streaming call does: the
  // free tier took 18 to 90 s to send it (2026-11-15, gemini-4-hydrogen).
  const wd = createStreamWatchdog(cb.signal, AI_CHAT_RESPONSE_TIMEOUT_MS)
  return wd.guard(() =>
    geminiTurn(config, system, messages, tools, maxTokens, cb, baseUrl, wd, options),
  )
}

async function geminiTurn(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  baseUrl: string,
  wd: StreamWatchdog,
  options: GeminiRequestOptions,
): Promise<void> {
  // ends the read when the stream goes silent after a call (GEMINI_TAIL_AFTER_CALLS_MS)
  const tail = new AbortController()
  let tailTimer: ReturnType<typeof setTimeout> | undefined
  const armTail = () => {
    clearTimeout(tailTimer)
    tailTimer = setTimeout(() => tail.abort(), GEMINI_TAIL_AFTER_CALLS_MS)
  }
  const onBytes = () => {
    wd.touch()
    cb.onActivity?.()
    if (tailTimer !== undefined) armTail()
  }
  const url = endpointUrl(baseUrl, `models/${config.model}:streamGenerateContent`, '?alt=sse')
  const response = await aiFetch(url, {
    method: 'POST',
    signal: AbortSignal.any([wd.signal, tail.signal]),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...opencodeSessionHeaders(baseUrl, cb.sessionId),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: geminiContents(messages),
      ...(tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  // JSON Schema constructs the Gemini proto lacks (type unions,
                  // $ref, ...) fail the whole request with HTTP 400
                  parameters: toGeminiSchema(t.inputSchema),
                })),
              },
            ],
          }
        : {}),
      // Google recommends the default temperature (1.0) for the Gemini 3
      // family — lower values may cause looping or degraded reasoning —
      // so omit our hard-coded 0.3 for those models via omitTemperature.
      generationConfig: {
        ...(options.omitTemperature ? {} : { temperature: 0.3 }),
        maxOutputTokens: maxTokens,
      },
    }),
  })
  // headers arrived: ping the renderer watchdog too, or a slow first chunk could trip it
  onBytes()
  if (!response.ok || !response.body) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${httpBodyDetail(await readCappedResponseText(response, onBytes))}`,
    )
  }
  const jsonBody = await jsonBodyInsteadOfSse(response, onBytes)
  if (jsonBody !== null) {
    throwIfCreditsNotice(jsonBody)
    return emitGeminiJsonMessage(jsonBody, cb)
  }
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  let sawFinish = false
  let emitted = false
  let toolCallCount = 0
  const turnUsage: AiTokenUsage = {}
  try {
    for await (const sse of sseDataEvents(response.body, onBytes)) {
      // A truncated frame or a non-JSON keep-alive from a proxy skips that event
      // rather than killing the turn.
      if (sse.json === undefined) continue
      const event = sse.json as {
        candidates?: Array<{
          content?: { parts?: GeminiPart[] }
          finishReason?: string
        }>
        promptFeedback?: { blockReason?: string }
        usageMetadata?: GeminiUsage
        error?: { message?: string } | string
      }
      if (event.error) throw new Error(sseErrorText(event.error, 'Gemini stream error'))
      if (event.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
      }
      // every chunk carries usageMetadata; later chunks supersede earlier ones
      mergeGeminiUsage(turnUsage, event.usageMetadata)
      const finishReason = event.candidates?.[0]?.finishReason
      if (finishReason) sawFinish = true
      if (finishReason === 'MAX_TOKENS') stopReason = 'max_tokens'
      else if (finishReason && finishReason !== 'STOP') abnormalFinish = finishReason
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          emitted = true
          cb.onDelta(part.text)
        }
        // Gemini emits function calls whole, never as partial JSON
        if (part.functionCall?.name) {
          throwIfToolCountOverBudget(++toolCallCount, 'gemini')
          emitted = true
          cb.onToolCall(geminiToolCall(part))
          armTail()
        }
      }
    }
  } catch (e) {
    // silence after a whole call ends the turn with that call; any other abort is a failure
    if (!tail.signal.aborted) throw e
  } finally {
    clearTimeout(tailTimer)
  }
  // A safety/recitation stop that produced nothing, or a stream with no message
  // framing at all (gateway soft-failure), would otherwise look like an empty
  // success; a genuine empty turn still carries finishReason=STOP and passes
  if (!emitted && abnormalFinish) {
    throw new Error(`Gemini returned no content (finishReason=${abnormalFinish})`)
  }
  if (!emitted && !sawFinish) {
    throw new Error('Gemini returned no content (empty stream)')
  }
  if (!sawFinish && !tail.signal.aborted) {
    throw new Error('Gemini stream ended before a finishReason')
  }
  if (stopReason) cb.onStopReason?.(stopReason)
  if (turnUsage.inputTokens !== undefined || turnUsage.outputTokens !== undefined)
    cb.onUsage?.(turnUsage)
}

export async function chatGemini(
  wd: StreamWatchdog,
  config: AiProviderConfig,
  system: string,
  user: string,
  baseUrl = GEMINI_BASE_URL,
  options: GeminiRequestOptions = {},
): Promise<AiChatResponse> {
  const url = endpointUrl(baseUrl, `models/${config.model}:generateContent`)
  const response = await aiFetch(url, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...opencodeSessionHeaders(baseUrl),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { ...(options.omitTemperature ? {} : { temperature: 0.3 }) },
    }),
  })
  wd.touch()
  if (!response.ok) {
    return {
      ok: false,
      error: `Gemini HTTP ${response.status}: ${httpBodyDetail(await readCappedResponseText(response, () => wd.touch()))}`,
    }
  }
  // A 200 with an HTML shell / empty / truncated body (gateway soft-failure)
  // would make response.json() throw; return ok:false instead of leaking a
  // raw SyntaxError to the caller.
  const bodyText = await readCappedResponseText(response, () => wd.touch())
  let json: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  try {
    json = JSON.parse(bodyText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
  } catch {
    return {
      ok: false,
      error: `Gemini returned a non-JSON response: ${httpBodyDetail(bodyText)}`,
    }
  }
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!content) return { ok: false, error: 'Gemini returned an empty response' }
  return { ok: true, content }
}
