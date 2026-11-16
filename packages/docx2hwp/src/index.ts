/**
 * Word (.docx) to Hangul (.hwp / .hwpx). The caller starts the engine once
 * per JavaScript realm and converts; documents, units and frees stay inside.
 */
export { HwpEngine } from './engine'
export {
  docxToHwp,
  Docx2HwpError,
  type Docx2HwpErrorCode,
  type HwpConversion,
  type HwpConversionOptions,
  type HwpFormat,
} from './convert'
export type { HwpLook } from './look'
export type { Loss, LossFeature, LossKind } from './losses'
