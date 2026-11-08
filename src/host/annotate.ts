import type { BatchEntry } from './capture-batch.ts'
import { usefulAnnotationText } from '../core/annotation-text.ts'
import { stripMarkup } from '../core/text.ts'
import { withStoreLock } from '../store/atomic.ts'
import { loadQuarantine, loadStore, storePaths, writeQuarantine, writeStore } from '../store/io.ts'
import type { RefAnnotation, StoredReference } from '../store/types.ts'

/**
 * Annotations written by the model right after a capture.
 *
 * The panel used to store bibliography only: a user who captured three works
 * got three rows and no answer to "why is this here". Every annotation is
 * grounded in the conversation transcript, and `evidence` is refused unless it
 * appears verbatim in that transcript — a fabricated quote is worse than a
 * missing one, because it looks like a citation the conversation made.
 */

/** One captured message. Mirrors the segment shape `session-read` produces. */
export interface TranscriptLine {
  readonly seq: number
  readonly role: string
  readonly text: string
}

export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** The slice of `llm` this module calls; declared structurally, not imported. */
export interface LlmServiceLike {
  stream(options: {
    readonly provider: string
    readonly model: string
    readonly messages: readonly {
      readonly role: 'user'
      readonly content: readonly { readonly type: 'text'; readonly text: string }[]
    }[]
    readonly system?: string
    readonly temperature?: number
    readonly maxTokens?: number
    readonly signal?: AbortSignal
  }): AsyncIterable<unknown>
}

export interface AnnotateDeps {
  readonly workspace: string
  readonly llm?: LlmServiceLike | undefined
  /** The profile's default model route; absent when no model is configured. */
  readonly selection?: (() => ModelRoute | undefined) | undefined
  /** The transcript this capture read, used both as prompt context and gate. */
  readonly lines?: readonly TranscriptLine[] | undefined
  readonly signal?: AbortSignal | undefined
  readonly now?: (() => Date) | undefined
}

export interface AnnotationOutcome {
  readonly annotated: number
  readonly considered: number
  /** `provider/model`, or `''` when no call was made. */
  readonly model: string
  /** Set when nothing was annotated; human-readable, safe to print. */
  readonly reason?: string
  readonly ids: readonly string[]
}

/** A batch is small, but a pathological session could cite dozens of works. */
const MAX_REFS = 12
const MAX_EXCERPT_CHARS = 6_000
const MAX_TOKENS = 1_400
const TIMEOUT_MS = 60_000

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function tokensOf(title: string): string[] {
  return normalizeWhitespace(stripMarkup(title))
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
}

function familyOf(ref: StoredReference): string {
  const first = ref.authors[0]
  if (first === undefined) return ''
  const name = first.family ?? first.literal ?? ''
  return name.split(/\s+/u)[0]?.toLowerCase() ?? ''
}

/**
 * The lines that actually mention this work, widened by one line on each side.
 *
 * A citation line alone says "this work exists"; the sentence after it usually
 * says what the conversation used it for, which is the annotation we want.
 */
export function groundingFor(ref: StoredReference, lines: readonly TranscriptLine[]): string | undefined {
  const tokens = tokensOf(ref.title)
  const family = familyOf(ref)
  const doi = (ref.identifiers.doi ?? '').toLowerCase()
  let bestIndex = -1
  let bestScore = 0
  for (const [index, line] of lines.entries()) {
    const text = line.text.toLowerCase()
    let score = 0
    let titleHits = 0
    for (const token of tokens) {
      if (!text.includes(token)) continue
      score += 1
      titleHits += 1
    }
    if (family !== '' && text.includes(family)) score += 3
    if (ref.year !== undefined && text.includes(String(ref.year))) score += 1
    if (doi !== '' && text.includes(doi)) score += 6
    // A shared author and year is not a citation of this work: without at least
    // one title word the line is about something else by the same person.
    if (titleHits === 0) continue
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  if (bestIndex < 0 || bestScore < 2) return undefined
  const first = Math.max(0, bestIndex - 1)
  const last = Math.min(lines.length - 1, bestIndex + 1)
  const excerpt = lines
    .slice(first, last + 1)
    .map((line) => normalizeWhitespace(line.text))
    .filter((text) => text !== '')
    .join('\n')
  if (excerpt === '') return undefined
  return excerpt.length <= 900 ? excerpt : `${excerpt.slice(0, 900)}…`
}

function promptFor(
  refs: readonly { readonly ref: StoredReference; readonly excerpt: string }[],
): string {
  const items = refs.map(({ ref, excerpt }, index) => {
    const authors = ref.authors
      .map((author) => author.literal ?? [author.family, author.given].filter(Boolean).join(', '))
      .filter((name) => name !== '')
    const head = {
      index: index + 1,
      title: stripMarkup(ref.title),
      authors,
      ...(ref.year === undefined ? {} : { year: ref.year }),
      ...(ref.containerTitle === undefined ? {} : { container: stripMarkup(ref.containerTitle) }),
      ...(ref.identifiers.doi === undefined ? {} : { doi: ref.identifiers.doi }),
    }
    return `Reference ${String(index + 1)}:\n${JSON.stringify(head)}\nConversation excerpt:\n${excerpt}`
  })
  return [
    'Annotate the references below for one citation manager. Use only the excerpts given.',
    '',
    items.join('\n\n'),
    '',
    'Reply with a JSON array and nothing else. One object per reference:',
    '{"index": 1, "summary": "…", "relevance": "…", "evidence": "…", "caveats": "…"}',
    '- summary: what the work is or says, one sentence, in the language of the excerpt.',
    '- relevance: why this conversation cites or relies on it, one sentence.',
    '- evidence: the exact sentence from that reference\'s excerpt that cites or relies on it, copied verbatim. Use "" when the excerpt does not say.',
    '- caveats: a limit or uncertainty, one sentence. Use "" when there is none.',
    'Never invent DOIs, years, page numbers, or quotes.',
    'When the excerpt does not support a field, answer "" for that field. Never describe the excerpt, the context, or what is missing: no "the excerpt does not mention", no "no citation sentence is available", no "cannot be determined". An empty field is the correct answer; a sentence about absence is not.',
    'Empty strings are expected answers, not placeholders.',
  ].join('\n')
}

interface RawAnnotation {
  readonly index: number
  readonly summary: string
  readonly relevance: string
  readonly evidence: string
  readonly caveats: string
}

/** Model text → array of annotations. Tolerates fences and surrounding prose. */
export function parseAnnotations(text: string): RawAnnotation[] | undefined {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const out: RawAnnotation[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const index = typeof record['index'] === 'number' ? record['index'] : Number.NaN
    if (!Number.isInteger(index) || index < 1) continue
    const text_ = (key: string): string => {
      const value = record[key]
      if (typeof value !== 'string') return ''
      // Meta-commentary ("the excerpt does not cite this work") is dropped here
      // rather than stored: an empty field is honest, a field explaining its own
      // absence reads as content once it reaches BibTeX or annotated.md.
      return usefulAnnotationText(normalizeWhitespace(stripMarkup(value)))
    }
    out.push({
      index,
      summary: text_('summary').slice(0, 600),
      relevance: text_('relevance').slice(0, 400),
      evidence: text_('evidence').slice(0, 600),
      caveats: text_('caveats').slice(0, 400),
    })
  }
  return out.length === 0 ? undefined : out
}

async function collectCompletion(deps: AnnotateDeps, route: ModelRoute, prompt: string): Promise<string> {
  const llm = deps.llm
  if (llm === undefined) throw new Error('no model service')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const forward = (): void => controller.abort()
  deps.signal?.addEventListener('abort', forward, { once: true })
  try {
    let text = ''
    let failure = ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      system:
        'You annotate bibliographic references. You answer with a JSON array only, using only the text you were given.',
      temperature: 0.2,
      maxTokens: MAX_TOKENS,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (typeof chunk !== 'object' || chunk === null) continue
      const record = chunk as Record<string, unknown>
      if (record['type'] === 'text-delta' && typeof record['text'] === 'string') text += record['text']
      if (record['type'] === 'finish') {
        const reason = record['reason'] as { readonly kind?: string; readonly failure?: { readonly message?: string } } | undefined
        if (reason?.kind === 'error' || reason?.kind === 'aborted') {
          failure = reason.failure?.message ?? reason.kind
        }
        break
      }
    }
    if (failure !== '') throw new Error(failure)
    return text
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', forward)
  }
}

function mergeAnnotation(
  previous: RefAnnotation | undefined,
  next: { summary: string; relevance: string; evidence: string; caveats: string },
  now: string,
): RefAnnotation | undefined {
  // A user's own wording is never overwritten; the model only fills the blanks.
  const keep = previous?.source === 'user'
  const pick = (field: 'summary' | 'relevance' | 'evidence' | 'caveats'): string | undefined => {
    // Older rows may already hold meta-commentary; treat it as absent so the
    // next capture can replace it instead of preserving it forever.
    const old = usefulAnnotationText(previous?.[field])
    if (keep && old !== '') return old
    const fresh = usefulAnnotationText(next[field])
    if (fresh !== '') return fresh
    return old === '' ? undefined : old
  }
  const merged = {
    ...(pick('summary') === undefined ? {} : { summary: pick('summary') }),
    ...(pick('relevance') === undefined ? {} : { relevance: pick('relevance') }),
    ...(pick('evidence') === undefined ? {} : { evidence: pick('evidence') }),
    ...(pick('caveats') === undefined ? {} : { caveats: pick('caveats') }),
  }
  // All four fields dropped: there is no annotation, only an empty shell. Drop
  // the record's annotation entirely rather than leave `_ (model)_` with no text.
  if (Object.keys(merged).length === 0) return undefined
  return { ...merged, source: keep ? 'hybrid' : 'model', status: 'complete', updatedAt: now }
}

/**
 * Annotate stored references from transcript grounding.
 *
 * Returns counts instead of throwing: capture must succeed even when the model
 * is unavailable, because the bibliography is the durable part and the
 * annotation is the enrichment.
 */
export async function annotateReferences(
  refs: readonly StoredReference[],
  deps: AnnotateDeps,
): Promise<AnnotationOutcome> {
  const considered = refs.length
  if (considered === 0) {
    return { annotated: 0, considered: 0, model: '', reason: 'nothing to annotate', ids: [] }
  }
  if (deps.llm === undefined) {
    return {
      annotated: 0,
      considered,
      model: '',
      reason: 'this host exposes no model service',
      ids: [],
    }
  }
  const route = deps.selection?.()
  if (route === undefined || route.provider === '' || route.model === '') {
    return {
      annotated: 0,
      considered,
      model: '',
      reason: 'no default model is selected in this profile',
      ids: [],
    }
  }
  const lines = deps.lines ?? []
  const grounded: { ref: StoredReference; excerpt: string }[] = []
  let budget = MAX_EXCERPT_CHARS
  for (const ref of refs) {
    if (grounded.length >= MAX_REFS) break
    const excerpt = groundingFor(ref, lines)
    if (excerpt === undefined) continue
    if (excerpt.length > budget) continue
    budget -= excerpt.length
    grounded.push({ ref, excerpt })
  }
  if (grounded.length === 0) {
    return {
      annotated: 0,
      considered,
      model: `${route.provider}/${route.model}`,
      reason: 'the conversation excerpt for these entries is not in this capture, so there is nothing to ground an annotation in',
      ids: [],
    }
  }

  let reply: string
  try {
    reply = await collectCompletion(deps, route, promptFor(grounded))
  } catch (error) {
    return {
      annotated: 0,
      considered,
      model: `${route.provider}/${route.model}`,
      reason: `the model call failed (${error instanceof Error ? error.message : String(error)})`,
      ids: [],
    }
  }
  const parsed = parseAnnotations(reply)
  if (parsed === undefined) {
    return {
      annotated: 0,
      considered,
      model: `${route.provider}/${route.model}`,
      reason: 'the model did not return a JSON array of annotations',
      ids: [],
    }
  }

  return withStoreLock(storePaths(deps.workspace).dir, async () => {
    const now = (deps.now?.() ?? new Date()).toISOString()
    // Load first: whether an existing annotation is pure meta-commentary is a
    // property of the stored row, not of the candidate passed in here.
    const store = await loadStore(deps.workspace, { now })
    const quarantine = await loadQuarantine(deps.workspace, { now })
    const storedAnnotations = new Map<string, RefAnnotation | undefined>()
    for (const stored of [...store.state.references, ...quarantine.entries]) {
      storedAnnotations.set(stored.id, stored.annotation)
    }
    const answers = new Map(parsed.map((item) => [item.index, item]))
    /** True when an annotation still says something after meta-commentary is removed. */
    const usable = (annotation: RefAnnotation | undefined): boolean =>
      annotation !== undefined &&
      [annotation.summary, annotation.relevance, annotation.evidence, annotation.caveats].some(
        (field) => usefulAnnotationText(field) !== '',
      )
    const wanted = new Map<string, { summary: string; relevance: string; evidence: string; caveats: string }>()
    // Rows that only ever held "the excerpt does not cite this work" are cleaned
    // here instead of being carried forward: a stale explanation of absence is
    // exactly the text the user asked never to see again.
    const drop = new Set<string>()
    grounded.forEach(({ ref, excerpt }, index) => {
      const previous = storedAnnotations.get(ref.id)
      const stale = previous !== undefined && !usable(previous)
      const answer = answers.get(index + 1)
      if (answer === undefined) {
        if (stale) drop.add(ref.id)
        return
      }
      // The gate: a quote that is not in the transcript is a fabrication, so the
      // evidence falls back to the line the work was actually found on.
      const haystack = normalizeWhitespace(excerpt)
      const quoted = answer.evidence
      const verbatim = quoted.length >= 12 && haystack.toLowerCase().includes(quoted.toLowerCase())
      const evidence = verbatim ? quoted : ''
      if (answer.summary === '' && answer.relevance === '' && evidence === '' && answer.caveats === '') {
        if (stale) drop.add(ref.id)
        return
      }
      wanted.set(ref.id, {
        summary: answer.summary,
        relevance: answer.relevance,
        evidence,
        caveats: answer.caveats,
      })
    })
    if (wanted.size === 0 && drop.size === 0) {
      return {
        annotated: 0,
        considered,
        model: `${route.provider}/${route.model}`,
        reason: 'the model returned no usable annotation for these entries',
        ids: [],
      }
    }

    const touched: string[] = []
    const annotatedIds: string[] = []
    const apply = (list: readonly StoredReference[]): StoredReference[] =>
      list.map((ref) => {
        const next = wanted.get(ref.id)
        const removeThis = drop.has(ref.id)
        if (next === undefined && !removeThis) return ref
        touched.push(ref.id)
        if (next === undefined) {
          const rest = { ...ref }
          delete rest.annotation
          return { ...rest, updatedAt: now }
        }
        const annotation = mergeAnnotation(ref.annotation, next, now)
        if (annotation === undefined) {
          const rest = { ...ref }
          delete rest.annotation
          return { ...rest, updatedAt: now }
        }
        annotatedIds.push(ref.id)
        return { ...ref, annotation, updatedAt: now }
      })
    const references = apply(store.state.references)
    const entries = apply(quarantine.entries)
    if (touched.length === 0) {
      return {
        annotated: 0,
        considered,
        model: `${route.provider}/${route.model}`,
        reason: 'the annotated entries are no longer in the library',
        ids: [],
      }
    }
    if (references !== store.state.references) {
      await writeStore(deps.workspace, { ...store.state, updatedAt: now, references })
    }
    if (entries !== quarantine.entries) {
      await writeQuarantine(deps.workspace, { ...quarantine, updatedAt: now, entries })
    }
    return {
      annotated: annotatedIds.length,
      considered,
      model: `${route.provider}/${route.model}`,
      ...(annotatedIds.length === 0
        ? { reason: 'the stored annotations only described the missing evidence, so they were removed' }
        : {}),
      ids: annotatedIds,
    }
  })
}

/**
 * Annotate what a capture just stored, and mark the batch entries that gained
 * an annotation so the panel can show it without a second read.
 */
export async function annotateCaptured(
  entries: readonly BatchEntry[],
  deps: AnnotateDeps,
): Promise<{ entries: BatchEntry[]; outcome: AnnotationOutcome }> {
  const ids = entries
    .filter((entry) => entry.id !== undefined && (entry.status === 'saved' || entry.status === 'quarantined'))
    .map((entry) => entry.id as string)
  if (ids.length === 0) {
    return {
      entries: [...entries],
      outcome: { annotated: 0, considered: 0, model: '', reason: 'nothing was stored', ids: [] },
    }
  }
  const now = (deps.now?.() ?? new Date()).toISOString()
  const store = await loadStore(deps.workspace, { now })
  const quarantine = await loadQuarantine(deps.workspace, { now })
  const pool = new Map<string, StoredReference>()
  for (const ref of [...store.state.references, ...quarantine.entries]) pool.set(ref.id, ref)
  const refs = ids.map((id) => pool.get(id)).filter((ref): ref is StoredReference => ref !== undefined)
  const outcome = await annotateReferences(refs, deps)
  const annotated = new Set(outcome.ids)
  return {
    entries: entries.map((entry) =>
      entry.id !== undefined && annotated.has(entry.id) ? { ...entry, annotated: true } : entry,
    ),
    outcome,
  }
}
