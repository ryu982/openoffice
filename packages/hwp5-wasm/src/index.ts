import init, {
  initSync,
  inspect_hwp5,
  parse_records,
  read_stream,
  rewrite_streams,
  strip_tracked_changes,
} from '../pkg/hwp5_wasm.js'
import type { InitInput, InitOutput, SyncInitInput } from '../pkg/hwp5_wasm.js'

export interface Hwp5Info {
  valid: boolean
  compressed: boolean
  encrypted: boolean
  distribution: boolean
  tracked: boolean
  hasViewText: boolean
  sections: number
  paths: string[]
  streamPaths: string[]
}

export interface HwpRecord {
  tag: number
  level: number
  start: number
  body: number
  end: number
}

export interface StreamReplacement {
  path: string
  data: Uint8Array
  plain?: boolean
}

let initialized = false

/** Initializes the HWP5 WASM module asynchronously (browser / Vite / Electron renderer). */
export async function initHwp5Wasm(
  moduleOrPath?: InitInput | Promise<InitInput>,
): Promise<InitOutput> {
  const output =
    moduleOrPath === undefined ? await init() : await init({ module_or_path: moduleOrPath })
  initialized = true
  return output
}

/** Initializes the HWP5 WASM module synchronously from raw WASM bytes or a compiled module. */
export function initHwp5WasmSync(module: SyncInitInput): InitOutput {
  const output = initSync({ module })
  initialized = true
  return output
}

export function isHwp5WasmReady(): boolean {
  return initialized
}

/** Inspects an HWP 5 OLE2 container. Never throws on malformed or non-HWP inputs. */
export function inspectHwp5(bytes: Uint8Array): Hwp5Info {
  return JSON.parse(inspect_hwp5(bytes)) as Hwp5Info
}

/** Reads a stream from an HWP 5 container, optionally raw-deflate inflating it. */
export function readStream(bytes: Uint8Array, path: string, decompress = false): Uint8Array | null {
  const result = read_stream(bytes, path, decompress)
  return result ?? null
}

/** Parses an uncompressed HWP 5 tagged record stream into record boundaries, or null if malformed. */
export function parseRecords(streamBytes: Uint8Array): HwpRecord[] | null {
  const json = parse_records(streamBytes)
  return json === undefined ? null : (JSON.parse(json) as HwpRecord[])
}

/**
 * Rewrites selected streams in a plain HWP 5 container with self-readback verification.
 * Returns null if the source is unreadable/protected, any path is missing, or readback fails.
 */
export function rewriteStreams(
  bytes: Uint8Array,
  replacements: ReadonlyArray<StreamReplacement>,
): Uint8Array | null {
  let totalLength = 0
  for (const item of replacements) {
    totalLength += item.data.byteLength
  }
  const payloads = new Uint8Array(totalLength)
  const manifest: Array<{ path: string; offset: number; length: number; plain: boolean }> = []
  let offset = 0
  for (const item of replacements) {
    payloads.set(item.data, offset)
    manifest.push({
      path: item.path,
      offset,
      length: item.data.byteLength,
      plain: Boolean(item.plain),
    })
    offset += item.data.byteLength
  }
  const result = rewrite_streams(bytes, JSON.stringify(manifest), payloads)
  return result ?? null
}

/**
 * Removes tracked-changes ViewText entries and clears the tracked flag in FileHeader,
 * verifying body stream preservation on readback. Returns null if not a plain tracked HWP 5 file.
 */
export function stripTrackedChanges(bytes: Uint8Array): Uint8Array | null {
  const result = strip_tracked_changes(bytes)
  return result ?? null
}

export {
  init,
  initSync,
  inspect_hwp5,
  parse_records,
  read_stream,
  rewrite_streams,
  strip_tracked_changes,
}
export type { InitInput, InitOutput, SyncInitInput }
