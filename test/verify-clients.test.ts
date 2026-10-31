import { describe, expect, it } from 'vitest'
import {
  arxivSearchUrl,
  crossrefDoiUrl,
  crossrefSearchUrl,
  dataciteDoiUrl,
  openalexDoiUrl,
  openalexSearchUrl,
  parseArxivFeed,
  parseCrossrefSearch,
  parseCrossrefWork,
  parseDataciteWork,
  parseOpenAlexSearch,
  parseOpenAlexWork,
  SOURCE_ORDER,
} from '../src/verify/clients.ts'

/** Shapes below mirror the live payloads (trimmed), so a schema change fails here. */
const CROSSREF_ITEM = {
  DOI: '10.1000/ABC',
  title: ['Attention Is All You Need'],
  author: [
    { family: 'Vaswani', given: 'Ashish' },
    { family: 'Shazeer', given: 'Noam' },
  ],
  issued: { 'date-parts': [[2017, 6, 12]] },
  'container-title': ['Advances in Neural Information Processing Systems'],
  type: 'proceedings-article',
  URL: 'https://doi.org/10.1000/abc',
}

const OPENALEX_WORK = {
  id: 'https://openalex.org/W2963403868',
  doi: 'https://doi.org/10.1000/abc',
  title: 'Attention Is All You Need',
  publication_year: 2017,
  authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
  primary_location: { source: { display_name: 'NeurIPS' } },
  type: 'article',
}

const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <published>2017-06-12T17:57:34Z</published>
    <arxiv:doi>10.1000/abc</arxiv:doi>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v1</id>
    <title>深度学习在医学影像中的应用综述</title>
    <author><name>张三</name></author>
    <published>2024-01-02T00:00:00Z</published>
  </entry>
</feed>`

const DATACITE_WORK = {
  data: {
    id: '10.5061/dryad.abc',
    attributes: {
      doi: '10.5061/DRYAD.ABC',
      titles: [{ title: 'Raw measurements for the 2024 field campaign' }],
      creators: [{ name: 'Wang, Y.' }],
      publicationYear: 2024,
      publisher: 'Dryad',
      types: { resourceTypeGeneral: 'Dataset' },
      url: 'https://datadryad.org/stash/dataset/doi:10.5061/dryad.abc',
    },
  },
}

describe('URL construction', () => {
  it('encodes DOIs and never invents a contact address', () => {
    expect(crossrefDoiUrl('10.1000/a b')).toContain('10.1000%2Fa%20b')
    // No mailto by default: a fabricated address is worse than the slow pool.
    expect(crossrefDoiUrl('10.1000/x')).not.toContain('mailto=')
    expect(crossrefDoiUrl('10.1000/x', { mailto: 'me@example.org' })).toContain('mailto=me%40example.org')
    expect(openalexDoiUrl('10.1000/x')).toContain('doi:10.1000%2Fx')
    expect(dataciteDoiUrl('10.5061/dryad.abc')).toContain('10.5061%2Fdryad.abc')
  })

  it('encodes bibliographic queries instead of pasting them raw', () => {
    expect(crossrefSearchUrl('a & b')).toContain('query.bibliographic=a%20%26%20b')
    expect(openalexSearchUrl('a & b')).toContain('search=a%20%26%20b')
    expect(arxivSearchUrl('all:attention')).toContain('search_query=all%3Aattention')
  })

  it('orders sources crossref, openalex, arxiv, datacite', () => {
    expect(SOURCE_ORDER).toEqual(['crossref', 'openalex', 'arxiv', 'datacite'])
  })
})

describe('Crossref parsing', () => {
  it('normalizes one work', () => {
    const record = parseCrossrefWork(CROSSREF_ITEM)
    expect(record).toMatchObject({
      source: 'crossref',
      doi: '10.1000/abc',
      title: 'Attention Is All You Need',
      year: 2017,
      type: 'proceedings-article',
      container: 'Advances in Neural Information Processing Systems',
    })
    expect(record?.authors).toEqual(['Vaswani, Ashish', 'Shazeer, Noam'])
  })

  it('reads a search page and skips unusable items', () => {
    const records = parseCrossrefSearch({ message: { items: [CROSSREF_ITEM, { nonsense: true }] } })
    expect(records).toHaveLength(1)
    expect(records[0]?.title).toBe('Attention Is All You Need')
  })

  it('returns nothing rather than a half record', () => {
    expect(parseCrossrefWork({})).toBeUndefined()
    expect(parseCrossrefWork(null)).toBeUndefined()
  })
})

describe('OpenAlex parsing', () => {
  it('strips the doi.org prefix and the OpenAlex id URL', () => {
    const record = parseOpenAlexWork(OPENALEX_WORK)
    expect(record).toMatchObject({ doi: '10.1000/abc', id: 'W2963403868', year: 2017, container: 'NeurIPS' })
    expect(record?.authors).toEqual(['Ashish Vaswani'])
  })

  it('reads search results', () => {
    expect(parseOpenAlexSearch({ results: [OPENALEX_WORK] })).toHaveLength(1)
  })
})

describe('arXiv parsing', () => {
  it('reads every entry, including a CJK title', () => {
    const records = parseArxivFeed(ARXIV_FEED)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ id: '1706.03762v5', year: 2017, doi: '10.1000/abc', container: 'arXiv' })
    expect(records[1]?.title).toBe('深度学习在医学影像中的应用综述')
    expect(records[1]?.authors).toEqual(['张三'])
  })

  it('returns nothing for an empty or malformed feed', () => {
    expect(parseArxivFeed('<feed></feed>')).toEqual([])
    expect(parseArxivFeed('not xml')).toEqual([])
  })
})

describe('DataCite parsing', () => {
  it('normalizes a dataset DOI', () => {
    const record = parseDataciteWork(DATACITE_WORK)
    expect(record).toMatchObject({
      source: 'datacite',
      doi: '10.5061/dryad.abc',
      year: 2024,
      container: 'Dryad',
      type: 'Dataset',
    })
    expect(record?.authors).toEqual(['Wang, Y.'])
  })

  it('returns nothing without a data envelope', () => {
    expect(parseDataciteWork({})).toBeUndefined()
  })
})

describe('bibliographic detail (the fields verification used to discard)', () => {
  it('keeps volume, issue, pages, publisher and language from Crossref', () => {
    const record = parseCrossrefWork({
      ...CROSSREF_ITEM,
      volume: '30',
      issue: '2',
      page: '5998-6008',
      publisher: 'Curran Associates',
      language: 'en',
    })
    expect(record).toMatchObject({
      volume: '30',
      issue: '2',
      pages: '5998-6008',
      publisher: 'Curran Associates',
      language: 'en',
    })
  })

  it('keeps biblio volume/issue/pages, publisher and language from OpenAlex', () => {
    const record = parseOpenAlexWork({
      ...OPENALEX_WORK,
      biblio: { volume: '30', issue: '2', first_page: '5998', last_page: '6008' },
      primary_location: { source: { display_name: 'NeurIPS', publisher: 'Curran Associates' } },
      language: 'en',
    })
    expect(record).toMatchObject({
      volume: '30',
      issue: '2',
      pages: '5998-6008',
      publisher: 'Curran Associates',
      language: 'en',
    })
  })

  it('omits the keys entirely when a registry does not publish them', () => {
    const record = parseCrossrefWork(CROSSREF_ITEM)
    expect(record?.volume).toBeUndefined()
    expect(record?.pages).toBeUndefined()
    // `undefined` rather than a placeholder string: enrich must not write blanks.
    expect(Object.hasOwn(record ?? {}, 'publisher')).toBe(false)
  })

  it('keeps a first page alone when no last page is published', () => {
    const record = parseOpenAlexWork({
      ...OPENALEX_WORK,
      biblio: { volume: '30', first_page: 'e124372' },
    })
    expect(record?.pages).toBe('e124372')
  })
})
