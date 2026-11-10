/**
 * Registry clients, split into the two halves that can be tested without a
 * network: URL construction and payload parsing.
 *
 * Transport is deliberately absent. M2 wires `fetch` on top of these; keeping
 * the parsing pure means a registry changing its JSON shape shows up as a
 * failing fixture test instead of a runtime surprise during a capture.
 */

import type { SourceId, SourceRecord } from './types.ts'

/** Registries, in the order the verifier should try them. */
export const SOURCE_ORDER: readonly SourceId[] = ['crossref', 'openalex', 'arxiv', 'datacite', 'pubmed']

/**
 * Optional `mailto` for the polite pool.
 *
 * Deliberately not a hardcoded address: inventing one (the earlier
 * `refkeeper@example.invalid`) is a worse citizen than omitting it, and the
 * registries treat an absent `mailto` as "slower pool", not "reject".
 */
export interface ContactOptions {
  readonly mailto?: string | undefined
}

function withMailto(url: string, options: ContactOptions | undefined): string {
  const mailto = options?.mailto?.trim()
  if (mailto === undefined || mailto === '') return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}mailto=${encodeURIComponent(mailto)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

function yearOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\d{4}$/u.test(value)) return Number(value)
  return undefined
}

/** A trimmed non-empty string, or undefined; keeps `BatchFields` free of `''`. */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** `page: "1-15"`, or OpenAlex's split first/last page pair. */
function pagesOf(first: unknown, last: unknown): string | undefined {
  const start = textOf(first)
  if (start === undefined) return undefined
  const end = textOf(last)
  if (end === undefined || end === start) return start
  return `${start}-${end}`
}

/** `issued: {"date-parts": [[2024, 5]]}` (Crossref) and friends. */
function crossrefYear(issued: unknown): number | undefined {
  if (!isRecord(issued)) return undefined
  const parts = issued['date-parts']
  if (!Array.isArray(parts) || parts.length === 0) return undefined
  const first = parts[0]
  if (!Array.isArray(first) || first.length === 0) return undefined
  return yearOf(first[0])
}

/* ------------------------------------------------------------------ Crossref */

export function crossrefDoiUrl(doi: string, options?: ContactOptions): string {
  return withMailto(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, options)
}

export function crossrefSearchUrl(query: string, rows = 5, options?: ContactOptions): string {
  return withMailto(
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${String(rows)}&select=DOI,title,author,issued,container-title,type,URL,volume,issue,page,publisher,language`,
    options,
  )
}

/** One item from `message.items[]` or `message` for a single-DOI lookup. */
export function parseCrossrefWork(raw: unknown): SourceRecord | undefined {
  if (!isRecord(raw)) return undefined
  // `/works/{doi}` wraps the work in `message`; `/works/{doi}/transform` and
  // search items do not. Accept both so a caller cannot silently get `undefined`.
  const work = isRecord(raw['message']) ? raw['message'] : raw
  const title = strings(work['title'])[0]?.trim() ?? ''
  const doi = typeof work['DOI'] === 'string' ? work['DOI'].trim().toLowerCase() : ''
  if (title === '' && doi === '') return undefined
  const authors = Array.isArray(work['author'])
    ? work['author'].flatMap((author) => {
        if (!isRecord(author)) return []
        const family = typeof author['family'] === 'string' ? author['family'] : ''
        const given = typeof author['given'] === 'string' ? author['given'] : ''
        const literal = typeof author['name'] === 'string' ? author['name'] : ''
        if (literal !== '') return [literal]
        if (family === '') return []
        return [given === '' ? family : `${family}, ${given}`]
      })
    : []
  return {
    source: 'crossref',
    id: doi,
    title,
    authors,
    year: crossrefYear(work['issued']),
    container: strings(work['container-title'])[0] ?? '',
    doi,
    type: typeof work['type'] === 'string' ? work['type'] : '',
    url: typeof work['URL'] === 'string' ? work['URL'] : '',
    ...fieldOf('volume', textOf(work['volume'])),
    ...fieldOf('issue', textOf(work['issue'])),
    ...fieldOf('pages', textOf(work['page'])),
    ...fieldOf('publisher', textOf(work['publisher'])),
    ...fieldOf('language', textOf(work['language'])),
  }
}

/** Spread helper: omit absent fields so `undefined` never lands in a record. */
function fieldOf<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}

export function parseCrossrefSearch(raw: unknown): SourceRecord[] {
  if (!isRecord(raw)) return []
  const message = isRecord(raw['message']) ? raw['message'] : raw
  const items = Array.isArray(message['items']) ? message['items'] : []
  return items.flatMap((item) => {
    const record = parseCrossrefWork(item)
    return record === undefined ? [] : [record]
  })
}

/* ------------------------------------------------------------------ OpenAlex */

export function openalexDoiUrl(doi: string, options?: ContactOptions): string {
  return withMailto(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, options)
}

export function openalexSearchUrl(query: string, perPage = 5, options?: ContactOptions): string {
  return withMailto(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${String(perPage)}`,
    options,
  )
}

export function parseOpenAlexWork(raw: unknown): SourceRecord | undefined {
  if (!isRecord(raw)) return undefined
  const title = (typeof raw['title'] === 'string' ? raw['title'] : typeof raw['display_name'] === 'string' ? raw['display_name'] : '').trim()
  const doi = typeof raw['doi'] === 'string' ? raw['doi'].replace(/^https?:\/\/doi\.org\//iu, '').trim().toLowerCase() : ''
  if (title === '' && doi === '') return undefined
  const authors = Array.isArray(raw['authorships'])
    ? raw['authorships'].flatMap((entry) => {
        if (!isRecord(entry) || !isRecord(entry['author'])) return []
        const name = entry['author']['display_name']
        return typeof name === 'string' && name !== '' ? [name] : []
      })
    : []
  const primary = isRecord(raw['primary_location']) ? raw['primary_location'] : undefined
  const source = primary !== undefined && isRecord(primary['source']) ? primary['source'] : undefined
  const biblio = isRecord(raw['biblio']) ? raw['biblio'] : undefined
  return {
    source: 'openalex',
    id: typeof raw['id'] === 'string' ? raw['id'].replace(/^https?:\/\/openalex\.org\//iu, '') : doi,
    title,
    authors,
    year: yearOf(raw['publication_year']),
    container: source !== undefined && typeof source['display_name'] === 'string' ? source['display_name'] : '',
    doi,
    type: typeof raw['type'] === 'string' ? raw['type'] : '',
    url: doi === '' ? '' : `https://doi.org/${doi}`,
    ...fieldOf('volume', biblio === undefined ? undefined : textOf(biblio['volume'])),
    ...fieldOf('issue', biblio === undefined ? undefined : textOf(biblio['issue'])),
    ...fieldOf('pages', biblio === undefined ? undefined : pagesOf(biblio['first_page'], biblio['last_page'])),
    ...fieldOf(
      'publisher',
      source === undefined
        ? undefined
        : (textOf(source['publisher']) ?? textOf(source['host_organization_name'])),
    ),
    ...fieldOf('language', textOf(raw['language'])),
  }
}

export function parseOpenAlexSearch(raw: unknown): SourceRecord[] {
  if (!isRecord(raw)) return []
  const results = Array.isArray(raw['results']) ? raw['results'] : []
  return results.flatMap((entry) => {
    const record = parseOpenAlexWork(entry)
    return record === undefined ? [] : [record]
  })
}

/* --------------------------------------------------------------------- arXiv */

export function arxivSearchUrl(query: string, maxResults = 5): string {
  // Callers may pass a bare string or an arXiv field query (`ti:`, `au:`);
  // prefixing `all:` twice would return nothing.
  const scoped = /^[a-z]+:/u.test(query) ? query : `all:${query}`
  return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(scoped)}&max_results=${String(maxResults)}`
}

/**
 * Exact arXiv lookup.
 *
 * `search_query=all:<id>` goes through the fuzzy text index and can return the
 * wrong paper; `id_list` is the documented exact form.
 */
export function arxivIdUrl(arxivId: string): string {
  const bare = arxivId.replace(/^arxiv:/iu, '').replace(/v\d+$/u, '')
  return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(bare)}&max_results=1`
}

function xmlText(block: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'u').exec(block)
  if (match === null) return ''
  return (match[1] ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Parse the arXiv Atom feed.
 *
 * Hand-rolled rather than pulling an XML dependency: the feed is a fixed shape,
 * and the plugin's whole install footprint is currently zero runtime deps.
 */
export function parseArxivFeed(xml: string): SourceRecord[] {
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gu)]
  return entries.flatMap((match) => {
    const block = match[1] ?? ''
    const title = xmlText(block, 'title')
    const idUrl = xmlText(block, 'id')
    const arxivId = /\/abs\/((?:[^/\s?#]+\/)?[^/\s?#]+)(?:[?#][^\s]*)?$/u.exec(idUrl)?.[1] ?? ''
    if (title === '' || arxivId === '') return []
    const authors = [...block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gu)].flatMap((author) => {
      const name = xmlText(author[1] ?? '', 'name')
      return name === '' ? [] : [name]
    })
    const published = xmlText(block, 'published')
    return [
      {
        source: 'arxiv' as const,
        id: arxivId,
        title,
        authors,
        year: /^(\d{4})-/u.exec(published)?.[1] === undefined ? undefined : Number(published.slice(0, 4)),
        container: 'arXiv',
        doi: xmlText(block, 'arxiv:doi').toLowerCase(),
        type: 'preprint',
        url: idUrl,
      },
    ]
  })
}

/* ------------------------------------------------------------------ DataCite */

export function dataciteDoiUrl(doi: string): string {
  return `https://api.datacite.org/dois/${encodeURIComponent(doi)}`
}

export function parseDataciteWork(raw: unknown): SourceRecord | undefined {
  if (!isRecord(raw)) return undefined
  const data = isRecord(raw['data']) ? raw['data'] : raw
  const attributes = isRecord(data['attributes']) ? data['attributes'] : undefined
  if (attributes === undefined) return undefined
  const title = Array.isArray(attributes['titles'])
    ? attributes['titles'].flatMap((entry) => (isRecord(entry) && typeof entry['title'] === 'string' ? [entry['title'].trim()] : []))[0] ?? ''
    : ''
  const doi = typeof attributes['doi'] === 'string' ? attributes['doi'].trim().toLowerCase() : ''
  if (title === '' && doi === '') return undefined
  const authors = Array.isArray(attributes['creators'])
    ? attributes['creators'].flatMap((creator) => {
        if (!isRecord(creator)) return []
        const name = typeof creator['name'] === 'string' ? creator['name'] : ''
        if (name !== '') return [name]
        const family = typeof creator['familyName'] === 'string' ? creator['familyName'] : ''
        const given = typeof creator['givenName'] === 'string' ? creator['givenName'] : ''
        return family === '' ? [] : [given === '' ? family : `${family}, ${given}`]
      })
    : []
  const types = isRecord(attributes['types']) ? attributes['types'] : undefined
  return {
    source: 'datacite',
    id: doi,
    title,
    authors,
    year: yearOf(attributes['publicationYear']),
    container: typeof attributes['publisher'] === 'string' ? attributes['publisher'] : '',
    doi,
    type: types !== undefined && typeof types['resourceTypeGeneral'] === 'string' ? types['resourceTypeGeneral'] : '',
    url: typeof attributes['url'] === 'string' ? attributes['url'] : doi === '' ? '' : `https://doi.org/${doi}`,
  }
}

/* -------------------------------------------------- body shape validation */

/**
 * Raised when a registry answers `200` with something that is not the payload
 * we asked for (HTML error page, wrong envelope, truncated XML).
 *
 * This exists because the earlier code let such a body parse to `[]`, which the
 * transport then counted as "source answered, no match" — a transient outage
 * would be persisted as a confident `quarantined + no-source-hit`. A body we
 * cannot understand is an error, never a negative result.
 */
export class SourceBodyError extends Error {
  readonly source: SourceId
  readonly detail: string

  constructor(source: SourceId, detail: string) {
    super(`${source}: ${detail}`)
    this.name = 'SourceBodyError'
    this.source = source
    this.detail = detail
  }
}

/** What the caller asked the registry for; the expected envelope depends on it. */
export type BodyBasis = 'doi' | 'search' | 'id'

function jsonEnvelope(source: SourceId, body: string): Record<string, unknown> {
  let raw: unknown
  try {
    raw = JSON.parse(body) as unknown
  } catch {
    throw new SourceBodyError(source, 'body is not JSON')
  }
  if (!isRecord(raw)) throw new SourceBodyError(source, 'body is not a JSON object')
  return raw
}

export function pubmedIdUrl(pmid: string): string {
  // Built like the DOI URL helpers: an identifier that cannot resolve is a
  // lookup that comes back empty, not a thrown error. Throwing here aborted
  // the whole verification — and with it the save — when a user typed a
  // PMCID into the PMID box.
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json&tool=dsh-refkeeper`
}

export function pmcSearchUrl(pmcid: string): string {
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(`${pmcid.toUpperCase()}[pmc]`)}&retmode=json&tool=dsh-refkeeper`
}

export function pmcSummaryUrl(uid: string): string {
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${encodeURIComponent(uid)}&retmode=json&tool=dsh-refkeeper`
}

function cleanPubMedTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\.$/u, '')
    .trim()
}

function pubmedAuthorName(value: unknown): string | undefined {
  const name = textOf(value)
  if (name === undefined || name.includes(',')) return name
  const match = /^(.+)\s+(\S+)$/u.exec(name)
  return match === null ? name : `${match[1]}, ${match[2]}`
}

function pubmedYear(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /\b(\d{4})\b/u.exec(value)
  return match === null ? undefined : Number(match[1])
}

/** Parse the ESearch db=pmc response to its internal PMC UID (not a PMID). */
export function parsePmcSearchUid(json: string): string | undefined {
  const raw = jsonEnvelope('pubmed', json)
  const result = isRecord(raw['esearchresult']) ? raw['esearchresult'] : undefined
  if (result === undefined || !Array.isArray(result['idlist'])) {
    throw new SourceBodyError('pubmed', 'missing esearchresult.idlist[]')
  }
  const ids = result['idlist']
  if (!ids.every((id) => typeof id === 'string' && /^\d+$/u.test(id))) {
    throw new SourceBodyError('pubmed', 'esearch result contains invalid PMC UIDs')
  }
  return ids[0] as string | undefined
}

/** PMC ESummary uses an internal UID; extract its linked PubMed identifier. */
export function parsePmcSummaryPmid(json: string, uid: string): string {
  const raw = jsonEnvelope('pubmed', json)
  const result = isRecord(raw['result']) ? raw['result'] : undefined
  const work = result !== undefined && isRecord(result[uid]) ? result[uid] : undefined
  if (work === undefined) throw new SourceBodyError('pubmed', 'missing PMC summary record')
  const articleids = work['articleids']
  if (!Array.isArray(articleids)) throw new SourceBodyError('pubmed', 'missing PMC articleids[]')
  const pmid = articleids.find((entry) =>
    isRecord(entry) && entry['idtype'] === 'pmid' && typeof entry['value'] === 'string'
  )
  const value = isRecord(pmid) ? textOf(pmid['value']) : undefined
  if (value === undefined || !/^\d{6,8}$/u.test(value)) {
    throw new SourceBodyError('pubmed', 'PMC summary has no valid PMID')
  }
  return value
}

/** Parse one or more PubMed ESummary records into the verifier's common shape. */
/**
 * PubMed's `pubtype` mixes publication kinds with study design — a record can
 * read `["Comparative Study", "Journal Article", "Research Support, Non-U.S.
 * Gov't"]`. The first entry is therefore not the document type. Pick the first
 * recognised publication kind and map it onto the reference types the exporters
 * know; anything unrecognised falls back to a journal article.
 */
const PUBMED_REF_TYPE: Readonly<Record<string, string>> = {
  'journal article': 'journalArticle',
  review: 'journalArticle',
  'review article': 'journalArticle',
  'systematic review': 'journalArticle',
  letter: 'journalArticle',
  comment: 'journalArticle',
  editorial: 'journalArticle',
  news: 'journalArticle',
  'book review': 'journalArticle',
  'published erratum': 'journalArticle',
  book: 'book',
  'book chapter': 'book',
  monograph: 'book',
  conference: 'conferencePaper',
  'conference paper': 'conferencePaper',
  'congress': 'conferencePaper',
  'proceedings': 'conferencePaper',
  preprint: 'preprint',
  thesis: 'thesis',
  dissertation: 'thesis',
  report: 'report',
  'technical report': 'report',
  'working paper': 'report',
  webpage: 'webpage',
  'internet resource': 'webpage',
  'database': 'webpage',
}

function pubmedRefType(pubtypes: readonly string[]): string {
  for (const raw of pubtypes) {
    const hit = PUBMED_REF_TYPE[raw.trim().toLowerCase()]
    if (hit !== undefined) return hit
  }
  return 'journalArticle'
}

export function parsePubMedSummary(json: string): SourceRecord[] {
  const raw = jsonEnvelope('pubmed', json)
  const result = isRecord(raw['result']) ? raw['result'] : undefined
  if (result === undefined || !Array.isArray(result['uids'])) {
    throw new SourceBodyError('pubmed', 'missing result.uids[]')
  }
  const uids = result['uids']
  if (!uids.every((uid) => typeof uid === 'string' && /^\d{6,8}$/u.test(uid))) {
    throw new SourceBodyError('pubmed', 'summary contains invalid PMID values')
  }
  return uids.map((uid) => {
    const work = result[uid]
    if (!isRecord(work)) throw new SourceBodyError('pubmed', 'missing summary record')
    const title = cleanPubMedTitle(work['title'])
    if (title === '') throw new SourceBodyError('pubmed', 'summary record has no title')
    const authors = Array.isArray(work['authors'])
      ? work['authors'].flatMap((author) => {
          if (!isRecord(author)) return []
          const name = pubmedAuthorName(author['name'])
          return name === undefined ? [] : [name]
        })
      : []
    const articleids = Array.isArray(work['articleids']) ? work['articleids'] : []
    const doiEntry = articleids.find((entry) => isRecord(entry) && entry['idtype'] === 'doi')
    const doi = isRecord(doiEntry) ? textOf(doiEntry['value'])?.replace(/^doi:\s*/iu, '').toLowerCase() ?? '' : ''
    const lang = Array.isArray(work['lang']) ? strings(work['lang'])[0] : undefined
    return {
      source: 'pubmed',
      id: uid,
      title,
      authors,
      year: pubmedYear(work['pubdate']),
      container: textOf(work['fulljournalname']) ?? textOf(work['source']) ?? '',
      doi,
      type: pubmedRefType(Array.isArray(work['pubtype']) ? strings(work['pubtype']) : []),
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      volume: textOf(work['volume']),
      issue: textOf(work['issue']),
      pages: textOf(work['pages']),
      language: lang,
    }
  })
}

function workOfWork(source: SourceId, raw: Record<string, unknown>): Record<string, unknown> {
  const work = isRecord(raw['message']) ? raw['message'] : raw
  if (!isRecord(work)) throw new SourceBodyError(source, 'no work object in response')
  return work
}

/** XML prologue we tolerate before the root element: declaration, comments, whitespace. */
const ATOM_PROLOGUE = /^\s*(?:<\?xml\b[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/u
const XML_COMMENTS = /<!--[\s\S]*?-->/gu
/** `<name …>`, `</name>`, `<name … />`; attribute values may contain `>`. */
const XML_TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gu

/**
 * Reject anything that is not a complete, well-nested Atom feed.
 *
 * Truncation shows up two ways, and both used to read as "source answered, no
 * hits" — which could be persisted as `quarantined + no-source-hit`:
 *   1. the closing `</feed>` is missing;
 *   2. an inner element is cut or mis-nested while `</feed>` still arrives
 *      (`<feed><entry><title>cut</entry></feed>`), leaving `parseArxivFeed`
 *      with zero complete entries.
 *
 * The stack pass below only proves tag balance — it is not a general XML
 * parser. Bodies that fail it are treated as damaged, which is the safe
 * direction: a retryable `source-error` instead of a permanent verdict.
 */
function assertAtomFeed(source: SourceId, body: string): string {
  const xml = body.replace(ATOM_PROLOGUE, '').replace(XML_COMMENTS, '')
  // XML is case-sensitive: Atom mandates the lower-case element names `feed`
  // and `entry`. Matching case-insensitively here would accept `<Feed>` and
  // then hand the parser a document it reads as an empty feed.
  const root = /^<feed\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/u.exec(xml)
  if (root === null) throw new SourceBodyError(source, 'body is not an Atom feed')
  const attributes = root[1] ?? ''
  if (!/\bxmlns\s*=\s*(?:"http:\/\/www\.w3\.org\/2005\/Atom"|'http:\/\/www\.w3\.org\/2005\/Atom')/u.test(attributes)) {
    throw new SourceBodyError(source, 'Atom feed is missing the Atom namespace')
  }
  if (!/<\/feed\s*>/u.test(xml)) throw new SourceBodyError(source, 'Atom feed is truncated (no closing </feed>)')

  const open: string[] = []
  let cursor = 0
  let rootSeen = false
  for (const match of xml.matchAll(XML_TAG)) {
    const between = xml.slice(cursor, match.index)
    if (between.includes('<') || (open.length === 0 && between.trim() !== '')) {
      throw new SourceBodyError(source, 'body is not well-formed XML')
    }
    cursor = match.index + match[0].length
    const closing = match[1] === '/'
    const name = match[2] ?? ''
    const selfClosing = (match[3] ?? '').trimEnd().endsWith('/')

    if (closing) {
      const expected = open.pop()
      if (expected === undefined || expected !== name) {
        throw new SourceBodyError(source, `Atom feed is malformed (unexpected </${name}>)`)
      }
    } else {
      if (open.length === 0) {
        if (rootSeen) throw new SourceBodyError(source, 'Atom feed has multiple root elements')
        rootSeen = true
      }
      if (!selfClosing) open.push(name)
    }
  }
  const tail = xml.slice(cursor)
  if (tail.includes('<') || (open.length === 0 && tail.trim() !== '')) {
    throw new SourceBodyError(source, 'body is not well-formed XML')
  }
  if (!rootSeen) throw new SourceBodyError(source, 'body is not an Atom feed')
  const unclosed = open.at(-1)
  if (unclosed !== undefined) {
    throw new SourceBodyError(source, `Atom feed is truncated (unclosed <${unclosed}>)`)
  }
  return xml
}

/**
 * Parse a registry body, distinguishing "valid envelope, no records" from
 * "this is not the payload we expected".
 *
 * The distinction is the whole point: only the first may count as a source
 * answering, so only the first can produce `no-source-hit`.
 */
export function parseSourceBody(source: SourceId, basis: BodyBasis, body: string): SourceRecord[] {
  if (source === 'arxiv') {
    const xml = assertAtomFeed(source, body)
    const records = parseArxivFeed(xml)
    // Count every entry marker (also unsupported prefixed/case variants) and
    // require the parser to produce one record per entry. Otherwise one good
    // row could hide a truncated neighbor and still look like a clean answer.
    const entryCount = [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?entry\b/giu)].length
    if (records.length !== entryCount) {
      throw new SourceBodyError(source, 'Atom feed has entries that could not be read')
    }
    return records
  }
  if (source === 'datacite') {
    const raw = jsonEnvelope(source, body)
    const data = isRecord(raw['data']) ? raw['data'] : raw
    if (!isRecord(data['attributes'])) throw new SourceBodyError(source, 'missing data.attributes')
    const record = parseDataciteWork(raw)
    if (record === undefined) throw new SourceBodyError(source, 'work has neither DOI nor title')
    return [record]
  }
  if (source === 'openalex') {
    const raw = jsonEnvelope(source, body)
    if (basis === 'search') {
      const results = raw['results']
      if (!Array.isArray(results)) throw new SourceBodyError(source, 'missing results[]')
      const records = parseOpenAlexSearch(raw)
      if (records.length !== results.length) {
        throw new SourceBodyError(source, 'search response contains unreadable results')
      }
      return records
    }
    if (
      typeof raw['id'] !== 'string' &&
      typeof raw['doi'] !== 'string' &&
      typeof raw['display_name'] !== 'string' &&
      typeof raw['title'] !== 'string'
    ) {
      throw new SourceBodyError(source, 'no work object in response')
    }
    const record = parseOpenAlexWork(raw)
    if (record === undefined) throw new SourceBodyError(source, 'work has neither DOI nor title')
    return [record]
  }
  if (source === 'pubmed') {
    if (basis !== 'id') throw new SourceBodyError(source, 'only exact-ID lookups are supported')
    return parsePubMedSummary(body)
  }
  // Crossref
  const raw = jsonEnvelope(source, body)
  if (basis === 'search') {
    const message = isRecord(raw['message']) ? raw['message'] : raw
    const items = message['items']
    if (!Array.isArray(items)) throw new SourceBodyError(source, 'missing message.items[]')
    const records = parseCrossrefSearch(raw)
    if (records.length !== items.length) {
      throw new SourceBodyError(source, 'search response contains unreadable items')
    }
    return records
  }
  const work = workOfWork(source, raw)
  const hasDoi = typeof work['DOI'] === 'string' && work['DOI'].trim() !== ''
  if (!hasDoi && strings(work['title']).length === 0) {
    throw new SourceBodyError(source, 'work has neither DOI nor title')
  }
  const record = parseCrossrefWork(raw)
  if (record === undefined) throw new SourceBodyError(source, 'work has neither DOI nor title')
  return [record]
}
