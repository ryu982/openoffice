/// The preload side of the editor choice and AI-off switch (app-choice.ts):
/// what a window exposes as `window.aiOfficeEditorChoice`. Every answer is
/// normalized again here, so a screen only ever sees a well-formed choice.
/// Runs in sandboxed preloads: imports only electron and Node-free modules.
import { ipcRenderer } from 'electron'
import {
  APP_CHOICE_CHANNELS,
  normalizeAppChoice,
  APP_CHOICE_BRIDGE_KEY,
  type AppChoice,
  type AppChoicePatch,
} from './app-choice'

export { APP_CHOICE_BRIDGE_KEY }

export interface AppChoiceBridge {
  /** the choice that applies now */
  get(): Promise<AppChoice>
  /** change it; resolves to the choice that applies after (unchanged when refused) */
  set(patch: AppChoicePatch): Promise<AppChoice>
  /** hear every change; returns the unsubscribe */
  onChange(listener: (choice: AppChoice) => void): () => void
  /** whether the one-time editor picker is due (onboarding seen, picker not yet) */
  pickDue(): Promise<boolean>
  markPickSeen(): Promise<void>
  /** how many AI jobs the screens started are running */
  aiJobCount(): Promise<number>
  onAiJobCountChange(listener: (count: number) => void): () => void
  /** stop every running AI job; resolves to how many were stopped */
  stopAllAiJobs(): Promise<number>
}

function countOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0
}

export function appChoiceBridge(): AppChoiceBridge {
  return {
    // no shell answering (an editor on its own) reads as everything on
    get: async () =>
      normalizeAppChoice(await ipcRenderer.invoke(APP_CHOICE_CHANNELS.get).catch(() => null)),
    set: async (patch) => {
      const sent: AppChoicePatch = {}
      if (Array.isArray(patch?.off))
        sent.off = patch.off.map(String) as NonNullable<AppChoicePatch['off']>
      if (typeof patch?.aiFeatures === 'boolean') sent.aiFeatures = patch.aiFeatures
      return normalizeAppChoice(await ipcRenderer.invoke(APP_CHOICE_CHANNELS.set, sent))
    },
    onChange(listener) {
      const handler = (_event: unknown, raw: unknown) => listener(normalizeAppChoice(raw))
      ipcRenderer.on(APP_CHOICE_CHANNELS.changed, handler)
      return () => {
        ipcRenderer.removeListener(APP_CHOICE_CHANNELS.changed, handler)
      }
    },
    pickDue: async () =>
      (await ipcRenderer.invoke(APP_CHOICE_CHANNELS.pickDue).catch(() => false)) === true,
    markPickSeen: async () => {
      await ipcRenderer.invoke(APP_CHOICE_CHANNELS.markPickSeen)
    },
    aiJobCount: async () =>
      countOf(await ipcRenderer.invoke(APP_CHOICE_CHANNELS.aiJobCount).catch(() => 0)),
    onAiJobCountChange(listener) {
      const handler = (_event: unknown, raw: unknown) => listener(countOf(raw))
      ipcRenderer.on(APP_CHOICE_CHANNELS.aiJobsChanged, handler)
      return () => {
        ipcRenderer.removeListener(APP_CHOICE_CHANNELS.aiJobsChanged, handler)
      }
    },
    stopAllAiJobs: async () => countOf(await ipcRenderer.invoke(APP_CHOICE_CHANNELS.stopAllAiJobs)),
  }
}
