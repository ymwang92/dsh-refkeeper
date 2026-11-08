import { join } from 'node:path'

import { BATCH_MARKER, normalizeBatch } from '../core/batch.ts'
import type { CaptureBatch } from '../core/batch.ts'
import { readFileAtomic, withStoreLock, writeFileAtomic } from '../store/atomic.ts'
import { storePaths } from '../store/io.ts'

/**
 * Persistence for the last capture run.
 *
 * `/refs export` used to export the whole library, which reads as a bug: a user
 * who just captured three references expects those three, not the 29 that
 * accumulated earlier. The batch is therefore recorded next to the library and
 * becomes the default export scope; the whole library stays reachable with
 * `--all`, so nothing is lost.
 *
 * The value shape and the transcript encoding live in `core/batch.ts`, which the
 * client bundle can import without dragging in Node builtins.
 */
export { BATCH_MARKER, encodeBatch, decodeBatch, exportableOf, findLatestBatch } from '../core/batch.ts'
export type { BatchEntry, BatchEntryStatus, CaptureBatch } from '../core/batch.ts'

export const BATCH_FILENAME = 'last-capture.json'

export function batchPath(workspace: string): string {
  return join(storePaths(workspace).dir, BATCH_FILENAME)
}

/** Never throws: a missing or corrupt batch must not break capture. */
export async function readBatch(workspace: string): Promise<CaptureBatch | undefined> {
  let raw: string
  try {
    raw = await readFileAtomic(batchPath(workspace))
  } catch {
    return undefined
  }
  try {
    return normalizeBatch(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Persist the batch and propagate failures for a visible host notice. */
export async function writeBatch(workspace: string, batch: CaptureBatch): Promise<boolean> {
  const dir = storePaths(workspace).dir
  await withStoreLock(dir, async () => {
    await writeFileAtomic(batchPath(workspace), `${JSON.stringify(batch, null, 2)}\n`)
  })
  return true
}
