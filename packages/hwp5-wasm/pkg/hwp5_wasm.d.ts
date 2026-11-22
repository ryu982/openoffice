/* tslint:disable */
/* eslint-disable */

export function inspect_hwp5(bytes: Uint8Array | number[]): string;

export function parse_records(stream_bytes: Uint8Array | number[]): string | undefined;

export function read_stream(bytes: Uint8Array | number[], path: string, decompress: boolean): Uint8Array | undefined;

export function rewrite_streams(bytes: Uint8Array | number[], manifest_json: string, payloads: Uint8Array | number[]): Uint8Array | undefined;

export function strip_tracked_changes(bytes: Uint8Array | number[]): Uint8Array | undefined;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly inspect_hwp5: (a: number, b: number) => [number, number];
    readonly parse_records: (a: number, b: number) => [number, number];
    readonly read_stream: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly rewrite_streams: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly strip_tracked_changes: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
