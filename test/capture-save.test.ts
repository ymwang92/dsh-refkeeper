import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/core/candidates.ts'
import { saveCaptured } from '../src/host/capture-save.ts'
import type { SourceRecord } from '../src/verify/types.ts'

const identifierOnly: Candidate = {
  key: 'doi:10.1000/example',
  type: 'journalArticle',
  origins: ['identifier'],
  doi: '10.1000/example',
  arxivId: '',
  isbn: '',
  reportNumber: '',
  url: '',
  title: '',
  authors: [],
  year: undefined,
  container: '',
  volume: '',
  issue: '',
  pages: '',
  confidence: 0.7,
  needsModelEnrichment: true,
  evidence: [12],
}

const registryRecord: SourceRecord = {
  source: 'crossref',
  id: '10.1000/example',
  title: 'A verified example paper',
  authors: ['Doe, Jane'],
  year: 2024,
  container: 'Journal of Examples',
  doi: '10.1000/example',
  type: 'journal-article',
  url: 'https://doi.org/10.1000/example',
}

describe('saveCaptured identifier hydration', () => {
  it('hydrates a bare DOI from a registry before the normal save path', async () => {
    let resolverCalls = 0
    let savedPayload: Record<string, unknown> | undefined
    const summary = await saveCaptured([identifierOnly], {
      now: () => '2026-10-28T12:00:00.000Z',
      resolveIdentifier: async (candidate) => {
        resolverCalls += 1
        expect(candidate.doi).toBe('10.1000/example')
        return registryRecord
      },
      save: async (payload) => {
        savedPayload = payload as Record<string, unknown>
        return { kind: 'success' }
      },
    })

    expect(resolverCalls).toBe(1)
    expect(savedPayload).toMatchObject({
      title: 'A verified example paper',
      authors: [{ family: 'Doe', given: 'Jane' }],
      year: 2024,
      doi: '10.1000/example',
      containerTitle: 'Journal of Examples',
      url: 'https://doi.org/10.1000/example',
      provenance: { trigger: 'button', capturedAt: '2026-10-28T12:00:00.000Z' },
    })
    expect(summary).toMatchObject({ saved: 1, quarantined: 0, skipped: 0, failed: 0 })
    expect(summary.entries).toHaveLength(1)
    expect(summary.entries?.[0]).toMatchObject({ status: 'saved', title: 'A verified example paper', year: 2024 })
  })

  it('hydrates a bare arXiv id from its registry before the normal save path', async () => {
    const candidate: Candidate = {
      ...identifierOnly,
      key: 'arxiv:2401.01234',
      doi: '',
      arxivId: '2401.01234',
    }
    const arxivRecord: SourceRecord = {
      source: 'arxiv',
      id: '2401.01234v1',
      title: 'A verified arXiv example',
      authors: ['Zhang San'],
      year: 2024,
      container: 'arXiv',
      doi: '',
      type: 'preprint',
      url: 'https://arxiv.org/abs/2401.01234v1',
    }
    let savedPayload: Record<string, unknown> | undefined
    const summary = await saveCaptured([candidate], {
      resolveIdentifier: async (seen) => {
        expect(seen.arxivId).toBe('2401.01234')
        return arxivRecord
      },
      save: async (payload) => {
        savedPayload = payload as Record<string, unknown>
        return { kind: 'success' }
      },
    })

    expect(savedPayload).toMatchObject({
      title: 'A verified arXiv example',
      authors: [{ literal: 'Zhang San' }],
      year: 2024,
      arxivId: '2401.01234',
      containerTitle: 'arXiv',
      url: 'https://arxiv.org/abs/2401.01234v1',
    })
    expect(summary).toMatchObject({ saved: 1, quarantined: 0, skipped: 0, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({ status: 'saved', arxivId: '2401.01234' })
  })

  it('counts an unresolvable identifier as skipped without inventing a title', async () => {
    let saveCalls = 0
    const summary = await saveCaptured([identifierOnly], {
      resolveIdentifier: async () => undefined,
      save: async () => {
        saveCalls += 1
        return { kind: 'success' }
      },
    })

    expect(saveCalls).toBe(0)
    expect(summary).toMatchObject({ saved: 0, quarantined: 0, skipped: 1, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({ status: 'skipped', doi: '10.1000/example' })
  })

  it('preserves extracted author/year claims while hydrating only missing fields', async () => {
    let savedPayload: Record<string, unknown> | undefined
    const candidate = { ...identifierOnly, authors: ['Wrong, Alice'], year: 2022 }
    const summary = await saveCaptured([candidate], {
      resolveIdentifier: async () => registryRecord,
      save: async (payload) => {
        savedPayload = payload as Record<string, unknown>
        return { kind: 'success', quarantined: true }
      },
    })

    expect(savedPayload).toMatchObject({
      title: 'A verified example paper',
      authors: [{ family: 'Wrong', given: 'Alice' }],
      year: 2022,
      containerTitle: 'Journal of Examples',
    })
    expect(summary).toMatchObject({ saved: 0, quarantined: 1, skipped: 0, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({ status: 'quarantined' })
  })

  it('keeps the cited title but backfills the rest of a titled candidate', async () => {
    let resolverCalls = 0
    const summary = await saveCaptured(
      [{ ...identifierOnly, title: 'Existing title', authors: ['Doe, Jane'], year: 2024 }],
      {
        resolveIdentifier: async () => {
          resolverCalls += 1
          return { ...registryRecord, volume: '12', issue: '3', pages: '45-67', publisher: 'ACME' }
        },
        save: async () => ({ kind: 'success', quarantined: true }),
      },
    )

    // The capture now asks the registry for every identified candidate, not only
    // for the ones that failed to supply a title: the panel shows the fields
    // verification already had, so it must not throw them away.
    expect(resolverCalls).toBe(1)
    expect(summary).toMatchObject({ saved: 0, quarantined: 1, skipped: 0, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({
      status: 'quarantined',
      title: 'Existing title',
      year: 2024,
    })
  })
})
