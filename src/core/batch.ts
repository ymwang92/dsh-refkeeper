/**
 * The last capture run, as a plain value.
 *
 * Two audiences share this shape, so it lives in `core/` with no Node imports:
 * the host persists it next to the library and uses it as the default export
 * scope, and the client panel renders it. A client plugin cannot register a
 * Remote namespace and `CommandResult` carries text only, so the batch travels
 * to the panel as one machine-readable marker line inside the command output.
 */

import { stripMarkup } from './text.ts'

export const BATCH_MARKER = 'refkeeper-batch:'

export type BatchEntryStatus = 'saved' | 'quarantined' | 'skipped' | 'failed'

/**
 * The reference's editable metadata, carried along so the panel can show (and
 * let the user correct) the fields the exporters will actually write.
 */
export interface BatchFields {
  readonly type: string
  readonly title: string
  readonly containerTitle?: string | undefined
  readonly authors: readonly string[]
  readonly year?: number | undefined
  readonly volume?: string | undefined
  readonly issue?: string | undefined
  readonly pages?: string | undefined
  readonly publisher?: string | undefined
  readonly publisherPlace?: string | undefined
  readonly language?: string | undefined
  readonly doi?: string | undefined
  readonly arxivId?: string | undefined
  readonly pmid?: string | undefined
  readonly pmcid?: string | undefined
  readonly url?: string | undefined
}

export interface BatchEntry {
  readonly title: string
  readonly status: BatchEntryStatus
  readonly id?: string | undefined
  readonly year?: number | undefined
  readonly doi?: string | undefined
  readonly arxivId?: string | undefined
  readonly pmid?: string | undefined
  readonly pmcid?: string | undefined
  /** Present when verification failed, so the panel can say why. */
  readonly reason?: string | undefined
  /** Snapshot of the stored record's editable metadata. */
  readonly fields?: BatchFields | undefined
  /** True when the model wrote an annotation for this entry after capture. */
  readonly annotated?: boolean | undefined
}

export interface CaptureBatch {
  readonly capturedAt: string
  readonly scope: string
  readonly entries: readonly BatchEntry[]
}

function sanitizeFields(value: unknown): BatchFields | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  // A batch captured before the parsers stripped Markdown keeps `> Daly, C.`
  // and `*Journal*` in its snapshot; cleaning on the way in means the panel and
  // the user's edits start from the value the exporters should write. Identifiers
  // and URLs are exempt: an id may legitimately contain `*` (quarantine ids look
  // like `title:*Drought*|1965`) and stripping it would stop `--ids` matching.
  const text = (input: unknown): string | undefined => {
    if (typeof input !== 'string') return undefined
    const clean = stripMarkup(input)
    return clean === '' ? undefined : clean
  }
  const plain = (input: unknown): string | undefined =>
    typeof input === 'string' && input !== '' ? input : undefined
  const title = text(raw['title']) ?? ''
  const type = text(raw['type']) ?? 'journalArticle'
  const authors = Array.isArray(raw['authors'])
    ? raw['authors']
        .map((author) => text(author))
        .filter((author): author is string => author !== undefined)
    : []
  const year = typeof raw['year'] === 'number' ? raw['year'] : undefined
  return {
    type,
    title,
    authors,
    ...(text(raw['containerTitle']) === undefined ? {} : { containerTitle: text(raw['containerTitle']) }),
    ...(year === undefined ? {} : { year }),
    ...(text(raw['volume']) === undefined ? {} : { volume: text(raw['volume']) }),
    ...(text(raw['issue']) === undefined ? {} : { issue: text(raw['issue']) }),
    ...(text(raw['pages']) === undefined ? {} : { pages: text(raw['pages']) }),
    ...(text(raw['publisher']) === undefined ? {} : { publisher: text(raw['publisher']) }),
    ...(text(raw['publisherPlace']) === undefined ? {} : { publisherPlace: text(raw['publisherPlace']) }),
    ...(text(raw['language']) === undefined ? {} : { language: text(raw['language']) }),
    ...(plain(raw['doi']) === undefined ? {} : { doi: plain(raw['doi']) }),
    ...(plain(raw['arxivId']) === undefined ? {} : { arxivId: plain(raw['arxivId']) }),
    ...(plain(raw['pmid']) === undefined ? {} : { pmid: plain(raw['pmid']) }),
    ...(plain(raw['pmcid']) === undefined ? {} : { pmcid: plain(raw['pmcid']) }),
    ...(plain(raw['url']) === undefined ? {} : { url: plain(raw['url']) }),
  }
}

/** Keep only the fields the panel and the export scope actually read. */
function sanitizeEntry(entry: unknown): BatchEntry | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const raw = entry as Record<string, unknown>
  const status = raw['status']
  if (status !== 'saved' && status !== 'quarantined' && status !== 'skipped' && status !== 'failed') {
    return undefined
  }
  const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const clean = stripMarkup(value)
    return clean === '' ? undefined : clean
  }
  // The id is an identity: quarantine ids embed `*` (`title:*Drought*|1965`), so
  // it must survive verbatim for `--ids` to find the row again.
  const id = typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : undefined
  const doi = typeof raw['doi'] === 'string' && raw['doi'] !== '' ? raw['doi'] : undefined
  const arxivId = typeof raw['arxivId'] === 'string' && raw['arxivId'] !== '' ? raw['arxivId'] : undefined
  const pmid = typeof raw['pmid'] === 'string' && raw['pmid'] !== '' ? raw['pmid'] : undefined
  const pmcid = typeof raw['pmcid'] === 'string' && raw['pmcid'] !== '' ? raw['pmcid'] : undefined
  const reason = text(raw['reason'])
  const title = text(raw['title']) ?? ''
  const year = typeof raw['year'] === 'number' ? raw['year'] : undefined
  const fields = sanitizeFields(raw['fields'])
  const annotated = raw['annotated'] === true
  return {
    title,
    status,
    ...(fields === undefined ? {} : { fields }),
    ...(annotated ? { annotated: true } : {}),
    ...(id === undefined ? {} : { id }),
    ...(doi === undefined ? {} : { doi }),
    ...(arxivId === undefined ? {} : { arxivId }),
    ...(pmid === undefined ? {} : { pmid }),
    ...(pmcid === undefined ? {} : { pmcid }),
    ...(reason === undefined ? {} : { reason }),
    ...(year === undefined ? {} : { year }),
  }
}

/** Tolerant parse: a corrupt batch degrades the panel, never capture. */
export function normalizeBatch(value: unknown): CaptureBatch | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw['entries'])) return undefined
  const entries: BatchEntry[] = []
  for (const entry of raw['entries']) {
    const clean = sanitizeEntry(entry)
    if (clean !== undefined) entries.push(clean)
  }
  return {
    capturedAt: typeof raw['capturedAt'] === 'string' ? raw['capturedAt'] : '',
    scope: typeof raw['scope'] === 'string' ? raw['scope'] : '',
    entries,
  }
}

/** Entries that exist in a table and may therefore be exported. */
export function exportableOf(batch: CaptureBatch, includeQuarantine: boolean): string[] {
  return batch.entries
    .filter((entry) => entry.id !== undefined && entry.id !== '')
    .filter((entry) => entry.status === 'saved' || (includeQuarantine && entry.status === 'quarantined'))
    .map((entry) => entry.id as string)
}

/** One transcript line carrying the batch for the client panel. */
export function encodeBatch(batch: CaptureBatch): string {
  return `${BATCH_MARKER} ${JSON.stringify(batch)}`
}

/** Read back what `encodeBatch` produced; used by the panel and by tests. */
export function decodeBatch(text: string): CaptureBatch | undefined {
  const at = text.lastIndexOf(BATCH_MARKER)
  if (at < 0) return undefined
  const json = text.slice(at + BATCH_MARKER.length).trim()
  const direct = parseBatchJson(json)
  if (direct !== undefined) return direct
  // A transcript line can pick up trailing prose, and a very long command
  // result can arrive with its tail clipped. Either way a complete object still
  // sits before the junk, so retry from the last closing brace backwards.
  for (let cut = json.lastIndexOf('}'); cut > 0; cut = json.lastIndexOf('}', cut - 1)) {
    const attempt = parseBatchJson(json.slice(0, cut + 1))
    if (attempt !== undefined) return attempt
  }
  return undefined
}

function parseBatchJson(json: string): CaptureBatch | undefined {
  try {
    return normalizeBatch(JSON.parse(json))
  } catch {
    return undefined
  }
}

/**
 * Newest batch among transcript texts, or undefined when the conversation has
 * never captured. Input order does not matter: the batch only carries a
 * timestamp, and ties are resolved by position, so the panel stays stable.
 */
export function findLatestBatch(texts: Iterable<string>): CaptureBatch | undefined {
  let best: CaptureBatch | undefined
  for (const text of texts) {
    if (!text.includes(BATCH_MARKER)) continue
    const batch = decodeBatch(text)
    if (batch === undefined) continue
    if (best === undefined || batch.capturedAt >= best.capturedAt) best = batch
  }
  return best
}
