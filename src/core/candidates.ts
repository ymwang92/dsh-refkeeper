/**
 * Candidate assembly: turn raw extraction hits into the one record the rest of
 * the plugin reasons about.
 *
 * Two rules drive the shape:
 *  - a candidate keeps *every* origin it was seen from, so a later verification
 *    failure can say "found as a DOI link and as an APA string" rather than
 *    silently picking one;
 *  - fields are never invented. An empty title means "unknown", never "the URL
 *    as a title", because verification compares titles and a fabricated one
 *    would pass nothing while looking complete.
 */

import type { CitationHit, ItemType } from './citations.ts'
import { extractCitations } from './citations.ts'
import type { IdentifierHit } from './identifiers.ts'
import { extractIdentifiers, normalizeArxiv, normalizeDoi, normalizeIsbn } from './identifiers.ts'
import { collapseSpace, titleKey } from './text.ts'

/** Where a candidate's fields came from. Higher priority wins on merge. */
export type CandidateOrigin = 'identifier' | 'citation' | 'model'

/** Which channel a text slice came from; tool output is read more narrowly. */
export type SourceRole = 'user' | 'assistant' | 'tool'

/** One text-bearing slice of the conversation. */
export interface SourcedText {
  /** Session event seq the text came from, for evidence links. */
  readonly seq: number
  readonly text: string
  /** Omitted by callers that only have text (tests, ad-hoc probes). */
  readonly role?: SourceRole | undefined
}

/** A reference this plugin might store, before any external verification. */
export interface Candidate {
  /** Dedupe key: the identity rule for "is this the same work". */
  readonly key: string
  readonly type: ItemType
  readonly origins: readonly CandidateOrigin[]
  readonly doi: string
  readonly arxivId: string
  readonly pmid?: string | undefined
  readonly pmcid?: string | undefined
  readonly isbn: string
  readonly reportNumber: string
  readonly url: string
  readonly title: string
  readonly authors: readonly string[]
  readonly year: number | undefined
  readonly container: string
  readonly volume: string
  readonly issue: string
  readonly pages: string
  /** 0..1 — extraction confidence, not verification status. */
  readonly confidence: number
  /** True when a model round-trip is needed to make this record useful. */
  readonly needsModelEnrichment: boolean
  /** Session seqs this candidate was observed in. */
  readonly evidence: readonly number[]
}

const ORIGIN_PRIORITY: Readonly<Record<CandidateOrigin, number>> = {
  model: 3,
  citation: 2,
  identifier: 1,
}

function firstNonNull<T>(...values: readonly (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined)
}

/**
 * Identity of a work: DOI, arXiv, PMID, PMCID, ISBN, report number, then
 * normalized title+year, then the URL. Mirrors §5.2 of the plan.
 */
export function dedupeKey(candidate: Pick<Candidate, 'doi' | 'arxivId' | 'pmid' | 'pmcid' | 'isbn' | 'reportNumber' | 'title' | 'year' | 'url' | 'key'>): string {
  if (candidate.doi !== '') return `doi:${candidate.doi}`
  if (candidate.arxivId !== '') return `arxiv:${candidate.arxivId}`
  if (candidate.pmid !== undefined && candidate.pmid !== '') return `pmid:${candidate.pmid}`
  if (candidate.pmcid !== undefined && candidate.pmcid !== '') return `pmcid:${candidate.pmcid}`
  if (candidate.isbn !== '') return `isbn:${candidate.isbn}`
  if (candidate.reportNumber !== '') return `report:${candidate.reportNumber}`
  // A blank title must not become `title:|2024`: that key collides with every
  // other untitled work in the same year and makes dedupe actively wrong.
  const title = titleKey(candidate.title)
  if (title !== '') return `title:${title}|${candidate.year ?? ''}`
  if (candidate.url !== '') return `url:${candidate.url}`
  return candidate.key
}

/** True when a candidate can at least be named: an identifier, a title or a URL. */
export function hasIdentity(candidate: Pick<Candidate, 'doi' | 'arxivId' | 'pmid' | 'pmcid' | 'isbn' | 'reportNumber' | 'title' | 'url'>): boolean {
  return (
    candidate.doi !== '' ||
    candidate.arxivId !== '' ||
    candidate.pmid !== undefined && candidate.pmid !== '' ||
    candidate.pmcid !== undefined && candidate.pmcid !== '' ||
    candidate.isbn !== '' ||
    candidate.reportNumber !== '' ||
    titleKey(candidate.title) !== '' ||
    candidate.url !== ''
  )
}

/**
 * Keep only evidence seqs that actually exist in the window that was read.
 *
 * A model can name seq 999 for a 12-event session; storing that would make the
 * annotation point at nothing. Unknown seqs are dropped, not guessed at.
 */
export function sanitizeEvidence(seqs: readonly number[], window: ReadonlySet<number> | undefined): number[] {
  const kept = seqs.filter((seq) => Number.isInteger(seq) && seq >= 0 && (window === undefined || window.has(seq)))
  return [...new Set(kept)].sort((a, b) => a - b)
}

function emptyCandidate(type: ItemType, origin: CandidateOrigin, confidence: number): Candidate {
  return {
    key: '',
    type,
    origins: [origin],
    doi: '',
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
    confidence,
    needsModelEnrichment: true,
    evidence: [],
  }
}

/** Identifier-only candidate: pins the work, says nothing about the prose. */
export function candidateFromIdentifier(hit: IdentifierHit, seq: number): Candidate {
  const base = emptyCandidate(typeForIdentifier(hit.kind), 'identifier', hit.confidence)
  const filled: Candidate = {
    ...base,
    doi: hit.kind === 'doi' ? hit.value : '',
    arxivId: hit.kind === 'arxiv' ? hit.value : '',
    ...(hit.kind === 'pmid' ? { pmid: hit.value } : {}),
    ...(hit.kind === 'pmcid' ? { pmcid: hit.value.toUpperCase() } : {}),
    isbn: hit.kind === 'isbn' ? hit.value : '',
    reportNumber: hit.kind === 'report' ? hit.value : '',
    url: hit.kind === 'url' ? hit.value : '',
    evidence: [seq],
  }
  return { ...filled, key: dedupeKey(filled) }
}

function typeForIdentifier(kind: IdentifierHit['kind']): ItemType {
  switch (kind) {
    case 'arxiv':
      return 'preprint'
    case 'isbn':
      return 'book'
    case 'report':
      return 'report'
    case 'url':
      return 'webpage'
    default:
      // A DOI resolves to a journal article far more often than not; the
      // verifier corrects the type from the registry record.
      return 'journalArticle'
  }
}

/** Citation-string candidate: has prose fields, usually lacks an identifier. */
export function candidateFromCitation(hit: CitationHit, seq: number, identifiers: readonly IdentifierHit[]): Candidate {
  const attached = (kind: IdentifierHit['kind']): string =>
    identifiers.find((identifier) => identifier.kind === kind)?.value ?? ''
  const pmid = attached('pmid')
  const pmcid = attached('pmcid').toUpperCase()
  const base = emptyCandidate(hit.type, 'citation', hit.confidence)
  const filled: Candidate = {
    ...base,
    doi: hit.doi !== '' ? hit.doi : attached('doi'),
    arxivId: attached('arxiv'),
    ...(pmid === '' ? {} : { pmid }),
    ...(pmcid === '' ? {} : { pmcid }),
    isbn: attached('isbn'),
    reportNumber: attached('report'),
    title: hit.title,
    authors: hit.authors,
    year: hit.year,
    container: hit.container,
    volume: hit.volume,
    issue: hit.issue,
    pages: hit.pages,
    evidence: [seq],
    needsModelEnrichment: hit.authors.length === 0 || hit.container === '',
  }
  return { ...filled, key: dedupeKey(filled) }
}

function nonEmpty(value: string, fallback: string): string {
  return value !== '' ? value : fallback
}

/** Structured fields a model supplies for Pass 3 (everything but the identity). */
export interface ModelCandidateInput {
  readonly title: string
  readonly authors?: readonly string[] | undefined
  readonly year?: number | undefined
  readonly type?: ItemType | undefined
  readonly doi?: string | undefined
  readonly arxivId?: string | undefined
  readonly pmid?: string | undefined
  readonly pmcid?: string | undefined
  readonly isbn?: string | undefined
  readonly reportNumber?: string | undefined
  readonly url?: string | undefined
  readonly container?: string | undefined
  readonly volume?: string | undefined
  readonly issue?: string | undefined
  readonly pages?: string | undefined
  /** Session seqs the model grounded this record in, when it can point at them. */
  readonly evidence?: readonly number[] | undefined
}

/**
 * Model-supplied candidate (Pass 3).
 *
 * Confidence is 0.9, not 1: it means "the model stated these fields", which
 * earns precedence over regex guesses during merge but says nothing about
 * whether the work exists. Only verification (M2) can raise that.
 */
export function candidateFromModel(input: ModelCandidateInput): Candidate {
  const base = emptyCandidate(input.type ?? 'journalArticle', 'model', 0.9)
  const authors = (input.authors ?? []).map((author) => collapseSpace(author)).filter((author) => author !== '')
  const pmid = (input.pmid ?? '').trim()
  const pmcid = (input.pmcid ?? '').trim().toUpperCase()
  const filled: Candidate = {
    ...base,
    doi: normalizeDoi(input.doi ?? ''),
    arxivId: normalizeArxiv(input.arxivId ?? ''),
    ...( /^\d{6,8}$/u.test(pmid) ? { pmid } : {}),
    ...( /^PMC\d+$/u.test(pmcid) ? { pmcid } : {}),
    isbn: normalizeIsbn(input.isbn ?? ''),
    reportNumber: collapseSpace(input.reportNumber ?? ''),
    url: (input.url ?? '').trim(),
    title: collapseSpace(input.title),
    authors,
    year: input.year,
    container: collapseSpace(input.container ?? ''),
    volume: (input.volume ?? '').trim(),
    issue: (input.issue ?? '').trim(),
    pages: (input.pages ?? '').trim(),
    evidence: [...new Set(input.evidence ?? [])].sort((a, b) => a - b),
  }
  return {
    ...filled,
    key: dedupeKey(filled),
    needsModelEnrichment: filled.title === '' || filled.year === undefined || authors.length === 0,
  }
}

/**
 * Merge two observations of the same work.
 *
 * Field-level rule: an incoming value wins only when the current one is empty,
 * unless the incoming origin outranks the current best origin (a model-supplied
 * title beats a regex guess). Evidence and origins always accumulate.
 */
export function mergeCandidates(current: Candidate, incoming: Candidate): Candidate {
  const bestOrigin = (candidate: Candidate): CandidateOrigin =>
    [...candidate.origins].sort((a, b) => ORIGIN_PRIORITY[b] - ORIGIN_PRIORITY[a])[0] ?? 'identifier'
  const incomingWins = ORIGIN_PRIORITY[bestOrigin(incoming)] > ORIGIN_PRIORITY[bestOrigin(current)]

  const pick = (mine: string, theirs: string): string =>
    mine === '' || (incomingWins && theirs !== '') ? nonEmpty(theirs, mine) : mine
  const pickOptional = (mine: string | undefined, theirs: string | undefined): string | undefined => {
    if (mine === undefined || mine === '') return theirs
    return incomingWins && theirs !== undefined && theirs !== '' ? theirs : mine
  }

  const merged: Candidate = {
    key: current.key,
    type: incomingWins ? incoming.type : current.type,
    origins: [...new Set([...current.origins, ...incoming.origins])],
    doi: pick(current.doi, incoming.doi),
    arxivId: pick(current.arxivId, incoming.arxivId),
    pmid: pickOptional(current.pmid, incoming.pmid),
    pmcid: pickOptional(current.pmcid, incoming.pmcid),
    isbn: pick(current.isbn, incoming.isbn),
    reportNumber: pick(current.reportNumber, incoming.reportNumber),
    url: pick(current.url, incoming.url),
    title: pick(current.title, incoming.title),
    // An outranking origin replaces the author list outright: appending the
    // regex-split fragments ("Zhang", "S.") to a model-supplied list corrupts
    // every downstream "first author" comparison.
    authors:
      incomingWins && incoming.authors.length > 0
        ? incoming.authors
        : current.authors.length > 0
          ? current.authors
          : incoming.authors,
    year: incomingWins && incoming.year !== undefined ? incoming.year : firstNonNull(current.year, incoming.year) ?? incoming.year,
    container: pick(current.container, incoming.container),
    volume: pick(current.volume, incoming.volume),
    issue: pick(current.issue, incoming.issue),
    pages: pick(current.pages, incoming.pages),
    confidence: Math.max(current.confidence, incoming.confidence),
    needsModelEnrichment: false,
    evidence: [...new Set([...current.evidence, ...incoming.evidence])].sort((a, b) => a - b),
  }
  return {
    ...merged,
    key: dedupeKey(merged),
    needsModelEnrichment: merged.title === '' || merged.year === undefined || merged.authors.length === 0,
  }
}

/** Order candidates for review: most trustworthy and most complete first. */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  const typeRank: Readonly<Record<ItemType, number>> = {
    journalArticle: 0,
    conferencePaper: 1,
    preprint: 2,
    report: 3,
    thesis: 4,
    book: 5,
    webpage: 6,
  }
  return [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type]
    if (a.title !== b.title) return a.title < b.title ? -1 : 1
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/**
 * Extract and dedupe candidates from conversation text slices.
 *
 * Per slice: parse citation strings first, then attach any identifier found in
 * the same line; identifiers not consumed by a citation become their own
 * candidates. Across slices: merge by `dedupeKey` so the same paper cited in
 * three turns is one candidate with three evidence seqs.
 */
export function extractCandidates(
  sources: readonly SourcedText[],
  options: { readonly includeTools?: boolean } = {},
): Candidate[] {
  const byKey = new Map<string, Candidate>()
  // A citation string and the DOI printed right after it are the same work, but
  // they dedupe to different keys (`title:…|2004` vs `doi:…`). Index titles so
  // the record that only has a title folds into the one that has an identifier.
  const byTitle = new Map<string, string>()
  const titleSlot = (candidate: Candidate): string | undefined => {
    if (candidate.title === '') return undefined
    return `${titleKey(candidate.title)}|${String(candidate.year ?? '')}`
  }
  const rebuildByTitle = (): void => {
    byTitle.clear()
    for (const [key, existing] of byKey) {
      const slot = titleSlot(existing)
      if (slot !== undefined && !byTitle.has(slot)) byTitle.set(slot, key)
    }
  }
  const absorb = (candidate: Candidate): void => {
    // Never let an identity-less record into the table: its key would be the
    // empty string and every such record would merge into one ghost row.
    if (!hasIdentity(candidate) || candidate.key === '') return

    let merged = candidate
    const absorbedKeys = new Set<string>()
    let absorbed = true
    while (absorbed) {
      absorbed = false
      const slot = titleSlot(merged)
      const titleTwin = slot === undefined ? undefined : byTitle.get(slot)
      for (const key of [merged.key, titleTwin]) {
        if (key === undefined || absorbedKeys.has(key)) continue
        const existing = byKey.get(key)
        if (existing === undefined) continue
        absorbedKeys.add(key)
        merged = mergeCandidates(existing, merged)
        absorbed = true
      }
    }

    // A merge can promote a title key to a stronger identifier key. Remove all
    // absorbed entries first, then write exactly once under the recomputed key.
    for (const key of absorbedKeys) byKey.delete(key)
    byKey.set(merged.key, merged)
    // Rebuild derived title aliases so rekeys and model title changes cannot
    // leave a stale slot pointing at a deleted key.
    rebuildByTitle()
  }

  for (const source of sources) {
    const identifiers = extractIdentifiers(source.text)
    // Tool output is noisy machine text: search results, HTTP bodies, logs. Only
    // persistent identifiers and strong-domain URLs survive it (§5.2); citation
    // strings there are the tool's own formatting, not the conversation's.
    if (source.role === 'tool') {
      if (options.includeTools !== true) continue
      for (const identifier of identifiers) {
        if (identifier.kind !== 'doi' && identifier.kind !== 'arxiv' && identifier.kind !== 'pmid' && identifier.kind !== 'pmcid' && identifier.kind !== 'url') continue
        if (identifier.kind === 'url' && identifier.confidence < 0.7) continue
        absorb(candidateFromIdentifier(identifier, source.seq))
      }
      continue
    }

    const citations = extractCitations(source.text)
    const consumed = new Set<IdentifierHit>()
    for (const citation of citations) {
      const inLine = identifiers.filter((identifier) => citation.raw.includes(identifier.raw))
      for (const identifier of inLine) consumed.add(identifier)
      absorb(candidateFromCitation(citation, source.seq, inLine))
    }

    for (const identifier of identifiers) {
      if (consumed.has(identifier)) continue
      // Bare URLs are leads, not references: only a DOI/arXiv/ISBN/report
      // number is strong enough to create a candidate on its own.
      if (identifier.kind === 'url' && identifier.confidence < 0.7) continue
      absorb(candidateFromIdentifier(identifier, source.seq))
    }
  }

  return rankCandidates([...byKey.values()])
}
