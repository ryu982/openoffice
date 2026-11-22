/**
 * Generate-window hand-off on the main-process side of the whiteboard editor.
 */
import { ipcMain } from 'electron'
import {
  reportGenerateRunStarted,
  takeGenerateHandoff,
} from '@genoffice/electron-utils/generate-handoff'
import { WHITEBOARD_CHANNELS, type WhiteboardHandoff } from '../shared/ipc'

const MAX_REPORTED_PATHS = 256
const MAX_PATH_CHARS = 4096

export interface WhiteboardHandoffIpcOptions {
  opensFile(webContentsId: number): boolean
}

export function reportedPaths(report: unknown): { id: string; paths: string[] } | null {
  if (!report || typeof report !== 'object') return null
  const { id, attachedPaths } = report as { id?: unknown; attachedPaths?: unknown }
  if (typeof id !== 'string' || id === '' || !Array.isArray(attachedPaths)) return null
  const paths = attachedPaths
    .slice(0, MAX_REPORTED_PATHS)
    .filter((p): p is string => typeof p === 'string' && p !== '' && p.length <= MAX_PATH_CHARS)
  return paths.length > 0 ? { id, paths } : null
}

export function registerWhiteboardHandoffIpc(options: WhiteboardHandoffIpcOptions): void {
  const takenIdByWc = new Map<number, string>()

  ipcMain.handle(WHITEBOARD_CHANNELS.handoffTake, (e): WhiteboardHandoff | null => {
    const wcId = e.sender.id
    if (options.opensFile(wcId)) return null
    const handoff = takeGenerateHandoff('whiteboard', wcId)
    if (!handoff) return null
    takenIdByWc.set(wcId, handoff.id)
    return {
      id: handoff.id,
      sourcePaths: handoff.materials.map((m) => m.path),
      prompt: handoff.text,
    }
  })

  ipcMain.on(WHITEBOARD_CHANNELS.handoffRunStarted, (e, report: unknown) => {
    const wcId = e.sender.id
    const reported = reportedPaths(report)
    if (!reported || takenIdByWc.get(wcId) !== reported.id) return
    if (reportGenerateRunStarted('whiteboard', wcId, reported.paths)) takenIdByWc.delete(wcId)
  })
}
