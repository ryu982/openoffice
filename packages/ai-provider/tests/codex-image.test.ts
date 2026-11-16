/**
 * The Codex image entry point gives the generator and the model list, and
 * loading it turns nothing on: until a process registers a generator and says
 * so, a request that chose Codex goes to a key provider or to "unavailable".
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as codexImage from '../src/codex-image'
import * as entry from '../src/index'
import {
  codexImageGenerationAvailable,
  imageProviderSelection,
  resolveImageBackend,
} from '../src/image-backend'
import { defaultAiMediaSettings } from '../src/media'
import type { AiSubscriptionStatus } from '../src/types'

const source = readFileSync(
  fileURLToPath(new URL('../src/codex-image.ts', import.meta.url)),
  'utf8',
)

const READY: AiSubscriptionStatus = { provider: 'codex', state: 'ready', meteredAccepted: false }

describe('the Codex image entry point', () => {
  it('gives the generator, the model list and the limits, from the package root too', () => {
    expect(Object.keys(codexImage).sort()).toEqual([
      'CODEX_IMAGE_MAX_BYTES',
      'CODEX_IMAGE_MIN_VERSION',
      'CODEX_IMAGE_TIMEOUT_MS',
      'generateCodexImage',
      'listCodexModels',
    ])
    expect(entry.generateCodexImage).toBe(codexImage.generateCodexImage)
    expect(entry.listCodexModels).toBe(codexImage.listCodexModels)
    expect(codexImage.CODEX_IMAGE_TIMEOUT_MS).toBe(300_000)
    expect(codexImage.CODEX_IMAGE_MAX_BYTES).toBe(25 * 1024 * 1024)
  })

  it('declares nothing available when it loads', () => {
    expect(codexImageGenerationAvailable()).toBe(false)
  })

  it('leaves a selected Codex without an image backend, even on a ready subscription', () => {
    const media = defaultAiMediaSettings()
    media.imageProvider = 'codex'
    expect(resolveImageBackend({ media }, { codex: READY })).toEqual({ kind: 'none' })
    expect(imageProviderSelection({ media })).toBe('none')
  })

  it('turns nothing on and names no login file', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/setCodexImageGenerationAvailable/)
    expect(source).not.toMatch(/auth\.json/i)
    expect(source).not.toMatch(/CODEX_HOME/)
  })
})
