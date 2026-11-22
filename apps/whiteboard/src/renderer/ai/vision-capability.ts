/**
 * Determines whether the currently active AI model can accept a PNG image of
 * the whiteboard page alongside the `<whiteboard_page>` text table.
 */
import { localModelCapabilities, type AiSettings } from '@genoffice/ai-provider/browser'

const VISION_CAPABLE_PROVIDERS = new Set<string>([
  'auto',
  'claude-subscription',
  'codex-subscription',
  'chatgpt-subscription',
  'anthropic',
  'openai',
  'google',
  'gemini',
])

export function modelSupportsVision(settings: AiSettings | null | undefined): boolean {
  if (!settings) return false
  const caps = localModelCapabilities(settings)
  if (caps.vision !== undefined) return caps.vision
  if (settings.provider === 'custom') {
    const endpoint = settings.customEndpoints?.find((e) => e.id === settings.customEndpoint)
    if (endpoint?.kind === 'local') {
      // Conservative default for local endpoints without an explicit vision capability flag.
      return false
    }
    return false
  }
  return VISION_CAPABLE_PROVIDERS.has(settings.provider)
}
