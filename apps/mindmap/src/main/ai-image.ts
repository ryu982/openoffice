/**
 * Image search/generation for the mind map's AI panel: the two channels the
 * renderer calls to bring a picture into the map file.
 *
 * The bytes are the renderer's business (it puts them into the document as a
 * new entry); this side only reaches the network. `generateImageTool` is the
 * same tool the other editors use, with the statuses of the process-wide
 * subscription service, and `fetchImageBytes` reads a web address or the file
 * the generator wrote into its own store — the generated-image store is the
 * only `file://` it answers.
 *
 * The channels are this editor's own (`mindmap:`); the shared `ai:*` and
 * subscription channels belong to the docs main and are never registered here.
 */
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  abortMediaCalls,
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
import { MINDMAP_CHANNELS } from '../shared/ipc'

export interface MindmapImageIpcOptions {
  /** the map file this view has open, for the media roots; null while it has none */
  filePathOf(webContentsId: number): string | null
  /** where a pasted picture waits (the same folder the attachment reader uses) */
  pastedImageDir: string
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
export function registerMindmapImageIpc(options: MindmapImageIpcOptions): void {
  ipcMain.handle(
    MINDMAP_CHANNELS.aiGenerateImage,
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
            mediaRoots: documentMediaRoots(options.filePathOf(e.sender.id), options.pastedImageDir),
            // screen path: the statuses of the process-wide subscription service decide the route
            context: { path: 'screen', statuses: sharedSubscriptionStatuses() },
            signal,
          },
        ),
      )
    },
  )

  ipcMain.handle(MINDMAP_CHANNELS.fetchImage, (_e, url: unknown) => fetchImageBytes(url))
}
