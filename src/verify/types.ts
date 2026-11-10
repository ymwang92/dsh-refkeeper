/**
 * Types for the verification stage (M2).
 *
 * The shape is deliberately record-in / report-out: no network type appears
 * here, so the judgement can be tested exhaustively against fixtures and the
 * HTTP clients can be tested separately by parsing canned payloads.
 */

/** The authoritative registries this plugin trusts. */
export type SourceId = 'crossref' | 'openalex' | 'arxiv' | 'datacite' | 'pubmed'

/** One work as a registry reported it, normalized to the fields we compare. */
export interface SourceRecord {
  readonly source: SourceId
  /** Registry's identifier for this record (DOI, arXiv id, OpenAlex id). */
  readonly id: string
  readonly title: string
  /** Author names in the registry's order; only the first one is compared. */
  readonly authors: readonly string[]
  readonly year: number | undefined
  readonly container: string
  readonly doi: string
  /** Registry-native type string, kept for the report rather than mapped. */
  readonly type: string
  readonly url: string
  /**
   * Bibliographic detail the registries also publish.
   *
   * Only the four compared fields used to be parsed, so an entry captured from
   * a bare DOI reached the panel's detail form with nothing but its title —
   * verification "had" the metadata and then threw it away. These stay optional
   * so a registry that omits them changes nothing.
   */
  readonly volume?: string | undefined
  readonly issue?: string | undefined
  readonly pages?: string | undefined
  readonly publisher?: string | undefined
  readonly language?: string | undefined
}

/** Why a record failed to earn a place in the main table. */
export type ReasonCode =
  | 'no-identity'
  | 'no-source-hit'
  | 'source-error'
  | 'ambiguous-record'
  | 'title-mismatch'
  | 'year-mismatch'
  | 'author-mismatch'
  | 'timeout'

/** Outcome of one condition, with the values that produced it. */
export interface ConditionCheck {
  readonly pass: boolean
  /** Candidate-side value, already normalized for display. */
  readonly ours: string
  /** Registry-side value of the same field. */
  readonly theirs: string
  /** 0..1 where a similarity is meaningful; -1 otherwise. */
  readonly score: number
}

/** Where a candidate ends up after verification. */
export type VerificationStatus = 'verified' | 'warning' | 'unverified' | 'quarantined'

/** The full verification verdict for one candidate. */
export interface VerificationReport {
  readonly status: VerificationStatus
  readonly title: ConditionCheck
  readonly year: ConditionCheck
  readonly firstAuthor: ConditionCheck
  /** How many of the three conditions passed (0..3). */
  readonly passed: number
  /** Registries that returned at least one record. */
  readonly sources: readonly SourceId[]
  /** Registry of the record the verdict was computed against. */
  readonly matchedSource?: SourceId | undefined
  /** True when at least one source errored or timed out. */
  readonly partial: boolean
  readonly reasons: readonly ReasonCode[]
}
