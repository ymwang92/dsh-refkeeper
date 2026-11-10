import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileAtomic, writeFileAtomic } from '../src/store/atomic.ts'
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

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn(async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    }),
  }
})

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
    const logicalPath = join(workspace, 'refs', 'refs.json')
    const file = await readFileAtomic(logicalPath)
    const parsed = JSON.parse(file) as { schemaVersion: number; references: unknown[] }
    expect(await readFile(`${logicalPath}.v1`, 'utf8')).toBe(file)
    expect(await readFile(`${logicalPath}.journal`, 'utf8')).toContain('"version":1')
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
    await saveQuarantined(workspace, ref({ title: 'Unverified note', identifiers: { doi: '10.1000/unverified-note' } }), { now: NOW })

    const main = await loadStore(workspace, { now: NOW })
    expect(main.state.references).toHaveLength(1)
    const quarantine = await loadQuarantine(workspace, { now: NOW })
    expect(quarantine.entries).toHaveLength(1)
    expect(quarantine.entries[0]?.title).toBe('Unverified note')
  })

  it('removes a stale quarantine copy when a later verified save succeeds', async () => {
    const stale = ref({ verification: { status: 'unverified', checkedAt: NOW } })
    await saveQuarantined(workspace, stale, { now: NOW })
    await saveReference(workspace, ref({ verification: { status: 'verified', checkedAt: NOW } }), { now: NOW })

    expect((await loadStore(workspace, { now: NOW })).state.references).toHaveLength(1)
    expect((await loadQuarantine(workspace, { now: NOW })).entries).toHaveLength(0)
  })

  it('does not add a quarantine copy when the identity already exists in main', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const outcome = await saveQuarantined(workspace, ref({ verification: { status: 'unverified', checkedAt: NOW } }), { now: NOW })
    expect(outcome.stored).toBe(false)
    expect(outcome.state.entries).toHaveLength(0)
    expect((await loadQuarantine(workspace, { now: NOW })).entries).toHaveLength(0)
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

  it('commits a complete immutable file without rename and keeps the logical file readable', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const paths = storePaths(workspace)
    const logical = await readFileAtomic(paths.refs)
    const committed = JSON.parse(logical) as { schemaVersion: number; references: unknown[] }
    expect(committed.schemaVersion).toBe(1)
    expect(committed.references).toHaveLength(1)
    expect(await readFile(`${paths.refs}.v1`, 'utf8')).toBe(logical)
    const entries = await readdir(paths.dir)
    expect(entries).toContain('refs.json.journal')
    expect(entries).toContain('refs.json.v1')
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the prior commit visible when an uncommitted snapshot is partial', async () => {
    const file = storePaths(workspace).refs
    await writeFileAtomic(file, 'complete prior value')
    await writeFile(`${file}.v2`, 'partial value')

    await expect(readFileAtomic(file)).resolves.toBe('complete prior value')
  })

  it('recovers from a torn journal tail without exposing a partial value', async () => {
    const file = storePaths(workspace).refs
    await writeFileAtomic(file, 'complete prior value')
    await writeFile(`${file}.v2`, 'partial value')
    await writeFile(`${file}.journal`, '{"version":2,"sha256":"incomplete', { flag: 'a' })

    await expect(readFileAtomic(file)).resolves.toBe('complete prior value')
    await writeFileAtomic(file, 'complete next value')
    await expect(readFileAtomic(file)).resolves.toBe('complete next value')
    const journalRecords = (await readFile(`${file}.journal`, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as { version: number }]
        } catch {
          return []
        }
      })
    const latestVersion = journalRecords.at(-1)?.version
    expect(latestVersion).toBeDefined()
    expect(await readFile(`${file}.v${latestVersion}`, 'utf8')).toBe('complete next value')
  })

  it('ignores a valid journal record without its terminating newline', async () => {
    const file = storePaths(workspace).refs
    const prior = 'complete prior value'
    const uncommitted = 'complete snapshot without commit delimiter'
    await writeFileAtomic(file, prior)
    await writeFile(`${file}.v2`, uncommitted)
    const sha256 = createHash('sha256').update(uncommitted, 'utf8').digest('hex')
    await writeFile(`${file}.journal`, JSON.stringify({ version: 2, sha256 }), { flag: 'a' })

    await expect(readFileAtomic(file)).resolves.toBe(prior)
  })

  it('poisons a valid unterminated journal record before committing a later write', async () => {
    const file = storePaths(workspace).refs
    const prior = 'prior committed value'
    const orphan = 'valid but uncommitted snapshot'
    await writeFileAtomic(file, prior)
    await writeFile(`${file}.v2`, orphan)
    const orphanRecord = {
      version: 2,
      sha256: createHash('sha256').update(orphan, 'utf8').digest('hex'),
    }
    await writeFile(`${file}.journal`, JSON.stringify(orphanRecord), { flag: 'a' })

    await writeFileAtomic(file, 'new committed value')
    const journal = await readFile(`${file}.journal`, 'utf8')
    expect(journal).toContain(`${JSON.stringify(orphanRecord)}\u0000\n`)

    const committed = journal
      .split('\n')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as { version: number }]
        } catch {
          return []
        }
      })
      .at(-1)
    expect(committed).toBeDefined()
    await writeFile(`${file}.v${committed?.version}`, 'damaged new snapshot')
    await expect(readFileAtomic(file)).resolves.toBe(prior)
  })

  it('propagates non-ENOENT snapshot read errors instead of falling back', async () => {
    const file = storePaths(workspace).refs
    await writeFileAtomic(file, 'committed version')
    await writeFile(file, 'legacy canonical fallback')
    await rm(`${file}.v1`)
    await mkdir(`${file}.v1`)

    await expect(readFileAtomic(file)).rejects.toMatchObject({ code: 'EISDIR' })
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

  it('backs up a journal-backed legacy payload before migrating without a canonical file', async () => {
    const source = storePaths(workspace).refs
    const legacy = JSON.stringify([
      { title: 'Versioned legacy row', year: 2001, identifiers: { doi: '10.1000/versioned-legacy' } },
    ])
    await writeFileAtomic(source, legacy)

    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.migrated).toBe(true)
    expect(loaded.state.references[0]?.title).toBe('Versioned legacy row')
    expect(loaded.backupPath).toBe(`${source}.bak-2026-10-28T12-00-00-000Z`)
    await expect(readFile(loaded.backupPath ?? '', 'utf8')).resolves.toBe(legacy)
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

  it('normalizes flat and nested PMID/PMCID without changing identity', () => {
    const flat = coerceReference(
      { title: 'Flat article', year: 2015, pmid: '12 345 678', pmcid: ' pmc1234567 ' },
      now,
    )
    const nested = coerceReference(
      {
        title: 'Nested article',
        year: 2015,
        identifiers: { pmid: '12 345 678', pmcid: 'pmc 1234567' },
        pmid: '87654321',
        pmcid: 'PMC7654321',
      },
      now,
    )
    expect(flat?.identifiers).toEqual({ pmid: '12345678', pmcid: 'PMC1234567' })
    expect(nested?.identifiers).toEqual({ pmid: '12345678', pmcid: 'PMC1234567' })

    const withIds = coerceReference(
      { title: 'Same article', year: 2015, pmid: '12345678', pmcid: 'PMC1234567' },
      now,
    )
    const withoutIds = coerceReference({ title: 'Same article', year: 2015 }, now)
    expect(withIds?.id).toBe(withoutIds?.id)
    expect(withIds?.id).not.toContain('pmid:')
    expect(withIds?.id).not.toContain('pmcid:')
  })
})

describe('annotated.md', () => {
  it('omits annotation fields that only describe the missing evidence', async () => {
    const filler = coerceReference(
      {
        title: 'Filler annotation',
        type: 'journalArticle',
        authors: [{ family: 'Daly', given: 'C.' }],
        year: 2008,
        identifiers: { doi: '10.1002/joc.1688' },
        annotation: {
          summary: 'A gridded climate dataset.',
          caveats: 'The conversation excerpt does not mention or cite this reference.',
          source: 'model',
          status: 'complete',
        },
      },
      NOW,
    )
    if (!filler) throw new Error('fixture did not coerce')
    await saveReference(workspace, filler, { now: NOW })
    const rendered = await readFileAtomic(join(workspace, 'refs', 'annotated.md'))
    expect(rendered).toContain('**Summary** — A gridded climate dataset.')
    // The caveat was pure meta-commentary, so the line is absent rather than blank.
    expect(rendered).not.toContain('**Caveats**')
    expect(rendered).not.toContain('does not mention')
  })
})
