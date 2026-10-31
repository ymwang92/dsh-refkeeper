/**
 * Transport layer for the four registries (§5.3).
 *
 * Everything here is injectable so the whole verification path can be exercised
 * without a network: `fetcher`, clock, timeouts and cache are options. The
 * defaults are production-shaped (4s per source, 8s per verification round,
 * one retry on 429/5xx, 10-minute read cache).
 *
 * Failure policy is fail-closed: a source that errors or runs out of time is
 * recorded in `errors`/`timedOut`, and the judgement layer can only downgrade
 * the verdict because of it.
 */

import {
  arxivIdUrl,
  arxivSearchUrl,
  crossrefDoiUrl,
  crossrefSearchUrl,
  dataciteDoiUrl,
  openalexDoiUrl,
  openalexSearchUrl,
  parseSourceBody,
} from './clients.ts'
import type { BodyBasis } from './clients.ts'
import { judgeCandidate } from './judge.ts'
import type { Candidate } from '../core/candidates.ts'
import type { SourceId, SourceRecord, VerificationReport } from './types.ts'

/** Minimal response shape; `fetch` satisfies it. */
export interface HttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body: string
}

export type Fetcher = (url: string, init: { signal?: AbortSignal }) => Promise<HttpResult>

export interface LookupOptions {
  readonly fetcher?: Fetcher | undefined
  /** Sent as `?mailto=` when non-empty; omitted entirely otherwise. */
  readonly mailto?: string | undefined
  readonly sourceTimeoutMs?: number | undefined
  readonly totalBudgetMs?: number | undefined
  readonly retries?: number | undefined
  readonly retryDelayMs?: number | undefined
  readonly cache?: LookupCache | undefined
  readonly now?: (() => number) | undefined
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
  readonly signal?: AbortSignal | undefined
}

export interface LookupResult {
  readonly records: readonly SourceRecord[]
  readonly errors: readonly SourceId[]
  readonly timedOut: boolean
  /** Sources that answered, whether or not they found anything. */
  readonly answered: readonly SourceId[]
}

export const DEFAULT_SOURCE_TIMEOUT_MS = 4_000
export const DEFAULT_TOTAL_BUDGET_MS = 8_000
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000

interface CacheEntry {
  readonly body: string
  readonly expiresAt: number
}

/** Tiny TTL cache keyed by URL; only successful responses are stored. */
export class LookupCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  // Plain assignment rather than a parameter property: Node's strip-only
  // TypeScript loader (used by the smoke script) rejects parameter properties.
  constructor(ttlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs
  }

  get(url: string, now: number): string | undefined {
    const entry = this.entries.get(url)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now) {
      this.entries.delete(url)
      return undefined
    }
    return entry.body
  }

  set(url: string, body: string, now: number): void {
    this.entries.set(url, { body, expiresAt: now + this.ttlMs })
  }

  get size(): number {
    return this.entries.size
  }
}

const defaultFetcher: Fetcher = async (url, init) => {
  const response = await fetch(url, init.signal === undefined ? {} : { signal: init.signal })
  return { ok: response.ok, status: response.status, body: await response.text() }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class AttemptTimeout extends Error {
  constructor() {
    super('attempt timed out')
  }
}

/** A 4xx that retrying cannot fix (400, 403, 404). */
class PermanentHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${String(status)}`)
    this.status = status
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimeout()), ms)
    // Never keep the host process alive for a timer that is about to be cleared.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Fetch with a per-attempt timeout that actually cancels the request.
 *
 * Racing a promise against a timer only stops *waiting*; the socket and the
 * response body keep going. For a 4s budget over three registries that is three
 * orphaned requests per verification, so the timer aborts the controller.
 */
async function fetchWithTimeout(
  fetcher: Fetcher,
  url: string,
  ms: number,
  outer: AbortSignal | undefined,
): Promise<HttpResult> {
  if (outer?.aborted === true) throw outer.reason ?? new DOMException('The operation was aborted', 'AbortError')

  const controller = new AbortController()
  let didTimeout = false
  let onAbort: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true
      reject(new AttemptTimeout())
      controller.abort()
    }, ms)
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
  })
  const callerAbort =
    outer === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          onAbort = () => {
            controller.abort(outer.reason)
            reject(outer.reason ?? new DOMException('The operation was aborted', 'AbortError'))
          }
          outer.addEventListener('abort', onAbort, { once: true })
        })

  try {
    const work = fetcher(url, { signal: controller.signal }).catch((error: unknown) => {
      if (didTimeout) throw new AttemptTimeout()
      throw error
    })
    return await Promise.race(callerAbort === undefined ? [work, timeout] : [work, timeout, callerAbort])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (outer !== undefined && onAbort !== undefined) outer.removeEventListener('abort', onAbort)
  }
}

interface FetchTextOptions {
  readonly fetcher: Fetcher
  readonly cache?: LookupCache | undefined
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly retries: number
  readonly retryDelayMs: number
  readonly timeoutMs: number
  readonly signal?: AbortSignal | undefined
}

/** GET one URL with cache, per-attempt timeout and 429/5xx retry. */
async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  const cached = options.cache?.get(url, options.now())
  if (cached !== undefined) return cached

  let lastError: unknown
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const result = await fetchWithTimeout(options.fetcher, url, options.timeoutMs, options.signal)
      if (result.ok) return result.body
      // 4xx other than 429 will not improve on retry.
      if (result.status !== 429 && result.status < 500) {
        throw new PermanentHttpError(result.status)
      }
      lastError = new Error(`HTTP ${String(result.status)}`)
    } catch (error) {
      lastError = error
      // Timeouts, caller cancellation, and permanent statuses are final:
      // retrying only burns budget or starts work after the caller gave up.
      if (
        options.signal?.aborted ||
        error instanceof AttemptTimeout ||
        error instanceof PermanentHttpError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error
      }
    }
    if (attempt < options.retries) await options.sleep(options.retryDelayMs * (attempt + 1))
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function dedupe(records: readonly SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>()
  const out: SourceRecord[] = []
  for (const record of records) {
    const key = `${record.source}|${record.id}|${record.doi}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(record)
  }
  return out
}

interface SourceTask {
  readonly source: SourceId
  readonly url: string
  readonly basis: BodyBasis
}

/** Identity a verification can start from; at least one field must be set. */
export interface LookupIdentity {
  readonly doi?: string | undefined
  readonly arxivId?: string | undefined
  readonly title?: string | undefined
}

function tasksFor(identity: LookupIdentity, mailto: string | undefined): SourceTask[] {
  const contact = mailto === undefined ? undefined : { mailto }
  const doi = identity.doi?.trim()
  if (doi !== undefined && doi !== '') {
    return [
      { source: 'crossref', url: crossrefDoiUrl(doi, contact), basis: 'doi' },
      { source: 'datacite', url: dataciteDoiUrl(doi), basis: 'doi' },
      { source: 'openalex', url: openalexDoiUrl(doi, contact), basis: 'doi' },
    ]
  }
  const arxivId = identity.arxivId?.trim()
  if (arxivId !== undefined && arxivId !== '') {
    return [{ source: 'arxiv', url: arxivIdUrl(arxivId), basis: 'id' }]
  }
  const title = identity.title?.trim()
  if (title === undefined || title === '') return []
  return [
    { source: 'crossref', url: crossrefSearchUrl(title, 5, contact), basis: 'search' },
    { source: 'openalex', url: openalexSearchUrl(title, 5, contact), basis: 'search' },
    { source: 'arxiv', url: arxivSearchUrl(title, 5), basis: 'search' },
  ]
}

/**
 * Query the registries for one identity.
 *
 * Sources run concurrently; when the total budget expires the already-settled
 * results are kept and `timedOut` is set, so a slow registry costs precision
 * (⚠ region) rather than blocking the capture.
 */
export async function lookupRecords(identity: LookupIdentity, options: LookupOptions = {}): Promise<LookupResult> {
  const tasks = tasksFor(identity, options.mailto)
  if (tasks.length === 0) return { records: [], errors: [], timedOut: false, answered: [] }

  const fetcher = options.fetcher ?? defaultFetcher
  const cache = options.cache
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepMs
  const retries = options.retries ?? 1
  const retryDelayMs = options.retryDelayMs ?? 250
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS
  const lookupController = new AbortController()
  const callerSignal = options.signal
  const forwardAbort = (): void => lookupController.abort(callerSignal?.reason)
  if (callerSignal?.aborted === true) forwardAbort()
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true })

  const run = async (task: SourceTask): Promise<{ source: SourceId; records?: SourceRecord[]; error?: unknown }> => {
    try {
      const body = await fetchText(task.url, {
        fetcher,
        cache,
        now,
        sleep,
        retries,
        retryDelayMs,
        timeoutMs: sourceTimeoutMs,
        signal: lookupController.signal,
      })
      const records = parseSourceBody(task.source, task.basis, body)
      // A 2xx response is not a cacheable success until its body matches the
      // requested source contract. Otherwise a transient HTML/malformed body
      // would poison retries for the full cache TTL.
      cache?.set(task.url, body, now())
      return { source: task.source, records }
    } catch (error) {
      // A 404 means "this registry does not have that work", which is a real
      // answer, not an outage. Counting it as `source-error` marked every
      // successful Crossref hit `partial` just because DataCite had no copy.
      if (error instanceof PermanentHttpError && error.status === 404) {
        return { source: task.source, records: [] }
      }
      return { source: task.source, error }
    }
  }

  try {
    const settled = await settleWithin(tasks.map(run), totalBudgetMs, () => {
      lookupController.abort(new AttemptTimeout())
    })

    const records: SourceRecord[] = []
    const errors: SourceId[] = []
    const answered: SourceId[] = []
    let timedOut = settled.timedOut

    for (const [index, outcome] of settled.values.entries()) {
      const task = tasks[index]
      if (task === undefined) continue
      if (outcome === undefined) {
        // The round budget expired before this source settled.
        timedOut = true
        errors.push(task.source)
        continue
      }
      if (outcome.error !== undefined) {
        if (outcome.error instanceof AttemptTimeout) timedOut = true
        errors.push(outcome.source)
        continue
      }
      answered.push(outcome.source)
      records.push(...(outcome.records ?? []))
    }

    return { records: dedupe(records), errors, timedOut, answered }
  } finally {
    callerSignal?.removeEventListener('abort', forwardAbort)
  }
}

/** Await every promise, but stop waiting after `budgetMs`; unresolved become `undefined`. */
async function settleWithin<T>(
  promises: readonly Promise<T>[],
  budgetMs: number,
  onTimeout: () => void,
): Promise<{ values: (T | undefined)[]; timedOut: boolean }> {
  const values: (T | undefined)[] = promises.map(() => undefined)
  let timedOut = false
  await Promise.all(
    promises.map(async (promise, index) => {
      try {
        values[index] = await withTimeout(promise, budgetMs)
      } catch (error) {
        if (error instanceof AttemptTimeout && !timedOut) {
          timedOut = true
          onTimeout()
        }
        values[index] = undefined
      }
    }),
  )
  return { values, timedOut }
}

export interface VerifyOutcome {
  readonly report: VerificationReport
  readonly records: readonly SourceRecord[]
  readonly lookup: LookupResult
}

/** A claim to check: everything is optional except one identity or a title. */
export interface VerificationClaim {
  readonly title?: string | undefined
  readonly authors?: readonly string[] | undefined
  readonly year?: number | undefined
  readonly doi?: string | undefined
  readonly arxivId?: string | undefined
}

/** Look the candidate up and judge it. The only network entry point in M2. */
export async function verifyCandidate(
  input: VerificationClaim,
  options: LookupOptions = {},
): Promise<VerifyOutcome> {
  const candidate = {
    title: input.title ?? '',
    authors: input.authors ?? [],
    year: input.year,
    doi: input.doi ?? '',
    arxivId: input.arxivId ?? '',
  }
  const lookup = await lookupRecords(
    { doi: candidate.doi, arxivId: candidate.arxivId, title: candidate.title },
    options,
  )
  // Identifier-only lookups (a bare DOI/arXiv id) carry no claim to compare
  // against, so the matched record becomes the claim. Without this, a perfectly
  // resolvable DOI would score 0/3 and land in the ⚠ region for the wrong reason.
  const claim =
    candidate.title.trim() === '' && lookup.records.length > 0
      ? {
          ...candidate,
          title: lookup.records[0]?.title ?? '',
          authors: lookup.records[0]?.authors ?? [],
          year: lookup.records[0]?.year,
        }
      : candidate

  const report = judgeCandidate({
    candidate: claim,
    records: lookup.records,
    errors: lookup.errors,
    timedOut: lookup.timedOut,
    answered: lookup.answered,
  })
  return { report, records: lookup.records, lookup }
}
