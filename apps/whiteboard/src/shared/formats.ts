/**
 * File-extension detection and safe naming helpers for `.whiteboard` and
 * Excalidraw import formats (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`).
 */

export type WhiteboardInputFormat =
  'whiteboard' | 'excalidraw' | 'excalidraw.png' | 'excalidraw.svg'

export function detectWhiteboardFormat(fileName: string): WhiteboardInputFormat | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.whiteboard')) return 'whiteboard'
  if (lower.endsWith('.excalidraw.png')) return 'excalidraw.png'
  if (lower.endsWith('.excalidraw.svg')) return 'excalidraw.svg'
  if (lower.endsWith('.excalidraw')) return 'excalidraw'
  return null
}

export function isExcalidrawFormat(format: WhiteboardInputFormat | null): boolean {
  return format === 'excalidraw' || format === 'excalidraw.png' || format === 'excalidraw.svg'
}

export function whiteboardBaseName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.excalidraw\.(png|svg)$/i, '').replace(/\.(whiteboard|excalidraw)$/i, '')
}

export function safeFileNameBase(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120)
}

export function withWhiteboardExtension(filePath: string): string {
  return /\.whiteboard$/i.test(filePath) ? filePath : `${filePath}.whiteboard`
}
