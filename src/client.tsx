import * as React from 'react'

const ReactDOM = require('react-dom') as {
  createPortal: (children: React.ReactNode, container: Element) => React.ReactPortal
}

/**
 * Client face of dsh-refkeeper (M4).
 *
 * The composer cannot write files itself: every mutation has to travel through
 * the host, which owns the sandbox and the approval gate. This face therefore
 * *only* composes slash-command lines and hands them to the Session input
 * machine (`inputActions.setDraft` + `inputActions.submit`), so a click and a
 * typed `/refs …` end up in exactly the same host handler.
 *
 * Data flow, end to end:
 *
 *   button / panel  →  `/refs capture --scope=…`  →  host command
 *                   →  `runRefsCommand` (pure, unit-tested)  →  result text
 *   panel "save"    →  `/refs save --payload=<base64url>`  →  host command → store
 *
 * The panel cannot ask the host for data directly: a client plugin cannot
 * register a Remote namespace (the namespace list is assembled host-side in
 * `@deepseek-ai/dsh-api-remotes`) and `CommandResult` carries text only. The host
 * therefore appends one machine-readable `refkeeper-batch:` line to every
 * capture result, and the panel reads the newest such line back out of this
 * session's event stream. That keeps "what did I just capture" visible without
 * a channel the plugin is not allowed to open.
 */

import { BATCH_MARKER, decodeBatch } from './core/batch.ts'
import type { BatchEntry, CaptureBatch } from './core/batch.ts'
import { parseAuthorLines } from './ui/authors.ts'
import { cachedCommandSnapshot, entryReasonForMeta, parseManualSaveResult } from './ui/save-result.ts'
import type { CommandSnapshotCache, ManualSaveResult } from './ui/save-result.ts'
import { decodeDir } from './core/panel.ts'
import type { DirectorySetting } from './core/panel.ts'
import { encodeFlag } from './ui/payload.ts'
import { stringsFor } from './ui/strings.ts'
import type { Strings } from './ui/strings.ts'
import { UI_TOKENS } from './ui/tokens.ts'
import { REF_TYPES } from './store/types.ts'

export const REGISTRANT = 'dsh-refkeeper'

export const inject = ['slots']

/** Capture windows exposed by `/refs capture`; `turns` is only meaningful for `lastN`. */
type Scope = 'turn' | 'lastN' | 'all'

interface PanelState {
  readonly open: boolean
  readonly scope: Scope
  readonly turns: number
  /** Export formats: BibTeX and RIS are independent choices. */
  readonly bibtex: boolean
  readonly ris: boolean
}

const INITIAL: PanelState = {
  open: false,
  scope: 'turn',
  turns: 3,
  bibtex: true,
  ris: true,
}

let state: PanelState = INITIAL
const listeners = new Set<() => void>()

function setState(patch: Partial<PanelState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function usePanelState(): PanelState {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => INITIAL,
  )
}

/**
 * The browser client's locale service, captured in `apply()`.
 *
 * Read through a getter rather than a captured value: the service may mount
 * after this plugin, and the user can switch languages while the panel is open.
 */
interface LocaleLike {
  getSnapshot(): { readonly active: string }
  subscribe(listener: () => void): () => void
}

let localeLookup: (() => LocaleLike | undefined) | undefined

/** The active DSH locale tag, or `undefined` before the service is reachable. */
function activeLocale(): string | undefined {
  try {
    return localeLookup?.()?.getSnapshot().active
  } catch {
    return undefined
  }
}

/**
 * Dictionary that follows the DSH locale, and falls back to the document
 * language until the locale service is reachable (and wherever it is absent).
 */
function useStrings(): Strings {
  const subscribe = React.useCallback((onChange: () => void) => {
    let locale: LocaleLike | undefined
    try {
      locale = localeLookup?.()
    } catch {
      return () => {}
    }
    return locale === undefined ? () => {} : locale.subscribe(onChange)
  }, [])
  const tag = React.useSyncExternalStore(
    subscribe,
    () => activeLocale() ?? (typeof document === 'undefined' ? 'en' : document.documentElement.lang),
    () => 'en',
  )
  return stringsFor(tag)
}

interface EventSourceLike {
  getSnapshot(): { readonly revision: number; readonly entries: readonly unknown[] }
  subscribe(listener: () => void): () => void
}

interface SessionsLike {
  binding(id: string): { readonly eventSource: EventSourceLike } | undefined
}

/**
 * Captured in `apply()`: the panel needs this session's event stream to read
 * back the batch the host wrote into the capture result.
 *
 * The service is looked up on every read instead of being cached at apply time:
 * a profile reload can re-apply this plugin while `sessions` is not mounted yet,
 * and caching that `undefined` would blank the captured list until the whole app
 * restarts even though the batch is on disk and in the transcript.
 */
let sessionsLookup: (() => SessionsLike | undefined) | undefined

function sessionsNow(): SessionsLike | undefined {
  if (sessionsLookup === undefined) return undefined
  try {
    return sessionsLookup()
  } catch {
    return undefined
  }
}

/** Every `command/done` text in the loaded window that carries a batch marker. */
function commandTexts(sessionId: string): string[] {
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source === undefined) return []
  const texts: string[] = []
  for (const entry of source.getSnapshot().entries) {
    const item = entry as {
      type?: unknown
      event?: { type?: unknown; data?: { text?: unknown } }
    }
    if (item.type !== 'event' || item.event?.type !== 'command/done') continue
    const text = item.event.data?.text
    if (typeof text === 'string' && text.includes(BATCH_MARKER)) texts.push(text)
  }
  return texts
}

/** Newest batch among the candidate texts; ties keep the later command. */
function latestBatchOf(texts: readonly string[]): CaptureBatch | undefined {
  let best: CaptureBatch | undefined
  for (const text of texts) {
    const batch = decodeBatch(text)
    if (batch === undefined) continue
    if (best === undefined || batch.capturedAt >= best.capturedAt) best = batch
  }
  return best
}

/**
 * `useSyncExternalStore` requires a stable snapshot, so the decoded batch is
 * cached per revision: decoding on every render would hand React a new object
 * each time and loop forever.
 */
const batchCache = new Map<string, { key: string; batch: CaptureBatch | undefined }>()

function snapshotBatch(sessionId: string | undefined, nonce: number): CaptureBatch | undefined {
  if (sessionId === undefined) return undefined
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source === undefined) return undefined
  const window = source.getSnapshot()
  const key = `${String(nonce)}:${String(window.revision)}:${String(window.entries.length)}`
  const cached = batchCache.get(sessionId)
  if (cached !== undefined && cached.key === key) return cached.batch
  const batch = latestBatchOf(commandTexts(sessionId))
  batchCache.set(sessionId, { key, batch })
  return batch
}

/**
 * A session that has not been retained yet has no event source; poll instead of
 * subscribing so the panel picks the batch up as soon as the conversation opens.
 */
function subscribeBatch(sessionId: string | undefined, listener: () => void): () => void {
  if (sessionId === undefined) return () => {}
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source !== undefined) return source.subscribe(listener)
  const timer = setInterval(listener, 1000)
  return () => clearInterval(timer)
}

function useLatestBatch(sessionId: string | undefined, nonce = 0): CaptureBatch | undefined {
  return React.useSyncExternalStore(
    (listener) => subscribeBatch(sessionId, listener),
    () => snapshotBatch(sessionId, nonce),
    () => undefined,
  )
}

/** Newest `refkeeper-dir:` marker in the transcript, decoded. */
function latestDirOf(sessionId: string): DirectorySetting | undefined {
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source === undefined) return undefined
  let found: DirectorySetting | undefined
  for (const entry of source.getSnapshot().entries) {
    const item = entry as { type?: unknown; event?: { type?: unknown; data?: { text?: unknown } } }
    if (item.type !== 'event' || item.event?.type !== 'command/done') continue
    const text = item.event.data?.text
    if (typeof text !== 'string') continue
    const decoded = decodeDir(text)
    if (decoded !== undefined) found = decoded
  }
  return found
}

const dirCache = new Map<string, { key: string; dir: DirectorySetting | undefined }>()

function snapshotDir(sessionId: string | undefined, nonce: number): DirectorySetting | undefined {
  if (sessionId === undefined) return undefined
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source === undefined) return undefined
  const window = source.getSnapshot()
  const key = `${String(nonce)}:${String(window.revision)}:${String(window.entries.length)}`
  const cached = dirCache.get(sessionId)
  if (cached !== undefined && cached.key === key) return cached.dir
  const dir = latestDirOf(sessionId)
  dirCache.set(sessionId, { key, dir })
  return dir
}

function useLatestDir(sessionId: string | undefined, nonce = 0): DirectorySetting | undefined {
  return React.useSyncExternalStore(
    (listener) => subscribeBatch(sessionId, listener),
    () => snapshotDir(sessionId, nonce),
    () => undefined,
  )
}

const STATUS_TONE: Record<BatchEntry['status'], string> = {
  saved: UI_TOKENS.color.success,
  quarantined: UI_TOKENS.color.warning,
  skipped: UI_TOKENS.color.neutral,
  failed: UI_TOKENS.color.error,
}

function statusLabel(entry: BatchEntry, text: Strings): string {
  if (entry.status === 'saved') return text.statusSaved
  if (entry.status === 'quarantined') return text.statusQuarantined
  if (entry.status === 'skipped') return text.statusSkipped
  return text.statusFailed
}

function entryMeta(entry: BatchEntry, text: Strings): string {
  const authors = entry.fields?.authors ?? []
  const author = authors.length === 1 ? authors[0] : authors.length === 2
    ? `${authors[0]} ${text.authorConjunction} ${authors[1]}`
    : authors.length > 2 ? `${authors[0]} et al.` : ''
  return [author, entry.fields?.year === undefined ? '' : String(entry.fields.year), entry.fields?.containerTitle ?? '', entryReasonForMeta(entry.status, entry.reason) ?? '']
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(' · ')
}

interface FieldRow {
  readonly key: 'type' | 'title' | 'authors' | 'containerTitle' | 'year' | 'volume' | 'issue' | 'pages' | 'publisher' | 'publisherPlace' | 'language' | 'doi' | 'arxivId' | 'pmid' | 'pmcid' | 'url'
  readonly label: (text: Strings) => string
  readonly multiline?: boolean
  readonly numeric?: boolean
}

const FIELDS: readonly FieldRow[] = [
  { key: 'type', label: (text) => text.fieldType },
  { key: 'title', label: (text) => text.fieldTitle, multiline: true },
  // The authors hint is part of the visible label, not a placeholder, so the
  // expected format stays readable after the field is filled. It is laid out on
  // its own line to keep the label within the 340px dock's label column.
  { key: 'authors', label: (text) => `${text.fieldAuthors}\n${text.fieldAuthorsHint}`, multiline: true },
  { key: 'containerTitle', label: (text) => text.fieldContainer },
  { key: 'year', label: (text) => text.fieldYear, numeric: true },
  { key: 'volume', label: (text) => text.fieldVolume },
  { key: 'issue', label: (text) => text.fieldIssue },
  { key: 'pages', label: (text) => text.fieldPages },
  { key: 'publisher', label: (text) => text.fieldPublisher },
  { key: 'publisherPlace', label: (text) => text.fieldPlace },
  { key: 'language', label: (text) => text.fieldLanguage },
  { key: 'doi', label: (text) => text.fieldDoi },
  { key: 'arxivId', label: (text) => text.fieldArxiv },
  { key: 'pmid', label: (text) => text.fieldPmid },
  { key: 'pmcid', label: (text) => text.fieldPmcid },
  { key: 'url', label: (text) => text.fieldUrl },
]

/** The stored record as editable strings, so an input can hold every field. */
function draftOf(entry: BatchEntry): Record<string, string> {
  const fields = entry.fields
  const base: Record<string, string> = {
    type: fields?.type ?? 'journalArticle',
    title: fields?.title ?? entry.title,
    authors: (fields?.authors ?? []).join('\n'),
    containerTitle: fields?.containerTitle ?? '',
    year: fields?.year === undefined ? '' : String(fields.year),
    volume: fields?.volume ?? '',
    issue: fields?.issue ?? '',
    pages: fields?.pages ?? '',
    publisher: fields?.publisher ?? '',
    publisherPlace: fields?.publisherPlace ?? '',
    language: fields?.language ?? '',
    doi: fields?.doi ?? entry.doi ?? '',
    arxivId: fields?.arxivId ?? entry.arxivId ?? '',
    pmid: fields?.pmid ?? entry.pmid ?? '',
    pmcid: fields?.pmcid ?? entry.pmcid ?? '',
    url: fields?.url ?? '',
  }
  return base
}

/** Only what the user actually changed, so the host's report stays readable. */
function patchOf(entry: BatchEntry, draft: Record<string, string>): Record<string, unknown> {
  const base = draftOf(entry)
  const patch: Record<string, unknown> = {}
  for (const field of FIELDS) {
    const value = (draft[field.key] ?? '').trim()
    const before = (base[field.key] ?? '').trim()
    if (value === before) continue
    if (field.key === 'authors') {
      patch['authors'] = parseAuthorLines(value)
      continue
    }
    if (field.key === 'year') {
      const year = Number(value)
      if (value !== '' && Number.isFinite(year)) patch['year'] = year
      continue
    }
    if (field.key === 'type') {
      if (value !== '') patch['type'] = value
      continue
    }
    if (field.key === 'title') {
      if (value !== '') patch['title'] = value
      continue
    }
    patch[field.key] = value
  }
  return patch
}

type PanelView =
  | { readonly kind: 'list' }
  | { readonly kind: 'detail'; readonly id: string; readonly mode: 'edit' | 'create' }

type ManualSaveOutcome = 'pending' | 'saved' | 'already' | 'quarantined' | 'unconfirmed'

interface CommandEventSnapshot {
  readonly revision: number
  readonly size: number
  readonly runs: readonly { readonly index: number; readonly commandId: string; readonly name: string; readonly args?: string }[]
  readonly commands: readonly { readonly index: number; readonly commandId: string; readonly kind: 'success' | 'error'; readonly text?: string }[]
}

const EMPTY_COMMAND_SNAPSHOT = '{"revision":0,"size":0,"runs":[],"commands":[]}'

function commandSnapshotOf(sessionId: string | undefined, cache: CommandSnapshotCache): string {
  if (sessionId === undefined) {
    cache.current = undefined
    return EMPTY_COMMAND_SNAPSHOT
  }
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  const snapshot = source?.getSnapshot()
  if (snapshot === undefined) {
    cache.current = undefined
    return EMPTY_COMMAND_SNAPSHOT
  }
  return cachedCommandSnapshot(cache, sessionId, snapshot.revision, snapshot.entries.length, () => {
    const runs: Array<{ index: number; commandId: string; name: string; args?: string }> = []
    const commands: Array<{ index: number; commandId: string; kind: 'success' | 'error'; text?: string }> = []
    snapshot.entries.forEach((item, index) => {
      const event = item as { readonly type?: unknown; readonly event?: { readonly type?: unknown; readonly data?: unknown } }
      if (event.type !== 'event') return
      const data = event.event?.data
      if (typeof data !== 'object' || data === null) return
      const command = data as { readonly commandId?: unknown; readonly name?: unknown; readonly args?: unknown; readonly kind?: unknown; readonly text?: unknown }
      if (typeof command.commandId !== 'string') return
      if (event.event?.type === 'command/run') {
        if (typeof command.name !== 'string') return
        runs.push({
          index,
          commandId: command.commandId,
          name: command.name,
          ...(typeof command.args === 'string' ? { args: command.args } : {}),
        })
        return
      }
      if (event.event?.type !== 'command/done' || (command.kind !== 'success' && command.kind !== 'error')) return
      commands.push({
        index,
        commandId: command.commandId,
        kind: command.kind,
        ...(typeof command.text === 'string' ? { text: command.text } : {}),
      })
    })
    return JSON.stringify({ revision: snapshot.revision, size: snapshot.entries.length, runs, commands })
  })
}

function subscribeCommandEvents(sessionId: string | undefined, listener: () => void): () => void {
  if (sessionId === undefined) return () => undefined
  const source = sessionsNow()?.binding(sessionId)?.eventSource
  if (source !== undefined) return source.subscribe(listener)
  const timer = setInterval(listener, 1000)
  return () => clearInterval(timer)
}

function useCommandEvents(sessionId: string | undefined): CommandEventSnapshot {
  const cache = React.useRef<CommandSnapshotCache>({ current: undefined })
  const raw = React.useSyncExternalStore(
    (listener) => subscribeCommandEvents(sessionId, listener),
    () => commandSnapshotOf(sessionId, cache.current),
    () => EMPTY_COMMAND_SNAPSHOT,
  )
  return React.useMemo(() => JSON.parse(raw) as CommandEventSnapshot, [raw])
}

function createDraftOf(entry: BatchEntry): Record<string, string> {
  const draft = draftOf(entry)
  if (entry.fields?.title !== undefined) return draft
  const title = entry.title.trim()
  if (title === entry.doi || title === entry.arxivId || title === '—') draft.title = ''
  return draft
}

function entryWithManualResult(entry: BatchEntry, payload: Record<string, unknown>, result: ManualSaveResult): BatchEntry {
  const base = entry.fields ?? { type: 'journalArticle', title: entry.title, authors: [] }
  const title = typeof payload['title'] === 'string' ? payload['title'] : base.title
  const type = typeof payload['type'] === 'string' ? payload['type'] : base.type
  const authors = Array.isArray(payload['authors'])
    ? payload['authors'].filter((author): author is string => typeof author === 'string')
    : base.authors
  const fields = {
    ...base,
    ...payload,
    type,
    title,
    authors,
  } as NonNullable<BatchEntry['fields']>
  return {
    ...entry,
    id: result.id,
    status: result.status,
    title,
    fields,
    ...(typeof payload['year'] === 'number' ? { year: payload['year'] } : {}),
    ...(typeof payload['doi'] === 'string' && payload['doi'] !== '' ? { doi: payload['doi'] } : {}),
    ...(typeof payload['arxivId'] === 'string' && payload['arxivId'] !== '' ? { arxivId: payload['arxivId'] } : {}),
    ...(typeof payload['pmid'] === 'string' && payload['pmid'] !== '' ? { pmid: payload['pmid'] } : {}),
    ...(typeof payload['pmcid'] === 'string' && payload['pmcid'] !== '' ? { pmcid: payload['pmcid'] } : {}),
  }
}

function payloadFromDraft(draft: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: (REF_TYPES as readonly string[]).includes(draft['type'] ?? '') ? draft['type'] : 'journalArticle',
    title: (draft['title'] ?? '').trim(),
    year: Number(draft['year']),
    authors: parseAuthorLines(draft['authors'] ?? ''),
  }
  for (const field of FIELDS) {
    if (field.key === 'type' || field.key === 'title' || field.key === 'year' || field.key === 'authors') continue
    const value = (draft[field.key] ?? '').trim()
    if (value !== '') payload[field.key] = value
  }
  return payload
}

const ENTRY_DETAILS_FORM_ID = 'dsh-refkeeper-entry-details-form'

function EntryDetails(props: {
  readonly entry: BatchEntry
  readonly rowKey: string
  readonly mode: 'edit' | 'create'
  readonly text: Strings
  readonly onEdit: (id: string, patch: Record<string, unknown>, title?: string) => void
  readonly onManualSave: (entry: BatchEntry, payload: Record<string, unknown>) => boolean
  readonly onPromote: (entry: BatchEntry, manual: boolean) => void
  readonly manualOutcome?: ManualSaveOutcome
  readonly onTitleRef: (element: HTMLTextAreaElement | null) => void
}): React.ReactElement {
  const { entry, rowKey, mode, text, onEdit, onManualSave, onPromote, manualOutcome, onTitleRef } = props
  const [draft, setDraft] = React.useState<Record<string, string>>(() => createDraftOf(entry))
  const [validationError, setValidationError] = React.useState(false)
  const [editNotice, setEditNotice] = React.useState(false)

  React.useEffect(() => {
    setDraft(createDraftOf(entry))
    setValidationError(false)
    setEditNotice(false)
  }, [entry])

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (mode === 'create') {
      const authors = parseAuthorLines(draft['authors'] ?? '')
      const year = Number(draft['year'])
      const title = (draft['title'] ?? '').trim()
      if (title === '' || authors.length === 0 || !Number.isInteger(year)) {
        setValidationError(true)
        return
      }
      const sent = onManualSave(entry, payloadFromDraft(draft))
      setValidationError(false)
      if (!sent) setEditNotice(true)
      return
    }
    if (entry.id === undefined) return
    const patch = patchOf(entry, draft)
    if (Object.keys(patch).length === 0) {
      setValidationError(false)
      setEditNotice(true)
      return
    }
    onEdit(entry.id, patch, (draft['title'] ?? '').trim() || undefined)
    setValidationError(false)
    setEditNotice(true)
  }

  const outcomeText = manualOutcome === 'pending' ? text.manualSavePending
    : manualOutcome === 'saved' ? `${text.manualSaveConfirmed} ${text.manualSaveNextCapture}`
      : manualOutcome === 'already' ? `${text.manualSaveAlready} ${text.manualSaveNextCapture}`
        : manualOutcome === 'quarantined' ? `${text.manualSaveQuarantined} ${text.manualSaveNextCapture}`
          : manualOutcome === 'unconfirmed' ? text.manualSaveUnconfirmed
            : editNotice ? (mode === 'edit' ? text.detailsSubmitted : text.unavailable)
              : ''
  const outcomeTone = manualOutcome === 'quarantined' ? UI_TOKENS.color.warning
    : manualOutcome === 'unconfirmed' || editNotice ? UI_TOKENS.color.neutral : UI_TOKENS.color.success

  const groupDefinitions = [
    { key: 'identifiers', label: text.groupIdentifiers, fields: ['type', 'doi', 'arxivId', 'url'] },
    { key: 'bibliography', label: text.groupBibliography, fields: ['title', 'authors', 'containerTitle', 'pages', 'language'] },
    { key: 'publication', label: text.groupPublication, fields: ['year', 'volume', 'issue', 'publisher', 'publisherPlace'] },
  ] as const

  return React.createElement(
    'div',
    { style: { display: 'grid', gap: UI_TOKENS.layout.sectionGap, minWidth: 0 } },
    entry.status === 'quarantined'
      ? React.createElement('div', {
          role: 'status',
          style: { padding: UI_TOKENS.spacing.sm, borderRadius: UI_TOKENS.radius.panel, color: UI_TOKENS.color.warning, background: 'color-mix(in srgb, var(--dsw-alias-warning, #f59e0b) 14%, transparent)', fontSize: UI_TOKENS.fontSize.caption },
        }, `⚠ ${text.quarantineNotice}${entry.reason ? ` ${entry.reason}` : ''}`)
      : null,
    React.createElement(
      'form',
      {
        id: ENTRY_DETAILS_FORM_ID,
        onSubmit: submit,
        onReset: (event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          setDraft(createDraftOf(entry))
          setValidationError(false)
          setEditNotice(false)
        },
        style: { display: 'grid', gap: UI_TOKENS.layout.groupGap, minWidth: 0 },
      },
      ...groupDefinitions.map((group) => React.createElement(
        'section',
        { key: group.key, style: { display: 'grid', gap: UI_TOKENS.layout.fieldGap, minWidth: 0 } },
        React.createElement('h3', { style: { margin: 0, paddingBottom: UI_TOKENS.spacing.xs, borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))', fontSize: UI_TOKENS.fontSize.control, fontWeight: 500 } }, group.label),
        ...FIELDS.filter((field) => (group.fields as readonly string[]).includes(field.key)).map((field) => {
          const value = draft[field.key] ?? ''
          const label = field.label(text)
          const onChange = (nextValue: string): void => setDraft((current) => ({ ...current, [field.key]: nextValue }))
          let control: React.ReactElement
          if (field.key === 'type') {
            control = React.createElement('select', {
              value: value || 'journalArticle',
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
              style: FIELD_STYLE,
            }, ...REF_TYPES.map((type) => React.createElement('option', { key: type, value: type }, type)))
          } else if (field.multiline) {
            control = React.createElement('textarea', {
              ref: field.key === 'title' ? onTitleRef : undefined,
              value,
              rows: field.key === 'authors' ? 3 : 2,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
              style: { ...FIELD_STYLE, resize: 'vertical', minHeight: field.key === 'authors' ? '68px' : '48px' },
            })
          } else {
            control = React.createElement('input', {
              type: field.numeric ? 'number' : 'text',
              min: field.numeric ? 0 : undefined,
              max: field.numeric ? 9999 : undefined,
              step: field.numeric ? 1 : undefined,
              value,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
              style: FIELD_STYLE,
            })
          }
          return React.createElement(
            'label',
            { key: field.key, style: { display: 'grid', gap: UI_TOKENS.layout.labelGap, minWidth: 0, fontSize: UI_TOKENS.fontSize.caption } },
            React.createElement('span', { style: { whiteSpace: 'pre-line', color: UI_TOKENS.color.neutral } }, label),
            control,
          )
        }),
      )),
      validationError ? React.createElement('div', { role: 'alert', style: { color: UI_TOKENS.color.warning, fontSize: UI_TOKENS.fontSize.caption } }, text.manualSaveValidation) : null,
      outcomeText !== '' ? React.createElement('div', { role: 'status', style: { color: outcomeTone, fontSize: UI_TOKENS.fontSize.caption } }, outcomeText) : null,
      entry.status === 'quarantined'
        ? React.createElement('div', { style: { display: 'flex', gap: UI_TOKENS.layout.labelGap, flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', onClick: () => onPromote(entry, false), style: BASE_BUTTON }, text.promoteVerify),
            React.createElement('button', { type: 'button', onClick: () => onPromote(entry, true), style: BASE_BUTTON }, text.promoteManual))
        : null,
    ),
  )
}

interface PanelViewProps {
  readonly view: PanelView
  readonly onViewChange: (view: PanelView) => void
  readonly batch: CaptureBatch | undefined
  readonly text: Strings
  readonly sessionId?: string
  readonly isPicked: (entry: BatchEntry) => boolean
  readonly onToggle: (id: string, next: boolean) => void
  readonly onEdit: (id: string, patch: Record<string, unknown>, title?: string) => void
  readonly onPromote: (entry: BatchEntry, manual: boolean) => void
  readonly onManualSave: (entry: BatchEntry, payload: Record<string, unknown>) => boolean
  readonly titleOf: (entry: BatchEntry) => string
  readonly pickedCount: number
  readonly onRefresh: () => void
}

function PanelView(props: PanelViewProps): React.ReactElement {
  const { view, onViewChange, batch, text, sessionId, isPicked, onToggle, onEdit, onPromote, onManualSave, titleOf, pickedCount, onRefresh } = props
  const [updatedRows, setUpdatedRows] = React.useState<{ readonly batchKey: string; readonly rows: Readonly<Record<string, BatchEntry>> }>({ batchKey: '', rows: {} })
  const [pendingSave, setPendingSave] = React.useState<{ readonly rowKey: string; readonly baselineSize: number; readonly expectedArgs: string; readonly commandId?: string; readonly batchKey: string; readonly entry: BatchEntry; readonly payload: Record<string, unknown> } | undefined>(undefined)
  const [manualFeedback, setManualFeedback] = React.useState<{ readonly rowKey: string; readonly outcome: ManualSaveOutcome } | undefined>(undefined)
  const commands = useCommandEvents(sessionId)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const titleRef = React.useRef<HTMLTextAreaElement | null>(null)
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const restoreFocusKey = React.useRef<string | undefined>(undefined)
  const restoreFocusOnList = React.useRef(false)
  const listScrollTop = React.useRef(0)
  const priorBatchKey = React.useRef('')
  const batchKey = batch === undefined ? '' : `${batch.capturedAt}:${String(batch.entries.length)}`
  const entries = batch === undefined ? [] : batch.entries.map((entry, index) =>
    updatedRows.batchKey === batchKey ? updatedRows.rows[String(index)] ?? entry : entry,
  )

  React.useEffect(() => {
    if (priorBatchKey.current === batchKey) return
    priorBatchKey.current = batchKey
    onViewChange({ kind: 'list' })
    setUpdatedRows({ batchKey, rows: {} })
    setPendingSave(undefined)
    setManualFeedback(undefined)
  }, [batchKey, onViewChange])

  React.useEffect(() => {
    if (pendingSave === undefined) return
    if (pendingSave.commandId === undefined) {
      const run = commands.runs.find((event) =>
        event.index >= pendingSave.baselineSize && event.name === 'refs' && event.args === pendingSave.expectedArgs,
      )
      if (run === undefined) return
      setPendingSave((current) => current === pendingSave ? { ...current, commandId: run.commandId } : current)
      return
    }
    const done = commands.commands.find((event) => event.commandId === pendingSave.commandId)
    if (done === undefined) return
    const result = done.kind === 'success' && done.text !== undefined ? parseManualSaveResult(done.text) : undefined
    if (result === undefined) {
      setManualFeedback({ rowKey: pendingSave.rowKey, outcome: 'unconfirmed' })
      setPendingSave(undefined)
      return
    }
    if (pendingSave.batchKey === batchKey) {
      const next = entryWithManualResult(pendingSave.entry, pendingSave.payload, result)
      setUpdatedRows((current) => {
        const rows = current.batchKey === batchKey ? current.rows : {}
        return { batchKey, rows: { ...rows, [pendingSave.rowKey]: next } }
      })
    }
    setManualFeedback({ rowKey: pendingSave.rowKey, outcome: result.outcome })
    setPendingSave(undefined)
  }, [commands, pendingSave, batchKey])

  const leaveDetail = (): void => {
    restoreFocusOnList.current = true
    onViewChange({ kind: 'list' })
  }

  React.useEffect(() => {
    if (view.kind === 'detail') {
      const focusFrame = window.requestAnimationFrame(() => titleRef.current?.focus())
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        leaveDetail()
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        window.cancelAnimationFrame(focusFrame)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }
    if (!restoreFocusOnList.current) return
    restoreFocusOnList.current = false
    const focusKey = restoreFocusKey.current
    const frame = window.requestAnimationFrame(() => {
      if (focusKey !== undefined) triggerRefs.current.get(focusKey)?.focus()
      if (listRef.current !== null) listRef.current.scrollTop = listScrollTop.current
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view])

  const openDetail = (entry: BatchEntry, index: number, mode: 'edit' | 'create', trigger: 'title' | 'manual'): void => {
    const rowKey = String(index)
    restoreFocusKey.current = `${rowKey}:${trigger}`
    listScrollTop.current = listRef.current?.scrollTop ?? 0
    onViewChange({ kind: 'detail', id: rowKey, mode })
  }

  const submitManual = (entry: BatchEntry, payload: Record<string, unknown>, rowKey: string): boolean => {
    if (pendingSave !== undefined) return false
    const baselineSize = commands.size
    // DSH command/run args preserve raw input after the command name, including separator whitespace.
    const expectedArgs = manualSaveCommand(payload).slice('/refs'.length)
    const submitted = onManualSave(entry, payload)
    if (!submitted) {
      setManualFeedback({ rowKey, outcome: 'unconfirmed' })
      return false
    }
    setPendingSave({ rowKey, baselineSize, expectedArgs, batchKey, entry, payload })
    setManualFeedback({ rowKey, outcome: 'pending' })
    return true
  }

  if (view.kind === 'detail') {
    const index = Number(view.id)
    const entry = entries[index]
    if (entry === undefined) {
      return React.createElement('button', { type: 'button', onClick: leaveDetail, style: BASE_BUTTON }, text.detailBack)
    }
    const rowKey = String(index)
    const title = titleOf(entry) === '' ? entry.doi ?? entry.arxivId ?? '—' : titleOf(entry)
    const feedback = manualFeedback?.rowKey === rowKey ? manualFeedback.outcome
      : pendingSave?.rowKey === rowKey ? 'pending' : undefined
    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: UI_TOKENS.layout.labelGap, minWidth: 0, flexShrink: 0 } },
        React.createElement('button', { type: 'button', onClick: leaveDetail, style: { ...BASE_BUTTON, flexShrink: 0 } }, `← ${text.detailBack}`),
        React.createElement('strong', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, view.mode === 'create' ? text.detailCreate : text.detailEdit)),
      React.createElement(
        'div',
        { style: { display: 'grid', alignContent: 'start', gap: UI_TOKENS.layout.sectionGap, flex: '1 1 auto', minHeight: 0, minWidth: 0, overflowY: 'auto' } },
        React.createElement('div', { title, style: { fontSize: UI_TOKENS.fontSize.control, fontWeight: 500, overflowWrap: 'anywhere' } }, title),
        React.createElement('div', { style: { fontSize: UI_TOKENS.fontSize.caption, color: UI_TOKENS.color.neutral } }, entryMeta(entry, text)),
        React.createElement(EntryDetails, {
          key: `${rowKey}:${view.mode}`,
          entry,
          rowKey,
          mode: view.mode,
          text,
          onEdit,
          onManualSave: (currentEntry, payload) => submitManual(currentEntry, payload, rowKey),
          onPromote,
          manualOutcome: feedback,
          onTitleRef: (element) => { titleRef.current = element },
        }),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: UI_TOKENS.layout.labelGap, flexWrap: 'wrap', flexShrink: 0, paddingTop: UI_TOKENS.spacing.xs, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))' } },
        React.createElement('button', {
          type: 'submit',
          form: ENTRY_DETAILS_FORM_ID,
          disabled: view.mode === 'create' && (feedback === 'pending' || pendingSave !== undefined),
          style: BASE_BUTTON,
        }, view.mode === 'create' ? text.manualSave : text.detailsSave),
        React.createElement('button', { type: 'reset', form: ENTRY_DETAILS_FORM_ID, style: BASE_BUTTON }, text.detailsReset),
      ),
    )
  }

  if (batch === undefined) {
    return React.createElement(
      'div',
      { style: { marginTop: UI_TOKENS.spacing.md, padding: `${UI_TOKENS.spacing.lg} ${UI_TOKENS.spacing.md}`, textAlign: 'center', border: '1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.35))', borderRadius: UI_TOKENS.radius.panel, background: 'var(--dsw-alias-bg-l1, rgba(128,128,128,.04))', color: 'var(--dsw-alias-label-tertiary, inherit)' } },
      React.createElement('div', { 'aria-hidden': true, style: { fontSize: '22px', marginBottom: UI_TOKENS.spacing.xs } }, '⌕'),
      React.createElement('div', { style: { fontSize: '13px', fontWeight: 500 } }, text.batchEmpty),
    )
  }

  return React.createElement(
    'div',
    { ref: listRef, style: { marginTop: UI_TOKENS.spacing.md, display: 'grid', gap: UI_TOKENS.spacing.sm, minWidth: 0 } },
    React.createElement('div', { style: { ...ROW_STYLE, justifyContent: 'space-between', gap: UI_TOKENS.spacing.sm } },
      React.createElement('span', { style: { fontWeight: 500 } }, `${text.batchHeading} · ${String(entries.length)}`),
      React.createElement('div', { style: { ...ROW_STYLE, flexShrink: 0 } },
        React.createElement('span', { style: { opacity: 0.7, fontSize: UI_TOKENS.fontSize.caption } }, batch.scope),
        React.createElement('button', { type: 'button', onClick: onRefresh, style: { ...BASE_BUTTON, padding: '3px 7px' } }, text.refresh))),
    React.createElement('div', { style: { fontSize: UI_TOKENS.fontSize.caption, color: UI_TOKENS.color.neutral } }, text.selectedCount.replace('{n}', String(pickedCount))),
    ...entries.map((entry, index) => {
      const rowKey = String(index)
      const title = titleOf(entry) === '' ? entry.doi ?? entry.arxivId ?? '—' : titleOf(entry)
      const meta = entryMeta(entry, text)
      return React.createElement('div', {
        key: rowKey,
        style: { border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))', borderRadius: UI_TOKENS.radius.panel, padding: `${UI_TOKENS.spacing.sm} ${UI_TOKENS.spacing.sm}`, background: 'var(--dsw-alias-bg-l1, rgba(128,128,128,.035))', minWidth: 0 },
      },
        React.createElement('div', { style: { ...ROW_STYLE, gap: UI_TOKENS.spacing.xs, flexWrap: 'nowrap', minWidth: 0 } },
          entry.id === undefined
            ? React.createElement('span', { style: { width: '13px', flexShrink: 0 } })
            : React.createElement('input', { type: 'checkbox', checked: isPicked(entry), title: text.exportSelection, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onToggle(entry.id as string, event.target.checked), style: { flexShrink: 0, margin: 0 } }),
          React.createElement('span', { style: { color: STATUS_TONE[entry.status], flexShrink: 0, whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: '999px', background: `color-mix(in srgb, ${STATUS_TONE[entry.status]} 14%, transparent)`, fontSize: UI_TOKENS.fontSize.caption } }, statusLabel(entry, text)),
          entry.annotated === true ? React.createElement('span', { title: text.annotated, style: { flexShrink: 0, opacity: 0.65 } }, '✎') : null,
          React.createElement('button', {
            type: 'button',
            ref: (element: HTMLButtonElement | null): void => { const key = `${rowKey}:title`; if (element === null) triggerRefs.current.delete(key); else triggerRefs.current.set(key, element) },
            onClick: () => openDetail(entry, index, entry.id === undefined ? 'create' : 'edit', 'title'),
            style: { flex: '1 1 auto', minWidth: 0, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', padding: 0, cursor: 'pointer' },
            title,
          }, React.createElement('span', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title)),
          entry.status === 'skipped'
            ? React.createElement('button', {
                type: 'button',
                ref: (element: HTMLButtonElement | null): void => { const key = `${rowKey}:manual`; if (element === null) triggerRefs.current.delete(key); else triggerRefs.current.set(key, element) },
                onClick: () => openDetail(entry, index, 'create', 'manual'),
                style: { ...BASE_BUTTON, flexShrink: 0, padding: '3px 7px' },
              }, text.manualOpen)
            : null,
        ),
        meta === '' ? null : React.createElement('div', { title: meta, style: { margin: `${UI_TOKENS.spacing.xs} 0 0 20px`, fontSize: UI_TOKENS.fontSize.caption, lineHeight: 1.4, color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.82))', overflowWrap: 'anywhere' } }, meta),
      )
    }),
  )
}

interface InputActionsLike {
  setDraft: (text: string) => void
  submit: () => void
}

interface PanelProps {
  readonly inputActions?: InputActionsLike
  /** Supplied by the dock slot (session-scoped): the panel reads its batch. */
  readonly sessionId?: string
}

/**
 * Replace the draft and submit it on a later macrotask: `setDraft` publishes a
 * React state update, and submitting in the same tick would snapshot the *old*
 * draft inside the submit transaction.
 */
function manualSaveCommand(payload: Record<string, unknown>): string {
  return `/refs save ${encodeFlag('payload', payload)}`
}

function dispatch(actions: InputActionsLike | undefined, line: string): boolean {
  if (actions === undefined) return false
  actions.setDraft(line)
  setTimeout(() => {
    actions.submit()
  }, 60)
  return true
}

/**
 * `/refs capture`: the panel no longer offers the noisy tool-output opt-in.
 *
 * The panel always saves. A preview-only capture is the one way to end up with
 * candidates on screen and an empty library, which then reads as "nothing was
 * written" the next time an export runs.
 */
function captureLine(current: PanelState, save = true): string {
  const suffix = save ? ' --save' : ''
  if (current.scope === 'all') return `/refs capture --scope=all${suffix}`
  if (current.scope === 'lastN') return `/refs capture --scope=lastN --turns=${String(current.turns)}${suffix}`
  return `/refs capture --scope=turn${suffix}`
}

/** Export keeps the last capture as its default scope; ticks narrow it to `--ids`. */
function formatFlag(current: PanelState): string {
  if (current.bibtex && current.ris) return '--format=both'
  if (current.bibtex) return '--format=bibtex'
  if (current.ris) return '--format=ris'
  return ''
}

function exportLine(current: PanelState, extra = ''): string {
  const parts = [formatFlag(current), extra].filter((part) => part !== '')
  return `/refs export ${parts.join(' ')}`
}

const BASE_BUTTON: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: UI_TOKENS.spacing.xs,
  height: '28px',
  padding: '0 8px',
  borderRadius: UI_TOKENS.radius.control,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: UI_TOKENS.fontSize.control,
  cursor: 'pointer',
}

const PANEL_STYLE: React.CSSProperties = {
  // Rendered from the composer dock, but pinned to the right edge so the long
  // annotation form never pushes the composer or covers the transcript.
  position: 'fixed',
  right: '24px',
  top: '84px',
  zIndex: 60,
  width: '420px',
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100vh - 140px)',
  overflowY: 'auto',
  minWidth: 0,
  boxSizing: 'border-box',
  margin: 0,
  padding: '12px 14px',
  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
  borderRadius: '10px',
  background: 'var(--dsw-alias-bg-l2, rgba(127,127,127,.06))',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 8px 28px rgba(0,0,0,.16)',
  color: 'inherit',
  fontSize: '12px',
  lineHeight: 1.5,
}

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: `${UI_TOKENS.spacing.xs} ${UI_TOKENS.spacing.sm}`,
  borderRadius: UI_TOKENS.radius.control,
  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))',
  background: 'var(--dsw-alias-bg-l1, transparent)',
  color: 'inherit',
  font: 'inherit',
  fontSize: UI_TOKENS.fontSize.control,
}

const ROW_STYLE: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }

/** Composer tool-row button; opens the panel instead of sending anything. */
function CaptureButton(): React.ReactElement {
  const current = usePanelState()
  const text = useStrings()
  return React.createElement(
    'button',
    {
      type: 'button',
      title: text.buttonTitle,
      'aria-label': 'dsh-refkeeper capture',
      'aria-expanded': current.open,
      onClick: () => setState({ open: !current.open }),
      style: {
        ...BASE_BUTTON,
        color: current.open ? 'var(--dsw-alias-brand-primary, #1f6feb)' : 'inherit',
      },
    },
    React.createElement('span', { 'aria-hidden': true }, '❝'),
    text.button,
  )
}

/**
 * Panel below the composer. Lives in `conversation.composer.dock` (full width)
 * rather than the 28px input tool row.
 */
function CapturePanel(props: PanelProps): React.ReactElement | null {
  const current = usePanelState()
  const text = useStrings()
  const [notice, setNotice] = React.useState('')
  // Bumped by the refresh button: the snapshot cache is keyed by revision, and
  // a transcript the client never re-delivers would otherwise stay stale.
  const [nonce, setNonce] = React.useState(0)
  const batch = useLatestBatch(props.sessionId, nonce)
  const dir = useLatestDir(props.sessionId, nonce)
  const rememberedDir = dir === undefined || dir.dir === null ? '' : dir.dir
  // The typed path follows what the host last confirmed, but the user keeps
  // whatever they are editing until they save or clear it.
  const [dirDraft, setDirDraft] = React.useState(rememberedDir)
  const [dirSeed, setDirSeed] = React.useState(rememberedDir)
  if (dirSeed !== rememberedDir) {
    setDirSeed(rememberedDir)
    setDirDraft(rememberedDir)
  }
  const batchKey = batch === undefined ? '' : `${batch.capturedAt}:${String(batch.entries.length)}`
  const [view, setView] = React.useState<PanelView>({ kind: 'list' })
  React.useEffect(() => {
    if (!current.open) setView({ kind: 'list' })
  }, [current.open])
  const [ticks, setTicks] = React.useState<{ key: string; picked: Record<string, boolean> }>({
    key: '',
    picked: {},
  })
  const current_ticks = ticks.key === batchKey ? ticks.picked : undefined
  const isPicked = (entry: BatchEntry): boolean =>
    current_ticks?.[entry.id ?? ''] ?? entry.status === 'saved'
  const pickedIds =
    batch === undefined
      ? []
      : batch.entries
          .filter((entry) => entry.id !== undefined && isPicked(entry))
          .map((entry) => entry.id as string)
  const onToggle = (id: string, next: boolean): void => {
    setTicks((previous) => {
      if (previous.key === batchKey) return { key: previous.key, picked: { ...previous.picked, [id]: next } }
      const seeded: Record<string, boolean> = {}
      for (const entry of batch?.entries ?? []) {
        if (entry.id !== undefined) seeded[entry.id] = entry.status === 'saved'
      }
      seeded[id] = next
      return { key: batchKey, picked: seeded }
    })
  }
  // Reference ids can carry spaces, commas and quotes (quarantined entries are
  // titled after the raw candidate), so the tick list travels base64url-encoded.
  const selectionFlag = pickedIds.length === 0 ? '' : encodeFlag('ids', pickedIds)

  // Edited titles are shown immediately; the transcript is the source of truth
  // for whether the host accepted the edit.
  const [edits, setEdits] = React.useState<{ key: string; titles: Record<string, string> }>({
    key: '',
    titles: {},
  })
  const titleOverrides = edits.key === batchKey ? edits.titles : {}
  const titleOf = (entry: BatchEntry): string =>
    entry.id === undefined ? entry.title : titleOverrides[entry.id] ?? entry.title
  const onEdit = (id: string, patch: Record<string, unknown>, title?: string): void => {
    // encodeFlag already returns `--ids=…` / `--payload=…`; prefixing it here
    // produced `--ids=--ids=…` and the host decoded garbage.
    run(`/refs edit ${encodeFlag('ids', [id])} ${encodeFlag('payload', patch)}`)
    if (title === undefined) return
    setEdits((previous) => {
      const titles = previous.key === batchKey ? previous.titles : {}
      return { key: batchKey, titles: { ...titles, [id]: title } }
    })
  }

  /**
   * Default is a fresh check: it keeps the automatic gate meaningful and only
   * asks for a person when the registries still disagree. The manual path
   * records who decided and what quarantine had objected to.
   */
  const onPromote = (entry: BatchEntry, manual: boolean): void => {
    if (entry.id === undefined) return
    const parts = [encodeFlag('ids', [entry.id])]
    if (manual) parts.push('--manual', encodeFlag('reason', `panel confirmation ${new Date().toISOString()}`))
    run(`/refs promote ${parts.join(' ')}`)
  }

  if (!current.open) return null

  const run = (line: string): void => {
    setNotice(dispatch(props.inputActions, line) ? '' : text.unavailable)
  }

  const formatOption = (key: 'bibtex' | 'ris', label: string): React.ReactElement =>
    React.createElement(
      'label',
      { key, style: { ...ROW_STYLE, gap: '4px', cursor: 'pointer' } },
      React.createElement('input', {
        type: 'checkbox',
        checked: current[key],
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setState({ [key]: event.target.checked } as Partial<PanelState>),
      }),
      label,
    )

  // No format means no file, so the export buttons are disabled rather than
  // silently exporting both.
  const canExport = current.bibtex || current.ris
  const exportStyle = (): React.CSSProperties => ({
    ...BASE_BUTTON,
    opacity: canExport ? 1 : 0.5,
    cursor: canExport ? 'pointer' : 'not-allowed',
  })

  const scopeOption = (value: Scope, label: string): React.ReactElement =>
    React.createElement(
      'label',
      { key: value, style: { ...ROW_STYLE, gap: '4px', cursor: 'pointer' } },
      React.createElement('input', {
        type: 'radio',
        name: 'refkeeper-scope',
        checked: current.scope === value,
        onChange: () => setState({ scope: value }),
      }),
      label,
    )

  return ReactDOM.createPortal(
    React.createElement(
      'section',
      {
        style: view.kind === 'list'
          ? PANEL_STYLE
          : { ...PANEL_STYLE, display: 'flex', flexDirection: 'column', overflowY: 'hidden' },
        'aria-label': 'dsh-refkeeper panel',
      },
    view.kind === 'list'
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, justifyContent: 'space-between' } },
            React.createElement('strong', null, `❝ ${text.heading}`),
            React.createElement(
              'button',
              { type: 'button', onClick: () => setState({ open: false }), style: { ...BASE_BUTTON, height: '24px', padding: '0 6px' } },
              text.close,
            ),
          ),
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, marginTop: '6px' } },
            React.createElement('span', { style: { opacity: 0.7 } }, `${text.scopeLabel}:`),
            scopeOption('turn', text.scopeTurn),
            scopeOption('lastN', text.scopeLastN),
            current.scope === 'lastN'
              ? React.createElement('input', {
                  type: 'number',
                  min: 1,
                  max: 500,
                  value: current.turns,
                  'aria-label': text.turnsLabel,
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    const parsed = Number.parseInt(event.target.value, 10)
                    setState({ turns: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1 })
                  },
                  style: { ...FIELD_STYLE, width: '64px' },
                })
              : null,
            scopeOption('all', text.scopeAll),
          ),
        )
      : null,
    React.createElement(PanelView, {
      view,
      onViewChange: setView,
      batch,
      text,
      isPicked,
      onToggle,
      onEdit,
      onPromote,
      titleOf,
      pickedCount: pickedIds.length,
      onRefresh: () => setNonce((value) => value + 1),
      sessionId: props.sessionId,
      onManualSave: (_entry, payload) => {
        const submitted = dispatch(props.inputActions, manualSaveCommand(payload))
        setNotice(submitted ? '' : text.unavailable)
        return submitted
      },
    }),
    view.kind === 'list'
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, marginTop: '4px', justifyContent: 'space-between', gap: '8px' } },
            React.createElement(
              'span',
              {
                title: rememberedDir === '' ? text.defaultDirUnset : rememberedDir,
                style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 },
              },
              `${text.defaultDirLabel}: ${rememberedDir === '' ? text.defaultDirUnset : rememberedDir}`,
            ),
          ),
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, marginTop: '4px', gap: '6px', flexWrap: 'nowrap' } },
            React.createElement('input', {
              type: 'text',
              value: dirDraft,
              placeholder: text.dirPlaceholder,
              spellCheck: false,
              'aria-label': text.defaultDirLabel,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                setDirDraft(event.target.value)
              },
              style: { ...FIELD_STYLE, flex: '1 1 auto', minWidth: 0 },
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => run(`/refs dir ${encodeFlag('set', dirDraft.trim())}`),
                disabled: dirDraft.trim() === '',
                style: { ...BASE_BUTTON, flexShrink: 0, opacity: dirDraft.trim() === '' ? 0.5 : 1 },
              },
              text.dirSave,
            ),
            React.createElement(
              'button',
              { type: 'button', onClick: () => run('/refs dir --clear'), style: { ...BASE_BUTTON, flexShrink: 0 } },
              text.dirClearLabel,
            ),
          ),
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, marginTop: '4px' } },
            React.createElement('span', { style: { opacity: 0.75 } }, `${text.formatLabel}:`),
            formatOption('bibtex', text.formatBibtex),
            formatOption('ris', text.formatRis),
          ),
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, marginTop: '8px' } },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => run(captureLine(current)),
                style: { ...BASE_BUTTON, borderColor: 'var(--dsw-alias-brand-primary, #1f6feb)' },
              },
              `❝ ${text.capture}`,
            ),
            React.createElement(
              'button',
              { type: 'button', disabled: !canExport, onClick: () => run(exportLine(current, selectionFlag)), style: exportStyle() },
              text.export,
            ),
            React.createElement(
              'button',
              { type: 'button', disabled: !canExport, onClick: () => run(exportLine(current, '--all')), style: exportStyle() },
              text.exportAll,
            ),
          ),
          notice === ''
            ? null
            : React.createElement('div', { style: { marginTop: '6px', color: UI_TOKENS.color.warning } }, notice),
        )
      : null,
    ),
    document.body,
  )
}

/** Cordis client plugin: registrar name is the package, matching the loader id. */
export function apply(ctx: {
  get: (name: string) => unknown
  slots: {
    inject: (name: string, register: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
}): void {
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        // `conversation.input.left` is a *list* slot: it identifies each entry
        // by `id` (a `key` is only for single/chain slots) and refuses the mount
        // otherwise — the failure surfaces as a thrown
        // `list slot ... requires options.id` in the browser console.
        id: 'refkeeper-capture',
        order: 10,
        registrant: REGISTRANT,
      },
      CaptureButton,
    ),
  )
  sessionsLookup = () => ctx.get('sessions') as SessionsLike | undefined
  localeLookup = () => ctx.get('locale') as LocaleLike | undefined
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'refkeeper-panel', order: 20, registrant: REGISTRANT },
      CapturePanel,
    ),
  )
}
