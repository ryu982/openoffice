/**
 * The Codex image generator the app's main process and the command-line
 * process register (`registerCodexImageGenerator`): one picture through the
 * Codex subscription, made by `generateCodexImage` in a disposable thread of
 * the app's `codex app-server` client (`@genoffice/ai-provider/codex-image`).
 *
 * Every call reads `ai-settings.json` again for the Codex program
 * (`providers.codex.cliPath`), the Codex model (`providers.codex.model`) and
 * whether Codex is turned off in this app (decision 0114). Creating the
 * generator starts nothing, and neither does registering it; Codex starts
 * only when a request on the Codex route calls it. No login file is read here
 * or in the call it makes.
 */
import {
  generateCodexImage,
  listCodexModels,
  subscriptionOffIn,
  type AiSettings,
  type AiSubscriptionUsage,
} from '@genoffice/ai-provider'
import type { CodexImageGenerator } from './codex-image-generator'
import { readAiSettingsFile } from './media-tools'

export interface CodexImageGeneratorOptions {
  /** `ai-settings.json`, read on every call */
  settingsPath(): string
  /**
   * The usage windows Codex reports while it makes a picture. The app passes
   * one to update the usage line of its AI panes; the command line passes
   * none (its automatic calls keep to the ledger).
   */
  onUsage?: ((usage: AiSubscriptionUsage[]) => void) | undefined
  /** injected in tests; the real one runs the app-server client */
  generate?: typeof generateCodexImage
  /** injected in tests; the real one asks the app-server client for `model/list` */
  listModels?: typeof listCodexModels
}

function codexProgram(settings: AiSettings): string | undefined {
  return settings.providers.codex?.cliPath?.trim() || undefined
}

export function createCodexImageGenerator(
  options: CodexImageGeneratorOptions,
): CodexImageGenerator {
  const generate = options.generate ?? generateCodexImage
  const listModels = options.listModels ?? listCodexModels
  return {
    async generate(request) {
      const settings = readAiSettingsFile(options.settingsPath())
      return generate({
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        imageSize: request.imageSize,
        transparent: request.transparent,
        references: request.references,
        model: request.model,
        configuredModel: settings.providers.codex?.model?.trim() ?? '',
        cliPath: codexProgram(settings),
        codexOff: subscriptionOffIn(settings, 'codex'),
        signal: request.signal,
        onUsage: options.onUsage,
      })
    },
    async models() {
      const settings = readAiSettingsFile(options.settingsPath())
      // decision 0114: a Codex turned off in this app is not started, not even for its list
      if (subscriptionOffIn(settings, 'codex')) return null
      return (await listModels(codexProgram(settings))).models
    },
  }
}
