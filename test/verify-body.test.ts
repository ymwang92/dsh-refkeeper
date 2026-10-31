import { describe, expect, it } from 'vitest'

import { SourceBodyError, parseSourceBody } from '../src/verify/clients.ts'
import { verifyCandidate } from '../src/verify/lookup.ts'
import type { Fetcher, HttpResult } from '../src/verify/lookup.ts'

const candidate = {
  title: 'Attention Is All You Need',
  authors: ['Vaswani, Ashish'],
  year: 2017,
  doi: '10.1000/xyz',
  arxivId: '',
}

function respond(status: number, body: string): HttpResult {
  return { ok: status >= 200 && status < 300, status, body }
}

function routed(
  routes: readonly { match: string; reply: (url: string) => HttpResult }[],
): Fetcher {
  return async (url: string): Promise<HttpResult> => {
    const route = routes.find((entry) => url.includes(entry.match))
    if (route === undefined) throw new Error(`no route for ${url}`)
    return route.reply(url)
  }
}

function throwsBodyError(run: () => unknown): SourceBodyError {
  try {
    run()
  } catch (error) {
    if (error instanceof SourceBodyError) return error
    throw error
  }
  throw new Error('expected a SourceBodyError')
}

describe('parseSourceBody: malformed 200 bodies are errors, not empty results', () => {
  it('rejects an HTML page served with 200', () => {
    const error = throwsBodyError(() => parseSourceBody('crossref', 'doi', '<html>gateway</html>'))
    expect(error.detail).toBe('body is not JSON')
  })

  it('rejects a Crossref envelope without a work', () => {
    const error = throwsBodyError(() => parseSourceBody('crossref', 'doi', '{"status":"ok"}'))
    expect(error.detail).toBe('work has neither DOI nor title')
  })

  it('rejects a Crossref search envelope without items', () => {
    const error = throwsBodyError(() => parseSourceBody('crossref', 'search', '{"message":{}}'))
    expect(error.detail).toBe('missing message.items[]')
  })

  it('rejects an OpenAlex search envelope without results', () => {
    const error = throwsBodyError(() => parseSourceBody('openalex', 'search', '{"meta":{}}'))
    expect(error.detail).toBe('missing results[]')
  })

  it('rejects search pages that contain a mix of readable and unreadable items', () => {
    const crossref = JSON.stringify({
      message: { items: [{ DOI: '10.1000/x', title: ['Readable'] }, { nonsense: true }] },
    })
    const openalex = JSON.stringify({
      results: [{ id: 'W1', title: 'Readable' }, { nonsense: true }],
    })
    expect(() => parseSourceBody('crossref', 'search', crossref)).toThrow(SourceBodyError)
    expect(() => parseSourceBody('openalex', 'search', openalex)).toThrow(SourceBodyError)
  })

  it('rejects single-work envelopes whose DOI/title fields are blank', () => {
    expect(() => parseSourceBody('crossref', 'doi', '{"message":{"DOI":" ","title":[" "]}}')).toThrow(SourceBodyError)
    expect(() => parseSourceBody('openalex', 'doi', '{"id":"W1","title":" ","doi":" "}')).toThrow(SourceBodyError)
    expect(() => parseSourceBody('datacite', 'doi', '{"data":{"attributes":{"doi":" ","titles":[{"title":" "}]}}}')).toThrow(SourceBodyError)
  })

  it('rejects a DataCite body without data.attributes', () => {
    const error = throwsBodyError(() => parseSourceBody('datacite', 'doi', '{"data":{}}'))
    expect(error.detail).toBe('missing data.attributes')
  })

  it('rejects a body that is not XML at all', () => {
    const error = throwsBodyError(() => parseSourceBody('arxiv', 'id', '{"feed":"nope"}'))
    expect(error.detail).toBe('body is not an Atom feed')
  })

  it('rejects a truncated feed that still carries the <feed prefix', () => {
    // The shape that slipped through before: prefix present, entry never closed.
    const error = throwsBodyError(() =>
      parseSourceBody('arxiv', 'id', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>broken'),
    )
    expect(error.detail).toBe('Atom feed is truncated (no closing </feed>)')
  })

  it('rejects a truncated feed behind an XML declaration', () => {
    const error = throwsBodyError(() =>
      parseSourceBody('arxiv', 'id', '<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'),
    )
    expect(error.detail).toBe('Atom feed is truncated (no closing </feed>)')
  })

  it('rejects an entry cut inside its title, even though </feed> arrived', () => {
    // The shape that still slipped through: root closed, entry closed, title not.
    const error = throwsBodyError(() =>
      parseSourceBody('arxiv', 'id', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>truncated</entry></feed>'),
    )
    expect(error.detail).toBe('Atom feed is malformed (unexpected </entry>)')
  })

  it('rejects an element left open at the end of the body', () => {
    const error = throwsBodyError(() =>
      parseSourceBody(
        'arxiv',
        'id',
        '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>t</title><id>i</id></feed>',
      ),
    )
    expect(error.detail).toBe('Atom feed is malformed (unexpected </feed>)')
  })

  it('rejects a stray "<" that is not part of a tag', () => {
    const error = throwsBodyError(() =>
      parseSourceBody(
        'arxiv',
        'id',
        '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>a < b</title></entry></feed>',
      ),
    )
    expect(error.detail).toBe('body is not well-formed XML')
  })

  it('accepts a well-nested feed with self-closing tags', () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom">' +
      '<entry><title>T</title><id>http://arxiv.org/abs/1706.03762v1</id>' +
      '<link href="http://arxiv.org/abs/1706.03762v1"/><published>2017-06-12T00:00:00Z</published>' +
      '<author><name>Vaswani</name></author></entry></feed>'
    const records = parseSourceBody('arxiv', 'id', xml)
    expect(records).toHaveLength(1)
    expect(records[0]?.arxivId ?? records[0]?.id).toBe('1706.03762v1')
  })

  it('rejects a feed element that is not the document root', () => {
    const error = throwsBodyError(() =>
      parseSourceBody('arxiv', 'id', '<html><body><feed xmlns="http://www.w3.org/2005/Atom"></feed></body></html>'),
    )
    expect(error.detail).toBe('body is not an Atom feed')
  })

  it('rejects an Atom-looking feed with no Atom namespace', () => {
    const error = throwsBodyError(() =>
      parseSourceBody('arxiv', 'id', '<feed><entry><id>http://arxiv.org/abs/1706.03762</id></entry></feed>'),
    )
    expect(error.detail).toBe('Atom feed is missing the Atom namespace')
  })

  it('keeps "valid envelope, no records" as an empty result', () => {
    expect(parseSourceBody('crossref', 'search', '{"message":{"items":[]}}')).toEqual([])
    expect(parseSourceBody('openalex', 'search', '{"results":[]}')).toEqual([])
    expect(parseSourceBody('arxiv', 'search', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toEqual([])
  })
})

describe('verifyCandidate: a cut-off arXiv feed is an error, not an empty answer', () => {
  it('treats an internally truncated entry as a source error', async () => {
    const fetcher = async (): Promise<HttpResult> =>
      respond(200, '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>truncated</entry></feed>')
    const outcome = await verifyCandidate(
      { title: 'Attention Is All You Need', authors: [], year: 2017, arxivId: '1706.03762' },
      { fetcher, retries: 0 },
    )
    expect(outcome.lookup.answered).not.toContain('arxiv')
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
    expect(outcome.report.reasons).not.toContain('no-source-hit')
  })

  it('does not verify a matching entry if a sibling entry is unreadable', async () => {
    const body =
      '<feed xmlns="http://www.w3.org/2005/Atom">' +
      '<entry><title>Attention Is All You Need</title><id>http://arxiv.org/abs/1706.03762v1</id>' +
      '<published>2017-06-12T00:00:00Z</published><author><name>Ashish Vaswani</name></author></entry>' +
      '<entry><title>Unreadable: no id</title></entry></feed>'
    const fetcher = async (): Promise<HttpResult> => respond(200, body)
    const outcome = await verifyCandidate(
      { title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017, arxivId: '1706.03762' },
      { fetcher, retries: 0 },
    )
    expect(outcome.lookup.answered).not.toContain('arxiv')
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
    expect(outcome.report.reasons).not.toContain('no-source-hit')
  })

  it('reports source-error instead of quarantining an unpublished preprint', async () => {
    const fetcher = async (): Promise<HttpResult> =>
      respond(200, '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>cut off')
    const outcome = await verifyCandidate(
      { title: 'Attention Is All You Need', authors: [], year: 2017, arxivId: '1706.03762' },
      { fetcher, retries: 0 },
    )
    expect(outcome.lookup.answered).not.toContain('arxiv')
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
    expect(outcome.report.reasons).not.toContain('no-source-hit')
  })
})

describe('verifyCandidate: body-shape failures downgrade, never fabricate a verdict', () => {
  it('does not report no-source-hit when every registry returns an unreadable body', async () => {
    const fetcher = async (): Promise<HttpResult> => respond(200, '<html>captive portal</html>')
    const outcome = await verifyCandidate(candidate, { fetcher, retries: 0 })
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
    expect(outcome.report.reasons).not.toContain('no-source-hit')
    expect(outcome.lookup.answered).toEqual([])
  })

  it('keeps readable sources and marks the round partial when one body is garbage', async () => {
    const fetcher = routed([
      { match: 'api.crossref.org', reply: () => respond(404, '') },
      { match: 'api.openalex.org', reply: () => respond(200, 'not json') },
      { match: 'api.datacite.org', reply: () => respond(404, '') },
    ])
    const outcome = await verifyCandidate(candidate, { fetcher, retries: 0 })
    expect(outcome.lookup.answered).toContain('crossref')
    expect(outcome.lookup.answered).not.toContain('openalex')
    expect(outcome.report.partial).toBe(true)
    // One source was unreadable, so a retry could still find the work: fail
    // closed to `unverified` rather than asserting "no registry knows it".
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
  })
})

describe('parseSourceBody: Atom tag names are matched case-sensitively', () => {
  it('rejects an upper-case root element', () => {
    const error = throwsBodyError(() =>
      parseSourceBody(
        'arxiv',
        'id',
        '<Feed xmlns="http://www.w3.org/2005/Atom"><Entry><Title>T</Title></Entry></Feed>',
      ),
    )
    expect(error.detail).toBe('body is not an Atom feed')
  })

  it('rejects entries that are marked in a different case', () => {
    const error = throwsBodyError(() =>
      parseSourceBody(
        'arxiv',
        'id',
        '<feed xmlns="http://www.w3.org/2005/Atom"><Entry><Title>T</Title>' +
          '<Id>http://arxiv.org/abs/1706.03762</Id></Entry></feed>',
      ),
    )
    expect(error.detail).toBe('Atom feed has entries that could not be read')
  })

  it('rejects an unreadable entry even when another entry parsed successfully', () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom">' +
      '<entry><title>Readable</title><id>http://arxiv.org/abs/1706.03762</id></entry>' +
      '<entry><title>Unreadable: no id</title></entry></feed>'
    const error = throwsBodyError(() => parseSourceBody('arxiv', 'id', xml))
    expect(error.detail).toBe('Atom feed has entries that could not be read')
  })

  it('treats unreadable mixed-case entries as a source error end to end', async () => {
    const fetcher = async (): Promise<HttpResult> =>
      respond(
        200,
        '<feed xmlns="http://www.w3.org/2005/Atom"><Entry><Title>T</Title>' +
          '<Id>http://arxiv.org/abs/1706.03762</Id></Entry></feed>',
      )
    const outcome = await verifyCandidate(
      { title: 'Attention Is All You Need', authors: [], year: 2017, arxivId: '1706.03762' },
      { fetcher, retries: 0 },
    )
    expect(outcome.lookup.answered).not.toContain('arxiv')
    expect(outcome.report.status).toBe('unverified')
    expect(outcome.report.reasons).toContain('source-error')
    expect(outcome.report.reasons).not.toContain('no-source-hit')
  })

  it('still parses a real feed that carries camel-case foreign-namespace tags', () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">' +
      '<opensearch:totalResults>1</opensearch:totalResults>' +
      '<entry><title>T</title><id>http://arxiv.org/abs/1706.03762v1</id>' +
      '<author><name>Vaswani</name></author></entry></feed>'
    const records = parseSourceBody('arxiv', 'id', xml)
    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBe('1706.03762v1')
  })
})
