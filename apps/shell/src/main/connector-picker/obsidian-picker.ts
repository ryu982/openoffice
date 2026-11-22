import type { ConnectorPickerItem } from '../../shared/connector-picker-api'
import { listVaultNotesForPicker, type VaultEntryLike } from '../mcp-client/obsidian-vault'

/** Maximum number of notes that may be attached in one pick */
export const MAX_OBSIDIAN_PICKS = 20
const MAX_ID_LENGTH = 4096

/**
 * List `.md` notes across all registered Obsidian vaults (regardless of
 * per-vault AI toggle) and flag any note currently open with unsaved changes.
 */
export async function listObsidianPickerItems(
  vaults: readonly VaultEntryLike[],
  isUnsaved: (absPath: string) => Promise<boolean> | boolean,
  platform?: NodeJS.Platform,
): Promise<{ items: ConnectorPickerItem[] }> {
  const notes = await listVaultNotesForPicker(vaults, { platform })
  const items: ConnectorPickerItem[] = []
  for (const note of notes) {
    const unsaved = await isUnsaved(note.absPath)
    items.push({
      id: note.absPath,
      title: note.title,
      subtitle: note.relPath,
      vaultId: note.vaultId,
      vaultName: note.vaultName,
      tags: note.tags,
      mtimeMs: note.mtimeMs,
      ...(unsaved ? { disabledReason: 'unsaved' as const } : {}),
    })
  }
  return { items }
}

/**
 * Validate chosen IDs against the most recent listed items. Unknown, disabled,
 * or non-string IDs are dropped and counted in `skipped`. Capped at 20 paths.
 */
export function resolveObsidianSelection(
  rawIds: unknown,
  listedItems: readonly ConnectorPickerItem[] | null,
): { paths: string[]; skipped: number } {
  if (!Array.isArray(rawIds) || !listedItems) return { paths: [], skipped: 0 }
  const allowed = new Set<string>()
  for (const item of listedItems) {
    if (!item.disabledReason) allowed.add(item.id)
  }
  const paths: string[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const raw of rawIds) {
    if (typeof raw !== 'string' || raw.length > MAX_ID_LENGTH) {
      skipped += 1
      continue
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    if (!allowed.has(raw)) {
      skipped += 1
      continue
    }
    if (paths.length >= MAX_OBSIDIAN_PICKS) continue
    paths.push(raw)
  }
  return { paths, skipped }
}
