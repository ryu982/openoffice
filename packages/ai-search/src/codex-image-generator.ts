/**
 * The slot the Codex subscription image backend registers itself in. This
 * package only routes: it knows when a request goes to Codex, not how Codex
 * makes an image. A process in which nothing registered a generator has no
 * Codex image generation, and its requests go to a key provider or end in
 * "unavailable". The generator the app and the command line register is
 * `createCodexImageGenerator` (codex-image-subscription.ts).
 */

import type { CodexImageOutcome, CodexImageReference } from '@genoffice/ai-provider'

export interface CodexImageRequest {
  /** the prompt as the tool received it, trimmed; any script, never transliterated */
  prompt: string
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string | undefined
  /** auto | 0.5k | 1k | 2k | 3k | 4k */
  imageSize?: string | undefined
  /** the caller wants real alpha (icons, logos, cutouts); an opaque picture is then refused */
  transparent?: boolean | undefined
  /** pictures to edit or follow, already loaded under the media budget and checks */
  references?: readonly CodexImageReference[] | undefined
  /** a Codex model `models()` listed, in its listed spelling; absent runs the configured one */
  model?: string | undefined
  /** aborts when the caller cancels; the generator must end the turn and clean up */
  signal?: AbortSignal | undefined
}

/** How one Codex picture ended; anything else is thrown (`AiRunError`, or an `AbortError` on cancel) */
export type CodexImageResult = CodexImageOutcome

export interface CodexImageGenerator {
  /** makes one picture */
  generate(request: CodexImageRequest): Promise<CodexImageResult>
  /**
   * The Codex models a request may name (Codex's `model/list`, not a model
   * call); null when Codex is turned off in this app, so nothing is started.
   */
  models(): Promise<readonly string[] | null>
}

let generator: CodexImageGenerator | null = null

/** Called once by the process that can run the Codex image backend; `null` takes it out again. */
export function registerCodexImageGenerator(next: CodexImageGenerator | null): void {
  generator = next
}

export function codexImageGenerator(): CodexImageGenerator | null {
  return generator
}
