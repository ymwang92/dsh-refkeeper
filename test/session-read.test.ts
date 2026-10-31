import { describe, expect, it } from 'vitest'
import type { SessionEventLike, SessionLike, SessionQueryLike } from '../src/host/session-read.ts'
import { readTranscript, textOfEvent } from '../src/host/session-read.ts'

const RECORDS = [
  { seq: 1, type: 'session/header' },
  { seq: 2, type: 'turn/start' },
  { seq: 3, type: 'user/message' },
  { seq: 4, type: 'assistant/message' },
  { seq: 5, type: 'turn/start' },
  { seq: 6, type: 'user/message' },
  { seq: 7, type: 'tool/result' },
  { seq: 8, type: 'assistant/message' },
]

const EVENTS: SessionEventLike[] = [
  { seq: 3, type: 'user/message', data: { content: [{ type: 'text', text: 'first question' }] } },
  {
    seq: 4,
    type: 'assistant/message',
    // Real host shape: assistant replies arrive wrapped in a message object.
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'private reasoning' },
          { type: 'text', text: 'first answer' },
        ],
      },
    },
  },
  { seq: 6, type: 'user/message', data: { content: [{ type: 'text', text: 'second question' }] } },
  { seq: 7, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'tool output' }] } } },
  {
    seq: 8,
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] } },
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

describe('textOfEvent', () => {
  it('reads assistant text from the nested message and skips thinking blocks', () => {
    expect(textOfEvent(EVENTS[1] as SessionEventLike)).toBe('first answer')
  })

  it('reads tool output from the nested message', () => {
    expect(textOfEvent(EVENTS[3] as SessionEventLike)).toBe('tool output')
  })

  it('still reads a flat data.content payload', () => {
    const flat: SessionEventLike = {
      seq: 9,
      type: 'assistant/message',
      data: { content: [{ type: 'text', text: 'flat answer' }] },
    }
    expect(textOfEvent(flat)).toBe('flat answer')
  })

  it('ignores non-message events', () => {
    expect(textOfEvent({ seq: 1, type: 'turn/start' })).toBe('')
  })
})

describe('readTranscript over sessionQuery', () => {
  it('reads only the last turn for scope "turn"', async () => {
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'turn' }, query: QUERY })
    expect(read.readMode).toBe('sessionQuery')
    expect(read.resolution).toMatchObject({ startSeq: 5, turns: 1 })
    expect(read.segments.map((segment) => segment.seq)).toEqual([6, 8])
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'assistant'])
  })

  it('covers the last two turns for scope lastN', async () => {
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'lastN', turns: 2 }, query: QUERY })
    expect(read.resolution).toMatchObject({ startSeq: 2, turns: 2 })
    expect(read.segments.map((segment) => segment.seq)).toEqual([3, 4, 6, 8])
  })

  it('includes tool output only when explicitly requested', async () => {
    const read = await readTranscript({
      sessionId: 's',
      scope: { kind: 'turn' },
      query: QUERY,
      includeTools: true,
    })
    expect(read.segments.map((segment) => segment.seq)).toEqual([6, 7, 8])
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'tool', 'assistant'])
  })

  it('applies includeTools when sessionQuery prefers live surface text', async () => {
    const read = await readTranscript({
      sessionId: 's',
      scope: { kind: 'turn' },
      query: QUERY,
      session: {
        id: 's',
        seq: 8,
        surface: { nodes: [3, 4, 6, 7, 8] },
        eventAt(seq: number) {
          return EVENTS.find((event) => event.seq === seq)
        },
      },
      includeTools: true,
    })
    expect(read.readMode).toBe('session-surface')
    expect(read.segments.map((segment) => segment.seq)).toEqual([6, 7, 8])
  })

  it('filters tool output before applying the character budget', async () => {
    const query: SessionQueryLike = {
      async listEvents() {
        return [
          { seq: 1, type: 'turn/start' },
          { seq: 2, type: 'user/message' },
          { seq: 3, type: 'tool/result' },
          { seq: 4, type: 'assistant/message' },
        ]
      },
      async readEvent() {
        return {
          events: [
            { seq: 1, type: 'turn/start' },
            { seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'user' }] } },
            { seq: 3, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'x'.repeat(40) }] } } },
            { seq: 4, type: 'assistant/message', data: { content: [{ type: 'text', text: 'reply' }] } },
          ],
        }
      },
    }
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' }, query, maxChars: 9 })
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'assistant'])
    expect(read.chars).toBe(9)
    expect(read.truncated).toBe(false)
  })

  it('drops older segments whole when the budget is tight', async () => {
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' }, query: QUERY, maxChars: 20 })
    expect(read.truncated).toBe(true)
    expect(read.segments.map((segment) => segment.seq)).toEqual([8])
    expect(read.chars).toBe('second answer'.length)
  })

  it('widens to the whole conversation when the log has no turn boundaries', async () => {
    const noTurns: SessionQueryLike = {
      async listEvents() {
        return RECORDS.filter((record) => record.type !== 'turn/start')
      },
      readEvent: QUERY.readEvent,
    }
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'turn' }, query: noTurns })
    expect(read.resolution.degraded).toBe('no-turn-boundaries')
    expect(read.segments).toHaveLength(4)
  })
})

describe('readTranscript without a query service', () => {
  const session: SessionLike = {
    id: 's',
    seq: 8,
    surface: { nodes: [3, 4, 6, 7, 8] },
    eventAt(seq: number) {
      return EVENTS.find((event) => event.seq === seq)
    },
  }

  it('reads message text from the surface when the log is unavailable', async () => {
    // Turn boundaries are unknown, so the scope degrades — but the messages
    // themselves are in process and must not be silently dropped.
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'turn' }, session })
    expect(read.readMode).toBe('session-surface')
    expect(read.resolution.degraded).toBe('no-turn-boundaries')
    expect(read.segments).toHaveLength(4)
  })

  it('includes tool output on the session surface only when requested', async () => {
    const read = await readTranscript({
      sessionId: 's',
      scope: { kind: 'all' },
      session,
      includeTools: true,
    })
    expect(read.readMode).toBe('session-surface')
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'assistant', 'user', 'tool', 'assistant'])
  })

  it('reports "none" when the surface has no readable message', async () => {
    const blank: SessionLike = { ...session, surface: { nodes: [] }, eventAt: () => undefined }
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' }, session: blank })
    expect(read.readMode).toBe('none')
    expect(read.segments).toEqual([])
  })

  it('uses the deprecated path only when explicitly allowed', async () => {
    const read = await readTranscript({
      sessionId: 's',
      scope: { kind: 'all' },
      session,
      allowLegacyRead: true,
    })
    expect(read.readMode).toBe('legacy-eventAt')
    expect(read.segments).toHaveLength(4)
  })

  it('includes legacy tool output only when requested', async () => {
    const read = await readTranscript({
      sessionId: 's',
      scope: { kind: 'all' },
      session,
      allowLegacyRead: true,
      includeTools: true,
    })
    expect(read.readMode).toBe('legacy-eventAt')
    expect(read.segments.map((segment) => segment.role)).toEqual(['user', 'assistant', 'user', 'tool', 'assistant'])
  })

  it('reports "none" when neither a query service nor a session exists', async () => {
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' } })
    expect(read.readMode).toBe('none')
    expect(read.resolution.turns).toBe(0)
  })
})

describe('turn boundaries from the turnOutline projection', () => {
  it('uses projection turns when the persisted log only covers one turn', async () => {
    // A long session can be segmented: the log starts mid-conversation but the
    // projection still knows all four turns started at 2, 5, 12 and 20.
    const segmented: SessionQueryLike = {
      async listEvents() {
        return [
          { seq: 20, type: 'turn/start' },
          { seq: 21, type: 'user/message' },
          { seq: 22, type: 'assistant/message' },
        ]
      },
      async readEvent(request) {
        return {
          events: [
            { seq: 21, type: 'user/message', data: { content: [{ type: 'text', text: 'late question' }] } },
            { seq: 22, type: 'assistant/message', data: { content: [{ type: 'text', text: 'late answer' }] } },
          ].filter((event) => event.seq <= request.seq),
        }
      },
    }
    const read = await readTranscript({
      sessionId: 's1',
      scope: { kind: 'lastN', turns: 2 },
      query: segmented,
      turnStarts: [2, 5, 12, 20],
    })
    // The window covers two turns, and it starts where the projection says
    // turn 3 began — not where the segmented log begins.
    expect(read.resolution.turns).toBe(2)
    expect(read.resolution.startSeq).toBe(12)
    expect(read.readMode).toBe('sessionQuery')
  })
})

describe('read window safety', () => {
  it('never anchors on a seq the persisted log does not have', async () => {
    const calls: number[] = []
    const query: SessionQueryLike = {
      async listEvents() {
        return [
          { seq: 1, type: 'turn/start' },
          { seq: 2, type: 'user/message' },
        ]
      },
      async readEvent(request) {
        calls.push(request.seq)
        return { events: [{ seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } }] }
      },
    }
    // The live session is ahead of the log and the projection knows turns that
    // the log never stored; the read must stay on the stored anchor.
    const read = await readTranscript({
      sessionId: 's1',
      scope: { kind: 'all' },
      query,
      session: { id: 's1', seq: 53, surface: { nodes: [1, 2] } } as unknown as SessionLike,
      turnStarts: [40, 51, 53],
    })
    expect(calls).toEqual([2])
    expect(read.readMode).toBe('sessionQuery')
    expect(read.segments.map((segment) => segment.text)).toEqual(['hi'])
  })

  it('caps one read at the host window limit and reports truncation', async () => {
    const records = Array.from({ length: 80 }, (_, index) => ({
      seq: index + 1,
      type: index % 2 === 0 ? 'turn/start' : 'user/message',
    }))
    let firstRequested = -1
    const query: SessionQueryLike = {
      async listEvents() {
        return records
      },
      async readEvent(request) {
        if (firstRequested < 0) firstRequested = request.before ?? -1
        return { events: [] }
      },
    }
    const read = await readTranscript({ sessionId: 's1', scope: { kind: 'all' }, query })
    expect(firstRequested).toBe(49)
    expect(read.truncated).toBe(true)
  })
})

describe('log failure fallback', () => {
  it('reads the surface when the host log read throws', async () => {
    const session: SessionLike = {
      id: 's',
      seq: 8,
      surface: { nodes: [3, 4, 6, 7, 8] },
      eventAt(seq: number) {
        return EVENTS.find((event) => event.seq === seq)
      },
    }
    const query: SessionQueryLike = {
      async listEvents() {
        throw new Error('gateway/internal: before must be an integer between 0 and 50')
      },
      async readEvent() {
        throw new Error('unreachable')
      },
    }
    const read = await readTranscript({ sessionId: 's', scope: { kind: 'all' }, query, session })
    expect(read.readMode).toBe('session-surface')
    expect(read.segments).toHaveLength(4)
  })

  it('rethrows when there is no surface to fall back to', async () => {
    const query: SessionQueryLike = {
      async listEvents() {
        throw new Error('gateway/internal: boom')
      },
      async readEvent() {
        throw new Error('unreachable')
      },
    }
    await expect(readTranscript({ sessionId: 's', scope: { kind: 'all' }, query })).rejects.toThrow('boom')
  })
})
