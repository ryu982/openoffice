import { readAppSettings, writeAppSetting } from './app-settings'

export const SPLIT_MEMORY_SETTING_KEY = 'splitView'

export type SplitMemoryOrientation = 'side' | 'stack'
export type SplitMemoryFocus = 'a' | 'b'

export interface SplitMemory {
  version: 1
  a: string
  b?: string
  orientation?: SplitMemoryOrientation
  ratio?: number
  focus?: SplitMemoryFocus
}

export interface SplitMemoryState {
  aTabIdPath?: string
  bTabIdPath?: string
  orientation?: SplitMemoryOrientation
  ratio?: number
  focus?: SplitMemoryFocus
}

export interface SplitMemoryOptions {
  settingsPath: string | (() => string)
  readSettings?: (settingsPath: string) => Record<string, unknown>
  writeSetting?: (settingsPath: string, key: string, value: unknown) => void
}

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

function resolveSettingsPath(options: SplitMemoryOptions): string {
  return typeof options.settingsPath === 'function' ? options.settingsPath() : options.settingsPath
}

function nonEmptyPath(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

function baseMemory(aPath: string | undefined, bPath: string | undefined): SplitMemory | null {
  if (aPath !== undefined && bPath !== undefined) return { version: 1, a: aPath, b: bPath }
  if (aPath !== undefined) return { version: 1, a: aPath }
  if (bPath !== undefined) return { version: 1, a: bPath }
  return null
}

function normalizeStoredMemory(raw: unknown): SplitMemory | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1) return null
  if (typeof record.a !== 'string' || record.a.length === 0) return null

  const memory: SplitMemory = { version: 1, a: record.a }

  if (record.b !== undefined) {
    if (typeof record.b !== 'string') return null
    if (record.b.length > 0) memory.b = record.b
  }
  if (record.orientation !== undefined) {
    if (record.orientation !== 'side' && record.orientation !== 'stack') return null
    memory.orientation = record.orientation
  }
  if (record.ratio !== undefined) {
    if (typeof record.ratio !== 'number' || !Number.isFinite(record.ratio)) return null
    memory.ratio = clampRatio(record.ratio)
  }
  if (record.focus !== undefined) {
    if (record.focus !== 'a' && record.focus !== 'b') return null
    memory.focus = record.focus
  }

  return memory
}

export function writeSplitMemory(
  state: SplitMemoryState | null,
  options: SplitMemoryOptions,
): void {
  if (state === null) {
    clearSplitMemory(options)
    return
  }

  const memory = baseMemory(nonEmptyPath(state.aTabIdPath), nonEmptyPath(state.bTabIdPath))
  if (memory === null) {
    clearSplitMemory(options)
    return
  }

  if (state.orientation === 'side' || state.orientation === 'stack') {
    memory.orientation = state.orientation
  }
  if (typeof state.ratio === 'number' && Number.isFinite(state.ratio)) {
    memory.ratio = clampRatio(state.ratio)
  }
  if (state.focus === 'a' || state.focus === 'b') {
    memory.focus = state.focus
  }

  const writeSetting = options.writeSetting ?? writeAppSetting
  writeSetting(resolveSettingsPath(options), SPLIT_MEMORY_SETTING_KEY, memory)
}

export function readSplitMemory(options: SplitMemoryOptions): SplitMemory | null {
  const readSettings = options.readSettings ?? readAppSettings
  const settings = readSettings(resolveSettingsPath(options))
  return normalizeStoredMemory(settings[SPLIT_MEMORY_SETTING_KEY])
}

export function clearSplitMemory(options: SplitMemoryOptions): void {
  const writeSetting = options.writeSetting ?? writeAppSetting
  writeSetting(resolveSettingsPath(options), SPLIT_MEMORY_SETTING_KEY, undefined)
}

/**
 * Drop documents from the memory: their editor is turned off and the person
 * declined to restore them, so the next launch does not ask again. A memory
 * left with one document keeps it alone (it reopens without a split); one
 * left with none is cleared. `same` compares two paths (case rules of the OS).
 */
export function forgetSplitMemoryPaths(
  paths: readonly string[],
  options: SplitMemoryOptions & { same?: (a: string, b: string) => boolean },
): void {
  if (paths.length === 0) return
  const memory = readSplitMemory(options)
  if (!memory) return
  const same = options.same ?? ((a: string, b: string) => a === b)
  const gone = (path: string | undefined): boolean =>
    path !== undefined && paths.some((dropped) => same(dropped, path))
  if (!gone(memory.a) && !gone(memory.b)) return
  const kept = [memory.a, memory.b].filter(
    (path): path is string => path !== undefined && !gone(path),
  )
  if (kept.length === 0) {
    clearSplitMemory(options)
    return
  }
  const writeSetting = options.writeSetting ?? writeAppSetting
  const next: SplitMemory = { ...memory, a: kept[0] }
  delete next.b
  if (kept.length > 1) next.b = kept[1]
  writeSetting(resolveSettingsPath(options), SPLIT_MEMORY_SETTING_KEY, next)
}
