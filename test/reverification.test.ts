import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeBatch } from '../src/core/batch.ts'
import { readBatch, writeBatch } from '../src/host/capture-batch.ts'
import { runStoreCommand, verificationClaimOf } from '../src/host/store-command.ts'
import { loadQuarantine, writeQuarantine } from '../src/store/io.ts'
import { SCHEMA_VERSION } from '../src/store/types.ts'
import type { RefIdentifiers, StoredReference } from '../src/store/types.ts'
import type { VerificationReport } from '../src/verify/types.ts'

const capturedAt = '2026-11-22T22:00:00.000Z'

function reference(identifiers: RefIdentifiers): StoredReference {
  return {
    id: 'pmid:12345678',
    type: 'journalArticle',
    title: 'A test reference',
    authors: [{ family: 'Example', given: 'Author' }],
    year: 2020,
    identifiers,
    provenance: { capturedAt, scope: 'all', trigger: 'tool' },
    verification: { status: 'quarantined', checkedAt: '2020-01-01T00:00:00.000Z', reasons: ['old-reason'], note: 'old note' },
    addedAt: capturedAt,
    updatedAt: capturedAt,
  }
}

describe('re-verification', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'refkeeper-reverification-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('passes ISBN into verification claims', () => {
    expect(verificationClaimOf(reference({ isbn: '9780306406157' }))).toMatchObject({ isbn: '9780306406157' })
  })

  it('passes report numbers into verification claims', () => {
    expect(verificationClaimOf(reference({ reportNumber: 'NASA/TM-1981-1234' }))).toMatchObject({ reportNumber: 'NASA/TM-1981-1234' })
  })

  it('passes PMID into verification claims', () => {
    expect(verificationClaimOf(reference({ pmid: '12345678' }))).toMatchObject({ pmid: '12345678' })
  })

  it('refreshes failed verification metadata without promoting the quarantined entry', async () => {
    const ref = reference({ pmid: '12345678' })
    const initialQuarantine = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: capturedAt,
      entries: [ref],
    }
    await writeQuarantine(workspace, initialQuarantine)
    await writeBatch(workspace, {
      capturedAt,
      scope: 'all',
      entries: [{ id: ref.id, title: ref.title, status: 'quarantined', reason: 'old capture reason' }],
    })

    const checkedAt = '2026-11-22T22:58:00.000Z'
    const report: VerificationReport = {
      status: 'warning',
      title: { pass: true, ours: ref.title, theirs: ref.title, score: 1 },
      year: { pass: false, ours: '2020', theirs: '2018', score: -1 },
      firstAuthor: { pass: true, ours: 'Example', theirs: 'Example', score: 1 },
      passed: 2,
      sources: ['pubmed'],
      partial: false,
      reasons: ['year-mismatch'],
    }
    const result = await runStoreCommand('promote', {
      workspace,
      now: () => checkedAt,
      verify: async () => report,
    })

    const quarantine = await loadQuarantine(workspace, { now: checkedAt })
    expect(quarantine.entries).toHaveLength(1)
    expect(quarantine.entries[0]?.verification).toMatchObject({
      status: 'warning',
      checkedAt,
      passed: 2,
      reasons: ['year-mismatch'],
      note: expect.stringContaining('year-mismatch'),
    })
    expect(await readBatch(workspace)).toMatchObject({
      entries: [{ id: ref.id, reason: 'old capture reason' }],
    })
    const updated = decodeBatch(result.text)
    expect(updated?.entries[0]?.reason).toBe('refkeeper-latest-verification-reasons:year-mismatch')
  })

  it('refreshes sparse legacy verifier reports without throwing or promoting', async () => {
    const ref = reference({ pmid: '12345678' })
    await writeQuarantine(workspace, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: capturedAt,
      entries: [ref],
    })
    await writeBatch(workspace, {
      capturedAt,
      scope: 'all',
      entries: [{ id: ref.id, title: ref.title, status: 'quarantined', reason: 'old capture reason' }],
    })

    const checkedAt = '2026-11-22T23:02:00.000Z'
    const result = await runStoreCommand('promote', {
      workspace,
      now: () => checkedAt,
      verify: async () => ({ status: 'warning' }) as unknown as VerificationReport,
    })

    const quarantine = await loadQuarantine(workspace, { now: checkedAt })
    expect(quarantine.entries).toHaveLength(1)
    expect(quarantine.entries[0]?.verification).toMatchObject({
      status: 'warning',
      checkedAt,
      reasons: [],
      note: 're-verification failed: status warning',
    })
    const updated = decodeBatch(result.text)
    expect(updated?.entries[0]?.reason).toBe('refkeeper-latest-verification-reasons:status warning')
  })
})
