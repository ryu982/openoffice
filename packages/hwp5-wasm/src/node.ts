import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initHwp5WasmSync,
  inspectHwp5 as inspectRaw,
  isHwp5WasmReady,
  parseRecords as parseRecordsRaw,
  readStream as readStreamRaw,
  rewriteStreams as rewriteStreamsRaw,
  stripTrackedChanges as stripTrackedChangesRaw,
} from './index'
import type { Hwp5Info, HwpRecord, StreamReplacement } from './index'

export const WASM_PATH = fileURLToPath(new URL('../pkg/hwp5_wasm_bg.wasm', import.meta.url))

/** Loads and instantiates the committed WASM binary once synchronously in Node / Electron main. */
export function ensureHwp5WasmSync(): void {
  if (isHwp5WasmReady()) return
  const wasmBytes = readFileSync(WASM_PATH)
  initHwp5WasmSync(wasmBytes)
}

export function inspectHwp5(bytes: Uint8Array): Hwp5Info {
  ensureHwp5WasmSync()
  return inspectRaw(bytes)
}

export function readStream(bytes: Uint8Array, path: string, decompress = false): Uint8Array | null {
  ensureHwp5WasmSync()
  return readStreamRaw(bytes, path, decompress)
}

export function parseRecords(streamBytes: Uint8Array): HwpRecord[] | null {
  ensureHwp5WasmSync()
  return parseRecordsRaw(streamBytes)
}

export function rewriteStreams(
  bytes: Uint8Array,
  replacements: ReadonlyArray<StreamReplacement>,
): Uint8Array | null {
  ensureHwp5WasmSync()
  return rewriteStreamsRaw(bytes, replacements)
}

export function stripTrackedChanges(bytes: Uint8Array): Uint8Array | null {
  ensureHwp5WasmSync()
  return stripTrackedChangesRaw(bytes)
}

export type { Hwp5Info, HwpRecord, StreamReplacement }
