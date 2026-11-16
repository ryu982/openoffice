import { ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'
import {
  onAiJobsChanged,
  runningAiJobCount,
  stopAllAiJobs,
} from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import {
  APP_CHOICE_CHANNELS,
  APP_CHOICE_KEYS,
  allEditorsOff,
  appChoiceFromSettings,
  editorOffList,
  setAppChoiceSource,
  type AppChoice,
  type AppChoicePatch,
} from '@genoffice/electron-utils/app-choice'
import { readAppSettings, writeAppSetting, writeAppSettings } from './app-settings'
import { editorPickDue, storedAiFeatures, storedEditorChoice } from '../shared/editor-choice'

/**
 * The shell's side of the editor choice and the AI-off switch: reads and
 * writes userData/app-settings.json, answers the screens over IPC, tells
 * every window when the choice changes, and is the source the editor mains
 * read through @genoffice/electron-utils/app-choice. It also puts the
 * "ai-off" check in front of the editors' AI runs and answers the running AI
 * job count and "stop all" (@genoffice/electron-utils/ai-activity).
 */

/** shown if an editor's AI run still reaches its main process while AI is off */
export const AI_OFF_REFUSAL = 'AI features are turned off in Settings.'

export interface EditorChoiceMainDeps {
  settingsPath: () => string
  /**
   * Whether a request comes from the shell's own screen (Home and its
   * Settings in the main window). Changing the choice, marking the one-time
   * picker seen and stopping every AI job are answered only for it; any other
   * sender gets the choice as it is, or no job stopped, and nothing changes.
   */
  isShellSender: (event: IpcMainInvokeEvent) => boolean
  /** the refusal an AI run gets while AI is off; English when not given */
  aiOffRefusal?: () => string
}

export interface EditorChoiceService {
  /** the choice that applies now */
  effective(): AppChoice
  /**
   * Change the choice from the main process (an "on and open" answer): stored
   * and told to every window as a screen's change is. Answers the choice after.
   */
  set(patch: AppChoicePatch): AppChoice
  /** hear every change made through this service; returns the unsubscribe */
  onChange(listener: (choice: AppChoice) => void): () => void
}

/**
 * The one place that answers which choice applies. An administrator policy
 * would override and lock the stored choice here; none is read yet.
 */
export function effectiveAppChoice(settingsPath: string): AppChoice {
  return appChoiceFromSettings(readAppSettings(settingsPath))
}

function sameChoice(a: AppChoice, b: AppChoice): boolean {
  return (
    a.aiFeatures === b.aiFeatures &&
    a.off.length === b.off.length &&
    a.off.every((id, index) => b.off[index] === id)
  )
}

function broadcast(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

export function registerEditorChoiceIpc(deps: EditorChoiceMainDeps): EditorChoiceService {
  const listeners = new Set<(choice: AppChoice) => void>()
  const effective = () => effectiveAppChoice(deps.settingsPath())

  setAppChoiceSource(effective)

  // a second wall behind the screens hiding AI: the editors' AI IPC handlers
  // ask this before a run, and their sender is always one of the app's windows
  setAiRunGuard('ai-off', ({ senderId }) => {
    if (effective().aiFeatures || !webContents.fromId(senderId)) return null
    return deps.aiOffRefusal?.() ?? AI_OFF_REFUSAL
  })

  ipcMain.handle(APP_CHOICE_CHANNELS.get, (): AppChoice => effective())

  const set = (raw: unknown): AppChoice => {
    const before = effective()
    const patch =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const updates: Record<string, unknown> = {}
    if (Array.isArray(patch.off)) {
      const off = editorOffList({ off: patch.off })
      // at least one editor stays on: a value with every editor off is not stored
      if (!allEditorsOff(off)) updates[APP_CHOICE_KEYS.editors] = storedEditorChoice({ off })
    }
    if (typeof patch.aiFeatures === 'boolean') {
      // undefined drops the key: AI on is stored as nothing
      updates[APP_CHOICE_KEYS.aiFeatures] = storedAiFeatures(patch.aiFeatures)
    }
    if (Object.keys(updates).length === 0) return before
    writeAppSettings(deps.settingsPath(), updates)
    const next = effective()
    if (!sameChoice(before, next)) {
      broadcast(APP_CHOICE_CHANNELS.changed, next)
      for (const listener of [...listeners]) listener(next)
    }
    return next
  }

  ipcMain.handle(APP_CHOICE_CHANNELS.set, (event, raw: unknown): AppChoice =>
    deps.isShellSender(event) ? set(raw) : effective(),
  )

  ipcMain.handle(APP_CHOICE_CHANNELS.pickDue, (): boolean =>
    editorPickDue(readAppSettings(deps.settingsPath())),
  )

  ipcMain.handle(APP_CHOICE_CHANNELS.markPickSeen, (event): void => {
    if (!deps.isShellSender(event)) return
    writeAppSetting(deps.settingsPath(), APP_CHOICE_KEYS.editorPickSeen, true)
  })

  ipcMain.handle(APP_CHOICE_CHANNELS.aiJobCount, (): number => runningAiJobCount())
  ipcMain.handle(APP_CHOICE_CHANNELS.stopAllAiJobs, (event): Promise<number> =>
    deps.isShellSender(event) ? stopAllAiJobs() : Promise.resolve(0),
  )
  onAiJobsChanged((count) => broadcast(APP_CHOICE_CHANNELS.aiJobsChanged, count))

  return {
    effective,
    set,
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
