import { constants } from 'node:fs'
import { copyFile, link, open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { StoreError } from './types.ts'

const LOCK_STALE_MS = 30_000
const LOCK_TIMEOUT_MS = 5_000
const LOCK_RETRY_MS = 20

function sleep(ms: number): Promise<void> {
  // Deliberately *not* unref'd: while a caller waits for the lock this timer is
  // often the only pending handle, and an unref'd timer would let the event
  // loop drain and the wakeup disappear.
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Write `data` to `file` without ever exposing a half-written file.
 *
 * tmp file in the same directory -> fsync(tmp) -> rename(tmp, target) -> fsync(dir).
 * The directory fsync is what makes the rename durable across a crash; it is
 * best-effort because not every filesystem/OS allows it.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`
  let handle
  try {
    handle = await open(tmp, 'w')
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(tmp, file)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(tmp, { force: true }).catch(() => undefined)
    throw new StoreError(
      'write-failed',
      `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    const dirHandle = await open(dir, 'r')
    await dirHandle.sync().catch(() => undefined)
    await dirHandle.close()
  } catch {
    // Directory fsync is an extra durability step; failing it does not
    // invalidate the rename that already succeeded.
  }
}

export interface LockOptions {
  readonly staleMs?: number
  readonly timeoutMs?: number
  readonly retryMs?: number
}

/** Run `fn` while holding `refs/.lock`.
 *
 * Cross-process safety comes from `open(path, 'wx')` (O_EXCL). A crashed
 * holder leaves a stale lock behind, so age is checked and the file is stolen
 * after `staleMs`. Contention is surfaced as StoreError('lock-timeout')
 * instead of silently racing.
 *
 * Reclaiming a stale lock never unlinks `refs/.lock` by path: a path-based
 * delete races with another process taking the lock between our `stat` and our
 * `rm`. Instead the file is *renamed* to a private name, which is atomic and
 * moves whichever inode is actually there, and only then compared with the
 * inode we inspected. A mismatch means we grabbed somebody else's live lock,
 * which is put back with `link` (fails rather than overwrites). Release uses
 * the same helper, so a stale-steal that replaced our lock cannot be undone by
 * our own cleanup.
 */
function claimName(lockPath: string): string {
  return `${lockPath}.claim-${String(process.pid)}-${String(Date.now())}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** Put a renamed lock back in place without overwriting a newer one. */
async function restoreClaim(claimPath: string, lockPath: string): Promise<void> {
  try {
    await link(claimPath, lockPath)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
  }
  // Filesystems without hard links: COPYFILE_EXCL still refuses to clobber.
  try {
    await copyFile(claimPath, lockPath, constants.COPYFILE_EXCL)
  } catch {
    // A newer lock owns the path now; the one we hold is obsolete.
  }
}

type UnlinkOutcome = 'removed' | 'raced' | 'missing'

/** What identifies the lock we inspected: inode plus its exact bytes.
 *
 * A bare inode is not enough — the filesystem recycles inode numbers, so a
 * fresh lock can land on the number of the stale one we just stat'ed.
 */
export interface LockIdentity {
  readonly ino: number
  readonly content: string
}

/** Remove `path` only if it still holds `expected`; never deletes blindly.
 *
 * Exported for the lock tests: the value of this function is the ordering it
 * enforces between the inode it moves and the inode it compares, which only a
 * direct test can pin down.
 */
export async function unlinkIfSame(path: string, expected: LockIdentity): Promise<UnlinkOutcome> {
  const claimPath = claimName(path)
  try {
    await rename(path, claimPath)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'raced'
  }
  try {
    const claimed = await stat(claimPath).catch(() => undefined)
    if (claimed === undefined) return 'missing'
    const claimedContent = await readFile(claimPath, 'utf8').catch(() => undefined)
    if (claimed.ino !== expected.ino || claimedContent !== expected.content) {
      await restoreClaim(claimPath, path)
      return 'raced'
    }
    await rm(claimPath, { force: true })
    return 'removed'
  } finally {
    await rm(claimPath, { force: true }).catch(() => undefined)
  }
}

/** Remove a stale lock only if it is still the exact file we inspected. */
async function stealStaleLock(lockPath: string, seen: LockIdentity): Promise<boolean> {
  return (await unlinkIfSame(lockPath, seen)) === 'removed'
}

const acquireQueues = new Map<string, Promise<unknown>>()

/** Serialize lock *acquisition* per path inside this process.
 *
 * Cross-process exclusion comes from `open(wx)`; this queue exists because the
 * stale-lock takeover moves a file before validating it, and two local callers
 * interleaving there can strand each other's fresh lock.
 */
function withAcquireTurn<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = acquireQueues.get(key) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  acquireQueues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

type Attempt = 'acquired' | 'retry'

export async function withStoreLock<T>(
  dir: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? LOCK_STALE_MS
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS
  const retryMs = options.retryMs ?? LOCK_RETRY_MS
  await mkdir(dir, { recursive: true })
  const lockPath = join(dir, '.lock')
  const started = Date.now()
  let handle: FileHandle | undefined
  let owner: LockIdentity | undefined

  for (;;) {
    const attempt = await withAcquireTurn(lockPath, async (): Promise<Attempt> => {
      try {
        const content = `${String(process.pid)} ${new Date().toISOString()}\n`
        handle = await open(lockPath, 'wx')
        await handle.writeFile(content, 'utf8')
        const ino = (await handle.stat()).ino
        // A takeover may have moved our file out of the way between `open` and
        // here; only a lock still sitting at the path means we own it.
        const current = await stat(lockPath).catch(() => undefined)
        if (current === undefined || current.ino !== ino) {
          await handle.close().catch(() => undefined)
          handle = undefined
          return 'retry'
        }
        owner = { ino, content }
        return 'acquired'
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const info = await stat(lockPath).catch(() => undefined)
        const content = info === undefined ? undefined : await readFile(lockPath, 'utf8').catch(() => undefined)
        if (info !== undefined && content !== undefined && Date.now() - info.mtimeMs > staleMs) {
          await stealStaleLock(lockPath, { ino: info.ino, content })
        }
        return 'retry'
      }
    })
    if (attempt === 'acquired') break
    if (Date.now() - started > timeoutMs) {
      throw new StoreError('lock-timeout', `refs store is locked by another process (${lockPath})`)
    }
    await sleep(retryMs)
  }

  try {
    return await fn()
  } finally {
    await handle?.close().catch(() => undefined)
    // Only delete the lock we created; a stale-steal may have replaced it and
    // removing a live holder's lock would let two writers in. `unlinkIfSame`
    // renames before comparing, so it cannot remove a lock that arrived after
    // its own check.
    if (owner !== undefined) {
      await unlinkIfSame(lockPath, owner).catch(() => undefined)
    }
  }
}

const queues = new Map<string, Promise<unknown>>()

/** Serialize operations on one store within this process.
 *
 * The file lock already excludes other processes; this keeps two concurrent
 * tool calls in the same host from both reading the same snapshot.
 */
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}
