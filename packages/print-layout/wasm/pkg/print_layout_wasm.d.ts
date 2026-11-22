/* tslint:disable */
/* eslint-disable */

/**
 * Streaming DeviceGray PDF builder that appends one face at a time.
 */
export class GrayPdfBuilder {
    free(): void;
    [Symbol.dispose](): void;
    add_bgrx_face(bgrx: Uint8Array | number[], stride: number, width_px: number, height_px: number, width_pt: number, height_pt: number): void;
    add_gray_face(pixels: Uint8Array | number[], width_px: number, height_px: number, width_pt: number, height_pt: number): void;
    finish(): Uint8Array;
    constructor();
}

/**
 * Result of `rotate_landscape_faces`: when `rotated == 0`, `pdf` is `None`.
 */
export class RotateResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    take_pdf(): Uint8Array | undefined;
    readonly rotated: number;
}

/**
 * Arranges a job PDF according to a precomputed `PlannedFace[]` JSON array.
 */
export function arrange_pdf(pdf_bytes: Uint8Array | number[], faces_json: string): Uint8Array;

/**
 * Converts BGRx rows with stride into tightly packed 8-bit gray or RGB rows.
 */
export function convert_bgrx_pixels(bgrx: Uint8Array | number[], stride: number, width: number, height: number, grayscale: boolean): Uint8Array;

/**
 * Fused BGRx-to-PNG encoder without an intermediate full-frame pixel copy.
 */
export function encode_bgrx_to_png(bgrx: Uint8Array | number[], stride: number, width: number, height: number, grayscale: boolean): Uint8Array;

/**
 * Encodes tightly packed 8-bit gray (`channels = 1`) or RGB (`channels = 3`)
 * pixel rows to PNG using the Up row filter and fdeflate compression.
 */
export function encode_png(pixels: Uint8Array | number[], width: number, height: number, channels: number): Uint8Array;

/**
 * Reads each page's displayed size in points as JSON `[{widthPt, heightPt}, ...]`.
 */
export function read_job_page_sizes(pdf_bytes: Uint8Array | number[]): string;

/**
 * Rotates landscape pages 90 degrees clockwise (`/Rotate` + 90 mod 360).
 */
export function rotate_landscape_faces(pdf_bytes: Uint8Array | number[]): RotateResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_graypdfbuilder_free: (a: number, b: number) => void;
    readonly __wbg_rotateresult_free: (a: number, b: number) => void;
    readonly arrange_pdf: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly convert_bgrx_pixels: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly encode_bgrx_to_png: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly encode_png: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly graypdfbuilder_add_bgrx_face: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly graypdfbuilder_add_gray_face: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly graypdfbuilder_finish: (a: number) => [number, number, number, number];
    readonly graypdfbuilder_new: () => number;
    readonly read_job_page_sizes: (a: number, b: number) => [number, number, number, number];
    readonly rotate_landscape_faces: (a: number, b: number) => [number, number, number];
    readonly rotateresult_rotated: (a: number) => number;
    readonly rotateresult_take_pdf: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
