import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  coerceReference,
  loadQuarantine,
  loadStore,
  saveQuarantined,
  saveReference,
  storePaths,
} from '../src/store/io.ts'
import { StoreError } from '../src/store/types.ts'
import type { StoredReference } from '../src/store/types.ts'

const NOW = '2026-10-28T12:00:00.000Z'

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'refkeeper-store-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function ref(overrides: Record<string, unknown> = {}): StoredReference {
  const built = coerceReference(
    {
      title: 'Nanometre-scale thermometry in a living cell',
      type: 'journalArticle',
      authors: [{ family: 'Kucsko', given: 'G.' }],
      year: 2013,
      identifiers: { doi: '10.1038/nature12373' },
      ...overrides,
    },
    NOW,
  )
  if (!built) throw new Error('fixture did not coerce')
  return built
}

describe('store round trip', () => {
  it('writes refs/refs.json with a schema version and reads it back', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const file = await readFile(join(workspace, 'refs', 'refs.json'), 'utf8')
    const parsed = JSON.parse(file) as { schemaVersion: number; references: unknown[] }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.references).toHaveLength(1)

    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.migrated).toBe(false)
    expect(loaded.dropped).toBe(0)
    expect(loaded.state.references).toHaveLength(1)
    expect(loaded.state.references[0]?.title).toBe('Nanometre-scale thermometry in a living cell')
    expect(loaded.state.references[0]?.identifiers.doi).toBe('10.1038/nature12373')
  })

  it('replaces instead of duplicating when the identity repeats', async () => {
    const first = await saveReference(workspace, ref(), { now: NOW })
    const second = await saveReference(
      workspace,
      ref({ title: 'Nanometre-scale thermometry in a living cell (erratum)' }),
      { now: '2026-10-28T12:05:00.000Z' },
    )
    expect(second.replaced).toBe(true)
    expect(second.state.references).toHaveLength(1)
    expect(second.reference.addedAt).toBe(first.reference.addedAt)
    expect(second.reference.updatedAt).toBe('2026-10-28T12:05:00.000Z')
  })

  it('keeps distinct works apart', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    await saveReference(
      workspace,
      ref({
        title: 'Observation of a kilogram-scale oscillator',
        year: 2019,
        identifiers: { doi: '10.1000/other' },
      }),
      { now: NOW },
    )
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references).toHaveLength(2)
  })

  it('routes quarantined entries to their own file', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    await saveQuarantined(workspace, ref({ title: 'Unverified note' }), { now: NOW })

    const main = await loadStore(workspace, { now: NOW })
    expect(main.state.references).toHaveLength(1)
    const quarantine = await loadQuarantine(workspace, { now: NOW })
    expect(quarantine.entries).toHaveLength(1)
    expect(quarantine.entries[0]?.title).toBe('Unverified note')
  })

  it('serialises concurrent writers instead of losing one', async () => {
    await Promise.all([
      saveReference(workspace, ref(), { now: NOW }),
      saveReference(
        workspace,
        ref({ title: 'Second writer', year: 2020, identifiers: { doi: '10.1000/second' } }),
        { now: NOW },
      ),
    ])
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references).toHaveLength(2)
  })

  it('leaves no temporary files behind', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const entries = await readdir(storePaths(workspace).dir)
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(entries).toContain('refs.json')
  })
})

describe('store migration and damage', () => {
  it('migrates a legacy bare array and keeps a backup', async () => {
    const dir = storePaths(workspace).dir
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'refs.json'),
      JSON.stringify([{ title: 'Legacy row', year: 2001, identifiers: { doi: '10.1000/legacy' } }]),
      'utf8',
    )

    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.migrated).toBe(true)
    expect(loaded.state.references).toHaveLength(1)
    expect(loaded.backupPath).toBeDefined()
    const backup = await readFile(loaded.backupPath ?? '', 'utf8')
    expect(backup).toContain('Legacy row')
  })

  it('refuses a future schema version', async () => {
    const dir = storePaths(workspace).dir
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'refs.json'), JSON.stringify({ schemaVersion: 99, references: [] }), 'utf8')
    await expect(loadStore(workspace, { now: NOW })).rejects.toBeInstanceOf(StoreError)
  })

  it('refuses a file with no reference list', async () => {
    const dir = storePaths(workspace).dir
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'refs.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8')
    await expect(loadStore(workspace, { now: NOW })).rejects.toMatchObject({ code: 'corrupt-store' })
  })

  it('drops rows without a title instead of failing the whole file', async () => {
    const dir = storePaths(workspace).dir
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'refs.json'),
      JSON.stringify({
        schemaVersion: 1,
        references: [{ year: 2001 }, { title: 'Kept', year: 2002 }],
      }),
      'utf8',
    )
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.dropped).toBe(1)
    expect(loaded.state.references.map((entry) => entry.title)).toEqual(['Kept'])
  })

  it('enforces the capacity limit on new entries only', async () => {
    await saveReference(workspace, ref(), { now: NOW, max: 1 })
    await expect(
      saveReference(
        workspace,
        ref({ title: 'Over the limit', year: 2020, identifiers: { doi: '10.1000/over' } }),
        { now: NOW, max: 1 },
      ),
    ).rejects.toMatchObject({ code: 'capacity' })
    // Replacing the existing entry at capacity is still allowed.
    await expect(saveReference(workspace, ref(), { now: NOW, max: 1 })).resolves.toBeDefined()
  })
})

describe('reference identity', () => {
  const now = '2026-10-28T00:00:00.000Z'

  it('keeps a DOI sent in the flat shape used by `/refs save`', () => {
    const ref = coerceReference(
      { title: 'Nanometre-scale thermometry in a living cell', year: 2013, doi: '10.1038/nature12373' },
      now,
    )
    expect(ref?.identifiers).toEqual({ doi: '10.1038/nature12373' })
    // Identity drives dedupe: without the DOI this collapses onto a title key
    // and merges with any same-titled, same-year paper.
    expect(ref?.id).toBe('doi:10.1038/nature12373')
  })

  it('accepts arxivId, isbn and reportNumber in the flat shape', () => {
    const ref = coerceReference(
      { title: 'Attention is all you need', arxivId: '1706.03762', isbn: '9780306406157', reportNumber: 'NUREG-1150' },
      now,
    )
    expect(ref?.identifiers).toEqual({ arxiv: '1706.03762', isbn: '9780306406157', reportNumber: 'NUREG-1150' })
    expect(ref?.id).toBe('arxiv:1706.03762')
  })

  it('prefers the nested identifiers object when both shapes are present', () => {
    const ref = coerceReference(
      { title: 'Paper', identifiers: { doi: '10.1000/nested' }, doi: '10.1000/flat' },
      now,
    )
    expect(ref?.identifiers).toEqual({ doi: '10.1000/nested' })
  })
})
