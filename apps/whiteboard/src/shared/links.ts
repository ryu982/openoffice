import { safeExternalUrl } from '@genoffice/electron-utils/safe-external-url'

export const LINK_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:']

/**
 * Returns the validated `http:`, `https:`, or `mailto:` URL string when safe to
 * hand to `shell.openExternal`, or null for every other scheme (`javascript:`,
 * `file:`, `data:`, etc.).
 */
export function openableLink(raw: unknown): string | null {
  return safeExternalUrl(raw, { allowedProtocols: LINK_PROTOCOLS })
}
