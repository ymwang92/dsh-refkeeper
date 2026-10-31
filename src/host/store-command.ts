import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { encodeDir } from '../core/panel.ts'
import { stripMarkup } from '../core/text.ts'
import { EXPORT_EXTENSIONS, renderExport } from '../export/index.ts'
import type { ExportFormat } from '../export/index.ts'
import { writeFileAtomic } from '../store/atomic.ts'
import {
  coerceReference,
  loadQuarantine,
  loadStore,
  saveQuarantined,
  saveReference,
  storePaths,
  writeQuarantine,
  writeStore,
} from '../store/io.ts'
import { exportableOf, readBatch } from './capture-batch.ts'
import type { CaptureBatch } from './capture-batch.ts'
import { SCHEMA_VERSION, StoreError, referenceId } from '../store/types.ts'
import type { RefVerification, StoredReference, StoredVerificationStatus } from '../store/types.ts'
import type { SourceRecord, VerificationReport } from '../verify/types.ts'

export const STORE_USAGE = [
  'usage:',
  '  /refs save {"title":"…","doi":"…","year":2024,…}   verify, then store',
  '  /refs save --payload=<base64url(json)>             lossless, any characters',
  "  /refs save --json='{…}'                            same, but the shell-style",
  '                                                    tokenizer eats the quotes',
  '  /refs list [--limit=N] [--quarantine]              inspect the library',
  '  /refs edit --id=<id> --payload=<base64url(json)>   correct one entry\'s fields',
  '  /refs enrich [--quarantine]                        refill missing fields from registries',
  '  /refs remove <id|doi|arxiv>... [--quarantine]      delete specific entries',
  '  /refs remove --all --yes [--quarantine]            empty the table',
  '  /refs export [--format=bibtex|ris|both] [--out=path] [--include-quarantine]',
  '  /refs export [--ids=id,id] [--choose-dir] [--all]  panel tick-box selection',
  '  /refs dir [--set=<base64url(path)>|--clear]         default export folder',
  'export defaults to the references captured by the last `/refs capture --save`;',
  'add --all to export the whole library instead. Without --out, files go to the',
  'folder set by `/refs dir --set=…`, else to refs/exports/ in the workspace.',
  '',
  'Only `verified` references enter the main table; everything else lands in',
  'refs/quarantine.json and is excluded from export unless --include-quarantine.',
].join('\n')

/**
 * Every subcommand `/refs` routes to this module. Exported so the command
 * handler in `index.ts` cannot drift from the parser: a subcommand accepted
 * here but missing from that routing list reaches `runRefsCommand` and is
 * reported as `unknown subcommand`, which is exactly what happened to `dir`.
 */
export const STORE_SUBCOMMANDS = ['save', 'export', 'list', 'remove', 'edit', 'enrich', 'dir'] as const

export type StoreSubcommand = (typeof STORE_SUBCOMMANDS)[number]

export function isStoreSubcommand(value: string): value is StoreSubcommand {
  return (STORE_SUBCOMMANDS as readonly string[]).includes(value)
}

export interface ParsedStoreCommand {
  readonly sub: StoreSubcommand
  /** base64url-encoded JSON; prefer this over `json`, which cannot carry quotes. */
  readonly payload: string
  readonly json: string
  readonly format: ExportFormat | 'both'
  readonly out: string
  readonly limit: number
  readonly quarantine: boolean
  readonly includeQuarantine: boolean
  readonly chooseDir: boolean
  /** `dir --choose`: ask the host picker for the default export folder. */
  readonly dirChoose: boolean
  /** `dir --clear`: forget the default export folder. */
  readonly dirClear: boolean
  /** `dir --set=<payload>`: base64url-encoded folder typed or pasted in the panel. */
  readonly dirPath: string
  /** `remove` targets: reference ids, DOIs or arXiv ids. */
  readonly targets: readonly string[]
  /** `export --ids=…`: exactly these references, from either table. */
  readonly ids: readonly string[]
  readonly all: boolean
  readonly yes: boolean
}

function tokenize(raw: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/u.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}

/** Decode the panel's base64url id list; reference ids may carry spaces and quotes. */
function decodeIdsPayload(payload: string): string[] | { readonly error: string } {
  try {
    const text = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return { error: '--ids expects a JSON array of reference ids' }
    const ids: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string' || item === '') return { error: '--ids expects a JSON array of reference ids' }
      ids.push(item)
    }
    if (ids.length === 0) return { error: '--ids needs at least one reference id' }
    return ids
  } catch {
    return { error: '--ids payload is not valid base64url-encoded JSON' }
  }
}

export function parseStoreCommand(raw: string): ParsedStoreCommand | { readonly error: string } {
  const trimmed = raw.trim()
  const sub = /^([a-z]+)/u.exec(trimmed)?.[1] ?? ''
  if (!isStoreSubcommand(sub)) {
    return { error: `unknown subcommand "${sub === '' ? '(empty)' : sub}"` }
  }
  const rest = trimmed.slice(sub.length).trim()
  const tokens = tokenize(rest)
  const parsed: ParsedStoreCommand = {
    sub,
    payload: '',
    json: '',
    format: 'both',
    out: '',
    limit: 10,
    quarantine: false,
    includeQuarantine: false,
    chooseDir: false,
    dirChoose: false,
    dirClear: false,
    dirPath: '',
    targets: [],
    ids: [],
    all: false,
    yes: false,
  }
  const out: { -readonly [K in keyof ParsedStoreCommand]: ParsedStoreCommand[K] } = { ...parsed }
  const targets: string[] = []

  for (const token of tokens) {
    if (token === '--quarantine') {
      out.quarantine = true
      continue
    }
    if (token === '--include-quarantine') {
      out.includeQuarantine = true
      continue
    }
    if (token === '--choose-dir') {
      out.chooseDir = true
      continue
    }
    if (token === '--choose') {
      out.dirChoose = true
      continue
    }
    if (token === '--clear') {
      out.dirClear = true
      continue
    }
    const dirPath = /^--set=(.*)$/u.exec(token)
    if (dirPath) {
      out.dirPath = dirPath[1] ?? ''
      continue
    }
    if (token === '--all') {
      out.all = true
      continue
    }
    if (token === '--yes') {
      out.yes = true
      continue
    }
    const payload = /^--payload=(.*)$/u.exec(token)
    if (payload) {
      out.payload = payload[1] ?? ''
      continue
    }
    const json = /^--json=(.*)$/u.exec(token)
    if (json) {
      out.json = json[1] ?? ''
      continue
    }
    const format = /^--format=(bibtex|ris|both)$/u.exec(token)
    if (format) {
      out.format = format[1] as ExportFormat | 'both'
      continue
    }
    const outPath = /^--out=(.+)$/u.exec(token)
    if (outPath) {
      out.out = outPath[1] ?? ''
      continue
    }
    const limit = /^--limit=(\d+)$/u.exec(token)
    if (limit) {
      out.limit = Number(limit[1])
      continue
    }
    const editId = /^--id=(.+)$/u.exec(token)
    if (editId) {
      out.targets = [editId[1] ?? '']
      targets.push(editId[1] ?? '')
      continue
    }
    const ids = /^--ids=(.*)$/u.exec(token)
    if (ids) {
      const decoded = decodeIdsPayload(ids[1] ?? '')
      if (!Array.isArray(decoded)) return decoded
      out.ids = decoded
      continue
    }
    if (token.startsWith('--')) return { error: `unknown option "${token}"` }
    if (sub === 'remove') {
      targets.push(token)
      continue
    }
    if (sub === 'save' && out.json === '') {
      out.json = token
      continue
    }
    return { error: `unexpected argument "${token}"` }
  }
  out.targets = targets

  if (sub === 'save' && out.payload === '' && out.json === '') {
    return { error: 'save needs a JSON payload (--payload=<base64url> or --json=<json>)' }
  }
  if (sub === 'export' && out.format === 'both' && out.out !== '') {
    return { error: '--out needs a single --format; both formats write two files' }
  }
  if (out.chooseDir && sub !== 'export') return { error: '--choose-dir is valid only for export' }
  if (out.chooseDir && out.out !== '') return { error: '--choose-dir cannot be combined with --out' }
  if (out.ids.length > 0 && sub !== 'export' && sub !== 'edit') {
    return { error: '--ids is valid only for export or edit' }
  }
  if (out.ids.length > 0 && out.all) return { error: '--ids cannot be combined with --all' }
  if ((out.dirChoose || out.dirClear || out.dirPath !== '') && sub !== 'dir') {
    return { error: '--choose, --set and --clear are valid only for dir' }
  }
  if (sub === 'dir') {
    const modes = [out.dirChoose, out.dirClear, out.dirPath !== ''].filter(Boolean).length
    if (modes > 1) return { error: 'dir takes only one of --choose, --set or --clear' }
    if (
      out.all ||
      out.ids.length > 0 ||
      targets.length > 0 ||
      out.payload !== '' ||
      out.json !== '' ||
      out.out !== '' ||
      out.chooseDir ||
      out.quarantine ||
      out.includeQuarantine ||
      out.yes
    ) {
      return { error: 'dir takes only --set, --choose or --clear' }
    }
    return out
  }
  if (sub === 'remove') {
    if (out.all && targets.length > 0) return { error: '--all cannot be combined with explicit ids' }
    if (!out.all && targets.length === 0) return { error: 'remove needs at least one id, DOI or arXiv id (or --all --yes)' }
    if (out.all && !out.yes) return { error: 'remove --all deletes every entry; add --yes to confirm' }
    return out
  }
  if (sub === 'edit') {
    const chosen = targets.length > 0 ? targets : [...out.ids]
    if (chosen.length !== 1) return { error: 'edit needs exactly one reference id (--id=<id> or --ids=<payload>)' }
    if (out.payload === '') return { error: 'edit needs --payload=<base64url(json)> with the fields to change' }
    if (out.all || out.quarantine) return { error: 'edit takes a single reference; no --all or --quarantine' }
    out.targets = chosen
    return out
  }
  if (sub === 'enrich') {
    if (out.all || out.ids.length > 0 || targets.length > 0 || out.payload !== '' || out.out !== '' || out.chooseDir) {
      return { error: 'enrich takes no arguments besides --quarantine' }
    }
    return out
  }
  if (out.yes) return { error: '--yes is valid only for remove --all' }
  if (out.all && sub !== 'export') return { error: '--all is valid only for export or remove' }
  if (out.limit < 1 || out.limit > 500) return { error: '--limit must be between 1 and 500' }
  return out
}

export interface DirectoryPickerControllerLike {
  pick(signal: AbortSignal): Promise<string | null>
}

export interface FsTargetLike {
  readonly displayPath: string
}

/** The host's per-call sandbox fence: same permission mode, explicit workspace root. */
export interface SandboxPolicyLike {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly workspaceRoot: string
}

export interface HostFsLike {
  resolve(path: string, opts?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<FsTargetLike>
  stat(target: FsTargetLike, signal?: AbortSignal): Promise<{ readonly type: 'file' | 'directory' | 'other' } | undefined>
  processPath(target: FsTargetLike): string
  /** Canonical containment check; both targets must come from this provider. */
  contains?(parent: FsTargetLike, child: FsTargetLike): boolean
  writeText(
    target: FsTargetLike,
    content: string,
    expected: { readonly kind: 'createIfAbsent' },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxPolicyLike,
  ): Promise<unknown>
}

export interface StoreCommandDeps {
  /** Workspace root; every default path stays inside it. */
  readonly workspace: string
  readonly verify?: ((ref: StoredReference) => Promise<VerificationReport>) | undefined
  readonly allowManualConfirm?: boolean | undefined
  readonly now?: (() => string) | undefined
  readonly directoryPicker?: DirectoryPickerControllerLike | undefined
  readonly fs?: HostFsLike | undefined
  readonly signal?: AbortSignal | undefined
  /**
   * Registry lookup used by `/refs enrich` to backfill entries that were stored
   * before the bibliographic fields were parsed (or captured from a bare DOI).
   */
  readonly resolveIdentifiers?:
    | ((doi: string, arxivId: string) => Promise<SourceRecord | undefined>)
    | undefined
}

export interface StoreCommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

function verificationOf(ref: StoredReference, report: VerificationReport, now: string): RefVerification {
  return {
    status: report.status,
    checkedAt: now,
    passed: report.passed,
    checks: {
      title: report.title.score >= 0 ? report.title.score : 0,
      firstAuthor: report.firstAuthor.pass,
    },
    sources: report.sources,
    reasons: report.reasons,
    ...(report.partial ? { note: 'partial: at least one source errored or timed out' } : {}),
  }
}

function insideWorkspace(workspace: string, target: string): string {
  const root = resolve(workspace)
  const full = resolve(root, target)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new StoreError('invalid-reference', `refusing to write outside the workspace: ${target}`)
  }
  return full
}

function stamp(now: string): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

function buildReference(
  payload: unknown,
  deps: StoreCommandDeps,
  now: string,
): StoredReference {
  const base = coerceReference(payload, now)
  if (!base) {
    throw new StoreError('invalid-reference', 'payload needs at least a non-empty `title`')
  }
  const provenance = {
    ...base.provenance,
    trigger: base.provenance.trigger ?? ('command' as const),
    capturedAt: base.provenance.capturedAt || now,
  }
  return { ...base, id: referenceId(base), provenance, addedAt: base.addedAt || now, updatedAt: now }
}

export interface SaveResult extends StoreCommandResult {
  readonly status?: StoredVerificationStatus
  readonly id?: string
  readonly quarantined?: boolean
  readonly count?: number
  /** The record as written, so callers can mirror its fields (panel snapshots). */
  readonly reference?: StoredReference
}

/** Verify then persist one payload. Shared by `/refs save` and `ref_save`. */
export async function saveFromPayload(
  payload: unknown,
  deps: StoreCommandDeps,
): Promise<SaveResult> {
  const now = deps.now?.() ?? new Date().toISOString()

  let ref: StoredReference
  try {
    ref = buildReference(payload, deps, now)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }

  let report: VerificationReport | undefined
  if (deps.verify) {
    report = await deps.verify(ref)
  }
  const status = report?.status ?? (deps.allowManualConfirm ? 'manual' : undefined)
  if (status === undefined) {
    return {
      kind: 'error',
      text: 'no verifier available on this host: pass --verify support, or enable manual confirmation (default off).',
    }
  }

  const verification: RefVerification =
    report !== undefined
      ? verificationOf(ref, report, now)
      : { status: 'manual', checkedAt: now, note: 'stored without registry verification (manual confirmation)' }
  const stored: StoredReference = { ...ref, verification }

  const accepted = verification.status === 'verified' || verification.status === 'manual'
  try {
    if (accepted) {
      const outcome = await saveReference(deps.workspace, stored, { now })
      return {
        kind: 'success',
        status: verification.status,
        id: stored.id,
        quarantined: false,
        reference: stored,
        count: outcome.state.references.length,
        text: [
          `${outcome.replaced ? 'updated' : 'saved'} ${stored.id} → refs/refs.json`,
          `verification: ${verification.status}${verification.passed !== undefined ? ` ${String(verification.passed)}/3` : ''}`,
          `library: ${String(outcome.state.references.length)} reference(s)`,
        ].join('\n'),
      }
    }
    const next = await saveQuarantined(deps.workspace, stored, { now })
    return {
      kind: 'success',
      status: verification.status,
      id: stored.id,
      quarantined: true,
      reference: stored,
      count: next.entries.length,
      text: [
        `⚠ quarantined ${stored.id} → refs/quarantine.json`,
        `verification: ${verification.status}${verification.passed !== undefined ? ` ${String(verification.passed)}/3` : ''}${verification.reasons && verification.reasons.length > 0 ? ` · ${verification.reasons.join(', ')}` : ''}`,
        KEPT_OUT,
        `quarantine: ${String(next.entries.length)} entr${next.entries.length === 1 ? 'y' : 'ies'}`,
      ].join('\n'),
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

const KEPT_OUT = 'Kept out of the main table; it is not exported unless you pass --include-quarantine.'

/** Decode the base64url payload written by the composer panel. */
export function decodePayload(encoded: string): string {
  const base64 = encoded.replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

async function runSave(parsed: ParsedStoreCommand, deps: StoreCommandDeps): Promise<StoreCommandResult> {
  let payload: unknown
  try {
    payload = JSON.parse(parsed.payload === '' ? parsed.json : decodePayload(parsed.payload)) as unknown
  } catch (error) {
    return {
      kind: 'error',
      text: `save payload is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return await saveFromPayload(payload, deps)
}

interface ExportScope {
  /** References the export should contain. */
  readonly refs: readonly StoredReference[]
  /** How many references the library holds, for the "N of M" line. */
  readonly total: number
  readonly quarantined: number
  /** Human description of what was selected. */
  readonly label: string
}

/**
 * Default export scope: the references the last capture actually stored.
 *
 * Exporting the whole library by default is what made "capture 3, export 29"
 * look like a bug. `--all` restores the old behaviour, and an absent, stale or
 * empty batch falls back to the library with an explicit label so the output
 * never silently claims to be a capture.
 */
/** Persisted panel settings; kept beside the reference store. */
export interface StoreSettings {
  /** Absolute folder `/refs export` writes into when no `--out` is given. */
  readonly defaultExportDir?: string
}

function settingsPath(workspace: string): string {
  return join(storePaths(workspace).dir, 'settings.json')
}

async function readSettings(workspace: string): Promise<StoreSettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(workspace), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const dir = (parsed as { defaultExportDir?: unknown }).defaultExportDir
    // A malformed settings file must not break capture or export: fall back to
    // the workspace's refs/exports/ rather than failing the command.
    return typeof dir === 'string' && dir !== '' ? { defaultExportDir: dir } : {}
  } catch {
    return {}
  }
}

async function writeSettings(workspace: string, settings: StoreSettings): Promise<void> {
  await mkdir(storePaths(workspace).dir, { recursive: true })
  await writeFileAtomic(settingsPath(workspace), `${JSON.stringify(settings, null, 2)}\n`)
}

async function resolveExportScope(
  workspace: string,
  includeQuarantine: boolean,
  all: boolean,
  now: string,
  ids: readonly string[] = [],
): Promise<ExportScope> {
  const main = [...(await loadStore(workspace, { now })).state.references]
  const quarantine = await loadQuarantine(workspace, { now })
  if (ids.length > 0) {
    // An explicit selection is the tick-box list from the panel: it may name
    // quarantined entries, which is why the quarantine table joins the pool.
    const wanted = new Set(ids)
    const refs = [...main, ...quarantine.entries].filter((ref) => wanted.has(ref.id))
    const quarantined = refs.filter((ref) => quarantine.entries.some((entry) => entry.id === ref.id)).length
    return {
      refs,
      total: main.length + quarantine.entries.length,
      quarantined,
      label: 'your selection',
    }
  }

  let refs = main
  let quarantined = 0
  if (includeQuarantine) {
    quarantined = quarantine.entries.length
    refs = [...refs, ...quarantine.entries]
  }
  const total = refs.length
  if (all) return { refs, total, quarantined, label: 'whole library' }

  const batch: CaptureBatch | undefined = await readBatch(workspace)
  if (batch === undefined) {
    return { refs, total, quarantined, label: 'whole library (no capture recorded yet)' }
  }
  const selected = new Set(exportableOf(batch, includeQuarantine))
  const picked = refs.filter((ref) => selected.has(ref.id))
  if (picked.length === 0) {
    return { refs, total, quarantined, label: 'whole library (the last capture stored nothing exportable)' }
  }
  return { refs: picked, total, quarantined, label: 'the last capture' }
}

export interface ExportOptions {
  readonly format: ExportFormat | 'both'
  readonly out?: string
  readonly includeQuarantine?: boolean
  /** Exactly these references (panel tick-boxes); overrides the batch scope. */
  readonly ids?: readonly string[]
  /** Export the whole library instead of the last capture batch. */
  readonly all?: boolean
}

/** Render and write the library. Shared by `/refs export` and `ref_export`. */
export async function exportLibrary(
  options: ExportOptions,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const parsed = {
    format: options.format,
    out: options.out ?? '',
    includeQuarantine: options.includeQuarantine ?? false,
  }
  const now = deps.now?.() ?? new Date().toISOString()
  if (parsed.out === '' && deps.fs !== undefined) {
    const settings = await readSettings(deps.workspace)
    if (settings.defaultExportDir !== undefined) {
      // The folder chosen in the panel wins over refs/exports/, so both export
      // buttons always land where the user last pointed them.
      return await exportToChosenDirectory(
        {
          format: options.format,
          includeQuarantine: parsed.includeQuarantine,
          all: options.all ?? false,
          ids: options.ids ?? [],
        },
        deps,
        settings.defaultExportDir,
      )
    }
  }
  const paths = storePaths(deps.workspace)
  const scope = await resolveExportScope(
    deps.workspace,
    parsed.includeQuarantine,
    options.all ?? false,
    now,
    options.ids ?? [],
  )
  const refs = [...scope.refs]
  const quarantined = scope.quarantined
  if (refs.length === 0) {
    // Nothing to export is a normal state, not a failure: capture only produces
    // candidates, so an empty library is the expected first-run outcome.
    return {
      kind: 'success',
      text: parsed.includeQuarantine
        ? 'library and quarantine are empty — nothing to export yet.'
        : 'library is empty — nothing to export yet. Save a reference first (panel 手动添加, or the model\'s ref_save); ⚠ entries need --include-quarantine.',
    }
  }

  const formats: ExportFormat[] =
    parsed.format === 'both' ? ['bibtex', 'ris'] : [parsed.format]
  const written: string[] = []
  for (const format of formats) {
    const target =
      parsed.out !== ''
        ? parsed.out
        : join('refs', 'exports', `refs-${stamp(now)}.${EXPORT_EXTENSIONS[format]}`)
    const full = insideWorkspace(deps.workspace, target)
    const text = renderExport(format, refs)
    await writeFileAtomic(full, text)
    written.push(`${full} (${String(Buffer.byteLength(text, 'utf8'))} B)`)
  }
  return {
    kind: 'success',
    text: [
      `exported ${String(refs.length)} of ${String(scope.total)} reference(s) — ${scope.label}${quarantined > 0 ? `, including ${String(quarantined)} quarantined` : ''}`,
      ...(scope.label === 'the last capture' ? ['  (the whole library is `/refs export --all`)'] : []),
      ...written.map((line) => `  ${line}`),
    ].join('\n'),
  }
}

async function exportToChosenDirectory(
  options: Pick<ExportOptions, 'format' | 'includeQuarantine' | 'all' | 'ids'>,
  deps: StoreCommandDeps,
  presetDirectory?: string,
): Promise<StoreCommandResult> {
  const picker = deps.directoryPicker
  const fs = deps.fs
  if (fs === undefined || (presetDirectory === undefined && picker === undefined)) {
    return {
      kind: 'error',
      text: 'Choosing an export directory is unavailable on this host (directory picker or sandboxed filesystem service is missing). No files were written.',
    }
  }

  const signal = deps.signal ?? new AbortController().signal
  const now = deps.now?.() ?? new Date().toISOString()
  const scope = await resolveExportScope(
    deps.workspace,
    options.includeQuarantine ?? false,
    options.all ?? false,
    now,
    options.ids ?? [],
  )
  const refs = [...scope.refs]
  const quarantined = scope.quarantined
  if (refs.length === 0) {
    return {
      kind: 'success',
      text: options.includeQuarantine
        ? 'library and quarantine are empty — nothing to export yet.'
        : 'library is empty — nothing to export yet. Save a reference first; ⚠ entries need --include-quarantine.',
    }
  }

  let selectedPath: string | null
  if (presetDirectory !== undefined) {
    selectedPath = presetDirectory
  } else {
    try {
      selectedPath = await picker!.pick(signal)
    } catch (error) {
      return { kind: 'error', text: `directory picker failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (selectedPath === null) return { kind: 'success', text: 'export cancelled; no files were written.' }
  }

  const formats: ExportFormat[] = options.format === 'both' ? ['bibtex', 'ris'] : [options.format]
  const written: string[] = []
  const failures: string[] = []
  try {
    const directoryTarget = await fs.resolve(selectedPath, { signal })
    const directoryInfo = await fs.stat(directoryTarget, signal)
    if (directoryInfo?.type !== 'directory') {
      return { kind: 'error', text: 'The selected path is not an accessible directory; no files were written.' }
    }
    const canonicalDirectory = fs.processPath(directoryTarget)
    if (fs.contains !== undefined) {
      // A picked folder outside the session workspace cannot be written under
      // workspace-write, so say so before attempting (and failing) per file.
      const workspaceTarget = await fs.resolve(deps.workspace, { signal })
      if (!fs.contains(workspaceTarget, directoryTarget)) {
        return {
          kind: 'error',
          text: [
            'the selected folder is outside this session\'s workspace, so the workspace-write sandbox refuses to write there. No files were written.',
            `  folder: ${canonicalDirectory}`,
            `  workspace: ${deps.workspace}`,
            'Choose a folder inside the workspace (the default target is `refs/exports/` in it), or reopen the session with a wider file policy.',
          ].join('\n'),
        }
      }
    }
    const sandboxPolicy: SandboxPolicyLike = { mode: 'workspace-write', workspaceRoot: deps.workspace }
    for (const format of formats) {
      const filename = `refs-${stamp(now)}.${EXPORT_EXTENSIONS[format]}`
      let filePath = join(canonicalDirectory, filename)
      try {
        const fileTarget = await fs.resolve(filePath, { signal })
        filePath = fs.processPath(fileTarget)
        const content = renderExport(format, refs)
        await fs.writeText(fileTarget, content, { kind: 'createIfAbsent' }, signal, sandboxPolicy)
        written.push(filePath)
      } catch (error) {
        failures.push(`${filePath}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
      }
    }
  } catch (error) {
    return {
      kind: 'error',
      text: `export failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. No files were written.`,
    }
  }

  const lines = [
    `exported ${String(written.length)} of ${String(formats.length)} file(s) for ${String(refs.length)} of ${String(scope.total)} reference(s) — ${scope.label}${quarantined > 0 ? `, including ${String(quarantined)} quarantined` : ''}`,
    // Name the destination: an export that quietly lands somewhere unexpected
    // is indistinguishable from an export that never ran.
    `  into ${fs.processPath(await fs.resolve(selectedPath, { signal }))}`,
    ...written.map((path) => `  ${path}`),
    ...failures.map((failure) => `  failed: ${failure}`),
    ...(failures.some((failure) => /denied|sandbox|workspace-write/i.test(failure))
      ? [`  hint: the sandbox only writes inside the session workspace (${deps.workspace}); pick a folder inside it.`]
      : []),
  ]
  return { kind: failures.length === 0 ? 'success' : 'error', text: lines.join('\n') }
}

export interface DirectoryOptions {
  /** Ask the host picker for the folder; the result is remembered. */
  readonly choose?: boolean
  /** Forget the remembered folder. */
  readonly clear?: boolean
  /** Remember this folder; the panel sends a typed or pasted path. */
  readonly path?: string
}

/**
 * Clean a typed or pasted folder path.
 *
 * Finder's "Copy as Pathname" yields quotes, dragging yields a `file://` URL,
 * and terminals hand out `~`; all three are folded to one absolute path.
 */
function normalizeDirInput(raw: string): string {
  let value = raw.trim()
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  if (quoted && value.length >= 2) value = value.slice(1, -1).trim()
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(new URL(value).pathname)
    } catch {
      value = value.slice('file://'.length)
    }
  }
  if (value === '~') value = homedir()
  else if (value.startsWith('~/')) value = join(homedir(), value.slice(2))
  if (value.length > 1) value = value.replace(/[\\/]+$/u, '')
  return value
}

/** Validate one folder and remember it as the export default. */
async function rememberDirectory(
  path: string,
  fs: NonNullable<StoreCommandDeps['fs']>,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const signal = deps.signal ?? new AbortController().signal
  try {
    const target = await fs.resolve(path, { signal })
    const info = await fs.stat(target, signal)
    if (info?.type !== 'directory') {
      return {
        kind: 'error',
        text: [
          `\`${path}\` is not an accessible directory; nothing changed.`,
          'Paste an absolute folder path that already exists.',
        ].join('\n'),
      }
    }
    const canonical = fs.processPath(target)
    if (fs.contains !== undefined) {
      // Remembering a folder outside the workspace would make every later
      // export fail, so reject it here with the reason.
      const workspaceTarget = await fs.resolve(deps.workspace, { signal })
      if (!fs.contains(workspaceTarget, target)) {
        return {
          kind: 'error',
          text: [
            'that folder is outside this session\'s workspace, so the workspace-write sandbox cannot write there; nothing changed.',
            `  folder: ${canonical}`,
            `  workspace: ${deps.workspace}`,
            'Paste a folder inside the workspace.',
          ].join('\n'),
        }
      }
    }
    await writeSettings(deps.workspace, { defaultExportDir: canonical })
    return {
      kind: 'success',
      text: [
        `default export folder: ${canonical}`,
        '`/refs export` writes here from now on; `/refs dir --clear` goes back to `refs/exports/`.',
        encodeDir({ dir: canonical }),
      ].join('\n'),
    }
  } catch (error) {
    return {
      kind: 'error',
      text: `could not use that folder: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Nothing changed.`,
    }
  }
}

/** `/refs dir`: read, choose or clear the folder exports default to. */
export async function setDefaultDirectory(
  options: DirectoryOptions,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  if (options.clear === true) {
    await writeSettings(deps.workspace, {})
    return {
      kind: 'success',
      text: [
        'default export folder cleared; exports go to `refs/exports/` in the session workspace.',
        encodeDir({ dir: null }),
      ].join('\n'),
    }
  }

  if (options.choose !== true && options.path === undefined) {
    const current = await readSettings(deps.workspace)
    const dir = current.defaultExportDir ?? null
    return {
      kind: 'success',
      text: [
        dir === null
          ? 'no default export folder; exports go to `refs/exports/` in the session workspace.'
          : `default export folder: ${dir}`,
        encodeDir({ dir }),
      ].join('\n'),
    }
  }

  const fs = deps.fs
  if (fs === undefined) {
    return {
      kind: 'error',
      text: 'Saving a folder needs the sandboxed filesystem service, which this host does not provide. Nothing changed.',
    }
  }

  if (options.path !== undefined) {
    const wanted = normalizeDirInput(options.path)
    if (wanted === '') {
      return { kind: 'error', text: 'The folder path is empty; nothing changed.' }
    }
    return await rememberDirectory(wanted, fs, deps)
  }

  const picker = deps.directoryPicker
  if (picker === undefined) {
    return {
      kind: 'error',
      text: 'Choosing a folder is unavailable on this host (directory picker service is missing). Nothing changed.',
    }
  }

  const signal = deps.signal ?? new AbortController().signal
  let picked: string | null
  try {
    picked = await picker.pick(signal)
  } catch (error) {
    return {
      kind: 'error',
      text: `directory picker failed: ${error instanceof Error ? error.message : String(error)}. Nothing changed.`,
    }
  }
  if (picked === null) return { kind: 'success', text: 'folder choice cancelled; nothing changed.' }
  return await rememberDirectory(picked, fs, deps)

}

export interface ListOptions {
  readonly limit?: number
  readonly quarantine?: boolean
}

/** Counts plus the first N entries; shared by `/refs list` and `ref_list`. */
export async function listLibrary(
  options: ListOptions,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const parsed = {
    limit: options.limit ?? 10,
    quarantine: options.quarantine ?? false,
  }
  const now = deps.now?.() ?? new Date().toISOString()
  const store = (await loadStore(deps.workspace, { now })).state
  const quarantine = await loadQuarantine(deps.workspace, { now })
  const lines = [
    `refs/refs.json · ${String(store.references.length)} reference(s) · updated ${store.updatedAt}`,
    `refs/quarantine.json · ${String(quarantine.entries.length)} entr${quarantine.entries.length === 1 ? 'y' : 'ies'}`,
  ]
  const source = parsed.quarantine ? quarantine.entries : store.references
  const shown = source.slice(0, parsed.limit)
  if (shown.length > 0) lines.push('')
  for (const ref of shown) {
    const year = ref.year !== undefined ? String(ref.year) : 'n.d.'
    const container = ref.containerTitle ? ` · ${ref.containerTitle}` : ''
    lines.push(`- ${ref.id} | ${ref.type} | ${ref.title} (${year})${container}`)
  }
  if (source.length > shown.length) {
    lines.push(`… ${String(source.length - shown.length)} more (raise --limit to see them)`)
  }
  return { kind: 'success', text: lines.join('\n') }
}

export interface RemoveOptions {
  /** Reference ids, DOIs or arXiv ids; case-insensitive for DOIs. */
  readonly targets?: readonly string[]
  /** Delete every entry in the selected table. */
  readonly all?: boolean
  /** Operate on refs/quarantine.json instead of refs/refs.json. */
  readonly quarantine?: boolean
}

function normalizeTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '')
    .replace(/^doi:/u, '')
}

function matchesTarget(ref: StoredReference, normalized: string): boolean {
  if (ref.id.toLowerCase() === normalized) return true
  const doi = ref.identifiers.doi
  if (doi !== undefined && normalizeTarget(doi) === normalized) return true
  const arxiv = ref.identifiers.arxiv
  if (arxiv !== undefined && normalizeTarget(arxiv) === normalized) return true
  return false
}

/** Delete entries from the main table or the quarantine.
 *
 * Matching is by exact id, DOI or arXiv id — never by title — so a typo cannot
 * silently delete the wrong reference, and unknown targets are reported back
 * instead of being ignored. */
export async function removeReferences(
  options: RemoveOptions,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const now = deps.now?.() ?? new Date().toISOString()
  const quarantine = options.quarantine === true
  const table = quarantine ? 'refs/quarantine.json' : 'refs/refs.json'
  const targets = (options.targets ?? []).map(normalizeTarget).filter((target) => target !== '')
  if (options.all !== true && targets.length === 0) {
    return { kind: 'error', text: `remove needs at least one id, DOI or arXiv id (or --all --yes)\n${STORE_USAGE}` }
  }

  const before = quarantine
    ? (await loadQuarantine(deps.workspace, { now })).entries
    : (await loadStore(deps.workspace, { now })).state.references
  if (before.length === 0) {
    return { kind: 'success', text: `${table} is empty; nothing to remove` }
  }

  const kept =
    options.all === true ? [] : before.filter((ref) => !targets.some((target) => matchesTarget(ref, target)))
  const missing =
    options.all === true
      ? []
      : targets.filter((target) => !before.some((ref) => matchesTarget(ref, target)))
  const removed = before.length - kept.length
  if (removed === 0) {
    return {
      kind: 'error',
      text: `nothing matched in ${table}; nothing was changed   (${before.length} entr${before.length === 1 ? 'y' : 'ies'} kept)\nuse /refs list to copy exact ids`,
    }
  }

  if (quarantine) {
    await writeQuarantine(deps.workspace, { schemaVersion: SCHEMA_VERSION, updatedAt: now, entries: kept })
  } else {
    await writeStore(deps.workspace, { schemaVersion: SCHEMA_VERSION, updatedAt: now, references: kept })
  }

  const lines = [
    `removed ${String(removed)} of ${String(before.length)} entr${before.length === 1 ? 'y' : 'ies'} from ${table}`,
    `remaining: ${String(kept.length)}`,
    ...(missing.length > 0 ? [`unmatched: ${missing.join(', ')}`] : []),
  ]
  return { kind: 'success', text: lines.join('\n') }
}

export interface EditRequest {
  readonly id: string
  readonly patch: Record<string, unknown>
}

/** Map `"Family, Given"` display strings back onto stored author objects. */
function authorsFromStrings(values: readonly unknown[]): StoredReference['authors'] {
  const authors: { family?: string; given?: string; literal?: string; sequence: number }[] = []
  values.forEach((value, index) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed === '') return
    const [family, ...given] = trimmed.split(',')
    const head = (family ?? '').trim()
    const tail = given.join(',').trim()
    authors.push(tail === '' ? { literal: head, sequence: index } : { family: head, given: tail, sequence: index })
  })
  return authors
}

const EDITABLE_TEXT = [
  'containerTitle',
  'volume',
  'issue',
  'pages',
  'publisher',
  'publisherPlace',
  'language',
  'url',
] as const

/**
 * Correct one entry's metadata in place.
 *
 * Editing is not re-verification: the user is fixing what the registry (or the
 * capture) got wrong, so the record keeps its table and its verification status
 * and the exporters simply write the corrected fields.
 */
export async function editReference(
  request: EditRequest,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const now = deps.now?.() ?? new Date().toISOString()
  const store = await loadStore(deps.workspace, { now })
  const quarantine = await loadQuarantine(deps.workspace, { now })
  const inMain = store.state.references.find((ref) => ref.id === request.id)
  const inQuarantine = quarantine.entries.find((ref) => ref.id === request.id)
  const current = inMain ?? inQuarantine
  if (current === undefined) {
    return { kind: 'error', text: `no reference with id "${request.id}" in either table` }
  }

  const patch = request.patch
  const changed: string[] = []
  const next: { -readonly [K in keyof StoredReference]: StoredReference[K] } = { ...current }

  if (typeof patch['title'] === 'string' && patch['title'].trim() !== '') {
    next.title = patch['title'].trim()
    changed.push('title')
  }
  if (typeof patch['type'] === 'string' && patch['type'] !== '') {
    next.type = patch['type'] as StoredReference['type']
    changed.push('type')
  }
  if (typeof patch['year'] === 'number' && Number.isFinite(patch['year'])) {
    next.year = patch['year']
    changed.push('year')
  }
  for (const field of EDITABLE_TEXT) {
    if (typeof patch[field] === 'string') {
      next[field] = patch[field].trim() === '' ? undefined : patch[field].trim()
      changed.push(field)
    }
  }
  if (Array.isArray(patch['authors'])) {
    next.authors = authorsFromStrings(patch['authors'])
    changed.push('authors')
  }
  const identifiers = { ...current.identifiers }
  let identifiersChanged = false
  if (typeof patch['doi'] === 'string') {
    const doi = patch['doi'].trim()
    identifiers.doi = doi === '' ? undefined : doi
    identifiersChanged = true
  }
  if (typeof patch['arxivId'] === 'string') {
    const arxiv = patch['arxivId'].trim()
    identifiers.arxiv = arxiv === '' ? undefined : arxiv
    identifiersChanged = true
  }
  if (identifiersChanged) {
    next.identifiers = identifiers
    changed.push('doi/arxiv')
  }
  next.updatedAt = now

  if (changed.length === 0) {
    return { kind: 'error', text: 'nothing to change: the payload carried no known field' }
  }

  const edited: StoredReference = { ...next }
  if (inMain !== undefined) {
    const references = store.state.references.map((ref) => (ref.id === edited.id ? edited : ref))
    await writeStore(deps.workspace, { ...store.state, updatedAt: now, references })
  } else {
    const entries = quarantine.entries.map((ref) => (ref.id === edited.id ? edited : ref))
    await writeQuarantine(deps.workspace, { ...quarantine, updatedAt: now, entries })
  }
  return {
    kind: 'success',
    text: [
      `edited ${edited.id} → refs/${inMain === undefined ? 'quarantine.json' : 'refs.json'}`,
      `fields: ${changed.join(', ')}`,
      `title: ${edited.title}`,
    ].join('\n'),
  }
}

/**
 * Backfill bibliographic fields on entries that were stored before the
 * registries' volume/issue/pages/publisher/language were parsed.
 *
 * Unlike `/refs edit` this never overwrites what is already there and never
 * re-runs verification: it only fills the blanks, so a user's correction wins.
 */
export async function enrichReferences(
  options: { readonly quarantine?: boolean | undefined },
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const resolve = deps.resolveIdentifiers
  if (resolve === undefined) {
    return {
      kind: 'error',
      text: 'enrich needs the registry resolver, which this host build did not provide',
    }
  }
  const now = deps.now?.() ?? new Date().toISOString()
  // Text that arrived before the parsers stripped Markdown (a quoted citation
  // line keeps its `>` and a journal keeps its `*`). Enrich is the one command
  // the user already runs to repair the library, so the cleanup rides along and
  // runs even for rows without a DOI.
  const cleanOne = (
    ref: StoredReference,
  ): { readonly next: StoredReference; readonly cleaned: readonly string[] } | undefined => {
    const cleaned: string[] = []
    const next: { -readonly [K in keyof StoredReference]: StoredReference[K] } = { ...ref }
    for (const field of ['title', 'containerTitle', 'publisher', 'publisherPlace'] as const) {
      const value = next[field]
      if (typeof value !== 'string') continue
      const clean = stripMarkup(value)
      if (clean === value) continue
      next[field] = clean
      cleaned.push(`${field} (markup)`)
    }
    let authorsChanged = false
    const authors = ref.authors.map((author) => {
      if (author.literal !== undefined && author.literal !== '') {
        const literal = stripMarkup(author.literal)
        if (literal === author.literal) return author
        authorsChanged = true
        return { ...author, literal }
      }
      const family = author.family === undefined ? undefined : stripMarkup(author.family)
      const given = author.given === undefined ? undefined : stripMarkup(author.given)
      if (family === author.family && given === author.given) return author
      authorsChanged = true
      return { ...author, ...(family === undefined ? {} : { family }), ...(given === undefined ? {} : { given }) }
    })
    if (authorsChanged) {
      next.authors = authors
      cleaned.push('authors (markup)')
    }
    if (cleaned.length === 0) return undefined
    next.updatedAt = now
    return { next: { ...next }, cleaned }
  }
  const store = await loadStore(deps.workspace, { now })
  const quarantine = options.quarantine === true
    ? await loadQuarantine(deps.workspace, { now })
    : undefined

  const enrichOne = async (
    ref: StoredReference,
  ): Promise<{ readonly next: StoredReference; readonly filled: readonly string[] } | undefined> => {
    const doi = ref.identifiers.doi ?? ''
    const arxiv = ref.identifiers.arxiv ?? ''
    if (doi === '' && arxiv === '') return undefined
    let record: SourceRecord | undefined
    try {
      record = await resolve(doi, arxiv)
    } catch {
      record = undefined
    }
    if (record === undefined) return undefined
    const filled: string[] = []
    const next: { -readonly [K in keyof StoredReference]: StoredReference[K] } = { ...ref }
    const fromRegistry: Partial<Record<(typeof EDITABLE_TEXT)[number], string | undefined>> = {
      containerTitle: record.container,
      volume: record.volume,
      issue: record.issue,
      pages: record.pages,
      publisher: record.publisher,
      language: record.language,
      url: record.url,
    }
    for (const field of EDITABLE_TEXT) {
      if (next[field] !== undefined && next[field] !== '') continue
      const value = fromRegistry[field]
      if (typeof value === 'string' && value.trim() !== '') {
        next[field] = value.trim()
        filled.push(field)
      }
    }
    if ((next.year === undefined || next.year === 0) && typeof record.year === 'number') {
      next.year = record.year
      filled.push('year')
    }
    if (next.authors.length === 0 && Array.isArray(record.authors) && record.authors.length > 0) {
      next.authors = record.authors.map((author, index) => ({
        family: author.family,
        given: author.given,
        literal: author.literal,
        sequence: index,
      }))
      filled.push('authors')
    }
    if (filled.length === 0) return undefined
    next.updatedAt = now
    return { next: { ...next }, filled }
  }

  const report: string[] = []
  let looked = 0
  const references: StoredReference[] = []
  for (const ref of store.state.references) {
    looked += 1
    const cleaned = cleanOne(ref)
    const base = cleaned?.next ?? ref
    const outcome = await enrichOne(base)
    const changed = [...(cleaned?.cleaned ?? []), ...(outcome?.filled ?? [])]
    if (changed.length === 0) {
      references.push(ref)
      continue
    }
    references.push(outcome?.next ?? base)
    report.push(`${ref.id} → ${changed.join(', ')}`)
  }

  const entries: StoredReference[] = []
  if (quarantine !== undefined) {
    for (const ref of quarantine.entries) {
      looked += 1
      const cleaned = cleanOne(ref)
      const base = cleaned?.next ?? ref
      const outcome = await enrichOne(base)
      const changed = [...(cleaned?.cleaned ?? []), ...(outcome?.filled ?? [])]
      if (changed.length === 0) {
        entries.push(ref)
        continue
      }
      entries.push(outcome?.next ?? base)
      report.push(`${ref.id} → ${changed.join(', ')} (quarantine)`)
    }
  }

  if (report.length === 0) {
    return {
      kind: 'success',
      text: `enriched 0 of ${looked} reference(s): no missing fields, no Markdown to clean, or no registry matched`,
    }
  }

  await writeStore(deps.workspace, { ...store.state, updatedAt: now, references })
  if (quarantine !== undefined) {
    await writeQuarantine(deps.workspace, { ...quarantine, updatedAt: now, entries })
  }
  const shown = report.slice(0, 10)
  return {
    kind: 'success',
    text: [
      `enriched ${report.length} of ${looked} reference(s)`,
      ...shown.map((line) => `  ${line}`),
      ...(report.length > shown.length ? [`  …and ${report.length - shown.length} more`] : []),
    ].join('\n'),
  }
}

/** Execute one `/refs save|remove|export|list|edit` line. */
export async function runStoreCommand(
  raw: string,
  deps: StoreCommandDeps,
): Promise<StoreCommandResult> {
  const parsed = parseStoreCommand(raw)
  if ('error' in parsed) return { kind: 'error', text: `${parsed.error}\n${STORE_USAGE}` }
  try {
    if (parsed.sub === 'save') return await runSave(parsed, deps)
    if (parsed.sub === 'edit') {
      let patch: Record<string, unknown>
      try {
        const decoded: unknown = JSON.parse(decodePayload(parsed.payload))
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
          return { kind: 'error', text: 'edit payload must be a JSON object of the fields to change' }
        }
        patch = decoded as Record<string, unknown>
      } catch {
        return { kind: 'error', text: 'edit payload is not valid base64url-encoded JSON' }
      }
      return await editReference({ id: parsed.targets[0] ?? '', patch }, deps)
    }
    if (parsed.sub === 'enrich') {
      return await enrichReferences({ quarantine: parsed.quarantine }, deps)
    }
    if (parsed.sub === 'dir') {
      let path: string | undefined
      if (parsed.dirPath !== '') {
        // A panel built before the flag-prefix fix sent `--set=--set=<payload>`,
        // which decodes to bytes that are not UTF-8. Strip the doubled prefix so
        // an older client bundle still works against this host.
        const payload = parsed.dirPath.startsWith('--set=')
          ? parsed.dirPath.slice('--set='.length)
          : parsed.dirPath
        try {
          const decoded = Buffer.from(payload, 'base64url').toString('utf8')
          if (decoded.includes('\uFFFD')) {
            return {
              kind: 'error',
              text: 'the folder path did not survive the command line; reload the panel and paste it again. Nothing changed.',
            }
          }
          // The panel encodes JSON, so a plain path arrives quoted.
          path = decoded.startsWith('"') ? (JSON.parse(decoded) as string) : decoded
        } catch {
          return { kind: 'error', text: 'the folder path is not valid base64url text. Nothing changed.' }
        }
      }
      return await setDefaultDirectory(
        {
          choose: parsed.dirChoose,
          clear: parsed.dirClear,
          ...(path === undefined ? {} : { path }),
        },
        deps,
      )
    }
    if (parsed.sub === 'remove') {
      return await removeReferences(
        { targets: parsed.targets, all: parsed.all, quarantine: parsed.quarantine },
        deps,
      )
    }
    if (parsed.sub === 'export') {
      if (parsed.chooseDir) {
        return await exportToChosenDirectory(
          {
            format: parsed.format,
            includeQuarantine: parsed.includeQuarantine,
            all: parsed.all,
            ids: parsed.ids,
          },
          deps,
        )
      }
      return await exportLibrary(
        {
          format: parsed.format,
          out: parsed.out,
          includeQuarantine: parsed.includeQuarantine,
          all: parsed.all,
          ids: parsed.ids,
        },
        deps,
      )
    }
    return await listLibrary({ limit: parsed.limit, quarantine: parsed.quarantine }, deps)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}
