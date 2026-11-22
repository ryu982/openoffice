import { readFile } from 'node:fs/promises'

/**
 * How many font files the editor's font detection may read at once, from the open-file
 * limit of the renderer it runs in (studio-plugin/pc-fonts.mjs, fontFilesToRead).
 *
 * On Linux the renderer keeps each font file it read open until its next garbage
 * collection, and the detection reads one file per installed font: a PC with thousands of
 * fonts reached the limit and the editor stopped (#488). A desktop session starts programs
 * with a soft limit of 1024 (AppImage, the executable run directly); the deb and rpm
 * launcher raises it to the hard limit first. The detection gets half of the renderer's
 * own limit, the rest staying for the files the editor uses otherwise. The browser process
 * raises its own limit, so the renderer's is read, not the main process's.
 */

/** The soft "Max open files" of a /proc/<pid>/limits text; Infinity when unlimited. */
export function softOpenFileLimit(limits: string): number | null {
  const line = limits.split('\n').find((row) => row.startsWith('Max open files'))
  const soft = line?.slice('Max open files'.length).trim().split(/\s+/)[0]
  if (soft === 'unlimited') return Infinity
  const value = Number(soft)
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * The detection's share of a soft limit: half of it, every file when the limit is
 * unlimited, or null when it is not known (the detection keeps its own default).
 */
export function fontFileReadsFor(softLimit: number | null): number | null {
  if (softLimit === null) return null
  if (!Number.isFinite(softLimit)) return Number.MAX_SAFE_INTEGER
  return Math.max(1, Math.floor(softLimit / 2))
}

/**
 * The share for the renderer with the given process id; null off Linux (the detection
 * reads every file there) and when the limit cannot be read (it keeps its own default).
 */
export async function fontFileReadsOfProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<number | null> {
  if (platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null
  try {
    return fontFileReadsFor(softOpenFileLimit(await read(`/proc/${pid}/limits`)))
  } catch {
    return null
  }
}
