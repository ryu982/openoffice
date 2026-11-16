import { open, rename, rm, writeFile } from 'node:fs/promises'
import { tempPathBeside } from '@genoffice/electron-utils/atomic-write'

/**
 * How Windows refuses to put a file in place of an existing one: antivirus or
 * the search indexer still has the fresh temp file open (a moment later it
 * works), another program has the PDF open without delete sharing, the PDF is
 * read-only, or a ransomware guard blocks replacing a document.
 */
const REFUSED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800]

/**
 * Prefix of the error thrown when the PDF could not be replaced at all; the
 * renderer matches it to explain the refusal instead of showing the raw
 * `EPERM: operation not permitted, rename …` line.
 */
export const SAVE_TARGET_LOCKED = 'save-target-locked'

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code ?? ''
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function renameWithRetry(tmp: string, targetPath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmp, targetPath)
      return
    } catch (error) {
      if (!REFUSED_CODES.has(codeOf(error)) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error
      }
      await sleep(RENAME_RETRY_DELAYS_MS[attempt]!)
    }
  }
}

function lockedError(cause: unknown): Error {
  const code = codeOf(cause) || 'unknown'
  const message = cause instanceof Error ? cause.message : String(cause)
  return Object.assign(new Error(`${SAVE_TARGET_LOCKED} code=${code}: ${message}`), {
    code,
    cause,
  })
}

/**
 * Write PDF bytes beside the destination, then atomically replace it.
 *
 * When Windows keeps refusing the replace (see REFUSED_CODES), the new bytes
 * are written into the existing file instead, which a program holding the PDF
 * open often still allows. That file is opened without truncating it first,
 * so a refusal there leaves it exactly as it was. Only a write that fails
 * part-way into the open file keeps the temp file, because it then holds the
 * only complete copy of the new bytes. Every other failure leaves the
 * destination untouched and removes the temp file.
 */
export async function writePdfAtomically(targetPath: string, bytes: Uint8Array): Promise<void> {
  const tmp = tempPathBeside(targetPath)
  try {
    await writeFile(tmp, bytes)
  } catch (err) {
    await rm(tmp, { force: true })
    throw REFUSED_CODES.has(codeOf(err)) ? lockedError(err) : err
  }
  let refused: unknown
  try {
    await renameWithRetry(tmp, targetPath)
    return
  } catch (err) {
    if (!REFUSED_CODES.has(codeOf(err))) {
      await rm(tmp, { force: true })
      throw err
    }
    refused = err
  }
  let handle
  try {
    handle = await open(targetPath, 'r+')
  } catch {
    await rm(tmp, { force: true })
    throw lockedError(refused)
  }
  // Windows opens a folder for writing too; only a regular file is written into
  const isFile = await handle.stat().then(
    (s) => s.isFile(),
    () => false,
  )
  if (!isFile) {
    await handle.close().catch(() => {})
    await rm(tmp, { force: true })
    throw lockedError(refused)
  }
  try {
    // write over the old bytes from the start (a fresh handle sits at 0) and
    // cut the tail after, so the file is never empty in between
    await handle.writeFile(bytes)
    await handle.truncate(bytes.byteLength)
  } catch (err) {
    await handle.close().catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    throw Object.assign(new Error(`${message} (the new bytes are kept in ${tmp})`), {
      code: codeOf(err),
      cause: err,
    })
  }
  await handle.close()
  await rm(tmp, { force: true })
}
