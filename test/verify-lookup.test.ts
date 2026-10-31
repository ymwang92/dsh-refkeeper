import { describe, expect, it } from 'vitest'
import { LookupCache, lookupRecords, verifyCandidate } from '../src/verify/lookup.ts'
import type { Fetcher, HttpResult } from '../src/verify/lookup.ts'

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

function respond(status: number, body: string): HttpResult {
  return { ok: status >= 200 && status < 300, status, body }
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

const candidate = {
  title: '深度学习在医学影像中的应用综述',
  authors: ['Zhang, Wei'],
  year: 2024,
  doi: '10.1000/abc',
}

describe('lookupRecords', () => {
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

  it('retries a 429 once and then succeeds', async () => {
    let calls = 0
    const fetcher = routed([
      {
        match: 'api.crossref.org',
        reply: () => {
          calls += 1
          return calls === 1 ? respond(429, 'slow down') : respond(200, crossrefEnvelope)
        },
      },
    ])
    const lookup = await lookupRecords(
      { doi: '10.1000/abc' },
      { fetcher, retries: 1, sleep: async () => {}, cache: new LookupCache() },
    )
    expect(calls).toBe(2)
    expect(lookup.records).toHaveLength(1)
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
})

describe('verifyCandidate', () => {
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
