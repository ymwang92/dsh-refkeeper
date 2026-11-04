import * as React from 'react'

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
import { parseAuthors } from './ui/authors.ts'
import { decodeDir } from './core/panel.ts'
import type { DirectorySetting } from './core/panel.ts'
import { encodeFlag, payloadFlag } from './ui/payload.ts'

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

interface Strings {
  readonly button: string
  readonly buttonTitle: string
  readonly heading: string
  readonly scopeLabel: string
  readonly scopeTurn: string
  readonly scopeLastN: string
  readonly scopeAll: string
  readonly turnsLabel: string
  readonly includeTools: string
  readonly exportSelection: string
  readonly exportNone: string
  readonly capture: string
  readonly captureAndSave: string
  readonly manualToggle: string
  readonly manualHint: string
  readonly title: string
  readonly doi: string
  readonly year: string
  readonly authors: string
  readonly summary: string
  readonly relevance: string
  readonly evidence: string
  readonly caveats: string
  readonly save: string
  readonly list: string
  readonly export: string
  readonly exportAll: string
  readonly exportChooseDir: string
  /** Folder the export buttons write into by default. */
  readonly defaultDirLabel: string
  readonly defaultDirUnset: string
  readonly dirPlaceholder: string
  readonly dirSave: string
  readonly dirClearLabel: string
  readonly formatLabel: string
  readonly formatBibtex: string
  readonly formatRis: string
  readonly enrich: string
  readonly batchHeading: string
  readonly batchEmpty: string
  readonly refresh: string
  /** Tooltip on the mark that says the model annotated this entry. */
  readonly annotated: string
  /** Move a quarantined entry into the library after a fresh check. */
  readonly promoteVerify: string
  /** Move a quarantined entry in as manually accepted, no registry check. */
  readonly promoteManual: string
  readonly statusSaved: string
  readonly statusQuarantined: string
  readonly statusSkipped: string
  readonly statusFailed: string
  readonly close: string
  readonly needTitle: string
  readonly unavailable: string
  readonly detailsShow: string
  readonly detailsHide: string
  readonly detailsSave: string
  readonly detailsSaved: string
  readonly detailsStale: string
  readonly detailsReset: string
  readonly fieldType: string
  readonly fieldTitle: string
  readonly fieldAuthors: string
  readonly fieldAuthorsHint: string
  readonly fieldContainer: string
  readonly fieldYear: string
  readonly fieldVolume: string
  readonly fieldIssue: string
  readonly fieldPages: string
  readonly fieldPublisher: string
  readonly fieldPlace: string
  readonly fieldLanguage: string
  readonly fieldDoi: string
  readonly fieldArxiv: string
  readonly fieldUrl: string
}

const EN: Strings = {
  button: 'Refs',
  buttonTitle: 'Capture references from this conversation',
  heading: 'Capture references',
  scopeLabel: 'Scope',
  scopeTurn: 'This turn',
  scopeLastN: 'Last N turns',
  scopeAll: 'Whole conversation',
  turnsLabel: 'Turns',
  includeTools: 'Include tool outputs (noisy)',
  exportSelection: 'Tick the references to export.',
  exportNone: 'Nothing ticked: the whole last capture would be exported.',
  capture: 'Capture & save',
  captureAndSave: 'Capture & save',
  manualToggle: 'Add / annotate manually',
  manualHint:
    'Takes the same `/refs save` path as the model: the entry is verified first and only stored when it passes.',
  title: 'Title *',
  doi: 'DOI',
  year: 'Year',
  authors: 'Authors (comma separated)',
  summary: 'Summary',
  relevance: 'Relevance to this work',
  evidence: 'Evidence (quote or location)',
  caveats: 'Caveats',
  save: 'Verify & save',
  list: 'Library',
  export: 'Export this capture',
  exportAll: 'Export all references',
  exportChooseDir: 'Choose export folder…',
  defaultDirLabel: 'Folder',
  defaultDirUnset: 'not set (refs/exports/)',
  dirPlaceholder: 'Paste a folder path…',
  dirSave: 'Save folder',
  dirClearLabel: 'Clear',
  formatLabel: 'Formats',
  formatBibtex: 'BibTeX',
  formatRis: 'RIS',
  enrich: 'Fill missing fields',
  batchHeading: 'Last capture',
  batchEmpty: 'Nothing captured yet — the export buttons then fall back to the whole library.',
  refresh: 'Refresh list',
  annotated: 'annotated',
  promoteVerify: 'Re-verify',
  promoteManual: 'Store as manual',
  statusSaved: 'saved',
  statusQuarantined: '⚠ quarantined',
  statusSkipped: 'skipped',
  statusFailed: 'failed',
  close: 'Close',
  needTitle: 'A title is required before saving.',
  unavailable: 'The composer is not ready yet; reopen the panel and retry.',
  detailsShow: 'Details',
  detailsHide: 'Hide',
  detailsSave: 'Save changes',
  detailsSaved: 'Saved. Exports now use these fields.',
  detailsStale:
    'This entry was captured before field snapshots existed, so only its title, year and id are known. Press “Fill missing fields” (or capture again) to pull the full record from the registries.',
  detailsReset: 'Revert',
  fieldType: 'Type',
  fieldTitle: 'Title',
  fieldAuthors: 'Authors (one per line)',
  fieldAuthorsHint: 'Family, Given',
  fieldContainer: 'Publication',
  fieldYear: 'Year',
  fieldVolume: 'Volume',
  fieldIssue: 'Issue',
  fieldPages: 'Pages',
  fieldPublisher: 'Publisher',
  fieldPlace: 'Place',
  fieldLanguage: 'Language',
  fieldDoi: 'DOI',
  fieldArxiv: 'arXiv ID',
  fieldUrl: 'URL',
}

const ZH: Strings = {
  button: '引用',
  buttonTitle: '从当前对话中捕获文献',
  heading: '捕获文献',
  scopeLabel: '范围',
  scopeTurn: '本轮',
  scopeLastN: '前 N 轮',
  scopeAll: '全部对话',
  turnsLabel: '轮数',
  includeTools: '包含工具输出（可能含噪声）',
  exportSelection: '勾选需要导出的文献',
  exportNone: '没有勾选任何条目：将导出整批次（含已入表条目）',
  capture: '捕获并保存',
  captureAndSave: '捕获并保存',
  manualToggle: '手动添加 / 补充注解',
  manualHint: '与模型走同一条 `/refs save`：先校验，通过才入主表，不通过进 ⚠ 区。',
  title: '标题 *',
  doi: 'DOI',
  year: '年份',
  authors: '作者（逗号分隔）',
  summary: '摘要',
  relevance: '与本工作的关系',
  evidence: '证据（原话或位置）',
  caveats: '注意事项',
  save: '校验并保存',
  list: '文献库',
  export: '导出本次捕获',
  exportAll: '导出全部文献',
  exportChooseDir: '选择导出目录…',
  defaultDirLabel: '文件夹',
  defaultDirUnset: '未设置（refs/exports/）',
  dirPlaceholder: '粘贴文件夹路径…',
  dirSave: '保存文件夹',
  dirClearLabel: '清除',
  formatLabel: '导出格式',
  formatBibtex: 'BibTeX',
  formatRis: 'RIS',
  enrich: '补全缺失字段',
  batchHeading: '最近一次捕获',
  batchEmpty: '还没有捕获记录；此时导出会退回整库。',
  refresh: '刷新列表',
  annotated: '已注解',
  promoteVerify: '重新核验',
  promoteManual: '人工确认入表',
  statusSaved: '已入表',
  statusQuarantined: '⚠ 隔离',
  statusSkipped: '跳过',
  statusFailed: '失败',
  close: '关闭',
  needTitle: '保存前必须填写标题。',
  unavailable: '输入框尚未就绪，请重新打开面板再试。',
  detailsShow: '详细信息',
  detailsHide: '收起',
  detailsSave: '保存修改',
  detailsSaved: '已保存，导出将使用修改后的字段。',
  detailsStale:
    '这条是较早捕获留下的，只存了标题、年份和标识，没有完整字段。点“补全缺失字段”（或重新捕获一次）即可从 Crossref / OpenAlex 补全。',
  detailsReset: '还原',
  fieldType: '条目类型',
  fieldTitle: '标题',
  fieldAuthors: '作者（每行一个）',
  fieldAuthorsHint: '“姓, 名”',
  fieldContainer: '出版物',
  fieldYear: '年份',
  fieldVolume: '卷',
  fieldIssue: '期',
  fieldPages: '页码',
  fieldPublisher: '出版社',
  fieldPlace: '出版地',
  fieldLanguage: '语言',
  fieldDoi: 'DOI',
  fieldArxiv: 'arXiv ID',
  fieldUrl: 'URL',
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

/** Pick a dictionary for one BCP 47 tag, defaulting to English. */
function stringsFor(tag: string | undefined): Strings {
  return tag !== undefined && tag.toLowerCase().startsWith('zh') ? ZH : EN
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
  saved: 'var(--dsw-alias-success, #1a7f37)',
  quarantined: 'var(--dsw-alias-warn, #b26a00)',
  skipped: 'var(--dsw-alias-fg-secondary, #6b7280)',
  failed: 'var(--dsw-alias-danger, #b42318)',
}

function statusLabel(entry: BatchEntry, text: Strings): string {
  if (entry.status === 'saved') return text.statusSaved
  if (entry.status === 'quarantined') return text.statusQuarantined
  if (entry.status === 'skipped') return text.statusSkipped
  return text.statusFailed
}

interface FieldRow {
  readonly key: 'type' | 'title' | 'authors' | 'containerTitle' | 'year' | 'volume' | 'issue' | 'pages' | 'publisher' | 'publisherPlace' | 'language' | 'doi' | 'arxivId' | 'url'
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
      patch['authors'] = value === '' ? [] : value.split('\n').map((line) => line.trim()).filter((line) => line !== '')
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

/** Zotero-style field list for one captured reference, editable in place. */
function EntryDetails(props: {
  readonly entry: BatchEntry
  readonly text: Strings
  readonly onSave: (id: string, patch: Record<string, unknown>, title?: string) => void
}): React.ReactElement {
  const { entry, text, onSave } = props
  const [draft, setDraft] = React.useState<Record<string, string>>(() => draftOf(entry))
  const [saved, setSaved] = React.useState(false)
  const editable = entry.id !== undefined

  const change = (key: string, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  return React.createElement(
    'div',
    { style: { display: 'grid', gap: '4px', padding: '6px 0 8px 19px' } },
    entry.fields === undefined && entry.id !== undefined
      ? React.createElement(
          'div',
          { style: { opacity: 0.65, fontSize: '11px', lineHeight: 1.4 } },
          text.detailsStale,
        )
      : null,
    ...FIELDS.map((field) =>
      React.createElement(
        'label',
        {
          key: field.key,
          style: { display: 'grid', gridTemplateColumns: '92px 1fr', gap: '6px', alignItems: 'start' },
        },
        // 11px + a 92px column is what lets 「作者（每行一个）」 sit on one line and
        // its hint (“姓, 名”) on the next; pre-line honours the newline in the label.
        React.createElement(
          'span',
          { style: { opacity: 0.7, fontSize: '11px', lineHeight: '1.35', whiteSpace: 'pre-line' } },
          field.label(text),
        ),
        React.createElement(field.multiline === true ? 'textarea' : 'input', {
          ...(field.multiline === true ? { rows: field.key === 'authors' ? 3 : 2 } : {}),
          ...(field.key === 'authors' ? { placeholder: text.fieldAuthorsHint } : {}),
          ...(field.numeric === true ? { inputMode: 'numeric' } : {}),
          value: draft[field.key] ?? '',
          disabled: !editable,
          readOnly: !editable,
          style: { width: '100%', font: 'inherit' },
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            change(field.key, event.target.value),
        }),
      ),
    ),
    editable
      ? React.createElement(
          'div',
          { style: { ...ROW_STYLE, gap: '8px' } },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                const patch = patchOf(entry, draft)
                if (Object.keys(patch).length === 0) return
                const nextTitle = typeof patch['title'] === 'string' ? patch['title'] : undefined
                onSave(entry.id as string, patch, nextTitle)
                setSaved(true)
              },
            },
            text.detailsSave,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                setDraft(draftOf(entry))
                setSaved(false)
              },
            },
            text.detailsReset,
          ),
          saved ? React.createElement('span', { style: { opacity: 0.7 } }, text.detailsSaved) : null,
        )
      : null,
  )
}

/** What the last capture actually did, entry by entry. */
function BatchList(props: {
  readonly batch: CaptureBatch | undefined
  readonly text: Strings
  readonly isPicked: (entry: BatchEntry) => boolean
  readonly onToggle: (id: string, next: boolean) => void
  readonly onEdit: (id: string, patch: Record<string, unknown>, title?: string) => void
  readonly onPromote: (entry: BatchEntry, manual: boolean) => void
  readonly titleOf: (entry: BatchEntry) => string
}): React.ReactElement {
  const { batch, text, isPicked, onToggle, onEdit, onPromote, titleOf } = props
  if (batch === undefined) {
    return React.createElement('div', { style: { marginTop: '8px', opacity: 0.7 } }, text.batchEmpty)
  }
  return React.createElement(
    'div',
    { style: { marginTop: '8px', display: 'grid', gap: '2px' } },
    React.createElement(
      'div',
      { style: { ...ROW_STYLE, justifyContent: 'space-between', opacity: 0.8 } },
      React.createElement('strong', null, `${text.batchHeading} · ${String(batch.entries.length)}`),
      React.createElement('span', null, batch.scope),
    ),
    ...batch.entries.map((entry, index) =>
      React.createElement(
        'details',
        { key: `${String(index)}:${entry.id ?? entry.title}`, style: { padding: '2px 0' } },
        // The panel sits in a 340px dock, so the row must never wrap: the
        // checkbox and the status keep their width and the title takes what is
        // left and ellipsises. The flex row lives inside <summary> instead of
        // replacing its display, otherwise the disclosure marker disappears.
        React.createElement(
          'summary',
          { style: { cursor: 'pointer' } },
          React.createElement(
            'div',
            { style: { ...ROW_STYLE, gap: '6px', flexWrap: 'nowrap', overflow: 'hidden' } },
            entry.id === undefined
              ? React.createElement('span', { style: { width: '13px', flexShrink: 0 } })
              : React.createElement('input', {
                  type: 'checkbox',
                  checked: isPicked(entry),
                  title: text.exportSelection,
                  onClick: (event: React.MouseEvent) => event.stopPropagation(),
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                    onToggle(entry.id as string, event.target.checked),
                  style: { flexShrink: 0, margin: 0 },
                }),
            React.createElement(
              'span',
              { style: { color: STATUS_TONE[entry.status], flexShrink: 0, whiteSpace: 'nowrap' } },
              statusLabel(entry, text),
            ),
            entry.annotated === true
              ? React.createElement(
                  'span',
                  { title: text.annotated, style: { flexShrink: 0, opacity: 0.65 } },
                  '✎',
                )
              : null,
            React.createElement(
              'span',
              {
                style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                title: titleOf(entry),
              },
              titleOf(entry) === '' ? entry.doi ?? entry.arxivId ?? '—' : titleOf(entry),
            ),
          ),
        ),
        React.createElement(EntryDetails, { entry, text, onSave: onEdit }),
        // Only a quarantined row can move: verified rows are already in the
        // library and skipped rows never became candidates.
        entry.status === 'quarantined' && entry.id !== undefined
          ? React.createElement(
              'div',
              { style: { display: 'flex', gap: '6px', padding: '0 0 8px 19px' } },
              React.createElement(
                'button',
                { type: 'button', onClick: () => onPromote(entry, false) },
                text.promoteVerify,
              ),
              React.createElement(
                'button',
                { type: 'button', onClick: () => onPromote(entry, true) },
                text.promoteManual,
              ),
            )
          : null,
      ),
    ),
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
  gap: '4px',
  height: '28px',
  padding: '0 8px',
  borderRadius: '6px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
}

const PANEL_STYLE: React.CSSProperties = {
  // Rendered from the composer dock, but pinned to the right edge so the long
  // annotation form never pushes the composer or covers the transcript.
  position: 'fixed',
  right: '24px',
  top: '84px',
  zIndex: 60,
  width: '360px',
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
  padding: '4px 6px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))',
  background: 'var(--dsw-alias-bg-l1, transparent)',
  color: 'inherit',
  font: 'inherit',
  fontSize: '12px',
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

  return React.createElement(
    'section',
    { style: PANEL_STYLE, 'aria-label': 'dsh-refkeeper panel' },
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
    React.createElement(BatchList, { batch, text, isPicked, onToggle, onEdit, onPromote, titleOf }),
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
      React.createElement('button', { type: 'button', onClick: () => setNonce((value) => value + 1), style: { ...BASE_BUTTON, flexShrink: 0 } }, text.refresh),
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
      : React.createElement('div', { style: { marginTop: '6px', color: 'var(--dsw-alias-warn, #b26a00)' } }, notice),

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
