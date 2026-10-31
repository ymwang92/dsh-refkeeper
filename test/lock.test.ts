import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unlinkIfSame, withStoreLock } from '../src/store/atomic.ts'
import { loadStore } from '../src/store/io.ts'
import { StoreError } from '../src/store/types.ts'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refkeeper-lock-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function lockFile(): Promise<string> {
  return join(dir, '.lock')
}

async function writeStaleLock(ageMs: number): Promise<string> {
  const path = await lockFile()
  await writeFile(path, '99999 2020-01-01T00:00:00.000Z\n', 'utf8')
  const then = new Date(Date.now() - ageMs)
  await utimes(path, then, then)
  return path
}

async function leftovers(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.startsWith('.lock'))
}

describe('store lock', () => {
  it('does not wait on a fresh lock and leaves it in place', async () => {
    const path = await writeStaleLock(0)
    await expect(
      withStoreLock(dir, async () => 'unreachable', { timeoutMs: 80, retryMs: 10 }),
    ).rejects.toBeInstanceOf(StoreError)
    await expect(stat(path)).resolves.toBeDefined()
  })

  it('reclaims a stale lock and cleans up its claim file', async () => {
    await writeStaleLock(60_000)
    const result = await withStoreLock(dir, async () => 'ran', { timeoutMs: 2_000 })
    expect(result).toBe('ran')
    expect(await leftovers()).toEqual([])
  })

  it('lets only one concurrent reclaimer through and never deletes a live lock', async () => {
    await writeStaleLock(60_000)
    const order: string[] = []
    const runs = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        withStoreLock(
          dir,
          async () => {
            order.push(`start-${String(index)}`)
            await new Promise((resolve) => setTimeout(resolve, 5))
            order.push(`end-${String(index)}`)
            return index
          },
          { timeoutMs: 5_000 },
        ),
      ),
    )
    expect(runs).toHaveLength(5)
    // Each critical section must be exclusive: a start is always immediately
    // followed by its own end, whichever waiter wins the race.
    for (let index = 0; index < order.length; index += 2) {
      const start = order[index] ?? ''
      const end = order[index + 1] ?? ''
      expect(start.startsWith('start-')).toBe(true)
      expect(end).toBe(start.replace('start-', 'end-'))
    }
    expect(await leftovers()).toEqual([])
  })
})

describe('migration backup', () => {
  it('refuses to migrate when the backup cannot be written', async () => {
    // Legacy bare array (schemaVersion 0) triggers the migration path.
    await mkdir(join(dir, 'refs'), { recursive: true })
    await writeFile(
      join(dir, 'refs', 'refs.json'),
      JSON.stringify([{ title: 'Legacy entry', year: 2001, type: 'journalArticle' }], null, 2),
      'utf8',
    )
    await expect(
      loadStore(dir, {
        backup: async () => {
          throw new Error('disk full')
        },
      }),
    ).rejects.toMatchObject({ code: 'backup-failed' })
    // The original file must be untouched, and no half-written backup left.
    const kept = await readFile(join(dir, 'refs', 'refs.json'), 'utf8')
    expect(JSON.parse(kept)).toHaveLength(1)
    expect((await readdir(join(dir, 'refs'))).filter((name) => name.includes('.bak-'))).toEqual([])
  })
})

describe('stale lock replacement window', () => {
  it('refuses to delete a lock whose inode changed after inspection', async () => {
    const path = await lockFile()
    await writeFile(path, '111 2020-01-01T00:00:00.000Z\n', 'utf8')
    const inspected = { ino: (await stat(path)).ino, content: await readFile(path, 'utf8') }
    // Another process reclaims and takes the lock between our stat and our
    // rename: the file at `path` is now a different inode.
    await rm(path)
    await writeFile(path, '222 live holder\n', 'utf8')
    const outcome = await unlinkIfSame(path, inspected)
    expect(outcome).toBe('raced')
    expect(await readFile(path, 'utf8')).toBe('222 live holder\n')
    expect(await leftovers()).toEqual(['.lock'])
  })

  it('removes the lock when the inode still matches', async () => {
    const path = await lockFile()
    await writeFile(path, '333 stale\n', 'utf8')
    const inspected = { ino: (await stat(path)).ino, content: await readFile(path, 'utf8') }
    expect(await unlinkIfSame(path, inspected)).toBe('removed')
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await leftovers()).toEqual([])
  })

  it('reports a lock that vanished before the claim rename', async () => {
    expect(await unlinkIfSame(join(dir, '.lock'), { ino: 1, content: '' })).toBe('missing')
  })

  it('refuses when the inode was recycled for a different lock', async () => {
    // Same inode, different bytes: this is what a recycled inode looks like
    // when a crashed holder's number is reused by a fresh lock.
    const path = await lockFile()
    await writeFile(path, '555 crashed holder\n', 'utf8')
    const inspected = { ino: (await stat(path)).ino, content: await readFile(path, 'utf8') }
    await writeFile(path, '666 live holder\n', 'utf8')
    expect(await unlinkIfSame(path, inspected)).toBe('raced')
    expect(await readFile(path, 'utf8')).toBe('666 live holder\n')
    expect(await leftovers()).toEqual(['.lock'])
  })

  it('leaves a lock that replaced ours in place on release', async () => {
    const path = join(dir, '.lock')
    await withStoreLock(dir, async () => {
      // Simulate a steal: our lock is gone, another holder created its own.
      await rm(path)
      await writeFile(path, '444 other holder\n', 'utf8')
    })
    expect(await readFile(path, 'utf8')).toBe('444 other holder\n')
    expect(await leftovers()).toEqual(['.lock'])
  })
})
