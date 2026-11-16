/**
 * The pieces of a Codex image call that hold no process: what the call takes
 * and gives back, the request text, and how the returned bytes are read. The
 * run itself is `generateCodexImage` in `codex-app-server.ts`, which owns the
 * app-server client.
 */
import { PRODUCT_NAME } from '@genoffice/i18n'
import type { AiSubscriptionUsage } from './types'

/**
 * The oldest Codex that puts the picture itself in the `imageGeneration`
 * item (`result`, base64). Confirmed with codex-cli 0.166.0 on 2026-11-14; no
 * older release was checked, so this is the floor.
 */
export const CODEX_IMAGE_MIN_VERSION = '0.166.0'

/** How long one picture may take, from the start of the call to the end of its turn */
export const CODEX_IMAGE_TIMEOUT_MS = 300_000

/** The largest picture taken back */
export const CODEX_IMAGE_MAX_BYTES = 25 * 1024 * 1024

/** A picture the request edits or follows, as bytes the caller already loaded and checked */
export interface CodexImageReference {
  bytes: Uint8Array
  mime: string
}

export interface CodexImageCall {
  /** the prompt as the tool received it; passed on character for character */
  prompt: string
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string | undefined
  /** auto | 0.5k | 1k | 2k | 3k | 4k */
  imageSize?: string | undefined
  /** the caller needs real alpha; an opaque picture is then refused */
  transparent?: boolean | undefined
  /** pictures to edit or follow; written to the call's temp folder, the only user path the thread may read */
  references?: readonly CodexImageReference[] | undefined
  /** a Codex model the caller already matched against `listCodexModels` (rule D); wins over the setting */
  model?: string | undefined
  /** the Codex model of the settings (`providers.codex.model`); empty runs Codex's listed default */
  configuredModel?: string | undefined
  /** the Codex program of the settings; empty finds the installed one */
  cliPath?: string | undefined
  /** Codex is turned off in this app (decision 0114), as the caller's settings say */
  codexOff?: boolean | undefined
  /** the caller cancels (the person stopped, the window closed) */
  signal?: AbortSignal | undefined
  /** the usage windows Codex reports during the call, as a chat turn passes them on */
  onUsage?: ((usage: AiSubscriptionUsage[]) => void) | undefined
  /** defaults to CODEX_IMAGE_TIMEOUT_MS */
  timeoutMs?: number | undefined
  /** defaults to CODEX_IMAGE_MAX_BYTES */
  maxBytes?: number | undefined
}

/**
 * How a call ended, short of a thrown `AiRunError` (rate limit, needs update,
 * not installed, signed out, unsafe tools, timeout) or a cancel (`AbortError`).
 * `refused` carries no error code: Codex ran and made no usable picture.
 */
export type CodexImageOutcome =
  | { kind: 'image'; bytes: Uint8Array; mime: string }
  | {
      kind: 'unavailable'
      reason: 'free-plan' | 'not-subscription' | 'off'
      message: string
    }
  | { kind: 'refused'; message: string }

/** The base instructions of an image thread: one picture with the built-in tool, nothing else */
export const CODEX_IMAGE_INSTRUCTIONS = `You make pictures for ${PRODUCT_NAME}. From the user's request, make exactly one picture with the built-in image generation tool. Use no other tool: never inspect or modify local files, run shell commands, browse, call MCP, or use apps. When the picture is made, reply briefly.`

/** The size the image tool takes for an aspect ratio; it makes these three shapes */
export function codexImageSize(aspectRatio: string | undefined): string {
  switch (aspectRatio?.trim()) {
    case '16:9':
    case '3:2':
    case '4:3':
      return '1536x1024'
    case '9:16':
    case '2:3':
    case '3:4':
      return '1024x1536'
    default:
      return '1024x1024'
  }
}

/** `imageSize` is the app's detail level; the image tool calls the same idea "quality" */
export function codexImageQuality(imageSize: string | undefined): string | undefined {
  switch (imageSize?.trim().toLowerCase()) {
    case '0.5k':
      return 'low'
    case '1k':
      return 'medium'
    case '2k':
    case '3k':
    case '4k':
      return 'high'
    default:
      return undefined
  }
}

/** The text of the turn: the prompt unchanged, then the settings of the picture */
export function codexImagePrompt(call: CodexImageCall, referenceCount: number): string {
  const settings = [`- size: ${codexImageSize(call.aspectRatio)}`]
  const quality = codexImageQuality(call.imageSize)
  if (quality) settings.push(`- quality: ${quality}`)
  if (call.transparent) {
    settings.push('- background: transparent (a real alpha channel, no backdrop, no checkerboard)')
  }
  if (referenceCount > 0) {
    settings.push(
      `- the ${referenceCount === 1 ? 'attached picture is the one' : `${referenceCount} attached pictures are the ones`} to edit or follow, as the request says`,
    )
  }
  return [call.prompt, '', 'Picture settings:', ...settings].join('\n')
}

/** The file name extension a reference is written under */
export function codexReferenceExtension(mime: string): string {
  const subtype = mime.split('/')[1]?.toLowerCase() ?? ''
  if (subtype === 'jpeg' || subtype === 'jpg') return '.jpg'
  if (subtype === 'webp') return '.webp'
  if (subtype === 'gif') return '.gif'
  return '.png'
}

/** The format of picture bytes, from their first bytes; undefined for anything else */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  const at = (index: number) => bytes[index]
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/**
 * The Codex version in the `userAgent` the app-server gives on `initialize`
 * (`<originator>/<version> (<system>) ...`); undefined when it names none.
 */
export function codexVersionOfUserAgent(userAgent: unknown): string | undefined {
  if (typeof userAgent !== 'string') return undefined
  return /^[^/\s]+\/(\d+\.\d+\.\d+)/.exec(userAgent.trim())?.[1]
}

/** A short, single-line piece of what Codex said, for the model */
export function codexImageSnippet(text: string, limit = 300): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= limit ? line : `${line.slice(0, limit - 3)}...`
}
