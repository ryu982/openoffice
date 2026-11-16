// Main-process / worker entry for rendering: face images, the grayscale PDF and
// the job runner. Not part of `./plan` (Node only).
export { encodePng } from './png'
export { loadRasterPdfium, pdfiumWasmPath, type RasterPdfium } from './pdfium'
export {
  AUTO_FLOOR_DPI,
  AUTO_PIXEL_BUDGET,
  AUTO_TARGET_DPI,
  rasterDpiFor,
  rasterizePdf,
  type RasterFace,
  type RasterizeOptions,
  type RasterProgress,
} from './raster'
export { grayscalePdf, rotateLandscapeFaces, type GrayPdfOptions } from './grayscale'
export {
  isRasterWorkerData,
  PREVIEW_LONG_SIDE_MAX_PX,
  PREVIEW_LONG_SIDE_MIN_PX,
  PREVIEW_LONG_SIDE_PX,
  RASTER_WORKER_DATA,
  rasterErrorMessage,
  runRasterJob,
  serveRasterJob,
  type PreviewImageFace,
  type PrintImageFace,
  type RasterJobContext,
  type RasterJobRequest,
  type RasterJobResult,
  type RasterWorkerMessage,
  type RasterWorkerPort,
} from './raster-job'
