/**
 * Image search, image generation, and image byte fetching for the whiteboard AI panel.
 * Follows the exact Mindmap policy (decisions 0074, 0075, 0145).
 */
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  abortMediaCalls,
  documentMediaRoots,
  generateImageTool,
  imageSearchTool,
  withMediaCallSignal,
  type MediaCallSender,
} from '@genoffice/ai-search'
import { sharedSubscriptionStatuses } from '@genoffice/ai-provider/subscription'
import { registerAiJob } from '@genoffice/electron-utils/ai-activity'
import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'
import { aiFeaturesOn } from '@genoffice/electron-utils/app-choice'
import { fetchImageBytes } from '@genoffice/electron-utils/fetch-image-bytes'
import { WHITEBOARD_CHANNELS } from '../shared/ipc'

export interface WhiteboardImageIpcOptions {
  filePathOf(webContentsId: number): string | null
  pastedImageDir: string
}

const SETTINGS_PATH = (): string => join(app.getPath('userData'), 'ai-settings.json')
const AI_OFF_REFUSAL = 'AI features are turned off in Settings.'

function aiOffRefusal(senderId: number): string | null {
  if (aiFeaturesOn()) return null
  return aiRunRefusal({ senderId, provider: '', model: '' }) ?? AI_OFF_REFUSAL
}

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

export function registerWhiteboardImageIpc(options: WhiteboardImageIpcOptions): void {
  ipcMain.handle(WHITEBOARD_CHANNELS.aiImageSearch, (e, query: unknown) => {
    const refusal = aiOffRefusal(e.sender.id)
    if (refusal) return { error: refusal }
    return asAiJob(e.sender, () => imageSearchTool(SETTINGS_PATH(), String(query ?? '')))
  })

  ipcMain.handle(
    WHITEBOARD_CHANNELS.aiGenerateImage,
    (e, op: { prompt?: unknown; aspectRatio?: unknown; model?: unknown }) => {
      const refusal = aiOffRefusal(e.sender.id)
      if (refusal) return { error: refusal }
      const model = typeof op?.model === 'string' ? op.model.trim() : ''
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
            context: { path: 'screen', statuses: sharedSubscriptionStatuses() },
            signal,
          },
        ),
      )
    },
  )

  ipcMain.handle(WHITEBOARD_CHANNELS.fetchImage, (_e, url: unknown) => fetchImageBytes(url))
}
