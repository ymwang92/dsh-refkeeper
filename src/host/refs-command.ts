import type { Candidate } from '../core/candidates.ts'
import { extractCandidates } from '../core/candidates.ts'
import type { BatchEntry, CaptureBatch } from './capture-batch.ts'
import { BATCH_MARKER, encodeBatch } from './capture-batch.ts'
import type { AnnotationOutcome, TranscriptLine } from './annotate.ts'
import type { CaptureScope } from '../core/scope.ts'
import { describeScope, parseScope } from '../core/scope.ts'
import type { SessionLike, SessionQueryLike, TranscriptRead } from './session-read.ts'
import { readTranscript } from './session-read.ts'

/**
 * Everything `/refs` needs from the host.
 *
 * Injected rather than imported so the command stays a pure function: the
 * entry-point tests can drive it with a fake session and a fake query seam,
 * which is the only way this path is verifiable on a headless host (the CLI
 * never dispatches slash commands; only a UI client calls `commands.execute`).
 */
export interface RefsCommandDeps {
  readonly query?: SessionQueryLike | undefined
  readonly sdkVersion: string
  /** Turn seqs from the `turnOutline` projection, when the host exposes it. */
  readonly turnStarts?: ((session: SessionLike) => readonly number[] | undefined) | undefined
  /** Persist the captured candidates (`/refs capture --save`). */
  readonly save?: ((candidates: readonly Candidate[], context: SaveContext) => Promise<SaveSummary>) | undefined
}

/** What `--save` knows about the conversation it captured from. */
export interface SaveContext {
  /** The transcript the candidates came out of: annotations are grounded on it. */
  readonly lines: readonly TranscriptLine[]
}

/** What `--save` managed to do with the candidates it was handed. */
export interface SaveSummary {
  readonly saved: number
  readonly quarantined: number
  /** Candidates without a title: verification needs one, so they stay preview-only. */
  readonly skipped: number
  readonly failed: number
  /** Per-candidate outcome, in candidate order: the panel renders this list. */
  readonly entries?: readonly BatchEntry[] | undefined
  /** Set by the host once the batch is persisted; drives the default export scope. */
  readonly batch?: CaptureBatch | undefined
  /** How the automatic annotation pass went, when the host attempted one. */
  readonly annotations?: AnnotationOutcome | undefined
}

export const REFS_USAGE = [
  'usage:',
  '  /refs                                  show capture readiness',
  '  /refs capture [--scope=turn|lastN|all] [--turns=N] [--save] [--dry-run] [--include-tools]',
  '  /refs verify --doi=… | --arxiv=… | --title=… [--json]',
  '',
  'scope: turn (default, current turn) · lastN (previous N turns, default 5) · all',
  '--save verifies each candidate and stores the ones that pass; the rest go to refs/quarantine.json.',
].join('\n')

export interface ParsedRefsCommand {
  readonly sub: 'status' | 'capture'
  readonly scopeArg: string
  readonly turnsArg: string
  readonly save: boolean
  readonly dryRun: boolean
  readonly includeTools: boolean
}

export function parseRefsCommand(raw: string): ParsedRefsCommand | { readonly error: string } {
  const tokens = raw.split(/\s+/u).filter((token) => token !== '')
  const sub = tokens.shift() ?? 'status'
  if (sub !== 'status' && sub !== 'capture') return { error: `unknown subcommand "${sub}"\n${REFS_USAGE}` }
  let scopeArg = ''
  let turnsArg = ''
  let save = false
  let dryRun = false
  let includeTools = false
  for (const token of tokens) {
    if (token === '--dry-run') {
      dryRun = true
      continue
    }
    if (token === '--save') {
      save = true
      continue
    }
    if (token === '--include-tools') {
      includeTools = true
      continue
    }
    const match = /^--(scope|turns)=(.*)$/u.exec(token)
    if (match === null) return { error: `unknown option "${token}"\n${REFS_USAGE}` }
    if (match[1] === 'scope') scopeArg = match[2] ?? ''
    else turnsArg = match[2] ?? ''
  }
  return { sub, scopeArg, turnsArg, save, dryRun, includeTools }
}

/** One capture pass: what was read and what came out of it. */
export interface CaptureRun {
  readonly scope: CaptureScope
  readonly read: TranscriptRead
  readonly candidates: readonly Candidate[]
}

/**
 * Read the requested scope and extract candidates.
 *
 * One implementation serves the command and the tool so the two entry points can
 * never disagree about scope semantics or dedupe.
 */
export async function collectCapture(
  session: SessionLike,
  scopeArg: string,
  turnsArg: string,
  query: SessionQueryLike | undefined,
  turnStarts?: readonly number[] | undefined,
  includeTools = false,
): Promise<CaptureRun | { readonly error: string }> {
  const scope = parseScope(scopeArg, turnsArg)
  if ('error' in scope) return { error: scope.error }
  const read = await readTranscript({
    sessionId: session.id,
    scope,
    query,
    session,
    allowLegacyRead: false,
    turnStarts,
    includeTools,
  })
  const candidates = extractCandidates(
    read.segments.map((segment) => ({ seq: segment.seq, text: segment.text, role: segment.role })),
    { includeTools },
  )
  return { scope, read, candidates }
}

function formatCandidate(candidate: Candidate, index: number): string[] {
  const names = candidate.authors.length === 0 ? '(authors unknown)' : candidate.authors.slice(0, 3).join('; ')
  const year = candidate.year === undefined ? 'n.d.' : String(candidate.year)
  const ids = [
    candidate.doi === '' ? '' : `doi:${candidate.doi}`,
    candidate.arxivId === '' ? '' : `arXiv:${candidate.arxivId}`,
    candidate.isbn === '' ? '' : `ISBN:${candidate.isbn}`,
    candidate.reportNumber === '' ? '' : `report:${candidate.reportNumber}`,
    candidate.url === '' ? '' : candidate.url,
  ].filter((part) => part !== '')
  return [
    `${String(index)}. [${candidate.type}] ${candidate.title === '' ? '(title unknown)' : candidate.title}`,
    `   ${names} (${year})${candidate.container === '' ? '' : ` · ${candidate.container}`}`,
    `   ${ids.length === 0 ? 'no identifier' : ids.join(' · ')} · confidence ${candidate.confidence.toFixed(2)} · origins ${candidate.origins.join('+')}${candidate.needsModelEnrichment ? ' · needs model' : ''}`,
    `   evidence seq ${candidate.evidence.join(',')}`,
  ]
}

/** Human-readable capture result shared by `/refs capture` and the tool. */
export function renderCapture(run: CaptureRun, saving = false): string {
  const { read } = run
  const resolution = read.resolution
  const degraded =
    resolution.degraded === ''
      ? ''
      : resolution.degraded === 'no-turn-boundaries'
        ? ' (no turn boundaries in this session — scope widened to the whole conversation)'
        : ` (requested ${String(resolution.requestedTurns)} turns, session has ${String(resolution.turns)})`
  const lines = [
    saving
      ? 'dsh-refkeeper capture — candidates queued for verification and saving'
      : 'dsh-refkeeper capture — candidates only, nothing saved yet',
    `scope: ${describeScope(run.scope)}${degraded}`,
    `window: seq ${String(resolution.startSeq)}..${String(resolution.endSeq)}, ${String(resolution.turns)} turn(s), read via ${read.readMode}`,
    `scanned: ${String(read.segments.length)} message(s), ${String(read.chars)} chars${read.truncated ? ' (truncated by budget)' : ''}`,
    `candidates: ${String(run.candidates.length)}`,
  ]
  if (run.candidates.length === 0) {
    lines.push(
      read.readMode === 'none'
        ? 'no read path available: this host exposes neither sessionQuery nor a live session.'
        : 'no DOI / arXiv id / ISBN / report number / citation string found in this scope.',
    )
  } else {
    for (const [index, candidate] of run.candidates.entries()) {
      lines.push(...formatCandidate(candidate, index + 1))
    }
  }
  if (!saving) lines.push('run `/refs verify --doi=…` on one candidate, or `/refs save` to store it')
  return lines.join('\n')
}

/** Execute one `/refs` line against a session. Pure I/O through `deps.query`. */
export async function runRefsCommand(
  raw: string,
  session: SessionLike,
  deps: RefsCommandDeps,
): Promise<{ readonly kind: 'success' | 'error'; readonly text: string }> {
  const parsed = parseRefsCommand(raw.trim())
  if ('error' in parsed) return { kind: 'error', text: parsed.error }

  if (parsed.sub === 'status') {
    const records = deps.query === undefined ? undefined : await deps.query.listEvents(session.id)
    const turnCount =
      records === undefined ? -1 : records.filter((record) => record.type === 'turn/start').length
    const lines = [
      `dsh-refkeeper · sdk ${deps.sdkVersion}`,
      `session ${session.id}`,
      records === undefined
        ? 'read seam: sessionQuery unavailable on this host (capture will report readMode=none)'
        : `read seam: sessionQuery · ${String(records.length)} events · ${String(turnCount)} turn(s)`,
      'storage: refs/refs.json (verified) + refs/quarantine.json (⚠) · verification: /refs verify (Crossref, OpenAlex, arXiv, DataCite)',
      REFS_USAGE,
    ]
    return { kind: 'success', text: lines.join('\n') }
  }

  const run = await collectCapture(
    session,
    parsed.scopeArg,
    parsed.turnsArg,
    deps.query,
    deps.turnStarts?.(session),
    parsed.includeTools,
  )
  if ('error' in run) return { kind: 'error', text: `${run.error}\n${REFS_USAGE}` }
  const preview = renderCapture(run, parsed.save)
  if (!parsed.save) return { kind: 'success', text: preview }
  if (deps.save === undefined) {
    return {
      kind: 'error',
      text: 'capture --save is unavailable on this host build; restart or update dsh-refkeeper, then retry. No references were saved.',
    }
  }
  const transcript = run.read.segments.map((segment) => ({
    seq: segment.seq,
    text: segment.text,
    role: segment.role,
  }))
  const summary = await deps.save(run.candidates, { lines: transcript })
  const stored = summary.saved + summary.quarantined
  const lines = [
    preview,
    `saved: ${String(summary.saved)} · quarantine: ${String(summary.quarantined)} · skipped (no title): ${String(summary.skipped)} · failed: ${String(summary.failed)}`,
    summary.skipped > 0
      ? 'Candidates without a title cannot be verified: fill them in via 手动添加 or ask the model to complete them.'
      : stored > 0
        ? 'This capture is now the default export scope: `/refs export` writes just these entries; `/refs export --all` writes the whole library.'
        : 'Nothing was stored, so the export scope is unchanged.',
  ]
  const outcome = summary.annotations
  if (outcome !== undefined) {
    lines.push(
      outcome.reason === undefined
        ? `annotations: ${String(outcome.annotated)} of ${String(outcome.considered)} annotated by ${outcome.model}`
        : `annotations: skipped — ${outcome.reason}`,
    )
  }
  if (summary.batch !== undefined) lines.push(encodeBatch(summary.batch))
  return { kind: 'success', text: lines.join('\n') }
}
