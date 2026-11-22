/**
 * Opening a whiteboard or Excalidraw file from any open path: checks the file
 * before creating a tab so broken/invalid `.whiteboard` or `.excalidraw*` files
 * never open an empty tab.
 */
import { detectWhiteboardFormat, isExcalidrawFormat } from '../../../whiteboard/src/shared/formats'

export interface WhiteboardOpenGateDeps {
  refusal: (filePath: string) => string | null
  excalidrawRefusal: (filePath: string) => string | null
  open: (filePath: string) => void
  warn: (message: string, filePath: string) => void
}

export function openWhiteboardChecked(filePath: string, deps: WhiteboardOpenGateDeps): boolean {
  const reason = isExcalidrawFormat(detectWhiteboardFormat(filePath))
    ? deps.excalidrawRefusal(filePath)
    : deps.refusal(filePath)
  if (reason !== null) {
    deps.warn(reason, filePath)
    return false
  }
  deps.open(filePath)
  return true
}
