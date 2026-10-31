import { describe, expect, it } from 'vitest'
import { extractCandidates } from '../src/core/candidates.ts'
import type { SessionEventLike, SessionQueryLike } from '../src/host/session-read.ts'
import { readTranscript } from '../src/host/session-read.ts'

/**
 * Whole local pipeline (identifiers → citations → candidate merge) over the two
 * shapes that broke real data-source lookups: a reference line that ends with a
 * full stop after its DOI, and a compact ISBN-13 with no separators.
 */
describe('extractCandidates over real reference text', () => {
  it('keeps the DOI clean when the line ends with a full stop', () => {
    const [candidate] = extractCandidates([
      {
        seq: 3,
        text: '张三. 深度学习在医学影像中的应用综述[J]. 计算机学报, 2024, 47(3): 1-15. doi:10.1000/abc.',
      },
    ])
    expect(candidate?.doi).toBe('10.1000/abc')
    expect(candidate?.title).toBe('深度学习在医学影像中的应用综述')
    expect(candidate?.year).toBe(2024)
  })

  it('finds a compact ISBN-13 in prose', () => {
    const candidates = extractCandidates([{ seq: 5, text: '详见该书 ISBN 9780306406157。' }])
    expect(candidates.map((candidate) => candidate.isbn)).toContain('9780306406157')
  })
})

/**
 * Regression for a real-data failure: capture reported `0 candidates` on a
 * session that clearly contained citations, because assistant replies carry
 * their blocks under `data.message.content` and were read as empty strings.
 */
describe('transcript read → candidate extraction', () => {
  const RECORDS = [
    { seq: 1, type: 'session/header' },
    { seq: 2, type: 'turn/start' },
    { seq: 3, type: 'user/message' },
    { seq: 4, type: 'assistant/message' },
  ]

  const EVENTS: SessionEventLike[] = [
    { seq: 3, type: 'user/message', data: { content: [{ type: 'text', text: '帮我找几篇参考文献' }] } },
    {
      seq: 4,
      type: 'assistant/message',
      data: {
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: '内部推理不应成为候选' },
            {
              type: 'text',
              text: [
                'Daly, C. (2008). Physiographically sensitive mapping of temperature.',
                'doi:10.1002/joc.1688',
                'Wells, N. (2004). Atmosphere and ocean.',
                'doi:10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2',
              ].join('\n'),
            },
          ],
        },
      },
    },
  ]

  const QUERY: SessionQueryLike = {
    async listEvents() {
      return RECORDS
    },
    async readEvent(request) {
      const from = request.seq - (request.before ?? 0)
      return { events: EVENTS.filter((event) => event.seq >= from && event.seq <= request.seq) }
    },
  }

  it('finds the citations that live in an assistant reply', async () => {
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' }, query: QUERY })
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'assistant'])
    const candidates = extractCandidates(read.segments)
    const dois = candidates.map((candidate) => candidate.doi).filter((doi): doi is string => doi !== undefined)
    expect(dois).toContain('10.1002/joc.1688')
    expect(dois.some((doi) => doi.startsWith('10.1175/1520-0442(2004)017<2335'))).toBe(true)
    expect(candidates.some((candidate) => candidate.title?.includes('内部推理'))).toBe(false)
  })
})
