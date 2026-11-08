import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileAtomic, withStoreLock, writeFileAtomic } from '../src/store/atomic.ts'
import { loadStore } from '../src/store/io.ts'
import { StoreError } from '../src/store/types.ts'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refkeeper-lock-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function lockFile(generation = 0): string {
  return join(dir, generation === 0 ? '.lock' : `.lock.${String(generation)}`)
}

async function writeStaleLock(ageMs: number, pid = 99999999): Promise<string> {
  const path = lockFile()
  await writeFile(path, JSON.stringify({ state: 'held', pid, token: 'dead-owner', at: '2020-01-01T00:00:00.000Z' }), 'utf8')
  const then = new Date(Date.now() - ageMs)
  await utimes(path, then, then)
  return path
}

async function lockNames(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.startsWith('.lock')).sort()
}

async function lockRecord(generation = 0): Promise<{ state: string; pid: number; token: string }> {
  return JSON.parse((await readFile(lockFile(generation), 'utf8')).trim()) as {
    state: string
    pid: number
    token: string
  }
}

describe('store lock', () => {
  it('waits on a fresh held lock and leaves it in place', async () => {
    const path = await writeStaleLock(0, process.pid)
    await expect(
      withStoreLock(dir, async () => 'unreachable', { timeoutMs: 60, retryMs: 10 }),
    ).rejects.toBeInstanceOf(StoreError)
    await expect(stat(path)).resolves.toBeDefined()
    expect((await lockRecord()).state).toBe('held')
  })

  it('does not steal an old lock while its owner process is still alive', async () => {
    const path = await writeStaleLock(60_000, process.pid)
    await expect(
      withStoreLock(dir, async () => 'unreachable', { staleMs: 1, timeoutMs: 60, retryMs: 10 }),
    ).rejects.toMatchObject({ code: 'lock-timeout' })
    expect((await readFile(path, 'utf8')).trim()).toContain('"pid":' + String(process.pid))
  })

  it('reuses a released generation after a stale lock', async () => {
    await writeStaleLock(60_000)
    await expect(withStoreLock(dir, async () => 'ran', { timeoutMs: 2_000 })).resolves.toBe('ran')
    const firstToken = (await lockRecord()).token
    await expect(withStoreLock(dir, async () => 'ran-again', { timeoutMs: 2_000 })).resolves.toBe('ran-again')
    expect(await lockNames()).toEqual(['.lock'])
    expect((await lockRecord()).state).toBe('released')
    expect((await lockRecord()).token).not.toBe(firstToken)
  })

  it('re-enters the same lock in one async chain but blocks an independent chain', async () => {
    let signalEntered!: () => void
    let releaseOuter!: () => void
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve
    })
    const outerGate = new Promise<void>((resolve) => {
      releaseOuter = resolve
    })

    const outer = withStoreLock(dir, async () => {
      await withStoreLock(dir, async () => 'nested')
      expect(await lockNames()).toEqual(['.lock'])
      signalEntered()
      await outerGate
    })

    let independentEntered = false
    try {
      await entered
      const independent = withStoreLock(
        dir,
        async () => {
          independentEntered = true
        },
        { timeoutMs: 2_000, retryMs: 10 },
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(independentEntered).toBe(false)
      releaseOuter()
      await Promise.all([outer, independent])
    } finally {
      releaseOuter()
    }

    expect(independentEntered).toBe(true)
    expect(await lockNames()).toEqual(['.lock'])
    expect((await lockRecord()).state).toBe('released')
  })

  it('keeps concurrent critical sections exclusive while reusing a generation', async () => {
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
    for (let index = 0; index < order.length; index += 2) {
      const start = order[index] ?? ''
      const end = order[index + 1] ?? ''
      expect(start.startsWith('start-')).toBe(true)
      expect(end).toBe(start.replace('start-', 'end-'))
    }
    expect(await lockNames()).toEqual(['.lock'])
    expect((await lockRecord()).state).toBe('released')
  })

  it('reuses one generation across 4 writers and 6 rounds', async () => {
    const roundDurations: number[] = []
    const lockFileCounts: number[] = []

    for (let round = 0; round < 6; round += 1) {
      const started = performance.now()
      await Promise.all(
        Array.from({ length: 4 }, (_, writer) =>
          withStoreLock(dir, async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 1))
            return writer
          }),
        ),
      )
      roundDurations.push(performance.now() - started)
      lockFileCounts.push((await lockNames()).length)
      expect(lockFileCounts[round]).toBe(1)
      expect((await lockRecord()).state).toBe('released')
    }

    console.info(
      `[lock-perf] 4 writers x 6 rounds: ${roundDurations.map((ms) => ms.toFixed(2)).join(', ')} ms; lock files: ${lockFileCounts.join(', ')}`,
    )
    expect(lockFileCounts).toEqual(Array(6).fill(1))
  })

  it('does not fsync snapshots, journals, locks, or directories', async () => {
    const probe = await open(dir, 'r')
    const handlePrototype = Object.getPrototypeOf(probe)
    await probe.close()
    const syncSpy = vi.spyOn(handlePrototype, 'sync')
    const dataSyncSpy = vi.spyOn(handlePrototype, 'datasync')

    const refsPath = join(dir, 'refs.json')
    const quarantinePath = join(dir, 'quarantine.json')
    const annotatedPath = join(dir, 'annotated.md')
    const refs = '[]'
    const quarantine = '[{"title":"pending"}]'
    const annotated = '# Test annotation\n'

    try {
      await withStoreLock(dir, async () => {
        await writeFileAtomic(refsPath, refs)
        await writeFileAtomic(quarantinePath, quarantine)
      })
      expect(dataSyncSpy).not.toHaveBeenCalled()
      expect(syncSpy).not.toHaveBeenCalled()
      expect(await readFileAtomic(refsPath)).toBe(refs)
      expect(await readFileAtomic(quarantinePath)).toBe(quarantine)

      await writeFileAtomic(annotatedPath, annotated)
      expect(dataSyncSpy).not.toHaveBeenCalled()
      expect(syncSpy).not.toHaveBeenCalled()
      expect(await readFileAtomic(annotatedPath)).toBe(annotated)
    } finally {
      dataSyncSpy.mockRestore()
      syncSpy.mockRestore()
    }
  })

  it('releases a generation even when the critical section throws', async () => {
    await expect(withStoreLock(dir, async () => { throw new Error('failure') })).rejects.toThrow('failure')
    expect((await lockRecord()).state).toBe('released')
    await expect(withStoreLock(dir, async () => 'reused')).resolves.toBe('reused')
    expect(await lockNames()).toEqual(['.lock'])
    expect((await lockRecord()).state).toBe('released')
  })
})

describe('migration backup', () => {
  it('refuses to migrate when the backup cannot be written', async () => {
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
    const kept = await readFile(join(dir, 'refs', 'refs.json'), 'utf8')
    expect(JSON.parse(kept)).toHaveLength(1)
    expect((await readdir(join(dir, 'refs'))).filter((name) => name.includes('.bak-'))).toEqual([])
  })
})
