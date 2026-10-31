/**
 * Decision layer: turn "candidate + registry records" into the verdict the table
 * and the ⚠ region are driven by (§5.3 decision matrix).
 *
 * Two rules are load-bearing:
 *  - all three conditions must pass *and* at least one authoritative source must
 *    have answered; a perfect string match against no source is not verified;
 *  - failures close: a source that did not answer can only downgrade the verdict
 *    (`unverified`), never upgrade it.
 */

import type { Candidate } from '../core/candidates.ts'
import { familyName, firstAuthorMatches, titleSimilarity } from './match.ts'
import { titleMatches, yearMatches } from './match.ts'
import type { ConditionCheck, ReasonCode, SourceId, SourceRecord, VerificationReport } from './types.ts'

/** Minimum best-record score before any condition is even considered. */
export const MIN_RECORD_SCORE = 0.75

type Comparable = Pick<Candidate, 'title' | 'authors' | 'year' | 'doi' | 'arxivId'>

/** §5.3 candidate selection score for one registry record. */
export function scoreRecord(candidate: Comparable, record: SourceRecord): number {
  const title = titleSimilarity(candidate.title, record.title)
  const year = yearMatches(candidate.year, record.year) ? 1 : 0
  const author = firstAuthorMatches(candidate.authors, record.authors) ? 1 : 0
  return 0.6 * title + 0.25 * year + 0.15 * author
}

function check(pass: boolean, ours: string, theirs: string, score: number): ConditionCheck {
  return { pass, ours, theirs, score }
}

const EMPTY_CHECK = (ours: string): ConditionCheck => ({ pass: false, ours, theirs: '', score: 0 })

/**
 * Judge one candidate against every record the sources returned.
 *
 * `errors`/`timedOut` come from the caller's transport layer: they are the only
 * way this function can know that "no record" means "the source failed" rather
 * than "the work does not exist".
 */
export function judgeCandidate(input: {
  readonly candidate: Comparable
  readonly records: readonly SourceRecord[]
  readonly errors?: readonly SourceId[] | undefined
  readonly timedOut?: boolean | undefined
  /**
   * Sources that returned a payload we could read, whether or not it contained
   * the work. Needed because "no record" only means "no such work" when at
   * least one source actually answered with a payload we understood.
   */
  readonly answered?: readonly SourceId[] | undefined
}): VerificationReport {
  const { candidate, records } = input
  const errors = input.errors ?? []
  const sources = [...new Set(records.map((record) => record.source))]
  const partial = errors.length > 0 || input.timedOut === true

  const base = {
    sources,
    partial,
    matchedSource: undefined as SourceId | undefined,
  }

  const best = records
    .map((record) => ({ record, score: scoreRecord(candidate, record) }))
    .sort((a, b) => b.score - a.score)[0]

  if (best === undefined) {
    const reasons: ReasonCode[] = []
    if (input.timedOut === true) reasons.push('timeout')
    if (errors.length > 0) reasons.push('source-error')
    // "Every source answered and none knows this work" is a judgement, not an
    // outage: it belongs in the ⚠ region as `quarantined`. `unverified` is
    // reserved for "the network failed", which is retryable and must not be
    // mistaken for "this citation is fabricated".
    const reached = input.answered ?? (partial ? [] : sources)
    const answered = reached.length > 0 && !partial
    // A malformed 200 body is an error, not a negative answer: repeating it as
    // `no-source-hit` is what let a transient outage be stored as a confident
    // "no registry knows this work".
    if (answered) reasons.push('no-source-hit')
    return {
      ...base,
      status: answered ? 'quarantined' : 'unverified',
      title: EMPTY_CHECK(candidate.title),
      year: EMPTY_CHECK(String(candidate.year ?? '')),
      firstAuthor: EMPTY_CHECK(familyName(candidate.authors[0] ?? '')),
      passed: 0,
      reasons,
    }
  }

  if (best.score < MIN_RECORD_SCORE) {
    const reasons: ReasonCode[] = ['ambiguous-record']
    if (input.timedOut === true) reasons.push('timeout')
    if (errors.length > 0) reasons.push('source-error')
    return {
      ...base,
      status: partial ? 'unverified' : 'quarantined',
      title: EMPTY_CHECK(candidate.title),
      year: EMPTY_CHECK(String(candidate.year ?? '')),
      firstAuthor: EMPTY_CHECK(familyName(candidate.authors[0] ?? '')),
      passed: 0,
      reasons,
    }
  }

  const record = best.record
  const title = check(
    titleMatches(candidate.title, record.title),
    candidate.title,
    record.title,
    titleSimilarity(candidate.title, record.title),
  )
  const year = check(
    yearMatches(candidate.year, record.year),
    candidate.year === undefined ? '(unknown)' : String(candidate.year),
    record.year === undefined ? '(unknown)' : String(record.year),
    -1,
  )
  const firstAuthor = check(
    firstAuthorMatches(candidate.authors, record.authors),
    familyName(candidate.authors[0] ?? '') || '(unknown)',
    familyName(record.authors[0] ?? '') || '(unknown)',
    -1,
  )
  const passed = [title, year, firstAuthor].filter((entry) => entry.pass).length
  const reasons: ReasonCode[] = []
  if (!title.pass) reasons.push('title-mismatch')
  if (!year.pass) reasons.push('year-mismatch')
  if (!firstAuthor.pass) reasons.push('author-mismatch')
  if (input.timedOut === true) reasons.push('timeout')
  if (errors.length > 0) reasons.push('source-error')

  const status =
    partial
      ? 'unverified'
      : passed === 3 && sources.length >= 1
        ? 'verified'
        : passed === 2
          ? 'warning'
          : 'quarantined'

  return {
    ...base,
    matchedSource: record.source,
    status,
    title,
    year,
    firstAuthor,
    passed,
    reasons,
  }
}
