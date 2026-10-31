import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Candidate, ModelCandidateInput } from './core/candidates.ts'
import { candidateFromModel, mergeCandidates, rankCandidates, sanitizeEvidence } from './core/candidates.ts'
import { describeScope, parseScope } from './core/scope.ts'
import { writeBatch } from './host/capture-batch.ts'
import type { CaptureBatch } from './host/capture-batch.ts'
import { fieldsOfReference, saveCaptured } from './host/capture-save.ts'
import type { SessionLike, SessionQueryLike } from './host/session-read.ts'
import type { SaveSummary } from './host/refs-command.ts'
import { collectCapture, parseRefsCommand, runRefsCommand } from './host/refs-command.ts'
import { renderVerify, runVerifyCommand } from './host/verify-command.ts'
import { exportLibrary, isStoreSubcommand, runStoreCommand, saveFromPayload } from './host/store-command.ts'
import type { DirectoryPickerControllerLike, HostFsLike, StoreCommandDeps } from './host/store-command.ts'
import { LookupCache, verifyCandidate } from './verify/lookup.ts'
import type { VerificationClaim } from './verify/lookup.ts'

/** Package identity used by diagnostics and the client registrant label. */
export /**
 * One cache for the whole process.
 *
 * Per-call caches would die with the call and never dedupe the repeats that
 * actually matter (the same DOI re-verified while editing a paragraph).
 */
const verifyCache = new LookupCache()

/**
 * Human label for the scope flags on a `/refs capture …` line, reused for the
 * persisted batch so the panel can show what was captured.
 */
function scopeLabelOf(raw: string): string {
  const parsed = parseRefsCommand(raw)
  if ('error' in parsed) return 'last capture'
  const scope = parseScope(parsed.scopeArg, parsed.turnsArg)
  return 'error' in scope ? 'last capture' : describeScope(scope)
}

const PACKAGE_NAME = 'dsh-refkeeper'

/** Cordis service key this plugin provides. */
export const SERVICE_KEY = 'refkeeper'

/**
 * Reports which SDK build the plugin is actually running against.
 *
 * The host version is deliberately not read from `package.json` top-level
 * `version` (that is the plugin's own), and not assumed from an env var (the
 * desktop app does not export one). Resolving the peer package that carries
 * the tool/session contracts answers the question that matters: which API
 * surface is live in this process.
 */
export function probeSdkVersion(): string | undefined {
  const fromEnv = process.env['DSH_VERSION']
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('@deepseek-ai/dsh-tools/package.json') as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}

/**
 * Result of `ref_ping`: the M0 contract probe.
 *
 * Every field answers one question the M1/M4 implementation depends on:
 * whether the executing tool can reach the live session, whether the surface
 * enumerates the model-visible order, whether turn boundaries are readable,
 * and whether the host may write inside the session workspace.
 */
export interface ProbeReport {
  readonly plugin: string
  /** Resolved SDK build, or "unknown" when the peer package cannot be resolved. */
  readonly dshVersion: string
  readonly agent: boolean
  /** Empty string when no live session is reachable from the tool. */
  readonly sessionId: string
  readonly cwd: string
  readonly surfaceNodes: number
  /** -1 when the surface is empty. */
  readonly firstSeq: number
  readonly lastSeq: number
  readonly turnStarts: number
  /** -1 when no turn boundary is visible. */
  readonly currentTurnStartSeq: number
  readonly currentTurnEvents: number
  /** `seq:type` for every surface node, joined by spaces (contract evidence). */
  readonly nodeTypes: string
  /** Turn count from the `turnOutline` projection; -1 when that unit is not registered. */
  readonly outlineTurns: number
  /** `turn@seq` per outline entry, joined by spaces. */
  readonly turnOutline: string
  readonly writeOk: boolean
  /** Empty string when nothing was attempted or nothing failed. */
  readonly writePath: string
  readonly writeError: string
}

const probeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    plugin: { type: 'string' },
    dshVersion: { type: 'string' },
    agent: { type: 'boolean' },
    sessionId: { type: 'string' },
    cwd: { type: 'string' },
    surfaceNodes: { type: 'integer' },
    firstSeq: { type: 'integer' },
    lastSeq: { type: 'integer' },
    turnStarts: { type: 'integer' },
    currentTurnStartSeq: { type: 'integer' },
    currentTurnEvents: { type: 'integer' },
    nodeTypes: { type: 'string' },
    outlineTurns: { type: 'integer' },
    turnOutline: { type: 'string' },
    writeOk: { type: 'boolean' },
    writePath: { type: 'string' },
    writeError: { type: 'string' },
  },
} as const

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return error instanceof Error ? error.message : String(error)
}

async function writeProbe(cwd: string): Promise<Pick<ProbeReport, 'writeOk' | 'writePath' | 'writeError'>> {
  if (cwd === '') return { writeOk: false, writePath: '', writeError: 'no-cwd' }
  const dir = join(cwd, '.refkeeper')
  const path = join(dir, 'probe.json')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, `${JSON.stringify({ at: new Date().toISOString() })}\n`, 'utf8')
    return { writeOk: true, writePath: path, writeError: '' }
  } catch (error) {
    return { writeOk: false, writePath: path, writeError: errorCode(error) }
  }
}

/**
 * Structural view of the session-projection registry seam.
 *
 * Declared locally instead of imported so the compiled host bundle does not
 * pin a peer export that may move between DSH pre-releases; absence is a
 * capability probe, not a crash.
 */
interface ProjectionReader {
  stateOf(session: never, key: string): unknown
}

/** Set when the host exposes `sessionProjections`; `undefined` on hosts without it. */
let projections: ProjectionReader | undefined

/**
 * Set when the host exposes `sessionQuery`. This is the sanctioned async read
 * seam for the session log (turn boundaries + event payloads); when absent, the
 * capture paths degrade loudly instead of guessing.
 */
let sessionQuery: SessionQueryLike | undefined
let directoryPickerController: DirectoryPickerControllerLike | undefined
let hostFs: HostFsLike | undefined
/**
 * Optional host services may mount after this plugin's constructor runs, so a
 * value captured at mount time can stay undefined for the whole process. Probe
 * again on demand instead of trusting the first look.
 */
let serviceLookup: ((name: string) => unknown) | undefined

interface TurnOutlineLike {
  readonly turns?: readonly { readonly turn: number; readonly seq: number }[]
}

/**
 * Turn boundaries from the `turnOutline` projection.
 *
 * The persisted event log can be segmented, so a long session's older
 * `turn/start` events may not be visible through `sessionQuery.listEvents`.
 * The projection is folded by the host itself and therefore still knows them.
 */
function outlineTurnStarts(session: SessionLike | undefined): number[] | undefined {
  if (session === undefined || projections === undefined) return undefined
  const outline = projections.stateOf(session as never, 'turnOutline') as TurnOutlineLike | undefined
  const turns = outline?.turns
  if (turns === undefined || turns.length === 0) return undefined
  return turns.map((entry) => entry.seq)
}

/** Diagnostic tool: reports the live-session contract this plugin builds on. */
export const refPingTool = defineTool({
  name: 'ref_ping',
  description:
    'Diagnose the dsh-refkeeper plugin: report whether the tool can reach the live session, how many model-visible surface nodes and turns it sees, and whether the session workspace is writable from a tool. Reads only; writes at most .refkeeper/probe.json inside the session workspace.',
  parameters: {},
  output: {
    schema: probeSchema,
    render(_args: unknown, value: ProbeReport) {
      const lines = [
        `plugin: ${value.plugin}`,
        `dsh: ${value.dshVersion}`,
        `agent: ${value.agent}`,
        `session: ${value.sessionId === '' ? '(none)' : value.sessionId}`,
        `cwd: ${value.cwd === '' ? '(none)' : value.cwd}`,
        `surface nodes: ${value.surfaceNodes} (seq ${value.firstSeq}..${value.lastSeq})`,
        `turns: ${value.turnStarts} total, current turn starts at seq ${value.currentTurnStartSeq} with ${value.currentTurnEvents} events`,
        `node types: ${value.nodeTypes}`,
        `turnOutline: ${value.outlineTurns === -1 ? '(unit not registered)' : `${value.outlineTurns} turn(s) [${value.turnOutline}]`}`,
        `workspace write: ${value.writeOk ? 'ok' : `failed (${value.writeError})`}${value.writePath === '' ? '' : ` at ${value.writePath}`}`,
      ]
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(_args: unknown, exec): Promise<ProbeReport> {
    const agent = exec.agent
    const session = agent?.session
    const nodes = session?.surface.nodes ?? []
    // Prefer the log seam for boundaries; the deprecated accessor is only used
    // when no query service exists, and the report says which one was used.
    let turnStartSeqs: number[] = []
    if (session !== undefined && sessionQuery !== undefined) {
      const records = await sessionQuery.listEvents(session.id)
      turnStartSeqs = records.filter((record) => record.type === 'turn/start').map((record) => record.seq)
    } else if (session !== undefined) {
      for (const seq of nodes) {
        if (session.eventAt(seq)?.type === 'turn/start') turnStartSeqs.push(seq)
      }
    }
    const currentTurnStartSeq = turnStartSeqs.at(-1)
    const currentTurnEvents =
      currentTurnStartSeq === undefined
        ? 0
        : nodes.filter((seq) => seq >= currentTurnStartSeq).length
    const outline =
      session === undefined || projections === undefined
        ? undefined
        : (projections.stateOf(session as never, 'turnOutline') as TurnOutlineLike | undefined)
    const cwd = session?.header.cwd ?? ''
    const write = await writeProbe(cwd)
    return {
      plugin: PACKAGE_NAME,
      dshVersion: probeSdkVersion() ?? 'unknown',
      agent: agent !== undefined,
      sessionId: session?.id ?? '',
      cwd,
      surfaceNodes: nodes.length,
      firstSeq: nodes.at(0) ?? -1,
      lastSeq: nodes.at(-1) ?? -1,
      turnStarts: turnStartSeqs.length,
      currentTurnStartSeq: currentTurnStartSeq ?? -1,
      currentTurnEvents,
      nodeTypes:
        session === undefined
          ? ''
          : nodes.map((seq) => `${seq}:${session.eventAt(seq)?.type ?? '?'}`).join(' '),
      outlineTurns: outline === undefined ? -1 : outline.turns?.length ?? 0,
      turnOutline: outline?.turns?.map((entry) => `${entry.turn}@${entry.seq}`).join(' ') ?? '',
      ...write,
    }
  },
})

const verifySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    passed: { type: 'integer' },
    matchedSource: { type: 'string' },
    partial: { type: 'boolean' },
    reasonsJson: { type: 'string' },
    reportJson: { type: 'string' },
    note: { type: 'string' },
  },
} as const

/** Flat on purpose: the full report travels as lossless JSON text. */
interface VerifyToolResult {
  readonly status: string
  readonly passed: number
  readonly matchedSource: string
  readonly partial: boolean
  readonly reasonsJson: string
  readonly reportJson: string
  readonly note: string
}

/**
 * Verification as a model-facing tool.
 *
 * Same three conditions as `/refs verify`: a title alone that "looks right" is
 * not enough, and a candidate never becomes `verified` without a registry that
 * actually returns the work. The ⚠ statuses are deliberately distinct so the
 * model can say "the network failed, retry" instead of "this citation is fake".
 */
export const refVerifyTool = defineTool({
  name: 'ref_verify',
  description:
    'Verify one bibliographic claim against Crossref, OpenAlex, arXiv and DataCite before it enters the reference table. Pass the fields the user actually claimed (title, authors, year, doi, arxivId). The verdict is `verified` only when title strongly matches, year is within ±1, the first author matches AND at least one registry returns the work; `warning` (2/3), `quarantined` (0-1/3 or no registry hit) and `unverified` (registries unreachable) all belong in the ⚠ region and must not be exported. A bare DOI/arXiv id with no title is an existence check: the matched record supplies the claim.',
  parameters: {
    title: { type: 'string', description: 'Claimed title, as written in the conversation.' },
    authors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Claimed author names in citation order; only the first is compared.',
    },
    year: { type: 'integer', description: 'Claimed publication year.' },
    doi: { type: 'string', description: 'DOI without the https://doi.org/ prefix.' },
    arxivId: { type: 'string', description: 'arXiv identifier, e.g. 2401.01234.' },
  },
  output: {
    schema: verifySchema,
    render(_args: unknown, value: VerifyToolResult) {
      return [
        {
          type: 'text',
          text: [
            `${value.status} · passed ${String(value.passed)}/3${value.matchedSource === '' ? '' : ` · matched ${value.matchedSource}`}${value.partial ? ' · partial' : ''}`,
            value.reportJson,
            value.note,
          ].join('\n'),
        },
      ]
    },
  },
  async execute(args): Promise<VerifyToolResult> {
    if ((args.title ?? '') === '' && (args.doi ?? '') === '' && (args.arxivId ?? '') === '') {
      const report = {
        status: 'unverified',
        passed: 0,
        note: 'Rejected: supply a title, a DOI or an arXiv id. Verification needs an identity to look up.',
      }
      return {
        status: 'unverified',
        passed: 0,
        matchedSource: '',
        partial: false,
        reasonsJson: '["no-identity"]',
        reportJson: JSON.stringify(report),
        note: 'Nothing was queried: the claim had no identity.',
      }
    }
    const outcome = await verifyCandidate(
      {
        title: args.title,
        authors: args.authors,
        year: args.year,
        doi: args.doi,
        arxivId: args.arxivId,
      },
      { cache: verifyCache },
    )
    const report = outcome.report
    const note =
      report.status === 'verified'
        ? 'All three conditions passed against a live registry; this reference may enter the table.'
        : report.status === 'unverified'
          ? 'The registries could not be reached; this is not evidence the citation is wrong. Retry later.'
          : 'Kept out of the main table: the claim is not confirmed by a registry (⚠ region).'
    return {
      status: report.status,
      passed: report.passed,
      matchedSource: report.matchedSource ?? '',
      partial: report.partial,
      reasonsJson: JSON.stringify(report.reasons),
      reportJson: JSON.stringify({ report, records: outcome.lookup.records }),
      note,
    }
  },
})

const captureSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accepted: { type: 'boolean' },
    scope: { type: 'string' },
    readMode: { type: 'string' },
    turns: { type: 'integer' },
    messages: { type: 'integer' },
    chars: { type: 'integer' },
    truncated: { type: 'boolean' },
    candidatesJson: { type: 'string' },
    note: { type: 'string' },
  },
} as const

/** Tool result shape: flat on purpose, candidates travel as lossless JSON text. */
interface CaptureToolResult {
  readonly accepted: boolean
  readonly scope: string
  readonly readMode: string
  readonly turns: number
  readonly messages: number
  readonly chars: number
  readonly truncated: boolean
  readonly candidatesJson: string
  readonly note: string
}

/**
 * Pass 3 of extraction: the model states what a reference is.
 *
 * Structured fields supplied here outrank regex guesses during merge, and
 * `scope` optionally widens the answer with everything regex found in the same
 * window so the model and the scanner never produce two competing tables.
 */
function workspaceOf(session: { readonly header?: { readonly cwd?: string } } | undefined): string {
  return session?.header?.cwd ?? ''
}

function optionalService<T>(
  name: string,
  current: T | undefined,
  remember: (value: T) => void,
): T | undefined {
  if (current !== undefined) return current
  if (serviceLookup === undefined) return undefined
  try {
    const found = serviceLookup(name) as T | undefined
    if (found !== undefined) remember(found)
    return found
  } catch {
    return undefined
  }
}

function storeDeps(cwd: string, signal?: AbortSignal): StoreCommandDeps {
  const picker = optionalService<DirectoryPickerControllerLike>(
    'directoryPickerController',
    directoryPickerController,
    (value) => {
      directoryPickerController = value
    },
  )
  const fs = optionalService<HostFsLike>('fs', hostFs, (value) => {
    hostFs = value
  })
  return {
    workspace: cwd,
    ...(picker === undefined ? {} : { directoryPicker: picker }),
    ...(fs === undefined ? {} : { fs }),
    ...(signal === undefined ? {} : { signal }),
    // Manual confirmation stays off in the shipped host: it writes an
    // unverified entry into the main table. Exports do label it (BibTeX note,
    // RIS `N1`, annotated.md `⚑ manual`), so the switch is safe to flip later,
    // but not before the GUI can show that label to the user.
    allowManualConfirm: false,
    resolveIdentifiers: async (doi, arxivId) => {
      if (doi === '' && arxivId === '') return undefined
      const outcome = await verifyCandidate(
        { ...(doi === '' ? {} : { doi }), ...(arxivId === '' ? {} : { arxivId }) },
        { cache: verifyCache },
      )
      const wanted = doi.toLowerCase()
      const best =
        outcome.records.find((record) => (record.doi ?? '').toLowerCase() === wanted && wanted !== '') ??
        outcome.records.find(
          (record) => record.source === 'arxiv' && record.id.toLowerCase() === arxivId.toLowerCase(),
        ) ??
        outcome.records[0]
      return best
    },
    verify: async (ref) => {
      const outcome = await verifyCandidate(
        {
          title: ref.title,
          authors: ref.authors.map((author) => author.family ?? author.literal ?? '').filter((name) => name !== ''),
          year: ref.year,
          doi: ref.identifiers.doi,
          arxivId: ref.identifiers.arxiv,
        },
        { cache: verifyCache },
      )
      return outcome.report
    },
  }
}


const saveSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accepted: { type: 'boolean' },
    status: { type: 'string' },
    id: { type: 'string' },
    quarantined: { type: 'boolean' },
    message: { type: 'string' },
  },
} as const

const exportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
  },
} as const

export interface RefSaveToolResult {
  readonly accepted: boolean
  readonly status: string
  readonly id: string
  readonly quarantined: boolean
  readonly message: string
}

/** Persist one reference: verify first, then main table or ⚠ quarantine. */
export const refSaveTool = defineTool({
  name: 'ref_save',
  description:
    'Save one bibliographic reference to this workspace\'s refs/refs.json after running the three-condition verification (title + year ±1 + first author, all against a real registry record). Verified references enter the main table; anything else is written to refs/quarantine.json and excluded from export. Supply the annotation fields grounded in the conversation: summary (what the work says), relevance (why it matters for the user\'s task), evidence (the exact claim or quote from the conversation), caveats (limits the user should know).',
  parameters: {
    title: { type: 'string', required: true, description: 'Work title, in its original language.' },
    authors: { type: 'array', items: { type: 'string' }, description: 'Author names in citation order.' },
    year: { type: 'integer', description: 'Publication year.' },
    type: {
      type: 'string',
      enum: ['journalArticle', 'conferencePaper', 'preprint', 'report', 'thesis', 'book', 'webpage'],
      description: 'Reference type; defaults to journalArticle.',
    },
    doi: { type: 'string', description: 'DOI without the https://doi.org/ prefix.' },
    arxivId: { type: 'string', description: 'arXiv identifier, e.g. 2401.01234.' },
    isbn: { type: 'string' },
    reportNumber: { type: 'string' },
    url: { type: 'string' },
    container: { type: 'string', description: 'Journal, conference, publisher or report series.' },
    volume: { type: 'string' },
    issue: { type: 'string' },
    pages: { type: 'string' },
    language: { type: 'string', description: 'ISO 639-1 code when the work is not English, e.g. "zh".' },
    tags: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'Annotation: what the work says, in the user\'s language.' },
    relevance: { type: 'string', description: 'Annotation: why it matters for the current task.' },
    evidence: { type: 'string', description: 'Annotation: the conversation claim or quote that grounds it.' },
    caveats: { type: 'string', description: 'Annotation: limits, biases or open questions.' },
  },
  output: {
    schema: saveSchema,
    render(_args: unknown, value: RefSaveToolResult) {
      return [{ type: 'text', text: value.message }]
    },
  },
  async execute(args, exec): Promise<RefSaveToolResult> {
    const session = exec.agent?.session as unknown as
      | { readonly header?: { readonly cwd?: string } }
      | undefined
    const cwd = workspaceOf(session)
    if (cwd === '') {
      return {
        accepted: false,
        status: 'error',
        id: '',
        quarantined: false,
        message: 'no workspace: the session has no cwd, so refs/ cannot be written.',
      }
    }
    const annotation = {
      ...(args.summary ? { summary: args.summary } : {}),
      ...(args.relevance ? { relevance: args.relevance } : {}),
      ...(args.evidence ? { evidence: args.evidence } : {}),
      ...(args.caveats ? { caveats: args.caveats } : {}),
      source: 'model' as const,
      status: 'complete' as const,
    }
    const payload = {
      title: args.title,
      authors: args.authors ?? [],
      ...(args.year !== undefined ? { year: args.year } : {}),
      type: args.type ?? 'journalArticle',
      ...(args.doi ? { identifiers: { doi: args.doi } } : {}),
      ...(args.arxivId ? { identifiers: { arxiv: args.arxivId } } : {}),
      ...(args.isbn ? { identifiers: { isbn: args.isbn } } : {}),
      ...(args.reportNumber ? { identifiers: { reportNumber: args.reportNumber } } : {}),
      ...(args.container ? { containerTitle: args.container } : {}),
      ...(args.volume ? { volume: args.volume } : {}),
      ...(args.issue ? { issue: args.issue } : {}),
      ...(args.pages ? { pages: args.pages } : {}),
      ...(args.language ? { language: args.language } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
      annotation,
      provenance: {
        ...(session && 'id' in session ? {} : {}),
        trigger: 'tool' as const,
        capturedAt: new Date().toISOString(),
      },
    }
    const ids = {
      doi: args.doi,
      arxiv: args.arxivId,
      isbn: args.isbn,
      reportNumber: args.reportNumber,
    }
    const withIds = {
      ...payload,
      identifiers: Object.fromEntries(
        Object.entries(ids).filter(([, value]) => value !== undefined && value !== ''),
      ),
    }
    const result = await saveFromPayload(withIds, storeDeps(cwd))
    return {
      accepted: result.kind === 'success',
      status: result.status ?? (result.kind === 'success' ? 'stored' : 'error'),
      id: result.id ?? '',
      quarantined: result.quarantined === true,
      message: result.text,
    }
  },
})

export interface RefExportToolResult {
  readonly ok: boolean
  readonly message: string
}

/** Export the library as BibTeX and/or RIS inside the workspace. */
export const refExportTool = defineTool({
  name: 'ref_export',
  description:
    'Export this workspace\'s verified references to refs/exports/ as BibTeX and/or RIS. Quarantined (⚠) entries are excluded unless includeQuarantine is true. Both exporters are deterministic: re-exporting an unchanged library yields identical bytes, which keeps diffs and golden tests meaningful.',
  parameters: {
    format: {
      type: 'string',
      enum: ['bibtex', 'ris', 'both'],
      description: 'Defaults to both.',
    },
    out: {
      type: 'string',
      description: 'Workspace-relative path; only valid with a single format. Defaults to refs/exports/refs-<timestamp>.<ext>.',
    },
    includeQuarantine: {
      type: 'boolean',
      description: 'Include ⚠ entries. Default false: they never leave the workspace by default.',
    },
    all: {
      type: 'boolean',
      description:
        'Export the whole library. Default false exports only the last capture batch (what the user just captured); pass true when the user asks for the complete bibliography.',
    },
  },
  output: {
    schema: exportSchema,
    render(_args: unknown, value: RefExportToolResult) {
      return [{ type: 'text', text: value.message }]
    },
  },
  async execute(args, exec): Promise<RefExportToolResult> {
    const session = exec.agent?.session as unknown as
      | { readonly header?: { readonly cwd?: string } }
      | undefined
    const cwd = workspaceOf(session)
    if (cwd === '') {
      return { ok: false, message: 'no workspace: the session has no cwd.' }
    }
    const result = await exportLibrary(
      {
        format: args.format ?? 'both',
        ...(args.out ? { out: args.out } : {}),
        includeQuarantine: args.includeQuarantine ?? false,
        all: args.all ?? false,
      },
      { workspace: cwd },
    )
    return { ok: result.kind === 'success', message: result.text }
  },
})

export const refCaptureTool = defineTool({
  name: 'ref_capture',
  description:
    'Capture a bibliographic reference from the current conversation. Pass the fields you can ground in the conversation (title, authors, year, DOI, arXiv id, ISBN, report number, container, pages); fields you omit are left for regex extraction and later verification. With scope="turn"|"lastN"|"all" the result is merged with every reference found in that conversation window. This tool only previews candidates; `/refs capture --save` or ref_save verifies and stores them.',
  parameters: {
    title: { type: 'string', description: 'Work title, in the language it appears in the conversation.' },
    authors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Author names in citation order, e.g. ["Zhang, S.", "Li, W."].',
    },
    year: { type: 'integer', description: 'Publication year (four digits).' },
    type: {
      type: 'string',
      enum: ['journalArticle', 'conferencePaper', 'preprint', 'report', 'thesis', 'book', 'webpage'],
      description: 'Reference type; defaults to journalArticle.',
    },
    doi: { type: 'string', description: 'DOI without the https://doi.org/ prefix.' },
    arxivId: { type: 'string', description: 'arXiv identifier, e.g. 2401.01234 or 2401.01234v2.' },
    isbn: { type: 'string', description: 'ISBN for books.' },
    reportNumber: { type: 'string', description: 'Technical report number, e.g. NUREG/CR-1234, PB123456.' },
    url: { type: 'string', description: 'Canonical URL when no persistent identifier exists.' },
    container: { type: 'string', description: 'Journal, conference, publisher or report series name.' },
    volume: { type: 'string' },
    issue: { type: 'string' },
    pages: { type: 'string', description: 'Page range or article number, e.g. 45-67 or e12345.' },
    scope: {
      type: 'string',
      enum: ['turn', 'lastN', 'all'],
      description: 'Also scan this conversation window with regex extraction and merge the results.',
    },
    turns: { type: 'integer', description: 'N for scope="lastN" (1..500, default 5).' },
    includeTools: {
      type: 'boolean',
      description: 'Include tool outputs in the scan. Default false because search results and plugin output are noisy.',
    },
    evidence: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Session seq numbers where the reference appears, when known.',
    },
  },
  output: {
    schema: captureSchema,
    render(_args: unknown, value: CaptureToolResult) {
      const candidates = JSON.parse(value.candidatesJson) as unknown[]
      return [
        {
          type: 'text',
          text: [
            `accepted: ${String(value.accepted)} · scope: ${value.scope} · read: ${value.readMode}`,
            `candidates: ${String(candidates.length)}`,
            value.candidatesJson,
            value.note,
          ].join('\n'),
        },
      ]
    },
  },
  async execute(args, exec): Promise<CaptureToolResult> {
    const hasIdentity =
      (args.title ?? '') !== '' ||
      (args.doi ?? '') !== '' ||
      (args.arxivId ?? '') !== '' ||
      (args.isbn ?? '') !== '' ||
      (args.reportNumber ?? '') !== '' ||
      (args.url ?? '') !== ''
    // A window-only capture (`scope` without fields) is a lookup, not a claim:
    // it must stay legal so the model can ask "what does this conversation
    // contain" without inventing a title first.
    if (!hasIdentity && args.scope === undefined) {
      return {
        accepted: false,
        scope: 'none',
        readMode: 'none',
        turns: 0,
        messages: 0,
        chars: 0,
        truncated: false,
        candidatesJson: '[]',
        note: 'Rejected: supply at least one of title, doi, arxivId, isbn, reportNumber or url. A reference with no identity cannot be verified or deduped.',
      }
    }

    const modelInput: ModelCandidateInput = {
      title: args.title ?? '',
      authors: args.authors,
      year: args.year,
      type: args.type,
      doi: args.doi,
      arxivId: args.arxivId,
      isbn: args.isbn,
      reportNumber: args.reportNumber,
      url: args.url,
      container: args.container,
      volume: args.volume,
      issue: args.issue,
      pages: args.pages,
      evidence: args.evidence,
    }
    // Model-named seqs are unverified input: with no window read there is
    // nothing to check them against, so only non-negative integers survive.
    // Without an identity the model contributed nothing to merge: an empty
    // candidate would otherwise show up as a phantom row in every window scan.
    const fromModel = hasIdentity
      ? candidateFromModel({
          ...modelInput,
          evidence: sanitizeEvidence(modelInput.evidence ?? [], undefined),
        })
      : undefined

    const scopeArg = args.scope ?? ''
    const session = exec.agent?.session as SessionLike | undefined
    if (scopeArg === '') {
      return {
        accepted: true,
        scope: 'model-only',
        readMode: 'none',
        turns: 0,
        messages: 0,
        chars: 0,
        truncated: false,
        candidatesJson: JSON.stringify(fromModel === undefined ? [] : [fromModel]),
        note: 'Nothing persisted by this tool: it previews candidates. `/refs capture --save` verifies and stores them; entries that fail verification go to refs/quarantine.json.',
      }
    }
    if (session === undefined) {
      return {
        accepted: true,
        scope: scopeArg,
        readMode: 'none',
        turns: 0,
        messages: 0,
        chars: 0,
        truncated: false,
        candidatesJson: JSON.stringify(fromModel === undefined ? [] : [fromModel]),
        note: 'No live session is reachable from this tool, so scope scanning was skipped; only the model-supplied fields are reported.',
      }
    }

    const run = await collectCapture(
      session,
      scopeArg,
      args.turns === undefined ? '' : String(args.turns),
      sessionQuery,
      outlineTurnStarts(session),
      args.includeTools ?? false,
    )
    if ('error' in run) {
      return {
        accepted: false,
        scope: scopeArg,
        readMode: 'none',
        turns: 0,
        messages: 0,
        chars: 0,
        truncated: false,
        candidatesJson: JSON.stringify(fromModel === undefined ? [] : [fromModel]),
        note: `Rejected: ${run.error}`,
      }
    }

    // In the scoped path the read window *is* the ground truth: keep only the
    // seqs the model pointed at that were actually read.
    const window = new Set(run.read.segments.map((segment) => segment.seq))
    const groundedModel = hasIdentity
      ? candidateFromModel({
          ...modelInput,
          evidence: sanitizeEvidence(modelInput.evidence ?? [], window),
        })
      : undefined
    const byKey = new Map<string, Candidate>()
    const found = groundedModel === undefined ? run.candidates : [...run.candidates, groundedModel]
    for (const candidate of found) {
      const existing = byKey.get(candidate.key)
      byKey.set(candidate.key, existing === undefined ? candidate : mergeCandidates(existing, candidate))
    }
    const merged = rankCandidates([...byKey.values()])
    return {
      accepted: true,
      scope: describeScope(run.scope),
      readMode: run.read.readMode,
      turns: run.read.resolution.turns,
      messages: run.read.segments.length,
      chars: run.read.chars,
      truncated: run.read.truncated,
      candidatesJson: JSON.stringify(merged),
      note: 'Nothing persisted by this tool: candidate preview only. Model-supplied fields outrank regex guesses on merge; `/refs capture --save` stores the verified ones.',
    }
  },
})

/**
 * Host plugin. Registers the diagnostic tool, the capture tool, and the `/refs`
 * command over one shared read/extract path.
 */
export default class RefkeeperService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, SERVICE_KEY)
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projections = (projectionCtx as unknown as { sessionProjections: ProjectionReader })
        .sessionProjections
    })
    ctx.inject(['sessionQuery'], (queryCtx) => {
      sessionQuery = (queryCtx as unknown as { sessionQuery: SessionQueryLike }).sessionQuery
    })
    const getOptionalService = (ctx as unknown as { get?: (name: string) => unknown }).get
    serviceLookup =
      getOptionalService === undefined
        ? undefined
        : (name: string) => getOptionalService.call(ctx, name) as unknown
    try {
      directoryPickerController = getOptionalService?.call(ctx, 'directoryPickerController') as
        | DirectoryPickerControllerLike
        | undefined
    } catch {
      directoryPickerController = undefined
    }
    try {
      hostFs = getOptionalService?.call(ctx, 'fs') as HostFsLike | undefined
    } catch {
      hostFs = undefined
    }
    if (process.env['REFKEEPER_DEBUG'] !== undefined) {
      console.error(`[refkeeper] mounted ${PACKAGE_NAME} (sdk ${probeSdkVersion() ?? 'unknown'})`)
    }
    ctx.effect(() => ctx.tools.register(refPingTool), 'dsh-refkeeper: ref_ping tool')
    ctx.effect(() => ctx.tools.register(refCaptureTool), 'dsh-refkeeper: ref_capture tool')
    ctx.effect(() => ctx.tools.register(refVerifyTool), 'dsh-refkeeper: ref_verify tool')
    ctx.effect(() => ctx.tools.register(refSaveTool), 'dsh-refkeeper: ref_save tool')
    ctx.effect(() => ctx.tools.register(refExportTool), 'dsh-refkeeper: ref_export tool')
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(
        () =>
          commandCtx.commands.register({
            definitionId: CommandDefinitionId(`${PACKAGE_NAME}/refs`),
            name: 'refs',
            description: 'Capture, verify, store and export references for this workspace',
            input: {
              hint: '[status|capture|verify|save|list|export|dir] …',
            },
            handler: async (invocation) => {
              const raw = invocation.rawInput.trim()
              if (raw === 'verify' || raw.startsWith('verify ') || raw.startsWith('verify\t')) {
                return await runVerifyCommand(raw.slice('verify'.length), {
                  verify: (claim: VerificationClaim) => verifyCandidate(claim, { cache: verifyCache }),
                })
              }
              const session = invocation.agent.session as unknown as SessionLike
              const cwd = workspaceOf(session)
              // Route by the parsed subcommand rather than a hand-written prefix
              // list: `dir` (and any future subcommand) must reach the store
              // module instead of falling through to `runRefsCommand`, which
              // answers `unknown subcommand "dir"`.
              const sub = /^([a-z]+)/u.exec(raw)?.[1] ?? ''
              if (isStoreSubcommand(sub)) {
                if (cwd === '') {
                  return { kind: 'error', text: 'no workspace: the session has no cwd.' }
                }
                return await runStoreCommand(raw, storeDeps(cwd, invocation.signal))
              }
              const result = await runRefsCommand(
                raw,
                session,
                {
                  query: sessionQuery,
                  sdkVersion: probeSdkVersion() ?? 'unknown',
                  turnStarts: outlineTurnStarts,
                  save: async (candidates) => {
                    const summary = await saveCaptured(candidates, {
                      resolveIdentifier: async (candidate) => {
                        const outcome = await verifyCandidate(
                          {
                            doi: candidate.doi,
                            arxivId: candidate.arxivId,
                          },
                          { cache: verifyCache },
                        )
                        const matched = outcome.records.find(
                          (record) => record.source === outcome.report.matchedSource && record.title.trim() !== '',
                        )
                        return matched ?? outcome.records.find((record) => record.title.trim() !== '')
                      },
                      save: async (payload) => {
                        const stored = await saveFromPayload(payload, storeDeps(cwd))
                        return {
                          kind: stored.kind,
                          quarantined: stored.quarantined,
                          id: stored.id,
                          reason: stored.status,
                          fields: fieldsOfReference(stored.reference),
                        }
                      },
                    })
                    if (summary.entries === undefined || summary.entries.length === 0) return summary
                    const batch: CaptureBatch = {
                      capturedAt: new Date().toISOString(),
                      scope: scopeLabelOf(raw),
                      entries: summary.entries,
                    }
                    const persisted = await writeBatch(cwd, batch)
                    return persisted ? { ...summary, batch } : summary
                  },
                },
              )
              return result
            },
          }),
        'dsh-refkeeper: /refs command',
      )
    })
  }
}
