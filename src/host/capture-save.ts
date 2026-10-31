import type { BatchFields } from '../core/batch.ts'
import { stripMarkup } from '../core/text.ts'
import type { StoredReference } from '../store/types.ts'
import type { Candidate } from '../core/candidates.ts'
import type { SourceRecord } from '../verify/types.ts'
import type { BatchEntry } from './capture-batch.ts'
import type { SaveSummary } from './refs-command.ts'

export interface CaptureSaveResult {
  readonly kind: 'success' | 'error'
  readonly quarantined?: boolean | undefined
  /** Stored entry id, when the save path knows it. */
  readonly id?: string | undefined
  readonly reason?: string | undefined
  /** Snapshot of the stored record, so the panel can render editable fields. */
  readonly fields?: BatchFields | undefined
}

export interface CaptureSaveDeps {
  /** Resolve an identifier-only candidate against authoritative registries. */
  readonly resolveIdentifier: (candidate: Candidate) => Promise<SourceRecord | undefined>
  /** Use the normal verify-then-store path; do not bypass verification. */
  readonly save: (payload: unknown) => Promise<CaptureSaveResult>
  readonly now?: (() => string) | undefined
}

function withRegistryMetadata(candidate: Candidate, record: SourceRecord): Candidate {
  return {
    ...candidate,
    // A title the conversation already gave us wins: the registry may case-fold
    // or subtitle it, and silently rewriting it made the panel's own title jump
    // after saving. Only an absent title is hydrated.
    title: candidate.title.trim() === '' ? record.title.trim() : candidate.title,
    authors: candidate.authors.length > 0 ? candidate.authors : record.authors,
    year: candidate.year ?? record.year,
    container: candidate.container || record.container,
    volume: candidate.volume || (record.volume ?? ''),
    issue: candidate.issue || (record.issue ?? ''),
    pages: candidate.pages || (record.pages ?? ''),
    doi: candidate.doi || record.doi,
    url: candidate.url || record.url,
    needsModelEnrichment: record.title.trim() === '' || record.authors.length === 0 || record.year === undefined,
  }
}

/** Flatten a stored record into the panel's editable field view. */
export function fieldsOfReference(ref: StoredReference | undefined): BatchFields | undefined {
  if (ref === undefined) return undefined
  // Rows stored before the parsers stripped Markdown carry `> Daly, C.` and
  // `*Journal*`; the panel must show the value the exporters would write.
  const display = (author: StoredReference['authors'][number]): string =>
    stripMarkup(
      author.literal !== undefined && author.literal !== ''
        ? author.literal
        : [author.family ?? '', author.given ?? ''].filter((part) => part !== '').join(', '),
    )
  const authors = ref.authors.map(display).filter((author) => author !== '')
  return {
    type: ref.type,
    title: stripMarkup(ref.title),
    authors,
    ...(ref.containerTitle === undefined ? {} : { containerTitle: stripMarkup(ref.containerTitle) }),
    ...(ref.year === undefined ? {} : { year: ref.year }),
    ...(ref.volume === undefined ? {} : { volume: ref.volume }),
    ...(ref.issue === undefined ? {} : { issue: ref.issue }),
    ...(ref.pages === undefined ? {} : { pages: ref.pages }),
    ...(ref.publisher === undefined ? {} : { publisher: stripMarkup(ref.publisher) }),
    ...(ref.publisherPlace === undefined ? {} : { publisherPlace: stripMarkup(ref.publisherPlace) }),
    ...(ref.language === undefined ? {} : { language: ref.language }),
    ...(ref.identifiers.doi === undefined ? {} : { doi: ref.identifiers.doi }),
    ...(ref.identifiers.arxiv === undefined ? {} : { arxivId: ref.identifiers.arxiv }),
    ...(ref.url === undefined ? {} : { url: ref.url }),
  }
}

function authorPayload(author: string): { family: string; given?: string } | { literal: string } {
  const [family, ...given] = author.split(',')
  if (given.length === 0) return { literal: (family ?? '').trim() }
  return { family: (family ?? '').trim(), given: given.join(',').trim() }
}

/** Resolve bare identifiers before the standard verified-save path is called. */
export async function saveCaptured(
  candidates: readonly Candidate[],
  deps: CaptureSaveDeps,
): Promise<SaveSummary> {
  let saved = 0
  let quarantined = 0
  let skipped = 0
  let failed = 0
  const entries: BatchEntry[] = []

  for (const original of candidates) {
    let candidate = original
    let registry: SourceRecord | undefined
    // Any identified candidate gets one registry pass, not just the titleless
    // ones: a citation in the conversation usually carries a title and a DOI and
    // nothing else, and verification already looked the record up. Discarding it
    // left the panel's detail form empty, which read as "the capture is broken".
    if (candidate.doi !== '' || candidate.arxivId !== '') {
      try {
        const record = await deps.resolveIdentifier(candidate)
        if (record !== undefined) {
          registry = record
          candidate = withRegistryMetadata(candidate, record)
        }
      } catch {
        // A failed lookup must not invent metadata or block other candidates.
      }
    }

    const identity = {
      title: candidate.title,
      ...(candidate.year === undefined ? {} : { year: candidate.year }),
      ...(candidate.doi === '' ? {} : { doi: candidate.doi }),
      ...(candidate.arxivId === '' ? {} : { arxivId: candidate.arxivId }),
    }

    if (candidate.title.trim() === '') {
      skipped += 1
      entries.push({ ...identity, status: 'skipped' })
      continue
    }

    const payload = {
      title: candidate.title,
      authors: candidate.authors.map(authorPayload),
      year: candidate.year,
      type: candidate.type,
      doi: candidate.doi,
      arxivId: candidate.arxivId,
      isbn: candidate.isbn,
      reportNumber: candidate.reportNumber,
      url: candidate.url,
      containerTitle: candidate.container,
      volume: candidate.volume,
      issue: candidate.issue,
      pages: candidate.pages,
      publisher: registry?.publisher ?? '',
      language: registry?.language ?? '',
      provenance: { trigger: 'button' as const, capturedAt: deps.now?.() ?? new Date().toISOString() },
    }

    try {
      const result = await deps.save(payload)
      if (result.kind === 'error') {
        failed += 1
        entries.push({
          ...identity,
          status: 'failed',
          ...(result.reason === undefined ? {} : { reason: result.reason }),
        })
      } else if (result.quarantined === true) {
        quarantined += 1
        entries.push({
          ...identity,
          status: 'quarantined',
          ...(result.id === undefined ? {} : { id: result.id }),
          ...(result.reason === undefined ? {} : { reason: result.reason }),
          ...(result.fields === undefined ? {} : { fields: result.fields }),
        })
      } else {
        saved += 1
        entries.push({
          ...identity,
          status: 'saved',
          ...(result.id === undefined ? {} : { id: result.id }),
          ...(result.fields === undefined ? {} : { fields: result.fields }),
        })
      }
    } catch (error) {
      failed += 1
      entries.push({
        ...identity,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { saved, quarantined, skipped, failed, entries }
}
