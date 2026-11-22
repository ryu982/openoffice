/** File names of whiteboard picture exports (`<base>-p<n>.<ext>` for multi-page, chosen path for single page). */
import { basename, dirname, extname, join } from 'node:path'
import { safeFileNameBase } from '../shared/formats'

export function pageFilePaths(
  chosen: string,
  ext: 'png' | 'svg',
  pageNumbers: readonly number[],
  perPage: boolean,
): string[] {
  if (!perPage && pageNumbers.length === 1) return [chosen]
  const dir = dirname(chosen)
  let base = basename(chosen)
  if (extname(base).toLowerCase() === `.${ext}`) base = base.slice(0, -ext.length - 1)
  base = safeFileNameBase(base) || 'whiteboard'
  return pageNumbers.map((n) => join(dir, `${base}-p${n}.${ext}`))
}
