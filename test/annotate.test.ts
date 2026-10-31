import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { annotateCaptured, annotateReferences, groundingFor } from '../src/host/annotate.ts'
import type { LlmServiceLike, TranscriptLine } from '../src/host/annotate.ts'
import { coerceReference, loadStore, saveReference } from '../src/store/io.ts'
import type { StoredReference } from '../src/store/types.ts'
import type { BatchEntry } from '../src/core/batch.ts'

const NOW = '2026-10-31T10:00:00.000Z'
const TITLE = 'Gridded climate data for the United States'
const QUOTE = 'We used gridded climate data for the United States from Daly 2008.'

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'refkeeper-annotate-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function ref(overrides: Record<string, unknown> = {}): StoredReference {
  const built = coerceReference(
    {
      title: TITLE,
      type: 'journalArticle',
      authors: [{ family: 'Daly', given: 'C.' }],
      year: 2008,
      identifiers: { doi: '10.1002/joc.1688' },
      ...overrides,
    },
    NOW,
  )
  if (!built) throw new Error('fixture did not coerce')
  return built
}

function line(seq: number, role: string, text: string): TranscriptLine {
  return { seq, role, text }
}

const TRANSCRIPT: TranscriptLine[] = [
  line(1, 'user', 'Which precipitation dataset should I cite?'),
  line(2, 'assistant', `PRISM is the usual answer. ${QUOTE}`),
]

/** A model that always answers with the given text and finishes cleanly. */
function stubLlm(reply: string): LlmServiceLike {
  return {
    stream: () =>
      (async function* () {
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
  }
}

const ROUTE = { provider: 'stub', model: 'model' }

function answer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      index: 1,
      summary: 'A gridded climate dataset for the contiguous United States.',
      relevance: 'Supplies the precipitation input the analysis depends on.',
      evidence: QUOTE,
      caveats: 'Resolution is coarse enough to smooth local extremes.',
      ...overrides,
    },
  ])
}

describe('grounding', () => {
  it('finds the line a reference was cited on', () => {
    const excerpt = groundingFor(ref(), TRANSCRIPT)
    expect(excerpt).toBeDefined()
    expect(excerpt).toContain(QUOTE)
  })

  it('returns nothing when the conversation never mentions the work', () => {
    expect(groundingFor(ref({ title: 'An unrelated paper about lichens' }), TRANSCRIPT)).toBeUndefined()
  })
})

describe('automatic annotation', () => {
  it('stores a model annotation and quotes the line as evidence', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const outcome = await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(answer()),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    expect(outcome.annotated).toBe(1)
    expect(outcome.model).toBe('stub/model')

    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references[0]?.annotation).toMatchObject({
      summary: 'A gridded climate dataset for the contiguous United States.',
      evidence: QUOTE,
      source: 'model',
      status: 'complete',
    })
  })

  it('drops evidence the model made up instead of storing it', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(answer({ evidence: 'This sentence is not in the transcript at all.' })),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    const loaded = await loadStore(workspace, { now: NOW })
    const annotation = loaded.state.references[0]?.annotation
    expect(annotation?.evidence).toBeUndefined()
    expect(annotation?.summary).not.toBe('')
  })

  it('keeps a user-authored annotation and only fills the blanks', async () => {
    await saveReference(
      workspace,
      ref({ annotation: { summary: 'My own note', source: 'user', status: 'complete' } }),
      { now: NOW },
    )
    await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(answer()),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references[0]?.annotation).toMatchObject({
      summary: 'My own note',
      source: 'hybrid',
    })
  })

  it('drops sentences that only describe the missing evidence', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(
        answer({
          relevance:
            'The supplied excerpt contains no statement of why this work is cited, so its role cannot be determined.',
          caveats:
            'The conversation excerpt consists only of runtime and workspace context and does not mention or cite this reference.',
        }),
      ),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    const loaded = await loadStore(workspace, { now: NOW })
    const annotation = loaded.state.references[0]?.annotation
    // The supported fields survive; the meta-commentary leaves no trace.
    expect(annotation?.summary).toBe('A gridded climate dataset for the contiguous United States.')
    expect(annotation?.relevance).toBeUndefined()
    expect(annotation?.caveats).toBeUndefined()
  })

  it('stores no annotation at all when every field is meta-commentary', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const outcome = await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(
        answer({
          summary: '无法确定，因为上下文未提及该文献。',
          relevance: 'No citation sentence is available in the given text.',
          evidence: '',
          caveats: 'Does not mention or cite this reference.',
        }),
      ),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    expect(outcome.annotated).toBe(0)
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references[0]?.annotation).toBeUndefined()
  })

  it('drops meta-commentary already stored by an earlier capture', async () => {
    await saveReference(
      workspace,
      ref({
        annotation: {
          relevance: 'The provided text does not cite this work.',
          caveats: 'No citation sentence or purpose is available.',
          source: 'model',
          status: 'complete',
        },
      }),
      { now: NOW },
    )
    await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(answer({ summary: '', relevance: '', evidence: '', caveats: '' })),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    const loaded = await loadStore(workspace, { now: NOW })
    expect(loaded.state.references[0]?.annotation).toBeUndefined()
  })

  it('reports why it skipped instead of failing the capture', async () => {
    const noModel = await annotateReferences([ref()], { workspace, lines: TRANSCRIPT })
    expect(noModel.reason).toBe('this host exposes no model service')

    const noRoute = await annotateReferences([ref()], {
      workspace,
      llm: stubLlm(answer()),
      selection: () => undefined,
      lines: TRANSCRIPT,
    })
    expect(noRoute.reason).toBe('no default model is selected in this profile')

    const ungrounded = await annotateReferences([ref({ title: 'Lichens of the Pacific Northwest', year: 1999 })], {
      workspace,
      llm: stubLlm(answer()),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
    })
    expect(ungrounded.reason).toContain('nothing to ground an annotation in')

    const garbage = await annotateReferences([ref()], {
      workspace,
      llm: stubLlm('I am sorry, I cannot help with that.'),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
    })
    expect(garbage.reason).toBe('the model did not return a JSON array of annotations')
  })

  it('marks the capture batch entries that gained an annotation', async () => {
    await saveReference(workspace, ref(), { now: NOW })
    const entries: BatchEntry[] = [
      { title: TITLE, status: 'saved', id: ref().id },
      { title: 'Lichens of the Pacific Northwest', status: 'saved', id: 'title:lichens|1999' },
    ]
    const result = await annotateCaptured(entries, {
      workspace,
      llm: stubLlm(answer()),
      selection: () => ROUTE,
      lines: TRANSCRIPT,
      now: () => new Date(NOW),
    })
    expect(result.outcome.annotated).toBe(1)
    expect(result.entries[0]?.annotated).toBe(true)
    expect(result.entries[1]?.annotated).toBeUndefined()
  })
})
