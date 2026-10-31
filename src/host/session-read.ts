/**
 * Host-side conversation reading: the one place that knows how to turn a
 * session into `{seq, role, text}` segments for a requested scope.
 *
 * Why `sessionQuery` and not `session.eventAt`: `eventAt`/`snapshotEvents` are
 * marked deprecated for new code in the SDK, so the primary path is the
 * async `sessionQuery` seam (`listEvents` for boundaries, `readEvent` for
 * payloads). The deprecated accessor survives only as an explicit, off-by-
 * default fallback for hosts that ship neither service — never silently.
 *
 * Everything here is structural typing: the plugin must keep loading across DSH
 * pre-releases where these packages move.
 */

import type { CaptureScope, ScopeResolution } from '../core/scope.ts'
import { resolveScope } from '../core/scope.ts'

/** Minimal event shape this module reads. */
export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

/** `sessionQuery.listEvents` row: metadata only, no payload. */
export interface EventRecordLike {
  readonly seq: number
  readonly type: string
}

/** The slice of `ctx.sessionQuery` this plugin needs. */
export interface SessionQueryLike {
  listEvents(sessionId: string): Promise<readonly EventRecordLike[]>
  readEvent(request: {
    readonly sessionId: string
    readonly seq: number
    readonly before?: number
    readonly after?: number
  }): Promise<{ readonly events: readonly SessionEventLike[] }>
}

/** The slice of `Session` this plugin needs when no query service exists. */
export interface SessionLike {
  readonly id: string
  readonly seq: number
  readonly surface: { readonly nodes: readonly number[] }
  /** Present on live sessions; the plugin falls back to `none` reads without it. */
  readonly header?: { readonly cwd?: string }
  eventAt(seq: number): SessionEventLike | undefined
}

/** One message's text, addressed by the event that carried it. */
export interface TranscriptSegment {
  readonly seq: number
  readonly role: 'user' | 'assistant' | 'tool'
  readonly text: string
}

/** Which read path produced a transcript; surfaced so degradation is visible. */
export type ReadMode = 'sessionQuery' | 'session-surface' | 'legacy-eventAt' | 'none'

/** Result of one scoped read. */
export interface TranscriptRead {
  readonly segments: readonly TranscriptSegment[]
  readonly readMode: ReadMode
  readonly resolution: ScopeResolution
  /** True when the character budget cut older content. */
  readonly truncated: boolean
  readonly chars: number
}

/** Default budget for one capture, per §5.1 of the plan. */
export const DEFAULT_MAX_SCAN_CHARS = 200_000

/** `sessionQuery.readEvent` rejects windows wider than this many events. */
export const READ_WINDOW_MAX = 50

/** How many 50-event pages a single capture may walk backwards. */
export const MAX_READ_PAGES = 4

const MESSAGE_TYPES: Readonly<Record<string, TranscriptSegment['role']>> = {
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Concatenate text blocks; thinking, images and tool inputs are ignored. */
function blocksText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] !== 'text') continue
    const text = block['text']
    if (typeof text === 'string' && text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * Text of one message-shaped event.
 *
 * The persisted log uses two shapes and both are in the wild:
 *
 * - `user/message` carries the blocks directly under `data.content`
 * - `assistant/message` and `tool/result` carry a whole message under
 *   `data.message`, so their blocks live at `data.message.content`
 *
 * Reading only the flat shape silently dropped every assistant reply — the one
 * place citations usually appear — so both are tried here.
 */
export function textOfEvent(event: SessionEventLike): string {
  const role = MESSAGE_TYPES[event.type]
  if (role === undefined || !isRecord(event.data)) return ''
  const data = event.data
  const direct = blocksText(data['content'])
  if (direct !== '') return direct
  const message = data['message']
  if (isRecord(message)) {
    const nested = blocksText(message['content'])
    if (nested !== '') return nested
    const output = message['output']
    if (typeof output === 'string') return output
  }
  return ''
}

/** Collect segments, keeping only non-empty text in the requested window. */
function segmentsFrom(
  events: readonly SessionEventLike[],
  startSeq: number,
  includeTools = false,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  for (const event of events) {
    if (event.seq < startSeq) continue
    const role = MESSAGE_TYPES[event.type]
    if (role === undefined || (role === 'tool' && !includeTools)) continue
    const text = textOfEvent(event)
    if (text.trim() === '') continue
    segments.push({ seq: event.seq, role, text })
  }
  return segments
}

/** Keep the newest content that fits the budget, dropping older segments whole. */
function applyBudget(
  segments: readonly TranscriptSegment[],
  maxChars: number,
): { segments: TranscriptSegment[]; truncated: boolean; chars: number } {
  let total = 0
  let cut = segments.length
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment === undefined) break
    const cost = segment.text.length
    if (total + cost > maxChars) {
      cut = index + 1
      break
    }
    total += cost
    cut = index
  }
  const kept = segments.slice(cut)
  return { segments: kept, truncated: cut > 0, chars: total }
}

/** Seqs of `turn/start` events, ascending. */
function turnStartsOf(records: readonly EventRecordLike[]): number[] {
  return records.filter((record) => record.type === 'turn/start').map((record) => record.seq)
}

/**
 * Message segments from the live session surface.
 *
 * The persisted event log can be segmented, so a long conversation's older
 * messages may not be readable through `sessionQuery`. The surface is the
 * in-process view of everything the transcript shows, which is exactly what
 * "capture what we discussed" means — it is the fallback text source.
 */
function surfaceSegments(
  session: SessionLike,
  startSeq: number,
  includeTools = false,
): TranscriptSegment[] {
  // Capability probe, not a crash: a host without `eventAt` simply has no
  // surface text to offer and the caller falls back to the log.
  if (typeof session.eventAt !== 'function') return []
  const events: SessionEventLike[] = []
  for (const seq of session.surface.nodes) {
    if (seq < startSeq) continue
    const event = session.eventAt(seq)
    if (event !== undefined) events.push(event)
  }
  return segmentsFrom(events, startSeq, includeTools)
}

/**
 * Read one scope of a conversation.
 *
 * `query` is the preferred seam. When it is absent and `allowLegacyRead` is
 * true, the deprecated `session.eventAt` path is used and `readMode` reports it;
 * with neither, the result is empty and `readMode` is `'none'` — the caller is
 * expected to say so instead of pretending nothing was found.
 */
export async function readTranscript(options: {
  readonly sessionId: string
  readonly scope: CaptureScope
  readonly maxChars?: number
  readonly query?: SessionQueryLike | undefined
  readonly session?: SessionLike | undefined
  readonly allowLegacyRead?: boolean
  /** Include tool outputs when explicitly requested; excluded by default. */
  readonly includeTools?: boolean
  /**
   * Turn boundaries from the `turnOutline` projection. The persisted log can be
   * segmented (a long session's older events live in an earlier chunk), so the
   * projection is the only source that still knows how many turns existed.
   */
  readonly turnStarts?: readonly number[] | undefined
}): Promise<TranscriptRead> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_SCAN_CHARS
  const empty = (resolution: ScopeResolution, readMode: ReadMode): TranscriptRead => ({
    segments: [],
    readMode,
    resolution,
    truncated: false,
    chars: 0,
  })

  const readViaLog = async (): Promise<TranscriptRead | undefined> => {
    if (options.query === undefined) return undefined
    try {
      return await readLogWindow(options.query)
    } catch (error) {
      // A host-side log read can fail for reasons outside our control (the
      // session is ahead of its persisted chunk, an anchor seq vanished, or the
      // version changed shape). With a live surface we degrade to it; without
      // one the failure must surface rather than masquerade as "nothing found".
      if (options.session === undefined) throw error
      return undefined
    }
  }
  const readLogWindow = async (query: SessionQueryLike): Promise<TranscriptRead> => {
    const records = await query.listEvents(options.sessionId)
    // The anchor must be a seq that really exists in the persisted log: the
    // live session can be ahead of it, and readEvent rejects unknown seqs.
    const lastSeq = records.at(-1)?.seq ?? -1
    if (lastSeq < 0) return empty(resolveScope([], -1, options.scope), 'sessionQuery')
    const fromLog = turnStartsOf(records)
    // Projection turn starts can predate the readable segment or, in a resumed
    // session, point past its end; only boundaries inside the log are usable.
    const fromProjection = options.turnStarts?.filter((seq) => seq <= lastSeq)
    const turnStarts = fromProjection !== undefined && fromProjection.length > 0 ? fromProjection : fromLog
    const resolution = resolveScope(turnStarts, lastSeq, options.scope)
    // Text comes from the live surface when it is reachable: it holds every
    // message the transcript shows, including older turns the persisted log may
    // have moved into an earlier segment.
    const live = options.session === undefined ? [] : surfaceSegments(options.session, resolution.startSeq, options.includeTools ?? false)
    if (live.length > 0) {
      const budgetedLive = applyBudget(live, maxChars)
      return {
        segments: budgetedLive.segments,
        readMode: 'session-surface',
        resolution,
        truncated: budgetedLive.truncated,
        chars: budgetedLive.chars,
      }
    }
    const inWindow = records.filter((record) => record.seq >= resolution.startSeq).length
    if (inWindow === 0) return empty(resolution, 'sessionQuery')
    // readEvent caps one read at READ_WINDOW_MAX (50) events, so a wide window is
    // paged backwards from the newest event and reported as truncated when the
    // page budget runs out.
    // Pages overlap by their anchor event, so events are deduped by seq.
    const collected: SessionEventLike[] = []
    const seen = new Set<number>()
    let anchor = lastSeq
    for (let page = 0; page < MAX_READ_PAGES; page += 1) {
      const remaining = inWindow - collected.length
      if (remaining <= 0) break
      const want = Math.min(remaining, READ_WINDOW_MAX)
      const window = await query.readEvent({
        sessionId: options.sessionId,
        seq: anchor,
        before: Math.max(0, want - 1),
      })
      if (window.events.length === 0) break
      let added = 0
      for (const event of window.events) {
        if (seen.has(event.seq)) continue
        seen.add(event.seq)
        collected.push(event)
        added += 1
      }
      collected.sort((left, right) => left.seq - right.seq)
      const earliest = window.events[0]?.seq
      if (earliest === undefined || earliest <= resolution.startSeq) break
      // No progress means the host is not honouring `before`; stop instead of
      // re-requesting the same page forever.
      if (earliest === anchor) break
      anchor = earliest
      if (added === 0) break
    }
    // Whatever the reason (page budget, empty page, host truncation), fewer
    // events than the window asked for means the report is partial.
    const capped = collected.length < inWindow
    const segments = segmentsFrom(collected, resolution.startSeq, options.includeTools ?? false)
    const budgeted = applyBudget(segments, maxChars)
    return {
      segments: budgeted.segments,
      readMode: 'sessionQuery',
      resolution,
      truncated: capped || budgeted.truncated,
      chars: budgeted.chars,
    }
  }
  const logged = await readViaLog()
  if (logged !== undefined) return logged

  const session = options.session
  if (session === undefined) {
    return empty(resolveScope([], -1, options.scope), 'none')
  }
  if (options.allowLegacyRead !== true) {
    // Without the log there are no turn boundaries, but the messages themselves
    // are still readable from the surface — report the honest resolution and
    // return what the transcript shows.
    const resolution = resolveScope([], session.seq, options.scope)
    const budgeted = applyBudget(surfaceSegments(session, resolution.startSeq, options.includeTools ?? false), maxChars)
    if (budgeted.segments.length === 0) return empty(resolution, 'none')
    return {
      segments: budgeted.segments,
      readMode: 'session-surface',
      resolution,
      truncated: budgeted.truncated,
      chars: budgeted.chars,
    }
  }

  const nodes = session.surface.nodes
  const events: SessionEventLike[] = []
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event !== undefined) events.push(event)
  }
  const turnStarts = turnStartsOf(events.map((event) => ({ seq: event.seq, type: event.type })))
  const lastSeq = nodes.at(-1) ?? -1
  const resolution = resolveScope(turnStarts, lastSeq, options.scope)
  const segments = segmentsFrom(events, resolution.startSeq, options.includeTools ?? false)
  const budgeted = applyBudget(segments, maxChars)
  return {
    segments: budgeted.segments,
    readMode: 'legacy-eventAt',
    resolution,
    truncated: budgeted.truncated,
    chars: budgeted.chars,
  }
}
