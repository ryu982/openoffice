import { extractMarkdown } from '@genoffice/whiteboard-engine/node'

/**
 * Whiteboard to deterministic Markdown text shared by attachment parsing,
 * search indexing, and Quick Look. Runs the Rust WASM ZIP safety gate and
 * schema validation before returning text.
 */
export function whiteboardToText(bytes: Uint8Array): string {
  const res = extractMarkdown(bytes)
  if (!res.ok) {
    throw new Error(`Cannot read whiteboard (${res.error.code}): ${res.error.message}`)
  }
  return res.markdown
}
