/* tslint:disable */
/* eslint-disable */

export class WasmArchive {
    free(): void;
    [Symbol.dispose](): void;
    add_image_resource(resource_id: string, bytes: Uint8Array | number[]): string;
    constructor(doc_json: string);
    get_doc_json(): string;
    get_resource(resource_id: string): Uint8Array | undefined;
    get_thumbnail(): Uint8Array | undefined;
    is_changed(): boolean;
    static open(bytes: Uint8Array | number[]): WasmArchive;
    save(): Uint8Array;
    set_doc_json(doc_json: string): void;
    set_thumbnail(png_bytes?: Uint8Array | number[] | null): void;
}

export class WasmExcalidrawImport {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    summary_json(): string;
    take_archive(): WasmArchive | undefined;
}

export function wasm_apply_template(doc_json: string, template_json: string, active_page_id?: string | null): string;

export function wasm_board_to_markdown(doc_json: string, page_filter?: string | null): string | undefined;

export function wasm_check_excalidraw(bytes: Uint8Array | number[], filename_hint?: string | null): string;

export function wasm_check_whiteboard(bytes: Uint8Array | number[]): string;

export function wasm_compute_page_bounds(doc_json: string, page_id: string, margin: number): string | undefined;

export function wasm_compute_stroke_outline(points_json: string, width: number, tool?: string | null): string;

export function wasm_create_new_board(id: string, page_id: string, title: string): string;

export function wasm_extract_markdown(bytes: Uint8Array | number[], page_filter?: string | null): string;

export function wasm_extract_thumbnail(bytes: Uint8Array | number[]): Uint8Array | undefined;

export function wasm_import_excalidraw(bytes: Uint8Array | number[], filename_hint: string | null | undefined, board_id: string, page_id: string, title: string): WasmExcalidrawImport;

export function wasm_order_between(before?: string | null, after?: string | null): string;

export function wasm_plan_board_edit(doc_json: string, ops_json: string, default_page_id: string | null | undefined, mode: string): string;

export function wasm_read_board_table(doc_json: string, page_filter: string | null | undefined, selected_ids_json: string): string | undefined;

export function wasm_sniff_image(bytes: Uint8Array | number[]): string | undefined;

export function wasm_validate_board(doc_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmarchive_free: (a: number, b: number) => void;
    readonly __wbg_wasmexcalidrawimport_free: (a: number, b: number) => void;
    readonly wasm_apply_template: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_board_to_markdown: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_check_excalidraw: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_check_whiteboard: (a: number, b: number) => [number, number];
    readonly wasm_compute_page_bounds: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasm_compute_stroke_outline: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasm_create_new_board: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_extract_markdown: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_extract_thumbnail: (a: number, b: number) => [number, number];
    readonly wasm_import_excalidraw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly wasm_order_between: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_plan_board_edit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_read_board_table: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_sniff_image: (a: number, b: number) => [number, number];
    readonly wasm_validate_board: (a: number, b: number) => [number, number];
    readonly wasmarchive_add_image_resource: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmarchive_from_doc_json: (a: number, b: number) => [number, number, number];
    readonly wasmarchive_get_doc_json: (a: number) => [number, number];
    readonly wasmarchive_get_resource: (a: number, b: number, c: number) => [number, number];
    readonly wasmarchive_get_thumbnail: (a: number) => [number, number];
    readonly wasmarchive_is_changed: (a: number) => number;
    readonly wasmarchive_open: (a: number, b: number) => [number, number, number];
    readonly wasmarchive_save: (a: number) => [number, number, number, number];
    readonly wasmarchive_set_doc_json: (a: number, b: number, c: number) => [number, number];
    readonly wasmarchive_set_thumbnail: (a: number, b: number, c: number) => [number, number];
    readonly wasmexcalidrawimport_summary_json: (a: number) => [number, number];
    readonly wasmexcalidrawimport_take_archive: (a: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
