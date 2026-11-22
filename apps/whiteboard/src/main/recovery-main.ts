/**
 * Crash-recovery copies for `.whiteboard` tabs (`<userData>/whiteboard-autosave`, decision 0061).
 */
import { app } from 'electron'
import {
  createRecoveryStore,
  isUntitledIdentity,
  newUntitledRecoveryId,
  type RecoveryIdentity,
  type RecoveryStore,
} from '@genoffice/electron-utils'

export const DONT_SAVE_HOLD_MS = 10_000

let store: RecoveryStore | null = null

export function whiteboardRecoveryStore(): RecoveryStore {
  if (!store) {
    store = createRecoveryStore({ userDataDir: app.getPath('userData') })
  }
  return store
}

export function fileRecoveryIdentity(filePath: string): RecoveryIdentity {
  return { kind: 'whiteboard', filePath }
}

const viewIdentities = new Map<number, RecoveryIdentity>()
const viewOriginalPaths = new Map<number, string | null>()
const viewOpenDecisions = new Map<number, { copyBytes: Uint8Array; originalPath: string | null }>()

export function ensureViewIdentity(wcId: number, filePath: string | null): RecoveryIdentity {
  const existing = viewIdentities.get(wcId)
  if (filePath) {
    const id = fileRecoveryIdentity(filePath)
    viewIdentities.set(wcId, id)
    return id
  }
  if (existing && isUntitledIdentity(existing)) return existing
  const id: RecoveryIdentity = {
    kind: 'whiteboard',
    untitledId: newUntitledRecoveryId(),
    ext: '.whiteboard',
  }
  viewIdentities.set(wcId, id)
  return id
}

export function viewRecoveryIdentity(wcId: number): RecoveryIdentity | null {
  return viewIdentities.get(wcId) ?? null
}

export function setViewOriginalPath(wcId: number, originalPath: string | null): void {
  viewOriginalPaths.set(wcId, originalPath)
}

export function getViewOriginalPath(wcId: number): string | null {
  return viewOriginalPaths.get(wcId) ?? null
}

export function setRestoredCopyForView(
  wcId: number,
  identity: RecoveryIdentity,
  copyBytes: Uint8Array,
  originalPath: string | null,
): void {
  viewIdentities.set(wcId, identity)
  viewOriginalPaths.set(wcId, originalPath)
  viewOpenDecisions.set(wcId, { copyBytes, originalPath })
}

export function takeRestoredCopyForView(
  wcId: number,
): { copyBytes: Uint8Array; originalPath: string | null } | null {
  const hit = viewOpenDecisions.get(wcId) ?? null
  viewOpenDecisions.delete(wcId)
  return hit
}

export function recoveryAvailable(filePath: string): boolean {
  return whiteboardRecoveryStore().copyInfo(fileRecoveryIdentity(filePath)) !== null
}

export async function writeViewCopy(
  wcId: number,
  filePath: string | null,
  bytes: Uint8Array,
  title: string,
  originalPath?: string | null,
): Promise<boolean> {
  const id = ensureViewIdentity(wcId, filePath)
  const orig = originalPath !== undefined ? originalPath : (viewOriginalPaths.get(wcId) ?? null)
  const res = await whiteboardRecoveryStore().writeCopy(
    id,
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    {
      title,
      ...(isUntitledIdentity(id) && orig ? { originalPath: orig } : {}),
    },
  )
  return res === 'written'
}

export function viewSaved(wcId: number, newFilePath: string): void {
  const prev = viewIdentities.get(wcId)
  if (prev) {
    whiteboardRecoveryStore().deleteCopy(prev, 'saved')
  }
  viewIdentities.set(wcId, fileRecoveryIdentity(newFilePath))
  viewOriginalPaths.delete(wcId)
}

export function viewFileRenamed(wcId: number, newFilePath: string): void {
  const prev = viewIdentities.get(wcId)
  const next = fileRecoveryIdentity(newFilePath)
  if (prev && !isUntitledIdentity(prev)) {
    whiteboardRecoveryStore().deleteCopy(prev, 'saved')
  }
  viewIdentities.set(wcId, next)
}

export function viewClosedClean(wcId: number): void {
  const id = viewIdentities.get(wcId)
  if (id) whiteboardRecoveryStore().deleteCopy(id, 'closedClean')
  viewIdentities.delete(wcId)
  viewOriginalPaths.delete(wcId)
  viewOpenDecisions.delete(wcId)
}

export function viewDontSave(wcId: number): void {
  const id = viewIdentities.get(wcId)
  if (id) whiteboardRecoveryStore().deleteCopy(id, 'dontSave')
}

export function viewGone(wcId: number): void {
  viewIdentities.delete(wcId)
  viewOriginalPaths.delete(wcId)
  viewOpenDecisions.delete(wcId)
}
