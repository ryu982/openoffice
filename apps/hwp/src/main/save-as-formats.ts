/**
 * Save As format list of the HWP editor. HWP and HWPX are the document's own
 * formats (the document's current one first, so it is the dialog's default
 * type); PDF is a copy written by the PDF export, so picking it leaves the
 * open document as it was. Kept free of Electron so the rules are unit-tested.
 */
import type { HwpFormat } from '../shared/ipc'
import { withFormatExtension } from './save-plan'

export type HwpSaveAsKind = HwpFormat | 'pdf'

export type SaveAsLabelKey = 'filterHwp' | 'filterHwpx' | 'filterPdf'

export interface SaveAsFilter {
  name: string
  extensions: string[]
}

/** The dialog's filters: the document's format, the other one, then — for Save As — PDF. */
export function saveAsFilters(
  fallback: HwpFormat,
  offerExports: boolean,
  label: (key: SaveAsLabelKey) => string,
): SaveAsFilter[] {
  const hwp = { name: label('filterHwp'), extensions: ['hwp'] }
  const hwpx = { name: label('filterHwpx'), extensions: ['hwpx'] }
  const native = fallback === 'hwpx' ? [hwpx, hwp] : [hwp, hwpx]
  if (!offerExports) return native
  return [...native, { name: label('filterPdf'), extensions: ['pdf'] }]
}

/**
 * With PDF offered the suggestion carries no .hwp/.hwpx, so the file type
 * chosen in the dialog supplies the extension (a typed name keeps its own).
 */
export function saveAsDefaultPath(suggestion: string, offerExports: boolean): string {
  return offerExports ? suggestion.replace(/\.hwpx?$/i, '') : suggestion
}

/** Filters for the HWPX-only Save As path (e.g. saving as HWPX after HWP verification blocks). */
export function saveAsHwpxFilters(label: (key: SaveAsLabelKey) => string): SaveAsFilter[] {
  return [{ name: label('filterHwpx'), extensions: ['hwpx'] }]
}

/**
 * Suggestion for the HWPX-only Save As path: always carries `.hwpx` so dialogs that do not
 * append a filter extension (Linux GTK / xdg-desktop-portal) still return an `.hwpx` path.
 */
export function saveAsHwpxDefaultPath(suggestion: string): string {
  return `${suggestion.replace(/\.hwpx?$/i, '')}.hwpx`
}

/**
 * What the dialog's answer means. With PDF offered, a .pdf name writes the PDF
 * copy. Anything else — .hwp/.hwpx, or a bare name from a dialog that does not
 * add the chosen type's extension — saves the document as before.
 */
export function saveAsTarget(
  filePath: string,
  fallback: HwpFormat,
  offerExports: boolean,
): { path: string; kind: HwpSaveAsKind } {
  if (offerExports && /\.pdf$/i.test(filePath)) return { path: filePath, kind: 'pdf' }
  const path = withFormatExtension(filePath, fallback)
  return { path, kind: /\.hwpx$/i.test(path) ? 'hwpx' : 'hwp' }
}
