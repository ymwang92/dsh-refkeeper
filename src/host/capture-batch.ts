import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { BATCH_MARKER, normalizeBatch } from '../core/batch.ts'
import type { CaptureBatch } from '../core/batch.ts'
import { storePaths } from '../store/io.ts'
import { writeFileAtomic } from '../store/atomic.ts'

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
    raw = await readFile(batchPath(workspace), 'utf8')
  } catch {
    return undefined
  }
  try {
    return normalizeBatch(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Best effort: a failed write degrades the default export scope, never capture. */
export async function writeBatch(workspace: string, batch: CaptureBatch): Promise<boolean> {
  try {
    await writeFileAtomic(batchPath(workspace), `${JSON.stringify(batch, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}
