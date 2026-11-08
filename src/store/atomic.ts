import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomInt } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { StoreError } from './types.ts'

const LOCK_STALE_MS = 30_000
const LOCK_TIMEOUT_MS = 5_000
const LOCK_RETRY_MS = 20
const LOCK_RECORD_BYTES = 256
const JOURNAL_TAIL_BYTES = 512
const heldLockDirectories = new AsyncLocalStorage<ReadonlySet<string>>()

function sleep(ms: number): Promise<void> {
  // Deliberately *not* unref'd: while a caller waits for the lock this timer is
  // often the only pending handle, and an unref'd timer would let the event
  // loop drain and the wakeup disappear.
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function digest(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function journalPath(file: string): string {
  return `${file}.journal`
}

function snapshotPath(file: string, version: number): string {
  return `${file}.v${String(version)}`
}

interface CommitRecord {
  readonly version: number
  readonly sha256: string
}

function parseJournal(text: string): CommitRecord[] {
  const records: CommitRecord[] = []
  const lines = text.split('\n')
  if (!text.endsWith('\n')) lines.pop()
  for (const line of lines) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'version' in parsed &&
        typeof parsed.version === 'number' &&
        Number.isSafeInteger(parsed.version) &&
        parsed.version > 0 &&
        'sha256' in parsed &&
        typeof parsed.sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(parsed.sha256)
      ) {
        records.push({ version: parsed.version, sha256: parsed.sha256 })
      }
    } catch {
      // An interrupted final append is not a commit. Earlier complete records
      // remain authoritative and are intentionally left untouched.
    }
  }
  return records
}

async function journalRecords(file: string): Promise<CommitRecord[]> {
  try {
    return parseJournal(await readFile(journalPath(file), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function journalTailRecords(
  file: string,
): Promise<{ records: CommitRecord[]; complete: boolean }> {
  let handle: FileHandle
  try {
    handle = await open(journalPath(file), 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], complete: true }
    throw error
  }

  try {
    const { size } = await handle.stat()
    const length = Math.min(size, JOURNAL_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = length === 0
      ? { bytesRead: 0 }
      : await handle.read(buffer, 0, length, size - length)
    const records = parseJournal(buffer.toString('utf8', 0, bytesRead))
    if (records.length === 0 && size > length) {
      // A corrupt/oversized tail may hide the most recent complete entry.
      return { records: await journalRecords(file), complete: true }
    }
    return { records, complete: size <= length }
  } finally {
    await handle.close()
  }
}

async function readCommittedSnapshot(file: string, records: readonly CommitRecord[]): Promise<string | undefined> {
  for (const record of [...records].reverse()) {
    try {
      const data = await readFile(snapshotPath(file, record.version), 'utf8')
      if (digest(data) === record.sha256) return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
  return undefined
}

/** Read a logical store file, resolving its latest complete immutable version.
 *
 * Existing canonical files remain readable for migration/backward compatibility.
 * The normal read inspects only a bounded journal tail; the complete journal is
 * read only if recent snapshots fail validation and older commits are needed.
 */
export async function readFileAtomic(file: string): Promise<string> {
  const tail = await journalTailRecords(file)
  const recent = await readCommittedSnapshot(file, tail.records)
  if (recent !== undefined) return recent

  if (!tail.complete) {
    const fallback = await readCommittedSnapshot(file, await journalRecords(file))
    if (fallback !== undefined) return fallback
  }
  return readFile(file, 'utf8')
}

function usesVersionJournal(file: string): boolean {
  return ['refs.json', 'quarantine.json', 'annotated.md', 'last-capture.json'].includes(basename(file))
}

async function writeWithRename(file: string, data: string): Promise<void> {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`
  let handle: FileHandle | undefined
  try {
    handle = await open(tmp, 'w')
    await handle.writeFile(data, 'utf8')
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
}

/** Persist refs data as an immutable snapshot and append a checksummed commit record.
 *
 * This avoids rename/unlink entirely for the files affected by the host sandbox.
 * Until the journal record is complete, the previous committed version remains
 * visible. Uncommitted snapshots are retained because unlink is forbidden.
 */
async function appendJournalRecord(file: string, record: CommitRecord): Promise<void> {
  const handle = await open(journalPath(file), 'a+')
  try {
    const { size } = await handle.stat()
    let separator = ''
    if (size > 0) {
      const lastByte = Buffer.alloc(1)
      const { bytesRead } = await handle.read(lastByte, 0, 1, size - 1)
      if (bytesRead !== 1 || lastByte[0] !== 0x0a) separator = '\0\n'
    }

    const entry = `${separator}${JSON.stringify(record)}\n`
    await handle.writeFile(entry, 'utf8')
  } finally {
    await handle.close()
  }
}

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  if (!usesVersionJournal(file)) {
    await writeWithRename(file, data)
    return
  }
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  await serialize(file, async () => {
    const tail = await journalTailRecords(file)
    let version = Math.max(0, ...tail.records.map((record) => record.version)) + 1
    let snapshot: string
    let handle: FileHandle
    for (;;) {
      snapshot = snapshotPath(file, version)
      try {
        handle = await open(snapshot, 'wx')
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        // Failed commits can leave an immutable snapshot without a journal
        // record. Avoid linearly probing all prior orphan files: jump to a
        // random safe integer and let O_EXCL confirm it is unused.
        version = randomInt(1, 2 ** 48)
      }
    }

    try {
      // The journal record is the commit point. A crash before the complete
      // newline-terminated append leaves this snapshot invisible; readers still
      // validate the snapshot digest and fall back to the prior commit.
      await handle.writeFile(data, 'utf8')
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw new StoreError(
        'write-failed',
        `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await handle.close()

    try {
      await appendJournalRecord(file, { version, sha256: digest(data) })
    } catch (error) {
      throw new StoreError(
        'write-failed',
        `cannot commit ${file}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}

export interface LockOptions {
  readonly staleMs?: number
  readonly timeoutMs?: number
  readonly retryMs?: number
}

interface LockRecord {
  readonly state: 'held' | 'released'
  readonly pid: number
  readonly token: string
  readonly at: string
}

function lockName(dir: string, generation: number): string {
  return join(dir, generation === 0 ? '.lock' : `.lock.${String(generation)}`)
}

function lockContent(record: LockRecord): string {
  const serialized = JSON.stringify(record)
  if (Buffer.byteLength(serialized, 'utf8') > LOCK_RECORD_BYTES) {
    throw new Error('lock record exceeds fixed-size limit')
  }
  return serialized.padEnd(LOCK_RECORD_BYTES, ' ')
}

function parseLockRecord(content: string | undefined): LockRecord | undefined {
  if (content === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(content.trim())
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'state' in parsed &&
      (parsed.state === 'held' || parsed.state === 'released') &&
      'pid' in parsed &&
      typeof parsed.pid === 'number' &&
      'token' in parsed &&
      typeof parsed.token === 'string' &&
      'at' in parsed &&
      typeof parsed.at === 'string'
    ) {
      return { state: parsed.state, pid: parsed.pid, token: parsed.token, at: parsed.at }
    }
  } catch {
    // A malformed recent lock is treated as held; age-based recovery handles
    // crashes between O_EXCL creation and the initial record write.
  }
  return undefined
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Only ESRCH proves the owner is gone. Unknown errors fail closed so a
    // live lock is never reclaimed merely because the probe was inconclusive.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function readLockContent(handle: FileHandle): Promise<string> {
  const buffer = Buffer.alloc(LOCK_RECORD_BYTES)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  return buffer.toString('utf8', 0, bytesRead)
}

async function lockIsReusable(handle: FileHandle, staleMs: number): Promise<boolean> {
  const [info, content] = await Promise.all([handle.stat(), readLockContent(handle)])
  const record = parseLockRecord(content)
  if (record?.state === 'released') return true
  const age = Date.now() - info.mtimeMs
  if (age <= staleMs) return false
  if (record?.state === 'held' && processIsAlive(record.pid)) return false
  return true
}

async function writeLockContent(handle: FileHandle, content: string): Promise<void> {
  const { bytesWritten } = await handle.write(content, 0, 'utf8')
  if (bytesWritten !== Buffer.byteLength(content, 'utf8')) {
    throw new Error('short lock record write')
  }
}

async function markReleased(handle: FileHandle, token: string): Promise<void> {
  const content = lockContent({ state: 'released', pid: process.pid, token, at: new Date().toISOString() })
  await writeLockContent(handle, content)
}

interface HeldLock {
  readonly path: string
  readonly handle: FileHandle
  readonly token: string
}

async function acquireLock(dir: string, staleMs: number): Promise<HeldLock | undefined> {
  for (let generation = 0; ; generation += 1) {
    const path = lockName(dir, generation)
    let handle: FileHandle
    let created = false
    try {
      handle = await open(path, 'wx+')
      created = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        handle = await open(path, 'r+')
      } catch (openError) {
        if ((openError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw openError
      }
      try {
        if (!(await lockIsReusable(handle, staleMs))) {
          await handle.close()
          return undefined
        }
      } catch (readError) {
        await handle.close().catch(() => undefined)
        throw readError
      }
    }

    const token = `${String(process.pid)}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
    try {
      const content = lockContent({ state: 'held', pid: process.pid, token, at: new Date().toISOString() })
      await writeLockContent(handle, content)
      const confirmed = parseLockRecord(await readLockContent(handle))
      if (confirmed?.state !== 'held' || confirmed.token !== token) {
        await handle.close()
        // If another owner won the reuse race, wait for that owner rather than
        // taking a later generation and entering the same critical section.
        if (confirmed?.state === 'held') return undefined
        continue
      }
      return { path, handle, token }
    } catch (error) {
      if (created) await markReleased(handle, token).catch(() => undefined)
      await handle.close().catch(() => undefined)
      throw new StoreError(
        'write-failed',
        `cannot write store lock ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** Run `fn` while holding an exclusive generation lock in `refs/`.
 *
 * The host denies rename/unlink, so release overwrites this lock's fixed-size
 * record with `state: released`. Released generations are reclaimed in place
 * after the token is checked, preventing unbounded lock-file growth. Lock
 * records are coordination metadata, so writes are verified but not fsynced.
 */
export async function withStoreLock<T>(
  dir: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const lockDir = resolve(dir)
  const inheritedLocks = heldLockDirectories.getStore()
  if (inheritedLocks?.has(lockDir) === true) return await fn()

  return await serialize(lockDir, async () => {
    const staleMs = options.staleMs ?? LOCK_STALE_MS
    const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS
    const retryMs = options.retryMs ?? LOCK_RETRY_MS
    await mkdir(lockDir, { recursive: true })
    const started = Date.now()
    let held: HeldLock | undefined
    while (held === undefined) {
      held = await acquireLock(lockDir, staleMs)
      if (held !== undefined) break
      if (Date.now() - started > timeoutMs) {
        throw new StoreError('lock-timeout', `refs store is locked by another process (${join(lockDir, '.lock')})`)
      }
      await sleep(retryMs)
    }

    const activeLocks = new Set(inheritedLocks)
    activeLocks.add(lockDir)
    try {
      return await heldLockDirectories.run(activeLocks, fn)
    } finally {
      // Detached async work can inherit this store; stop treating the key as
      // held before releasing the physical lock.
      activeLocks.delete(lockDir)
      try {
        await markReleased(held.handle, held.token)
      } finally {
        await held.handle.close().catch(() => undefined)
      }
    }
  })
}

const queues = new Map<string, Promise<unknown>>()

/** Serialize operations on one store within this process. */
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}
