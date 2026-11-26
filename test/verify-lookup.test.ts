import { describe, expect, it } from 'vitest'
import {
  arxivIdUrl,
  arxivSearchUrl,
  crossrefDoiUrl,
  crossrefSearchUrl,
  dataciteDoiUrl,
  dataciteQueryUrl,
  openalexDoiUrl,
  openalexSearchUrl,
  openlibraryIsbnUrl,
  pmcSearchUrl,
  pubmedIdUrl,
} from '../src/verify/clients.ts'
import { DEFAULT_REGISTRY_BASE_URLS } from '../src/core/registry-settings.ts'
import { LookupCache, lookupRecords, verifyCandidate } from '../src/verify/lookup.ts'
import type { Fetcher, HttpResult, LookupIdentity } from '../src/verify/lookup.ts'

const crossrefEnvelope = JSON.stringify({
  message: {
    DOI: '10.1000/abc',
    title: ['深度学习在医学影像中的应用综述'],
    author: [{ family: 'Zhang', given: 'Wei' }],
    issued: { 'date-parts': [[2024]] },
    'container-title': ['计算机学报'],
    type: 'journal-article',
    URL: 'https://doi.org/10.1000/abc',
  },
})

const openalexWork = JSON.stringify({
  id: 'https://openalex.org/W1',
  title: '深度学习在医学影像中的应用综述',
  authorships: [{ author: { display_name: 'Wei Zhang' } }],
  publication_year: 2024,
  primary_location: { source: { display_name: '计算机学报' } },
  doi: 'https://doi.org/10.1000/abc',
  type: 'article',
})

function respond(status: number, body: string, headers?: HttpResult['headers']): HttpResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    ...(headers === undefined ? {} : { headers }),
  }
}

/** Route by URL substring; unmatched URLs 404. */
function routed(routes: readonly { match: string; reply: () => Promise<HttpResult> | HttpResult }[]): Fetcher {
  return async (url) => {
    for (const route of routes) {
      if (url.includes(route.match)) return await route.reply()
    }
    return respond(404, 'not found')
  }
}

async function requestedUrls(identity: LookupIdentity): Promise<string[]> {
  const seen: string[] = []
  const fetcher: Fetcher = async (url) => {
    seen.push(url)
    return respond(404, 'not found')
  }
  await lookupRecords(identity, { fetcher, retries: 0, cache: new LookupCache() })
  return seen
}

const candidate = {
  title: '深度学习在医学影像中的应用综述',
  authors: ['Zhang, Wei'],
  year: 2024,
  doi: '10.1000/abc',
}

describe('lookupRecords', () => {
  it('uses an HTTP(S) custom base URL for the matching registry only', async () => {
    const urls: string[] = []
    const fetcher: Fetcher = async (url) => {
      urls.push(url)
      return respond(404, 'not found')
    }
    const lookup = await lookupRecords(
      { doi: '10.1000/abc' },
      {
        fetcher,
        retries: 0,
        cache: new LookupCache(),
        registryBaseUrls: { ...DEFAULT_REGISTRY_BASE_URLS, crossref: 'https://crossref.proxy.example/api' },
      },
    )
    expect(lookup.records).toEqual([])
    expect(urls.some((url) => url.startsWith('https://crossref.proxy.example/api/works/'))).toBe(true)
    expect(urls.some((url) => url.includes('api.openalex.org'))).toBe(true)
    expect(urls.some((url) => url.includes('api.datacite.org'))).toBe(true)
  })

  it('does not create tasks, read cache, or fetch when private mode is enabled', async () => {
    let calls = 0
    const result = await lookupRecords(
      { doi: '10.1000/abc' },
      {
        privateMode: true,
        fetcher: async () => { calls += 1; return respond(200, crossrefEnvelope) },
        cache: new LookupCache(),
      },
    )
    expect(calls).toBe(0)
    expect(result).toEqual({ records: [], errors: [], timedOut: false, answered: [] })
  })

  it('queries the DOI registries and keeps partial results', async () => {
    const fetcher = routed([
      { match: 'api.crossref.org', reply: () => respond(200, crossrefEnvelope) },
      { match: 'api.openalex.org', reply: () => respond(200, openalexWork) },
      { match: 'api.datacite.org', reply: () => respond(404, '{"errors":[]}') },
    ])
    const lookup = await lookupRecords({ doi: '10.1000/abc' }, { fetcher, cache: new LookupCache() })
    expect(lookup.records.map((record) => record.source).sort()).toEqual(['crossref', 'openalex'])
    // DataCite 404 = "not in this registry", an answer rather than an outage.
    expect(lookup.errors).toEqual([])
    expect(lookup.timedOut).toBe(false)
    expect([...lookup.answered].sort()).toEqual(['crossref', 'datacite', 'openalex'])
  })

  it.each([
    { label: 'delay-seconds', value: '2', now: 0, expectedDelayMs: 2_000 },
    {
      label: 'HTTP-date',
      value: 'Wed, 21 Oct 2015 07:28:03 GMT',
      now: Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'),
      expectedDelayMs: 3_000,
    },
  ])('honors Retry-After as $label and then succeeds', async ({ value, now, expectedDelayMs }) => {
    let calls = 0
    const delays: number[] = []
    const fetcher = routed([
      {
        match: 'api.crossref.org',
        reply: () => {
          calls += 1
          return calls === 1
            ? respond(429, 'slow down', {
                get: (name) => (name.toLowerCase() === 'retry-after' ? value : null),
              })
            : respond(200, crossrefEnvelope)
        },
      },
    ])
    const lookup = await lookupRecords(
      { doi: '10.1000/abc' },
      { fetcher, retries: 1, sleep: async (ms) => { delays.push(ms) }, now: () => now, cache: new LookupCache() },
    )
    expect(calls).toBe(2)
    expect(delays).toEqual([expectedDelayMs])
    expect(lookup.records).toHaveLength(1)
  })

  it('defaults to two retries for a persistent 429 with exponential backoff', async () => {
    let calls = 0
    const delays: number[] = []
    const lookup = await lookupRecords(
      { arxivId: '2301.00001' },
      {
        fetcher: async () => {
          calls += 1
          return respond(429, 'slow down')
        },
        sleep: async (ms) => { delays.push(ms) },
        cache: new LookupCache(),
      },
    )
    expect(calls).toBe(3)
    expect(delays).toEqual([250, 1_000])
    expect(lookup.records).toEqual([])
    expect(lookup.errors).toHaveLength(1)
  })

  it('caps fallback backoff at four seconds', async () => {
    const delays: number[] = []
    await lookupRecords(
      { arxivId: '2301.00001' },
      {
        fetcher: async () => respond(429, 'slow down'),
        retries: 5,
        retryDelayMs: 250,
        sleep: async (ms) => { delays.push(ms) },
        cache: new LookupCache(),
      },
    )
    expect(delays).toEqual([250, 1_000, 2_000, 4_000, 4_000])
  })

  it('does not retry a permanent 4xx', async () => {
    let calls = 0
    const fetcher = async (): Promise<HttpResult> => {
      calls += 1
      return respond(400, 'bad request')
    }
    const lookup = await lookupRecords({ doi: '10.1000/abc' }, { fetcher, retries: 2, sleep: async () => {} })
    expect(calls).toBe(3) // one attempt per source, no retries
    expect(lookup.errors).toHaveLength(3)
  })

  it('does not retry 404 and counts it as a completed source answer', async () => {
    let calls = 0
    const delays: number[] = []
    const lookup = await lookupRecords(
      { arxivId: '2301.00001' },
      {
        fetcher: async () => {
          calls += 1
          return respond(404, 'not found')
        },
        retries: 5,
        sleep: async (ms) => { delays.push(ms) },
        cache: new LookupCache(),
      },
    )
    expect(calls).toBe(1)
    expect(delays).toEqual([])
    expect(lookup.records).toEqual([])
    expect(lookup.errors).toEqual([])
    expect(lookup.answered).toEqual(['arxiv'])
  })

  it('aborts all in-flight requests when the total lookup budget expires', async () => {
    let started = 0
    let aborted = 0
    const fetcher: Fetcher = async (_url, { signal }) => {
      started += 1
      return await new Promise<HttpResult>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            aborted += 1
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      })
    }
    const lookup = await lookupRecords(
      { doi: '10.1000/abc' },
      { fetcher, sourceTimeoutMs: 200, totalBudgetMs: 20, retries: 2, sleep: async () => {} },
    )
    expect(started).toBe(3)
    expect(aborted).toBe(3)
    expect(lookup.errors).toHaveLength(3)
    expect(lookup.timedOut).toBe(true)
  })

  it('marks a stalled source as timed out, aborts its request, and does not retry', async () => {
    let crossrefCalls = 0
    let crossrefAborted = false
    const fetcher: Fetcher = async (url, { signal }) => {
      if (url.includes('api.crossref.org')) {
        crossrefCalls += 1
        return await new Promise<HttpResult>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              crossrefAborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      return url.includes('api.openalex.org') ? respond(200, openalexWork) : respond(404, '')
    }
    const lookup = await lookupRecords(
      { doi: '10.1000/abc' },
      { fetcher, sourceTimeoutMs: 20, totalBudgetMs: 200, retries: 2, sleep: async () => {} },
    )
    expect(lookup.timedOut).toBe(true)
    expect(lookup.records.map((record) => record.source)).toEqual(['openalex'])
    expect(crossrefAborted).toBe(true)
    expect(crossrefCalls).toBe(1)
  })

  it('serves a repeated URL from the cache', async () => {
    let calls = 0
    const fetcher = routed([
      {
        match: 'api.crossref.org',
        reply: () => {
          calls += 1
          return respond(200, crossrefEnvelope)
        },
      },
    ])
    const cache = new LookupCache()
    const options = { fetcher, cache, now: () => 1_000 }
    await lookupRecords({ doi: '10.1000/abc' }, options)
    await lookupRecords({ doi: '10.1000/abc' }, options)
    expect(calls).toBe(1)
  })

  it('does not cache a 2xx body rejected by the source parser', async () => {
    let crossrefCalls = 0
    const fetcher = routed([
      {
        match: 'api.crossref.org',
        reply: () => {
          crossrefCalls += 1
          return respond(200, 'not JSON')
        },
      },
    ])
    const cache = new LookupCache()
    await lookupRecords({ doi: '10.1000/abc' }, { fetcher, cache, retries: 0 })
    await lookupRecords({ doi: '10.1000/abc' }, { fetcher, cache, retries: 0 })
    expect(crossrefCalls).toBe(2)
    expect(cache.size).toBe(0)
  })

  it('aborts in-flight requests and does not retry after caller cancellation', async () => {
    let started = 0
    let aborted = 0
    const fetcher: Fetcher = async (_url, { signal }) => {
      started += 1
      return await new Promise<HttpResult>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            aborted += 1
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      })
    }
    const controller = new AbortController()
    const pending = lookupRecords(
      { doi: '10.1000/abc' },
      { fetcher, retries: 2, sleep: async () => {}, signal: controller.signal },
    )
    expect(started).toBe(3)
    controller.abort()
    const lookup = await pending
    expect(lookup.errors).toHaveLength(3)
    expect(lookup.timedOut).toBe(false)
    expect(started).toBe(3)
    expect(aborted).toBe(3)
  })

  it('does not start requests when the caller signal is already aborted', async () => {
    let calls = 0
    const fetcher: Fetcher = async () => {
      calls += 1
      return respond(200, crossrefEnvelope)
    }
    const controller = new AbortController()
    controller.abort()
    const lookup = await lookupRecords({ doi: '10.1000/abc' }, { fetcher, signal: controller.signal })
    expect(calls).toBe(0)
    expect(lookup.errors).toHaveLength(3)
    expect(lookup.timedOut).toBe(false)
  })

  it.each([
    {
      label: 'prefers DOI registries over all lower-priority identifiers and title',
      identity: {
        doi: '10.1000/abc',
        arxivId: '2301.00001',
        pmid: '12345678',
        pmcid: 'PMC123456',
        reportNumber: 'NASA/TM 2024-1234',
        isbn: '9780306406157',
        title: 'A lower-priority title',
      },
      expected: [
        crossrefDoiUrl('10.1000/abc'),
        dataciteDoiUrl('10.1000/abc'),
        openalexDoiUrl('10.1000/abc'),
      ],
    },
    {
      label: 'prefers arXiv ID over lower-priority identifiers and title',
      identity: {
        arxivId: '2301.00001',
        pmid: '12345678',
        pmcid: 'PMC123456',
        reportNumber: 'NASA/TM 2024-1234',
        isbn: '9780306406157',
        title: 'A lower-priority title',
      },
      expected: [arxivIdUrl('2301.00001')],
    },
    {
      label: 'prefers PMID over PMCID and all lower-priority identifiers and title',
      identity: {
        pmid: '12345678',
        pmcid: 'PMC123456',
        reportNumber: 'NASA/TM 2024-1234',
        isbn: '9780306406157',
        title: 'A lower-priority title',
      },
      expected: [pubmedIdUrl('12345678')],
    },
    {
      label: 'prefers PMCID over lower-priority identifiers and title when PMID is absent',
      identity: {
        pmcid: 'PMC123456',
        reportNumber: 'NASA/TM 2024-1234',
        isbn: '9780306406157',
        title: 'A lower-priority title',
      },
      expected: [pmcSearchUrl('PMC123456')],
    },
    {
      label: 'prefers report-number lookup over title search',
      identity: { title: 'A technical report', reportNumber: 'NASA/TM 2024-1234' },
      expected: [dataciteQueryUrl('NASA/TM 2024-1234')],
    },
    {
      label: 'prefers ISBN over report number and title',
      identity: { title: 'A book', reportNumber: 'NUREG/CR-1234', isbn: '9780306406157' },
      expected: [openlibraryIsbnUrl('9780306406157')],
    },
    {
      label: 'prefers ISBN lookup over title search',
      identity: { title: 'A book', isbn: '9780306406157' },
      expected: [openlibraryIsbnUrl('9780306406157')],
    },
    {
      label: 'runs an ISBN-only lookup',
      identity: { isbn: '9780306406157' },
      expected: [openlibraryIsbnUrl('9780306406157')],
    },
    {
      label: 'runs a report-number-only lookup',
      identity: { reportNumber: 'NASA/TM 2024-1234' },
      expected: [dataciteQueryUrl('NASA/TM 2024-1234')],
    },
    {
      label: 'falls back to title search for an invalid ISBN',
      identity: { title: 'A book', isbn: '9780306406156' },
      expected: [
        crossrefSearchUrl('A book', 5),
        openalexSearchUrl('A book', 5),
        arxivSearchUrl('A book', 5),
      ],
    },
    {
      label: 'keeps title searches when no identifier is present',
      identity: { title: 'A technical report' },
      expected: [
        crossrefSearchUrl('A technical report', 5),
        openalexSearchUrl('A technical report', 5),
        arxivSearchUrl('A technical report', 5),
      ],
    },
  ])('$label', async ({ identity, expected }) => {
    expect(await requestedUrls(identity)).toEqual(expected)
  })

  it.each([
    { label: 'invalid ISBN-13', identity: { isbn: '9780306406156' } },
    { label: 'invalid ISBN-10', identity: { isbn: '0306406153' } },
    { label: 'URL', identity: { url: 'https://example.org/report' } },
  ])('does not search from $label alone', async ({ identity }) => {
    expect(await requestedUrls(identity)).toEqual([])
  })

  it.each([
    { label: 'hyphenated ISBN-13', identity: { isbn: '978-0 306-40615-7' }, normalized: '9780306406157' },
    { label: 'hyphenated ISBN-10', identity: { isbn: '0-306-40615-2' }, normalized: '0306406152' },
  ])('normalizes $label before searching', async ({ identity, normalized }) => {
    expect(await requestedUrls(identity)).toEqual([openlibraryIsbnUrl(normalized)])
  })
})

describe('verifyCandidate', () => {
  it('does not self-verify an ISBN-only Open Library candidate', async () => {
    const book = JSON.stringify({
      'ISBN:9780306406157': {
        title: 'A misleading book title',
        authors: [{ name: 'An Unrelated Author' }],
        publish_date: '2024',
        identifiers: { openlibrary: ['OL123M'] },
        key: '/books/OL123M',
      },
    })
    const fetcher = routed([{ match: 'openlibrary.org/api/books', reply: () => respond(200, book) }])
    const outcome = await verifyCandidate({ isbn: '9780306406157' }, { fetcher, retries: 0 })

    expect(outcome.records).toHaveLength(1)
    expect(outcome.report.status).not.toBe('verified')
    expect(outcome.report.passed).toBe(0)
  })

  it('verifies a work that two sources confirm', async () => {
    const fetcher = routed([
      { match: 'api.crossref.org', reply: () => respond(200, crossrefEnvelope) },
      { match: 'api.openalex.org', reply: () => respond(200, openalexWork) },
      { match: 'api.datacite.org', reply: () => respond(404, '{}') },
    ])
    const outcome = await verifyCandidate(candidate, { fetcher })
    expect(outcome.report.status).toBe('verified')
    expect(outcome.report.title.pass).toBe(true)
    expect(outcome.report.year.pass).toBe(true)
    expect(outcome.report.firstAuthor.pass).toBe(true)
    expect(outcome.report.passed).toBe(3)
  })

  it('quarantines a work no registry knows, and does not call it fabricated-by-outage', async () => {
    const fetcher = routed([
      // A DOI lookup that misses is a 404 at all three registries; a 200 with
      // an empty body would now be a body-shape error, not "no such work".
      { match: 'api.crossref.org', reply: () => respond(404, '') },
      { match: 'api.openalex.org', reply: () => respond(404, '') },
      { match: 'api.datacite.org', reply: () => respond(404, '') },
    ])
    const outcome = await verifyCandidate(candidate, { fetcher })
    expect(outcome.report.status).toBe('quarantined')
    expect(outcome.report.reasons).toContain('no-source-hit')
  })

  it('reports unverified when every source is down', async () => {
    const fetcher = async (): Promise<HttpResult> => respond(503, 'down')
    const outcome = await verifyCandidate(candidate, { fetcher, retries: 0 })
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toEqual(expect.arrayContaining(['source-error']))
    expect(outcome.report.reasons).not.toContain('no-source-hit')
  })

  it('does not self-verify a report-number-only DataCite hit', async () => {
    const reportNumber = 'NASA/TM 2024-1234'
    const seen: string[] = []
    const reportSearch = JSON.stringify({
      data: [
        {
          id: '10.1234/nasa.tm.2024.1234',
          type: 'dois',
          attributes: {
            doi: '10.1234/nasa.tm.2024.1234',
            titles: [{ title: 'A technical report' }],
            creators: [{ name: 'National Aeronautics and Space Administration' }],
            publicationYear: 2024,
            publisher: 'NASA',
            types: { resourceTypeGeneral: 'Report', resourceType: 'Technical Report' },
            url: 'https://example.org/report',
          },
        },
      ],
    })
    const fetcher: Fetcher = async (url) => {
      seen.push(url)
      return url.includes('api.datacite.org') ? respond(200, reportSearch) : respond(404, 'not found')
    }

    const outcome = await verifyCandidate(
      { title: '', authors: [], reportNumber },
      { fetcher, retries: 0, cache: new LookupCache() },
    )

    expect(seen).toEqual([dataciteQueryUrl(reportNumber)])
    expect(outcome.records).toHaveLength(1)
    expect(outcome.report.status).not.toBe('verified')
    expect(outcome.report.passed).toBe(0)
  })

  it('uses arXiv id_list for preprints instead of a title search', async () => {
    const seen: string[] = []
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2301.00001v2</id><title>Attention Is All You Need</title><author><name>Ashish Vaswani</name></author><published>2023-01-01T00:00:00Z</published></entry></feed>`
    const fetcher: Fetcher = async (url) => {
      seen.push(url)
      return respond(200, atom)
    }
    const lookup = await lookupRecords({ arxivId: '2301.00001' }, { fetcher })
    expect(seen[0]).toContain('id_list=2301.00001')
    expect(lookup.records[0]?.doi).toBe('')
    expect(lookup.records[0]?.year).toBe(2023)
  })
})
