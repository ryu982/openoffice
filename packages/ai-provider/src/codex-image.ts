/**
 * Image generation through the Codex subscription. Entry point
 * `@genoffice/ai-provider/codex-image`.
 *
 * `generateCodexImage` makes one picture in a disposable thread of the app's
 * `codex app-server` process (see `codex-app-server.ts`), and `listCodexModels`
 * gives the models a request may name. Loading this entry turns nothing on:
 * `codexImageGenerationAvailable()` stays off until the process that registers
 * a generator (the app's main process, the command-line process) turns it on.
 */
export { generateCodexImage, listCodexModels } from './codex-app-server'
export {
  CODEX_IMAGE_MAX_BYTES,
  CODEX_IMAGE_MIN_VERSION,
  CODEX_IMAGE_TIMEOUT_MS,
} from './codex-image-parts'
export type { CodexImageCall, CodexImageOutcome, CodexImageReference } from './codex-image-parts'
