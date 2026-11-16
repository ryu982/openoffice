/**
 * Picture search, generation and understanding for the Hangul editor's AI panel: the
 * channels the renderer calls to bring a picture into the document or to ask what one in
 * the document shows.
 *
 * The bytes are the renderer's business (it hands them to the editor plugin, which inserts
 * them inside one change); this side only reaches the network or the configured reader.
 * `generateImageTool` and `analyzeMediaTool` are the shared tools with the process-wide
 * subscription statuses, and `fetchImageBytes` reads a web address or the file the
 * generator wrote into its own store — that store is the only `file://` it answers.
 *
 * The channels are this editor's own (`hwp:`); the shared `ai:*` and subscription channels
 * belong to the docs main and are never registered here.
 */
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  abortMediaCalls,
  analyzeMediaTool,
  documentMediaRoots,
  generateImageTool,
  withMediaCallSignal,
  type MediaCallSender,
} from '@genoffice/ai-search'
import { sharedSubscriptionStatuses } from '@genoffice/ai-provider/subscription'
import { fetchImageBytes } from '@genoffice/electron-utils/fetch-image-bytes'
import { registerAiJob } from '@genoffice/electron-utils/ai-activity'
import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'
import { aiFeaturesOn } from '@genoffice/electron-utils/app-choice'
import { HWP_CHANNELS } from '../shared/ipc'

export interface HwpImageIpcOptions {
  /** the file this view has open (or saves to); null for an untitled document */
  filePathOf(webContentsId: number): string | null
}

const SETTINGS_PATH = (): string => join(app.getPath('userData'), 'ai-settings.json')

/** what a refused call says when the shell gave no words of its own */
const AI_OFF_REFUSAL = 'AI features are turned off in Settings.'

/** a screen's picture call while AI is off in Settings: the refusal it gets (else null) */
function aiOffRefusal(senderId: number): string | null {
  if (aiFeaturesOn()) return null
  // the shell's "ai-off" check words it; the provider plays no part in that check
  return aiRunRefusal({ senderId, provider: '', model: '' }) ?? AI_OFF_REFUSAL
}

/**
 * Runs one picture call of a screen as a running AI job (it can run a subscription
 * program): counted while it runs, and Settings' "stop all" ends it the way the panel's
 * Stop does, through the call's signal.
 */
async function asAiJob<T>(
  sender: MediaCallSender,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const done = registerAiJob({ kind: 'chat', stop: () => abortMediaCalls(sender.id) })
  try {
    return await withMediaCallSignal(sender, run)
  } finally {
    done()
  }
}

/** Registers the two picture channels. Called once, with the editor's other channels. */
export function registerHwpImageIpc(options: HwpImageIpcOptions): void {
  ipcMain.handle(
    HWP_CHANNELS.aiGenerateImage,
    (e, op: { prompt?: unknown; aspectRatio?: unknown; model?: unknown }) => {
      const refusal = aiOffRefusal(e.sender.id)
      if (refusal) return { error: refusal }
      // the model the user named, as given: the shared tool decides whether the route offers it
      const model = typeof op?.model === 'string' ? op.model.trim() : ''
      // ends with its tab, or when the tab's AI run is stopped
      return asAiJob(e.sender, (signal) =>
        generateImageTool(
          SETTINGS_PATH(),
          {
            prompt: String(op?.prompt ?? ''),
            aspectRatio: op?.aspectRatio ? String(op.aspectRatio) : undefined,
            ...(model ? { model } : {}),
          },
          {
            mediaRoots: documentMediaRoots(
              options.filePathOf(e.sender.id),
              join(app.getPath('temp'), 'genoffice-pasted'),
            ),
            // screen path: the statuses of the process-wide subscription service decide the route
            context: { path: 'screen', statuses: sharedSubscriptionStatuses() },
            signal,
          },
        ),
      )
    },
  )

  ipcMain.handle(HWP_CHANNELS.fetchImage, (_e, url: unknown) => fetchImageBytes(url))

  // Picture understanding: the panel takes a picture out of the document and sends it as
  // an image data URL. Only data URLs are taken (this editor has no path to hand over), and
  // the call ends with its tab or when the tab's AI run is stopped.
  ipcMain.handle(
    HWP_CHANNELS.analyzeMedia,
    (e, op: { mediaUrls?: unknown; requirements?: unknown }) => {
      const refusal = aiOffRefusal(e.sender.id)
      if (refusal) return { error: refusal }
      return asAiJob(e.sender, async (signal) => {
        const mediaUrls = (Array.isArray(op?.mediaUrls) ? op.mediaUrls : [])
          .map(String)
          .filter((url) => /^data:image\//i.test(url))
        if (mediaUrls.length === 0) return { error: 'no picture was given to look at' }
        return analyzeMediaTool(
          SETTINGS_PATH(),
          { mediaUrls, requirements: String(op?.requirements ?? '') },
          {
            context: { path: 'screen', statuses: sharedSubscriptionStatuses() },
            signal,
          },
        )
      })
    },
  )
}
