import type { OpenErrorCode } from '@genoffice/whiteboard-engine'

export type OpenFailureReason = OpenErrorCode | 'unsupported' | 'unreadable'

export const OPEN_FAILURE_KEYS: Record<OpenFailureReason, string> = {
  not_zip: 'failNotZip',
  zip_rejected: 'failZipRejected',
  missing_board_json: 'failMissingBoard',
  invalid_utf8: 'failCorrupt',
  invalid_json: 'failCorrupt',
  unsupported_schema_version: 'failUnsupportedVersion',
  invalid_schema: 'failCorrupt',
  no_excalidraw_scene: 'failNoExcalidrawScene',
  invalid_excalidraw: 'failInvalidExcalidraw',
  unsupported: 'failUnsupported',
  unreadable: 'failUnreadable',
}
