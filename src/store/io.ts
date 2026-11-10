import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { renderAnnotated } from './annotated.ts'
import { readFileAtomic, serialize, withStoreLock, writeFileAtomic } from './atomic.ts'
import {
  DEFAULT_MAX_REFERENCES,
  REF_TYPES,
  SCHEMA_VERSION,
  StoreError,
  emptyQuarantine,
  emptyStore,
  referenceId,
  referenceIdentityKey,
  sortReferences,
} from './types.ts'
import type {
  QuarantineState,
  RefAuthor,
  RefType,
  StoredReference,
  StoreState,
} from './types.ts'

export const REFS_DIRNAME = 'refs'

export interface StorePaths {
  readonly dir: string
  readonly refs: string
  readonly quarantine: string
  readonly annotated: string
  readonly exports: string
}

export function storePaths(workspace: string): StorePaths {
  const dir = join(workspace, REFS_DIRNAME)
  return {
    dir,
    refs: join(dir, 'refs.json'),
    quarantine: join(dir, 'quarantine.json'),
    annotated: join(dir, 'annotated.md'),
    exports: join(dir, 'exports'),
  }
}

export interface LoadOutcome {
  readonly state: StoreState
  readonly migrated: boolean
  readonly backupPath?: string
  readonly dropped: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function isTrigger(value: unknown): value is 'button' | 'command' | 'tool' {
  return value === 'button' || value === 'command' || value === 'tool'
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function authors(value: unknown): RefAuthor[] {
  if (!Array.isArray(value)) return []
  const out: RefAuthor[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') {
      out.push({ literal: item.trim() })
      continue
    }
    if (!isRecord(item)) continue
    const family = str(item['family'])
    const given = str(item['given'])
    const literal = str(item['literal'])
    const sequence = num(item['sequence'])
    if (!family && !given && !literal) continue
    out.push({
      ...(family ? { family } : {}),
      ...(given ? { given } : {}),
      ...(literal ? { literal } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    })
  }
  return out
}

/**
 * Identity fields, accepted in two shapes on purpose:
 *   `{ identifiers: { doi } }`  — the stored shape, used by tools and stores
 *   `{ doi, arxivId }`          — the flat shape `/refs save` documents and the
 *                                 panel sends, because a human types one DOI
 * Mapping the flat shape here (rather than at each call site) means a payload
 * cannot lose its DOI on the way in: an identity-less record dedupes by title
 * and silently merges with a different paper that shares the year.
 */
function identifiers(raw: Record<string, unknown>): Record<string, string> {
  const nested = isRecord(raw['identifiers']) ? raw['identifiers'] : {}
  const out: Record<string, string> = {}
  const sources: readonly (readonly [string, string])[] = [
    ['doi', 'doi'],
    ['arxiv', 'arxiv'],
    ['arxivId', 'arxiv'],
    ['pmid', 'pmid'],
    ['pmcid', 'pmcid'],
    ['isbn', 'isbn'],
    ['reportNumber', 'reportNumber'],
  ]
  for (const [from, to] of sources) {
    if (out[to] !== undefined) continue
    const text = str(nested[from]) ?? str(raw[from])
    if (text === undefined) continue
    const normalized =
      to === 'pmid' ? text.replace(/\s+/gu, '')
      : to === 'pmcid' ? text.replace(/\s+/gu, '').toUpperCase()
      : text
    if (normalized) out[to] = normalized
  }
  return out
}

/** Fill in the mandatory envelope so writers never depend on caller hygiene. */
export function coerceReference(raw: unknown, now: string): StoredReference | undefined {
  if (!isRecord(raw)) return undefined
  const title = str(raw['title'])
  if (!title) return undefined
  const type = REF_TYPES.includes(raw['type'] as RefType) ? (raw['type'] as RefType) : 'journalArticle'
  const ids = identifiers(raw)
  const year = num(raw['year'])
  const addedAt = str(raw['addedAt']) ?? now
  const base = {
    title,
    year,
    identifiers: ids,
  }
  const provenance = isRecord(raw['provenance'])
    ? {
        ...(str(raw['provenance']['sessionId']) ? { sessionId: str(raw['provenance']['sessionId']) } : {}),
        ...(num(raw['provenance']['seqStart']) !== undefined ? { seqStart: num(raw['provenance']['seqStart']) } : {}),
        ...(num(raw['provenance']['seqEnd']) !== undefined ? { seqEnd: num(raw['provenance']['seqEnd']) } : {}),
        ...(str(raw['provenance']['scope']) ? { scope: str(raw['provenance']['scope']) } : {}),
        ...(str(raw['provenance']['capturedAt']) ? { capturedAt: str(raw['provenance']['capturedAt']) as string } : {}),
        ...(isTrigger(raw['provenance']['trigger']) ? { trigger: raw['provenance']['trigger'] } : {}),
      }
    : { capturedAt: addedAt }
  const verification = isRecord(raw['verification'])
    ? (raw['verification'] as unknown as StoredReference['verification'])
    : { status: 'manual' as const }
  return {
    id: str(raw['id']) ?? referenceId(base),
    type,
    ...(str(raw['language']) ? { language: str(raw['language']) as string } : {}),
    title,
    ...(str(raw['containerTitle']) ? { containerTitle: str(raw['containerTitle']) as string } : {}),
    authors: authors(raw['authors']),
    ...(year !== undefined ? { year } : {}),
    ...(str(raw['volume']) ? { volume: str(raw['volume']) as string } : {}),
    ...(str(raw['issue']) ? { issue: str(raw['issue']) as string } : {}),
    ...(str(raw['pages']) ? { pages: str(raw['pages']) as string } : {}),
    ...(str(raw['publisher']) ? { publisher: str(raw['publisher']) as string } : {}),
    ...(str(raw['publisherPlace']) ? { publisherPlace: str(raw['publisherPlace']) as string } : {}),
    identifiers: ids,
    ...(str(raw['url']) ? { url: str(raw['url']) as string } : {}),
    ...(str(raw['accessed']) ? { accessed: str(raw['accessed']) as string } : {}),
    provenance: { capturedAt: addedAt, ...provenance },
    verification,
    ...(isRecord(raw['annotation']) ? { annotation: raw['annotation'] as unknown as StoredReference['annotation'] } : {}),
    ...(Array.isArray(raw['tags']) ? { tags: raw['tags'].filter((t): t is string => typeof t === 'string') } : {}),
    ...(str(raw['bibtexKey']) ? { bibtexKey: str(raw['bibtexKey']) as string } : {}),
    addedAt,
    updatedAt: str(raw['updatedAt']) ?? addedAt,
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFileAtomic(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function stamp(now: string): string {
  return now.replace(/[:.]/gu, '-')
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFileAtomic(file)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new StoreError(
      'corrupt-store',
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function writeMigrationBackup(source: string, destination: string): Promise<string> {
  const contents = await readFileAtomic(source)
  let path = destination
  let suffix = 0
  for (;;) {
    let handle
    try {
      handle = await open(path, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      suffix += 1
      path = `${destination}.${String(suffix)}`
      continue
    }
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return path
  }
}

/** Read `refs/refs.json`, migrating older payloads forward.
 *
 * A legacy payload is a bare array (schemaVersion 0). Before rewriting it the
 * resolved legacy contents are copied to `refs.json.bak-<timestamp>` so a bad
 * migration never destroys the only copy.
 */
export interface LoadOptions {
  readonly now?: string
  /** Backup hook; injectable so the fail-closed path is testable. */
  readonly backup?: (source: string, destination: string) => Promise<void>
}

export async function loadStore(
  workspace: string,
  options: LoadOptions = {},
): Promise<LoadOutcome> {
  const now = options.now ?? new Date().toISOString()
  const paths = storePaths(workspace)
  if (!(await exists(paths.refs))) {
    return { state: emptyStore(now), migrated: false, dropped: 0 }
  }
  const raw = await readJson(paths.refs)
  const legacy = Array.isArray(raw)
  const record = isRecord(raw) ? raw : undefined
  const version = legacy ? 0 : num(record?.['schemaVersion']) ?? 0
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      'unsupported-schema',
      `refs.json has schemaVersion ${String(version)}; this build understands up to ${String(SCHEMA_VERSION)}. Upgrade dsh-refkeeper.`,
    )
  }
  const list = legacy
    ? raw
    : Array.isArray(record?.['references'])
      ? (record['references'] as unknown[])
      : undefined
  if (!list) {
    throw new StoreError('corrupt-store', 'refs.json has neither an array nor a `references` array')
  }

  const seen = new Map<string, StoredReference>()
  let dropped = 0
  for (const item of list) {
    const ref = coerceReference(item, now)
    if (!ref) {
      dropped += 1
      continue
    }
    seen.set(ref.id, ref)
  }
  const references = sortReferences([...seen.values()])
  const state: StoreState = { schemaVersion: SCHEMA_VERSION, updatedAt: now, references }

  if (version === SCHEMA_VERSION) return { state, migrated: false, dropped }

  let backupPath = `${paths.refs}.bak-${stamp(now)}`
  // Migration rewrites the logical file on the next save, so a missing backup
  // means the old library could be lost for good. Fail closed instead.
  try {
    if (options.backup) {
      await options.backup(paths.refs, backupPath)
    } else {
      backupPath = await writeMigrationBackup(paths.refs, backupPath)
    }
  } catch (error) {
    throw new StoreError(
      'backup-failed',
      `refusing to migrate refs.json: backup to ${backupPath} failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  return { state, migrated: true, backupPath, dropped }
}

export async function loadQuarantine(
  workspace: string,
  options: { readonly now?: string } = {},
): Promise<QuarantineState> {
  const now = options.now ?? new Date().toISOString()
  const paths = storePaths(workspace)
  if (!(await exists(paths.quarantine))) return emptyQuarantine(now)
  const raw = await readJson(paths.quarantine)
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['entries'])
      ? (raw['entries'] as unknown[])
      : undefined
  if (!list) throw new StoreError('corrupt-store', 'quarantine.json is not an array')
  const entries: StoredReference[] = []
  for (const item of list) {
    const ref = coerceReference(item, now)
    if (ref) entries.push(ref)
  }
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, entries }
}

function payload(
  updatedAt: string,
  key: 'references' | 'entries',
  list: readonly StoredReference[],
): string {
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt, [key]: list }, null, 2)}\n`
}

export async function writeStore(workspace: string, state: StoreState): Promise<void> {
  const paths = storePaths(workspace)
  await writeFileAtomic(paths.refs, payload(state.updatedAt, 'references', state.references))
  await writeFileAtomic(paths.annotated, renderAnnotated(state))
}

export async function writeQuarantine(
  workspace: string,
  state: QuarantineState,
): Promise<void> {
  await writeFileAtomic(
    storePaths(workspace).quarantine,
    payload(state.updatedAt, 'entries', state.entries),
  )
}

export interface SaveOutcome {
  readonly reference: StoredReference
  readonly state: StoreState
  readonly replaced: boolean
}

/** Append or replace one reference, holding both the in-process queue and the
 * on-disk lock. Capacity is checked against the *main* table only. */
export async function saveReference(
  workspace: string,
  input: StoredReference,
  options: { readonly now?: string; readonly max?: number } = {},
): Promise<SaveOutcome> {
  const now = options.now ?? new Date().toISOString()
  const max = options.max ?? DEFAULT_MAX_REFERENCES
  const paths = storePaths(workspace)
  return serialize(`store:${paths.dir}`, () =>
    withStoreLock(paths.dir, async () => {
      const { state } = await loadStore(workspace, { now })
      const identity = referenceIdentityKey(input)
      const existing = state.references.find((ref) => referenceIdentityKey(ref) === identity)
      if (!existing && state.references.length >= max) {
        throw new StoreError(
          'capacity',
          `refs store holds ${String(state.references.length)} references (limit ${String(max)}); export and archive before adding more.`,
        )
      }
      const merged: StoredReference = existing
        ? { ...input, id: existing.id, annotation: input.annotation ?? existing.annotation, addedAt: existing.addedAt, updatedAt: now }
        : { ...input, addedAt: input.addedAt || now, updatedAt: now }
      const references = sortReferences([
        ...state.references.filter((ref) => referenceIdentityKey(ref) !== identity),
        merged,
      ])
      const next: StoreState = { schemaVersion: SCHEMA_VERSION, updatedAt: now, references }
      await writeStore(workspace, next)
      // A successful capture supersedes any stale quarantine copy of the same id.
      // Write the main table first so an interruption cannot lose the only copy.
      const quarantine = await loadQuarantine(workspace, { now })
      const remaining = quarantine.entries.filter((ref) => referenceIdentityKey(ref) !== identity)
      if (remaining.length !== quarantine.entries.length) {
        await writeQuarantine(workspace, {
          schemaVersion: SCHEMA_VERSION,
          updatedAt: now,
          entries: remaining,
        })
      }
      return { reference: merged, state: next, replaced: Boolean(existing) }
    }),
  )
}

export interface QuarantineSave {
  readonly state: QuarantineState
  /** False when the same work is already in the main table and nothing was written. */
  readonly stored: boolean
}

export async function saveQuarantined(
  workspace: string,
  input: StoredReference,
  options: { readonly now?: string } = {},
): Promise<QuarantineSave> {
  const now = options.now ?? new Date().toISOString()
  const paths = storePaths(workspace)
  return serialize(`store:${paths.dir}`, () =>
    withStoreLock(paths.dir, async () => {
      const [main, current] = await Promise.all([
        loadStore(workspace, { now }),
        loadQuarantine(workspace, { now }),
      ])
      // Never re-create a quarantine copy once the same identity is in the main table.
      const identity = referenceIdentityKey(input)
      if (main.state.references.some((ref) => referenceIdentityKey(ref) === identity)) {
        return { state: current, stored: false }
      }
      const prior = current.entries.find((ref) => referenceIdentityKey(ref) === identity)
      const incoming = prior === undefined ? input : { ...input, verification: { ...input.verification, reasons: [...new Set([...(input.verification.reasons ?? []), ...(prior.verification.reasons ?? [])])] } }
      const entries = [incoming, ...current.entries.filter((ref) => referenceIdentityKey(ref) !== identity)]
      const next: QuarantineState = { schemaVersion: SCHEMA_VERSION, updatedAt: now, entries }
      await writeQuarantine(workspace, next)
      return { state: next, stored: true }
    }),
  )
}

/**
 * Move selected quarantine rows into the main table under one process and disk lock.
 * The main table is written before removing quarantine rows: an interrupted move
 * can leave a duplicate, but never lose the only copy. Retrying deduplicates by id.
 */
export async function promoteQuarantined(
  workspace: string,
  candidates: readonly StoredReference[],
  options: { readonly now?: string; readonly max?: number } = {},
): Promise<{ readonly promoted: readonly StoredReference[]; readonly skipped: number; readonly replaced: number }> {
  const now = options.now ?? new Date().toISOString()
  const max = options.max ?? DEFAULT_MAX_REFERENCES
  const paths = storePaths(workspace)
  return serialize(`store:${paths.dir}`, () =>
    withStoreLock(paths.dir, async () => {
      const [main, quarantine] = await Promise.all([
        loadStore(workspace, { now }),
        loadQuarantine(workspace, { now }),
      ])
      const quarantineById = new Map(quarantine.entries.map((ref) => [ref.id, ref]))
      const selected = candidates
        .map((candidate) => quarantineById.get(candidate.id))
        .filter((ref): ref is StoredReference => ref !== undefined)
      const existingById = new Map(main.state.references.map((ref) => [ref.id, ref]))
      const incoming = selected.map((ref) => {
        const candidate = candidates.find((item) => item.id === ref.id) ?? ref
        const previous = existingById.get(ref.id)
        // A promoted id already present in the main table has to replace that row.
        // Filtering it out while still deleting the quarantine row would keep the
        // stale record and lose the fresh verification, which is exactly what a
        // retry after an interrupted move runs into.
        return previous === undefined ? candidate : { ...candidate, annotation: candidate.annotation ?? previous.annotation }
      })
      const additions = incoming.filter((ref) => !existingById.has(ref.id))
      const replaced = incoming.length - additions.length
      if (main.state.references.length + additions.length > max) {
        throw new StoreError(
          'capacity',
          `refs store holds ${String(main.state.references.length)} references (limit ${String(max)}); export and archive before promoting more.`,
        )
      }
      if (selected.length === 0) return { promoted: [], skipped: candidates.length, replaced: 0 }
      const selectedIds = new Set(selected.map((ref) => ref.id))
      const nextMain: StoreState = {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: now,
        references: sortReferences([
          ...main.state.references.filter((ref) => !selectedIds.has(ref.id)),
          ...incoming,
        ]),
      }
      await writeStore(workspace, nextMain)
      const nextQuarantine: QuarantineState = {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: now,
        entries: quarantine.entries.filter((ref) => !selectedIds.has(ref.id)),
      }
      await writeQuarantine(workspace, nextQuarantine)
      return { promoted: incoming, skipped: candidates.length - selected.length, replaced }
    }),
  )
}
