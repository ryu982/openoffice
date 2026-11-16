/**
 * The `model` a generate_image request names, judged against the route the
 * request already started on. The route (Codex or which key provider) is
 * always the settings' choice (tool-routing.ts); a model name never moves a
 * request to another route, since a key provider costs money per picture.
 *
 * Every refusal is decided before a Codex turn or a key request starts, so a
 * name nobody can serve spends no allowance. Names are compared trimmed and
 * without case, and the listed spelling is the one that is used.
 */
import {
  AI_MEDIA_PROVIDERS,
  getMediaProviderMeta,
  providerHasCapability,
  type AiMediaKeyProviderId,
  type AiMediaProviderConfig,
} from '@genoffice/ai-provider'

export type ImageModelChoice =
  /** no name: the model of the settings, as before */
  | { kind: 'configured' }
  /** run this request on this model, in its listed spelling */
  | { kind: 'use'; model: string }
  /** Codex route with a `gpt-image` name: Codex chooses its image model itself */
  | { kind: 'codex-picks'; note: string }
  /** no request starts; the sentence is for the model */
  | { kind: 'refuse'; message: string }

const CODEX_ROUTE_LABEL = 'the ChatGPT plan through Codex'

export const CODEX_PICKS_IMAGE_MODEL_NOTE =
  'Codex picks its own image model on this route (the ChatGPT plan through Codex), so the named image model was not passed on.'

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function listed(name: string, models: readonly string[]): string | undefined {
  return models.find((model) => same(model, name))
}

function modelsSentence(route: string, models: readonly string[]): string {
  return models.length > 0
    ? ` Models the current image route (${route}) can use: ${models.join(', ')}.`
    : ` The current image route (${route}) lists no models to choose from.`
}

/** The key provider whose catalog lists `name`, other than `except` */
function catalogOwner(name: string, except?: AiMediaKeyProviderId): string | undefined {
  const owner = AI_MEDIA_PROVIDERS.find(
    (meta) =>
      meta.id !== except &&
      providerHasCapability(meta, 'image') &&
      listed(name, meta.imageModels) !== undefined,
  )
  return owner?.label
}

function otherProvider(name: string, owner: string, route: string, models: readonly string[]) {
  return {
    kind: 'refuse' as const,
    message:
      `The image model "${name}" belongs to ${owner}, which is not the image route in use, so no image was made.` +
      ' The image provider is changed under Settings > AI > Advanced.' +
      modelsSentence(route, models),
  }
}

function unknownModel(name: string, route: string, models: readonly string[]) {
  return {
    kind: 'refuse' as const,
    message:
      `The image model "${name}" is not available on the current image route, so no image was made.` +
      modelsSentence(route, models),
  }
}

/** The model name a request carries, trimmed; empty when it names none */
export function requestedImageModel(model: unknown): string {
  return typeof model === 'string' ? model.trim() : ''
}

/**
 * A key route: the provider's catalog models and the image model stored for
 * it are served; another provider's catalog model and an unknown name are not.
 */
export function keyImageModelChoice(
  name: string,
  provider: AiMediaKeyProviderId,
  config: AiMediaProviderConfig,
): ImageModelChoice {
  if (!name) return { kind: 'configured' }
  const meta = getMediaProviderMeta(provider)
  const stored = config.imageModel?.trim()
  const own = [...new Set([...(stored ? [stored] : []), ...(meta?.imageModels ?? [])])]
  const match = listed(name, own)
  if (match) return { kind: 'use', model: match }
  const route = meta?.label ?? provider
  const owner = catalogOwner(name, provider)
  return owner ? otherProvider(name, owner, route, own) : unknownModel(name, route, own)
}

/** A `gpt-image` name on the Codex route is drawn, with Codex choosing the image model */
export function codexPicksImageModel(name: string): boolean {
  return name.toLowerCase().startsWith('gpt-image')
}

/**
 * The Codex route, given the models Codex lists (`model/list`): a listed
 * model runs the picture thread; a key provider's catalog model and an
 * unknown name are refused with the Codex list. The `gpt-image` row is judged
 * first by the caller (`codexPicksImageModel`), so no list is read for it.
 */
export function codexImageModelChoice(name: string, models: readonly string[]): ImageModelChoice {
  if (!name) return { kind: 'configured' }
  if (codexPicksImageModel(name)) return { kind: 'codex-picks', note: CODEX_PICKS_IMAGE_MODEL_NOTE }
  const match = listed(name, models)
  if (match) return { kind: 'use', model: match }
  const owner = catalogOwner(name)
  return owner
    ? otherProvider(name, owner, CODEX_ROUTE_LABEL, models)
    : unknownModel(name, CODEX_ROUTE_LABEL, models)
}
