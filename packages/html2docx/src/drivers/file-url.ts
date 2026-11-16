import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Whether `url` names the file at `path`, however the URL spells it (percent
 * escapes, drive-letter case, a query or fragment). A rule for
 * `ElectronDriverIsolation.allowRequest`: the page's own file and nothing else
 * on disk.
 */
export function isFileUrlOf(url: string, path: string): boolean {
  if (!/^file:/i.test(url)) return false
  let target: string
  try {
    target = fileURLToPath(new URL(url))
  } catch {
    return false
  }
  const requested = resolve(target)
  const expected = resolve(path)
  return process.platform === 'win32'
    ? requested.toLowerCase() === expected.toLowerCase()
    : requested === expected
}
