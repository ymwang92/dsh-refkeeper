/**
 * Pass 1 extraction: identifiers that pin one work without parsing prose.
 *
 * The goal is recall on things a verifier can resolve exactly (DOI, arXiv,
 * ISBN, report numbers) and a *ranked* list of URLs, because a bare link is
 * evidence of interest, not evidence of a citation. Confidence encodes that
 * distinction so later stages can decide what deserves a model round-trip.
 */

/** What kind of identifier a hit pins down. */
export type IdentifierKind = 'doi' | 'arxiv' | 'isbn' | 'report' | 'url'

/** One identifier occurrence inside the scanned text. */
export interface IdentifierHit {
  readonly kind: IdentifierKind
  /** Canonical identifier value: bare DOI, bare arXiv id, digits-only ISBN. */
  readonly value: string
  /** Original matched text, useful for showing the user what was found. */
  readonly raw: string
  /** Host of a URL hit, lowercase; empty for non-URL hits. */
  readonly host: string
  /** 0..1 — how much this alone justifies creating a candidate. */
  readonly confidence: number
}

/** Hosts whose pages are almost always a citable work landing page. */
const STRONG_HOSTS: readonly string[] = [
  'doi.org',
  'dx.doi.org',
  'arxiv.org',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'nature.com',
  'science.org',
  'cell.com',
  'sciencedirect.com',
  'link.springer.com',
  'springer.com',
  'wiley.com',
  'onlinelibrary.wiley.com',
  'tandfonline.com',
  'sagepub.com',
  'ieeexplore.ieee.org',
  'dl.acm.org',
  'aclanthology.org',
  'cnki.net',
  'kns.cnki.net',
  'wanfangdata.com.cn',
  'cqvip.com',
  'jstor.org',
  'ncbi.nlm.nih.gov',
  'europepmc.org',
  'openalex.org',
  'semanticscholar.org',
]

/** Host suffix match, so `www.nature.com` and `nature.com` both count. */
function hostIsStrong(host: string): boolean {
  return STRONG_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))
}

/** Strip punctuation that prose glues onto a trailing identifier. */
function trimTrailing(raw: string): string {
  let value = raw
  for (;;) {
    const last = value.at(-1)
    if (last === undefined) return value
    if ('.,;:\'"”’、，。；：'.includes(last)) {
      value = value.slice(0, -1)
      continue
    }
    if (last === ')' && (value.match(/\(/gu)?.length ?? 0) < (value.match(/\)/gu)?.length ?? 0)) {
      value = value.slice(0, -1)
      continue
    }
    if (last === '>' && (value.match(/</gu)?.length ?? 0) < (value.match(/>/gu)?.length ?? 0)) {
      value = value.slice(0, -1)
      continue
    }
    return value
  }
}

// DOI suffixes may carry angle brackets: legacy AMS ids look like
// 10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2, so <> are part of the id.
const DOI = /\b10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/giu
const ARXIV_BARE = /\barxiv\s*:\s*(\d{4}\.\d{4,5})(?:v\d+)?/giu
const ARXIV_URL = /\barxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/giu
/** ISBN-13: 978/979 prefix, compact (`9780306406157`) or grouped (`978-0-306-40615-7`). */
const ISBN13 = /\b(97[89][\d\-\s]{8,16}[\dXx])\b/gu
/**
 * Bare ISBN-10 only counts when the text labels it: the shape test alone
 * accepts any 10-digit number, and the checksum only rejects 10 in 11.
 */
const ISBN10 = /\bISBN(?:-1[03])?\s*[:：]?\s*(\d[\d\-\s]{7,12}[\dXx])\b/giu
const REPORT = /\b(PB\d{6,}|NUREG-\d{3,}|WHO\/[A-Z]{2,}\/\d{1,4}|GB\/T\s?\d{1,6}(?:[-.]\d{1,4})?|ISO\s?\d{1,6}(?:[-:]\d{1,4})?)\b/gu
const URL_PATTERN = /\bhttps?:\/\/[^\s"'”）】\]]+/giu

/** Bare-DOI normal form: lowercase (DOIs are case-insensitive) and trimmed. */
export function normalizeDoi(raw: string): string {
  return trimTrailing(raw).trim().toLowerCase()
}

/** arXiv ids are compared without the version suffix. */
export function normalizeArxiv(raw: string): string {
  return raw.replace(/v\d+$/u, '')
}

/** ISBN comparison form: digits and X only. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^\dXx]/gu, '').toUpperCase()
}

/**
 * ISBN-13 check digit, alternating 1/3 weights over the first twelve digits.
 *
 * Validation is the only cheap way to tell an ISBN from any 13-digit number
 * (order ids, timestamps), and a mistyped ISBN is a bad row rather than a
 * missed one — so a failed checksum drops the hit.
 */
export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false
  let sum = 0
  for (const [index, char] of value.split('').entries()) {
    sum += Number(char) * (index % 2 === 0 ? 1 : 3)
  }
  return sum % 10 === 0
}

/** ISBN-10 check digit: weights 10..1, `X` counts as 10. */
export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/u.test(value)) return false
  let sum = 0
  for (const [index, char] of value.split('').entries()) {
    sum += (char === 'X' ? 10 : Number(char)) * (10 - index)
  }
  return sum % 11 === 0
}

function push(
  hits: IdentifierHit[],
  seen: Set<string>,
  hit: Omit<IdentifierHit, 'raw'> & { raw: string },
): void {
  const key = `${hit.kind}:${hit.value}`
  if (seen.has(key)) return
  seen.add(key)
  hits.push(hit)
}

/**
 * Extract every identifier occurrence in one text block.
 *
 * Ordering is by kind priority (doi, arxiv, isbn, report, url) rather than by
 * position, because later stages want "what did we pin down" first and "what
 * might be interesting" last.
 */
export function extractIdentifiers(text: string): IdentifierHit[] {
  const hits: IdentifierHit[] = []
  const seen = new Set<string>()

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = trimTrailing(match[0])
    let host = ''
    try {
      host = new URL(raw).hostname.toLowerCase()
    } catch {
      continue
    }
    // A doi.org/arxiv.org URL carries a better identifier than "a URL".
    const doiInUrl = raw.match(/10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/iu)
    if (doiInUrl !== null) {
      const value = normalizeDoi(doiInUrl[0])
      push(hits, seen, { kind: 'doi', value, raw, host, confidence: 0.95 })
      continue
    }
    const arxivInUrl = raw.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/iu)
    if (arxivInUrl?.[1] !== undefined) {
      push(hits, seen, {
        kind: 'arxiv',
        value: normalizeArxiv(arxivInUrl[1]),
        raw,
        host,
        confidence: 0.95,
      })
      continue
    }
    push(hits, seen, {
      kind: 'url',
      value: raw,
      raw,
      host,
      confidence: hostIsStrong(host) ? 0.7 : 0.3,
    })
  }

  for (const match of text.matchAll(DOI)) {
    push(hits, seen, {
      kind: 'doi',
      value: normalizeDoi(match[0]),
      raw: match[0],
      host: '',
      confidence: 0.95,
    })
  }

  for (const match of text.matchAll(ARXIV_BARE)) {
    const id = match[1]
    if (id === undefined) continue
    push(hits, seen, {
      kind: 'arxiv',
      value: normalizeArxiv(id),
      raw: match[0],
      host: '',
      confidence: 0.92,
    })
  }

  for (const match of text.matchAll(ARXIV_URL)) {
    const id = match[1]
    if (id === undefined) continue
    push(hits, seen, {
      kind: 'arxiv',
      value: normalizeArxiv(id),
      raw: match[0],
      host: 'arxiv.org',
      confidence: 0.92,
    })
  }

  for (const match of text.matchAll(ISBN13)) {
    const value = normalizeIsbn(match[1] ?? '')
    if (!isValidIsbn13(value)) continue
    push(hits, seen, { kind: 'isbn', value, raw: match[0], host: '', confidence: 0.85 })
  }

  for (const match of text.matchAll(ISBN10)) {
    const value = normalizeIsbn(match[1] ?? '')
    if (!isValidIsbn10(value)) continue
    push(hits, seen, { kind: 'isbn', value, raw: match[1] ?? match[0], host: '', confidence: 0.8 })
  }

  for (const match of text.matchAll(REPORT)) {
    push(hits, seen, {
      kind: 'report',
      value: collapseReport(match[1] ?? ''),
      raw: match[0],
      host: '',
      // A bare standard number ("ISO 9001") is usually not a citation.
      confidence: 0.45,
    })
  }

  return hits
}

/** Report numbers vary by spacing/case; comparing a compact form avoids misses. */
function collapseReport(raw: string): string {
  return raw.replace(/\s+/gu, '').toUpperCase()
}
