/**
 * Types for the verification stage (M2).
 *
 * The shape is deliberately record-in / report-out: no network type appears
 * here, so the judgement can be tested exhaustively against fixtures and the
 * HTTP clients can be tested separately by parsing canned payloads.
 */
/** The known verification registries; plugin extensions may add other sources. */
export declare const SOURCE_IDS: readonly ["crossref", "openalex", "arxiv", "datacite", "pubmed"];
export type SourceId = (typeof SOURCE_IDS)[number] | (string & {});
/** One work as a registry reported it, normalized to the fields we compare. */
export interface SourceRecord {
  readonly source: SourceId;
  /** Registry's identifier for this record (DOI, arXiv id, OpenAlex id). */
  readonly id: string;
  readonly title: string;
  /** Author names in the registry's order; only the first one is compared. */
  readonly authors: readonly string[];
  readonly year: number | undefined;
  readonly container: string;
  readonly doi: string;
  /** Registry-native type string, kept for the report rather than mapped. */
  readonly type: string;
  readonly url: string;
  /**
   * Bibliographic detail the registries also publish.
   *
   * Only the four compared fields used to be parsed, so an entry captured from
   * a bare DOI reached the panel's detail form with nothing but its title —
   * verification "had" the metadata and then threw it away. These stay optional
   * so a registry that omits them changes nothing.
   */
  readonly volume?: string | undefined;
  readonly issue?: string | undefined;
  readonly pages?: string | undefined;
  readonly publisher?: string | undefined;
  readonly language?: string | undefined;
}
/** Why a record failed to earn a place in the main table. */
export type ReasonCode = 'no-identity' | 'no-source-hit' | 'source-error' | 'ambiguous-record' | 'title-mismatch' | 'year-mismatch' | 'author-mismatch' | 'timeout';
/** Outcome of one condition, with the values that produced it. */
export interface ConditionCheck {
  readonly pass: boolean;
  /** Candidate-side value, already normalized for display. */
  readonly ours: string;
  /** Registry-side value of the same field. */
  readonly theirs: string;
  /** 0..1 where a similarity is meaningful; -1 otherwise. */
  readonly score: number;
}
/** Where a candidate ends up after verification. */
export type VerificationStatus = 'verified' | 'warning' | 'unverified' | 'quarantined';
/** The full verification verdict for one candidate. */
export interface VerificationReport {
  readonly status: VerificationStatus;
  readonly title: ConditionCheck;
  readonly year: ConditionCheck;
  readonly firstAuthor: ConditionCheck;
  /** How many of the three conditions passed (0..3). */
  readonly passed: number;
  /** Registries that returned at least one record. */
  readonly sources: readonly SourceId[];
  /** Registry of the record the verdict was computed against. */
  readonly matchedSource?: SourceId | undefined;
  /** True when at least one source errored or timed out. */
  readonly partial: boolean;
  readonly reasons: readonly ReasonCode[];
}
/**
 * Pass 1 extraction: identifiers that pin one work without parsing prose.
 *
 * The goal is recall on things a verifier can resolve exactly (DOI, arXiv,
 * ISBN, report numbers) and a *ranked* list of URLs, because a bare link is
 * evidence of interest, not evidence of a citation. Confidence encodes that
 * distinction so later stages can decide what deserves a model round-trip.
 */
/** What kind of identifier a hit pins down. */
export type IdentifierKind = 'doi' | 'arxiv' | 'pmid' | 'pmcid' | 'isbn' | 'report' | 'url';
/** One identifier occurrence inside the scanned text. */
export interface IdentifierHit {
  readonly kind: IdentifierKind;
  /** Canonical identifier value: bare DOI, bare arXiv id, digits-only ISBN. */
  readonly value: string;
  /** Original matched text, useful for showing the user what was found. */
  readonly raw: string;
  /** Host of a URL hit, lowercase; empty for non-URL hits. */
  readonly host: string;
  /** 0..1 — how much this alone justifies creating a candidate. */
  readonly confidence: number;
}
/** Bare-DOI normal form: lowercase (DOIs are case-insensitive) and trimmed. */
export declare function normalizeDoi(raw: string): string;
/** arXiv ids are compared without the version suffix. */
export declare function normalizeArxiv(raw: string): string;
/** ISBN comparison form: digits and X only. */
export declare function normalizeIsbn(raw: string): string;
/**
 * ISBN-13 check digit, alternating 1/3 weights over the first twelve digits.
 *
 * Validation is the only cheap way to tell an ISBN from any 13-digit number
 * (order ids, timestamps), and a mistyped ISBN is a bad row rather than a
 * missed one — so a failed checksum drops the hit.
 */
export declare function isValidIsbn13(value: string): boolean;
/** ISBN-10 check digit: weights 10..1, `X` counts as 10. */
export declare function isValidIsbn10(value: string): boolean;
/**
 * Extract every identifier occurrence in one text block.
 *
 * Ordering is by kind priority (doi, arxiv, pmid, pmcid, isbn, report, url)
 * rather than by position, because later stages want "what did we pin down"
 * first and "what might be interesting" last.
 */
export declare function extractIdentifiers(text: string): IdentifierHit[];
/**
 * Pass 2 extraction: reference strings that are already formatted as citations.
 *
 * Three styles cover the material this plugin meets in practice: GB/T 7714
 * (Chinese journals), APA and IEEE (English journals). The parser is
 * deliberately shallow — it fills title/year/authors/container and leaves the
 * authoritative fields to the identifier pass or the model (Pass 3). A citation
 * string that misses a year or a plausible title is dropped rather than stored
 * half-parsed, because a wrong year is worse than no entry.
 */
/** Recognized reference-string styles. */
export type CitationStyle = 'gbt7714' | 'apa' | 'ieee' | 'vancouver' | 'bibtex';
/** Item type carried into BibTeX/RIS mapping later. */
export type ItemType = 'journalArticle' | 'conferencePaper' | 'preprint' | 'report' | 'thesis' | 'book' | 'webpage';
/** One parsed reference string. */
export interface CitationHit {
  readonly style: CitationStyle;
  readonly type: ItemType;
  readonly title: string;
  readonly authors: readonly string[];
  /** Undefined when the string carries no plausible year. */
  readonly year: number | undefined;
  readonly container: string;
  readonly volume: string;
  readonly issue: string;
  readonly pages: string;
  readonly doi: string;
  readonly raw: string;
  readonly confidence: number;
}
/**
 * Split an author list without tearing "Surname, I. I." in half.
 *
 * APA and GB/T both write `Surname, I. I.` inside a comma-separated list, so a
 * naive split on `,` yields `['Zhang', 'S.', 'Li', 'W.']` — four people where
 * there are two, which then makes "first author" comparison compare a surname
 * against an initial. Comma-separated fragments that are only initials are
 * folded back into the surname they belong to. `&`/`and`/`;` stay hard
 * separators because they never appear inside one name.
 */
export declare function splitAuthors(raw: string): string[];
/** Parse BibTeX records in a text block, expanding @string definitions first. */
export declare function parseBibtexBlocks(text: string): CitationHit[];
/** Parse one BibTeX record; throws when a referenced macro cannot be expanded. */
export declare function parseBibtexBlock(block: string, macros?: ReadonlyMap<string, string>): CitationHit | undefined;
export declare function extractCitations(text: string): CitationHit[];
/** Where a candidate's fields came from. Higher priority wins on merge. */
export type CandidateOrigin = 'identifier' | 'citation' | 'model';
/** Which channel a text slice came from; tool output is read more narrowly. */
export type SourceRole = 'user' | 'assistant' | 'tool';
/** One text-bearing slice of the conversation. */
export interface SourcedText {
  /** Session event seq the text came from, for evidence links. */
  readonly seq: number;
  readonly text: string;
  /** Omitted by callers that only have text (tests, ad-hoc probes). */
  readonly role?: SourceRole | undefined;
}
/** A reference this plugin might store, before any external verification. */
export interface Candidate {
  /** Dedupe key: the identity rule for "is this the same work". */
  readonly key: string;
  readonly type: ItemType;
  readonly origins: readonly CandidateOrigin[];
  readonly doi: string;
  readonly arxivId: string;
  readonly pmid?: string | undefined;
  readonly pmcid?: string | undefined;
  readonly isbn: string;
  readonly reportNumber: string;
  readonly url: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly year: number | undefined;
  readonly container: string;
  readonly volume: string;
  readonly issue: string;
  readonly pages: string;
  /** 0..1 — extraction confidence, not verification status. */
  readonly confidence: number;
  /** True when a model round-trip is needed to make this record useful. */
  readonly needsModelEnrichment: boolean;
  /** Session seqs this candidate was observed in. */
  readonly evidence: readonly number[];
}
/**
 * Identity of a work: DOI, arXiv, PMID, PMCID, ISBN, report number, then
 * normalized title+year, then the URL. Mirrors §5.2 of the plan.
 */
export declare function dedupeKey(candidate: Pick<Candidate, 'doi' | 'arxivId' | 'pmid' | 'pmcid' | 'isbn' | 'reportNumber' | 'title' | 'year' | 'url' | 'key'>): string;
/** True when a candidate can at least be named: an identifier, a title or a URL. */
export declare function hasIdentity(candidate: Pick<Candidate, 'doi' | 'arxivId' | 'pmid' | 'pmcid' | 'isbn' | 'reportNumber' | 'title' | 'url'>): boolean;
/**
 * Keep only evidence seqs that actually exist in the window that was read.
 *
 * A model can name seq 999 for a 12-event session; storing that would make the
 * annotation point at nothing. Unknown seqs are dropped, not guessed at.
 */
export declare function sanitizeEvidence(seqs: readonly number[], window: ReadonlySet<number> | undefined): number[];
/** Identifier-only candidate: pins the work, says nothing about the prose. */
export declare function candidateFromIdentifier(hit: IdentifierHit, seq: number): Candidate;
/** Citation-string candidate: has prose fields, usually lacks an identifier. */
export declare function candidateFromCitation(hit: CitationHit, seq: number, identifiers: readonly IdentifierHit[]): Candidate;
/** Structured fields a model supplies for Pass 3 (everything but the identity). */
export interface ModelCandidateInput {
  readonly title: string;
  readonly authors?: readonly string[] | undefined;
  readonly year?: number | undefined;
  readonly type?: ItemType | undefined;
  readonly doi?: string | undefined;
  readonly arxivId?: string | undefined;
  readonly pmid?: string | undefined;
  readonly pmcid?: string | undefined;
  readonly isbn?: string | undefined;
  readonly reportNumber?: string | undefined;
  readonly url?: string | undefined;
  readonly container?: string | undefined;
  readonly volume?: string | undefined;
  readonly issue?: string | undefined;
  readonly pages?: string | undefined;
  /** Session seqs the model grounded this record in, when it can point at them. */
  readonly evidence?: readonly number[] | undefined;
}
/**
 * Model-supplied candidate (Pass 3).
 *
 * Confidence is 0.9, not 1: it means "the model stated these fields", which
 * earns precedence over regex guesses during merge but says nothing about
 * whether the work exists. Only verification (M2) can raise that.
 */
export declare function candidateFromModel(input: ModelCandidateInput): Candidate;
/**
 * Merge two observations of the same work.
 *
 * Field-level rule: an incoming value wins only when the current one is empty,
 * unless the incoming origin outranks the current best origin (a model-supplied
 * title beats a regex guess). Evidence and origins always accumulate.
 */
export declare function mergeCandidates(current: Candidate, incoming: Candidate): Candidate;
/** Order candidates for review: most trustworthy and most complete first. */
export declare function rankCandidates(candidates: readonly Candidate[]): Candidate[];
/**
 * Extract and dedupe candidates from conversation text slices.
 *
 * Per slice: parse citation strings first, then attach any identifier found in
 * the same line; identifiers not consumed by a citation become their own
 * candidates. Across slices: merge by `dedupeKey` so the same paper cited in
 * three turns is one candidate with three evidence seqs.
 */
export declare function extractCandidates(sources: readonly SourcedText[], options?: {
  readonly includeTools?: boolean;
}): Candidate[];
/**
 * Text normalization shared by extraction, dedupe and (later) verification.
 *
 * Every comparison in this plugin — is this the same paper, is this title the
 * same as the source's — goes through these helpers, so the rules live in one
 * place instead of being re-guessed per call site.
 */
/** Collapse every whitespace run (including full-width spaces) to one space. */
export declare function collapseSpace(input: string): string;
/** NFKC + lowercase + collapsed spaces: the comparison form for Latin text. */
export declare function foldText(input: string): string;
/** True when the string carries CJK characters (switches the similarity metric). */
export declare function hasCjk(input: string): boolean;
/**
 * Dedupe key for titles: letters and digits only.
 *
 * Punctuation differs wildly between a chat message and a registry record
 * ("Attention Is All You Need" vs "Attention is all you need."), so the key
 * drops everything else rather than trying to normalize punctuation.
 */
export declare function titleKey(input: string): string;
/** Token set for Jaccard similarity; single characters are dropped. */
export declare function titleTokens(input: string): Set<string>;
/**
 * Token Jaccard similarity in `[0, 1]`.
 *
 * Used for Latin titles; returns 0 when either side has no tokens so callers
 * never treat "nothing to compare" as a match.
 */
export declare function jaccard(a: string, b: string): number;
/** Sørensen–Dice on character bigrams, the CJK title metric. */
export declare function diceBigrams(a: string, b: string): number;
/**
 * Strip Markdown decoration that chat text carries but a reference field must
 * not: blockquote markers (`> Daly, C.`), list bullets, emphasis asterisks
 * (`*International Journal of Climatology*`), backticks and scriptio continua
 * underscores. A model answer renders a citation line as a quotation, so this
 * runs before parsing rather than after — otherwise the marker becomes part of
 * the stored author or journal name.
 */
export declare function stripMarkup(input: string): string;
/**
 * Normalize a personal author name to family-first form while preserving
 * already-comma-separated names. Corporate names must be recognized by the
 * caller before using this helper.
 */
export declare function formatAuthorName(input: string): string;
/** Truncate to `limit` characters, appending `…` when it actually cut. */
export declare function clip(input: string, limit: number): string;
/** Annotation text with meta-commentary removed; empty string means "leave the field out". */
export declare function usefulAnnotationText(value: string | undefined): string;
/**
 * The three comparison predicates of §5.3, isolated from anything that fetches.
 *
 * Every predicate answers "do these two describe the same work" using the
 * candidate's own fields against one registry record. Thresholds are the plan's
 * defaults; they are constants here so a report can cite the number that failed.
 */
/** Title thresholds from §5.3 (Jaccard / edit similarity / CJK Dice). */
export declare const TITLE: {
  readonly latinJaccard: 0.85;
  readonly latinEdit: 0.85;
  readonly latinStrong: 0.95;
  readonly cjkDice: 0.9;
};
/** Levenshtein distance over code points, iterative two-row implementation. */
export declare function editDistance(a: string, b: string): number;
/** 1 - distance/len, computed on the folded strings so case/punctuation do not count. */
export declare function editSimilarity(a: string, b: string): number;
/**
 * Title similarity 0..1.
 *
 * CJK titles are compared as character bigrams (word tokenization does not
 * exist for them); Latin titles use token overlap, which is robust to word order
 * and to the subtitle suffixes registries add.
 */
export declare function titleSimilarity(a: string, b: string): number;
/** Condition 1: strong overlap, per the plan's dual threshold. */
export declare function titleMatches(candidateTitle: string, recordTitle: string): boolean;
/** Condition 2: years within one, both known. An unknown year never matches. */
export declare function yearMatches(candidateYear: number | undefined, recordYear: number | undefined): boolean;
/**
 * Family name of one author string.
 *
 * Handles the three forms the extractors actually produce: `Zhang, S.` (family
 * before the comma), `S. Zhang` (initials first) and `张三` (no split). Anything
 * else falls back to the whole string rather than guessing a surname.
 */
export declare function familyName(author: string): string;
/** Condition 3: first author's family name equal, or one edit apart when long. */
export declare function firstAuthorMatches(candidateAuthors: readonly string[], recordAuthors: readonly string[]): boolean;
/** Minimum best-record score before any condition is even considered. */
export declare const MIN_RECORD_SCORE = 0.75;
type Comparable = Pick<Candidate, 'title' | 'authors' | 'year' | 'doi' | 'arxivId'>;
/** §5.3 candidate selection score for one registry record. */
export declare function scoreRecord(candidate: Comparable, record: SourceRecord): number;
/**
 * Judge one candidate against every record the sources returned.
 *
 * `errors`/`timedOut` come from the caller's transport layer: they are the only
 * way this function can know that "no record" means "the source failed" rather
 * than "the work does not exist".
 */
export declare function judgeCandidate(input: {
  readonly candidate: Comparable;
  readonly records: readonly SourceRecord[];
  readonly errors?: readonly SourceId[] | undefined;
  readonly timedOut?: boolean | undefined;
  /**
   * Sources that returned a payload we could read, whether or not it contained
   * the work. Needed because "no record" only means "no such work" when at
   * least one source actually answered with a payload we understood.
   */
  readonly answered?: readonly SourceId[] | undefined;
}): VerificationReport;
/** Persistent shapes for `refs/refs.json` and `refs/quarantine.json`.
 *
 * The wire format is versioned: `schemaVersion` is bumped whenever a field's
 * meaning changes. Readers migrate older payloads forward; writers always
 * emit the current version.
 */
declare const SCHEMA_VERSION: 1;
type RefType = 'journalArticle' | 'conferencePaper' | 'preprint' | 'report' | 'thesis' | 'book' | 'webpage';
export declare const REF_TYPES: readonly RefType[];
interface RefAuthor {
  readonly family?: string;
  readonly given?: string;
  /** Organizations and CJK names that do not split into family/given. */
  readonly literal?: string;
  readonly sequence?: number;
}
interface RefIdentifiers {
  readonly doi?: string;
  readonly arxiv?: string;
  readonly pmid?: string;
  readonly pmcid?: string;
  readonly isbn?: string;
  readonly reportNumber?: string;
}
interface RefProvenance {
  readonly sessionId?: string;
  readonly seqStart?: number;
  readonly seqEnd?: number;
  readonly scope?: string;
  readonly trigger?: 'button' | 'command' | 'tool';
  readonly capturedAt: string;
}
type StoredVerificationStatus = 'verified' | 'warning' | 'unverified' | 'quarantined' | 'manual';
interface RefVerification {
  readonly status: StoredVerificationStatus;
  readonly checkedAt?: string;
  readonly passed?: number;
  readonly checks?: {
    readonly title?: number;
    readonly yearDelta?: number;
    readonly firstAuthor?: boolean;
  };
  readonly sources?: readonly string[];
  readonly reasons?: readonly string[];
  readonly note?: string;
}
interface RefAnnotation {
  readonly summary?: string;
  readonly relevance?: string;
  readonly evidence?: string;
  readonly caveats?: string;
  readonly source?: 'model' | 'user' | 'hybrid';
  readonly status?: 'complete' | 'pending';
  readonly updatedAt?: string;
}
interface StoredReference {
  readonly id: string;
  readonly type: RefType;
  readonly language?: string;
  readonly title: string;
  readonly containerTitle?: string;
  readonly authors: readonly RefAuthor[];
  readonly year?: number;
  readonly volume?: string;
  readonly issue?: string;
  readonly pages?: string;
  readonly publisher?: string;
  readonly publisherPlace?: string;
  readonly identifiers: RefIdentifiers;
  readonly url?: string;
  readonly accessed?: string;
  readonly provenance: RefProvenance;
  readonly verification: RefVerification;
  readonly annotation?: RefAnnotation;
  readonly tags?: readonly string[];
  readonly bibtexKey?: string;
  readonly addedAt: string;
  readonly updatedAt: string;
}
interface StoreState {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly references: readonly StoredReference[];
}
interface QuarantineState {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly StoredReference[];
}
export declare function escapeBibtex(value: string): string;
/** `familyYYYYfirstword`, ASCII-only, de-duplicated with a/b/c suffixes. */
export declare function makeCiteKey(ref: StoredReference, taken: Set<string>): string;
/** Entries are ordered by author-year-title so repeated exports are byte-stable. */
export declare function renderBibtex(refs: readonly StoredReference[]): string;
export declare function renderRisEntry(ref: StoredReference): string;
/** Same ordering rule as BibTeX: author, year, title. */
export declare function renderRis(refs: readonly StoredReference[]): string;
export type ExportFormat = 'bibtex' | 'ris';
export declare const EXPORT_EXTENSIONS: Record<ExportFormat, string>;
export declare function renderExport(format: ExportFormat, refs: readonly StoredReference[]): string;
export type { QuarantineState, RefAuthor, RefType, StoreState, StoredReference };