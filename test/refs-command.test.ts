import { describe, expect, it } from 'vitest'
import { parseRefsCommand, runRefsCommand } from '../src/host/refs-command.ts'
import type { SessionLike, SessionQueryLike } from '../src/host/session-read.ts'

const SESSION: SessionLike = { id: 'sess-1', seq: 9, surface: { nodes: [3, 4] }, eventAt: () => undefined }

const RECORDS = [
  { seq: 2, type: 'turn/start' },
  { seq: 3, type: 'user/message' },
  { seq: 4, type: 'assistant/message' },
  { seq: 5, type: 'turn/start' },
  { seq: 9, type: 'user/message' },
]

const USER_TEXT = '见 Zhang, S. (2024). Attention and memory. Nature, 625(3), 45-67. doi:10.1038/s41586-024-00001-x'

const QUERY: SessionQueryLike = {
  async listEvents() {
    return RECORDS
  },
  async readEvent(request) {
    return {
      events: [
        {
          seq: 9,
          type: 'user/message',
          data: { content: [{ type: 'text', text: USER_TEXT }] },
        },
      ].filter((event) => event.seq <= request.seq),
    }
  },
}

describe('parseRefsCommand', () => {
  it('defaults to status', () => {
    expect(parseRefsCommand('')).toMatchObject({ sub: 'status' })
    expect(parseRefsCommand('   ')).toMatchObject({ sub: 'status' })
  })

  it('accepts scope, turns and dry-run in any order', () => {
    expect(parseRefsCommand('capture --turns=3 --scope=lastN --dry-run')).toEqual({
      sub: 'capture',
      scopeArg: 'lastN',
      turnsArg: '3',
      includeTools: false,
      save: false,
      dryRun: true,
    })
  })

  it('rejects unknown subcommands and options with the usage text', () => {
    const bad = parseRefsCommand('export --scope=all')
    expect(bad).toHaveProperty('error')
    expect('error' in bad && bad.error).toContain('usage:')

    const badOption = parseRefsCommand('capture --limit=3')
    expect(badOption).toHaveProperty('error')
  })
})

describe('runRefsCommand status', () => {
  it('reports the read seam and turn count', async () => {
    const result = await runRefsCommand('status', SESSION, { query: QUERY, sdkVersion: '0.2.1-rc.2' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('sdk 0.2.1-rc.2')
    expect(result.text).toContain('5 events · 2 turn(s)')
    expect(result.text).toContain('storage: refs/refs.json (verified)')
  })

  it('says so instead of pretending when the seam is missing', async () => {
    const result = await runRefsCommand('', SESSION, { sdkVersion: 'x' })
    expect(result.text).toContain('read seam: sessionQuery unavailable')
  })
})

describe('runRefsCommand capture', () => {
  it('renders a candidate found in the current turn', async () => {
    const result = await runRefsCommand('capture --scope=turn', SESSION, { query: QUERY, sdkVersion: 'x' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('candidates: 1')
    expect(result.text).toContain('doi:10.1038/s41586-024-00001-x')
    expect(result.text).toContain('read via sessionQuery')
  })

  it('reports an invalid scope as an error with usage', async () => {
    const result = await runRefsCommand('capture --scope=everything', SESSION, { query: QUERY, sdkVersion: 'x' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('usage:')
  })

  it('explains an empty result instead of returning a bare zero count', async () => {
    const empty: SessionQueryLike = {
      async listEvents() {
        return RECORDS
      },
      async readEvent() {
        return { events: [] }
      },
    }
    const result = await runRefsCommand('capture --scope=all', SESSION, { query: empty, sdkVersion: 'x' })
    expect(result.text).toContain('candidates: 0')
    expect(result.text).toContain('no DOI / arXiv id / ISBN / report number / citation string found')
  })
})


describe('/refs capture --save', () => {
  it('stores nothing unless --save is passed', async () => {
    let called = 0
    const result = await runRefsCommand('capture --scope=all', SESSION, {
      query: QUERY,
      sdkVersion: 'test',
      save: async () => {
        called += 1
        return { saved: 1, quarantined: 0, skipped: 0, failed: 0 }
      },
    })
    expect(called).toBe(0)
    expect(result.text).toContain('candidates only')
  })

  it('fails clearly instead of previewing when save is requested without a host saver', async () => {
    const result = await runRefsCommand('capture --scope=all --save', SESSION, {
      query: QUERY,
      sdkVersion: 'test',
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('capture --save is unavailable on this host build')
    expect(result.text).toContain('No references were saved')
  })

  it('hands the candidates to the saver and reports the tally', async () => {
    let received = 0
    const result = await runRefsCommand('capture --scope=all --save', SESSION, {
      query: QUERY,
      sdkVersion: 'test',
      save: async (candidates) => {
        received = candidates.length
        return { saved: 1, quarantined: 0, skipped: 0, failed: 0 }
      },
    })
    expect(received).toBeGreaterThan(0)
    expect(result.text).toContain('saved: 1')
    expect(result.text).toContain('queued for verification and saving')
    expect(result.text).not.toContain('candidates only, nothing saved yet')
    expect(result.text).toContain('This capture is now the default export scope')
    expect(result.text).toContain('/refs export --all')
  })

  it('explains skipped candidates instead of silently dropping them', async () => {
    const result = await runRefsCommand('capture --scope=all --save', SESSION, {
      query: QUERY,
      sdkVersion: 'test',
      save: async () => ({ saved: 0, quarantined: 0, skipped: 2, failed: 0 }),
    })
    expect(result.text).toContain('skipped (no title): 2')
    expect(result.text).toContain('cannot be verified')
  })
})
