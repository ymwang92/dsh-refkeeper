import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { saveCaptured } from '../src/host/capture-save.ts'
import { exportLibrary, saveFromPayload } from '../src/host/store-command.ts'
import { loadStore } from '../src/store/io.ts'
import { LookupCache, verifyCandidate } from '../src/verify/lookup.ts'
import type { Fetcher } from '../src/verify/lookup.ts'
import type { Candidate } from '../src/core/candidates.ts'

const doi = '10.1002/joc.1688'
const title = 'Physiographically sensitive mapping of climatological temperature and precipitation across the conterminous United States'
const now = '2026-10-28T12:00:00.000Z'

const identifierOnly: Candidate = {
  key: `doi:${doi}`,
  type: 'journalArticle',
  origins: ['identifier'],
  doi,
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

const crossrefBody = JSON.stringify({
  message: {
    DOI: doi,
    title: [title],
    author: [{ family: 'Daly', given: 'Christopher' }],
    issued: { 'date-parts': [[2008]] },
    'container-title': ['International Journal of Climatology'],
    type: 'journal-article',
    URL: `https://doi.org/${doi}`,
  },
})

const openAlexBody = JSON.stringify({
  title,
  doi: `https://doi.org/${doi}`,
  publication_year: 2008,
  authorships: [{ author: { display_name: 'Christopher Daly' } }],
  primary_location: { source: { display_name: 'International Journal of Climatology' } },
  type: 'article',
})

const fetcher: Fetcher = async (url) => {
  if (url.startsWith('https://api.crossref.org/works/')) {
    return { ok: true, status: 200, body: crossrefBody }
  }
  if (url.startsWith('https://api.openalex.org/works/doi:')) {
    return { ok: true, status: 200, body: openAlexBody }
  }
  if (url.startsWith('https://api.datacite.org/dois/')) {
    return { ok: false, status: 404, body: '' }
  }
  throw new Error(`unexpected registry URL: ${url}`)
}

describe('capture-save integration', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace !== '') await rm(workspace, { recursive: true, force: true })
    workspace = ''
  })

  it('hydrates a bare DOI, verifies it against registries, stores it, and exports BibTeX and RIS', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'refkeeper-capture-save-'))
    const cache = new LookupCache()
    const deps = { workspace, now: () => now }

    const summary = await saveCaptured([identifierOnly], {
      now: () => now,
      resolveIdentifier: async (candidate) => {
        const outcome = await verifyCandidate({ doi: candidate.doi }, { fetcher, cache })
        return (
          outcome.records.find(
            (record) => record.source === outcome.report.matchedSource && record.title.trim() !== '',
          ) ?? outcome.records.find((record) => record.title.trim() !== '')
        )
      },
      save: async (payload) =>
        await saveFromPayload(payload, {
          ...deps,
          verify: async (ref) =>
            (
              await verifyCandidate(
                {
                  title: ref.title,
                  authors: ref.authors.map((author) => author.family ?? author.literal ?? '').filter(Boolean),
                  year: ref.year,
                  doi: ref.identifiers.doi,
                  arxivId: ref.identifiers.arxiv,
                },
                { fetcher, cache },
              )
            ).report,
        }),
    })

    expect(summary).toMatchObject({ saved: 1, quarantined: 0, skipped: 0, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({ status: 'saved' })

    const stored = await loadStore(workspace, { now }).then((outcome) => outcome.state.references)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      title,
      authors: [{ family: 'Daly', given: 'Christopher' }],
      year: 2008,
      containerTitle: 'International Journal of Climatology',
      identifiers: { doi },
      verification: { status: 'verified', passed: 3 },
    })

    const exported = await exportLibrary({ format: 'both' }, deps)
    expect(exported.kind).toBe('success')
    expect(exported.text).toContain('exported 1 of 1 reference(s)')
    const exportDir = join(workspace, 'refs', 'exports')
    const bibtex = await readFile(join(exportDir, 'refs-20261028-1200.bib'), 'utf8')
    const ris = await readFile(join(exportDir, 'refs-20261028-1200.ris'), 'utf8')
    expect(bibtex).toContain('@article{')
    expect(bibtex).toContain(title)
    expect(bibtex).toContain(`doi = {${doi}}`)
    expect(ris).toContain('TY  - JOUR')
    expect(ris).toContain(`DO  - ${doi}`)
    expect(ris).toContain(title)
  })

  it('hydrates a bare arXiv id, verifies it, stores it, and exports BibTeX and RIS', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'refkeeper-capture-save-arxiv-'))
    const cache = new LookupCache()
    const deps = { workspace, now: () => now }
    const arxivId = '2401.01234'
    const arxivTitle = 'A deterministic example of registry-backed citation capture'
    const candidate: Candidate = {
      ...identifierOnly,
      key: `arxiv:${arxivId}`,
      doi: '',
      arxivId,
      type: 'preprint',
    }
    const atomFeed = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '<entry>',
      `<id>https://arxiv.org/abs/${arxivId}v1</id>`,
      `<title>${arxivTitle}</title>`,
      '<published>2024-01-02T00:00:00Z</published>',
      '<author><name>Ada Lovelace</name></author>',
      '</entry>',
      '</feed>',
    ].join('')
    const arxivFetcher: Fetcher = async (url) => {
      if (url.includes(`id_list=${arxivId}`)) return { ok: true, status: 200, body: atomFeed }
      throw new Error(`unexpected registry URL: ${url}`)
    }

    const summary = await saveCaptured([candidate], {
      now: () => now,
      resolveIdentifier: async (seen) => {
        const outcome = await verifyCandidate({ arxivId: seen.arxivId }, { fetcher: arxivFetcher, cache })
        return (
          outcome.records.find(
            (record) => record.source === outcome.report.matchedSource && record.title.trim() !== '',
          ) ?? outcome.records.find((record) => record.title.trim() !== '')
        )
      },
      save: async (payload) =>
        await saveFromPayload(payload, {
          ...deps,
          verify: async (ref) =>
            (
              await verifyCandidate(
                {
                  title: ref.title,
                  authors: ref.authors.map((author) => author.family ?? author.literal ?? '').filter(Boolean),
                  year: ref.year,
                  doi: ref.identifiers.doi,
                  arxivId: ref.identifiers.arxiv,
                },
                { fetcher: arxivFetcher, cache },
              )
            ).report,
        }),
    })

    expect(summary).toMatchObject({ saved: 1, quarantined: 0, skipped: 0, failed: 0 })
    expect(summary.entries?.[0]).toMatchObject({ status: 'saved' })

    const stored = await loadStore(workspace, { now }).then((outcome) => outcome.state.references)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      title: arxivTitle,
      authors: [{ literal: 'Ada Lovelace' }],
      year: 2024,
      identifiers: { arxiv: arxivId },
      verification: { status: 'verified', passed: 3 },
    })

    const exported = await exportLibrary({ format: 'both' }, deps)
    expect(exported.kind).toBe('success')
    const exportDir = join(workspace, 'refs', 'exports')
    const bibtex = await readFile(join(exportDir, 'refs-20261028-1200.bib'), 'utf8')
    const ris = await readFile(join(exportDir, 'refs-20261028-1200.ris'), 'utf8')
    expect(bibtex).toContain(arxivTitle)
    expect(bibtex).toContain(`eprint = {${arxivId}}`)
    expect(ris).toContain(arxivTitle)
    expect(ris).toContain(`AN  - arXiv:${arxivId}`)
  })
})
