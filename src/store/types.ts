/** Persistent shapes for `refs/refs.json` and `refs/quarantine.json`.
 *
 * The wire format is versioned: `schemaVersion` is bumped whenever a field's
 * meaning changes. Readers migrate older payloads forward; writers always
 * emit the current version.
 */

export const SCHEMA_VERSION = 1 as const

export const DEFAULT_MAX_REFERENCES = 5_000

export type RefType =
  | 'journalArticle'
  | 'conferencePaper'
  | 'preprint'
  | 'report'
  | 'thesis'
  | 'book'
  | 'webpage'

export const REF_TYPES: readonly RefType[] = [
  'journalArticle',
  'conferencePaper',
  'preprint',
  'report',
  'thesis',
  'book',
  'webpage',
]

export interface RefAuthor {
  readonly family?: string
  readonly given?: string
  /** Organizations and CJK names that do not split into family/given. */
  readonly literal?: string
  readonly sequence?: number
}

export interface RefIdentifiers {
  readonly doi?: string
  readonly arxiv?: string
  readonly isbn?: string
  readonly reportNumber?: string
}

export interface RefProvenance {
  readonly sessionId?: string
  readonly seqStart?: number
  readonly seqEnd?: number
  readonly scope?: string
  readonly trigger?: 'button' | 'command' | 'tool'
  readonly capturedAt: string
}

export type StoredVerificationStatus =
  | 'verified'
  | 'warning'
  | 'unverified'
  | 'quarantined'
  | 'manual'

export interface RefVerification {
  readonly status: StoredVerificationStatus
  readonly checkedAt?: string
  readonly passed?: number
  readonly checks?: {
    readonly title?: number
    readonly yearDelta?: number
    readonly firstAuthor?: boolean
  }
  readonly sources?: readonly string[]
  readonly reasons?: readonly string[]
  readonly note?: string
}

export interface RefAnnotation {
  readonly summary?: string
  readonly relevance?: string
  readonly evidence?: string
  readonly caveats?: string
  readonly source?: 'model' | 'user' | 'hybrid'
  readonly status?: 'complete' | 'pending'
  readonly updatedAt?: string
}

export interface StoredReference {
  readonly id: string
  readonly type: RefType
  readonly language?: string
  readonly title: string
  readonly containerTitle?: string
  readonly authors: readonly RefAuthor[]
  readonly year?: number
  readonly volume?: string
  readonly issue?: string
  readonly pages?: string
  readonly publisher?: string
  readonly publisherPlace?: string
  readonly identifiers: RefIdentifiers
  readonly url?: string
  readonly accessed?: string
  readonly provenance: RefProvenance
  readonly verification: RefVerification
  readonly annotation?: RefAnnotation
  readonly tags?: readonly string[]
  readonly bibtexKey?: string
  readonly addedAt: string
  readonly updatedAt: string
}

export interface StoreState {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly updatedAt: string
  readonly references: readonly StoredReference[]
}

export interface QuarantineState {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly updatedAt: string
  readonly entries: readonly StoredReference[]
}

export type StoreErrorCode =
  | 'corrupt-store'
  | 'unsupported-schema'
  | 'capacity'
  | 'lock-timeout'
  | 'backup-failed'
  | 'write-failed'
  | 'invalid-reference'

/** Raised for anything the caller must surface verbatim: corrupt file,
 * unsupported schema, capacity overflow, lock contention. */
export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export function emptyStore(now: string): StoreState {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, references: [] }
}

export function emptyQuarantine(now: string): QuarantineState {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, entries: [] }
}

/** Stable identity used for dedupe: strongest identifier first, else title+year. */
export function referenceId(
  ref: Pick<StoredReference, 'identifiers' | 'title' | 'year'>,
): string {
  const { doi, arxiv, isbn, reportNumber } = ref.identifiers
  if (doi) return `doi:${doi.toLowerCase()}`
  if (arxiv) return `arxiv:${arxiv.toLowerCase()}`
  if (isbn) return `isbn:${isbn}`
  if (reportNumber) return `report:${reportNumber.toLowerCase()}`
  return `title:${ref.title.toLowerCase().replace(/\s+/gu, ' ').trim()}|${ref.year ?? ''}`
}

/** Deterministic order: addedAt then id, so two exports of one store are byte-identical. */
export function sortReferences(refs: readonly StoredReference[]): StoredReference[] {
  return [...refs].sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
