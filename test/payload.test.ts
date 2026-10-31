import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodePayload, parseStoreCommand, runStoreCommand } from '../src/host/store-command.ts'
import { payloadFlag } from '../src/ui/payload.ts'
import type { VerificationReport } from '../src/verify/types.ts'

const VERIFIED: VerificationReport = {
  status: 'verified',
  title: { pass: true, ours: 't', theirs: 't', score: 1 },
  year: { pass: true, ours: '2024', theirs: '2024', score: 1 },
  firstAuthor: { pass: true, ours: 'a', theirs: 'a', score: 1 },
  passed: 3,
  sources: ['crossref'],
  partial: false,
  reasons: [],
}

/** Text a user may paste into any field; every character must survive verbatim. */
const TRICKY = `It's an "apostrophe" — 中文’标点 \\ backslash\nsecond line`

describe('command payload encoding', () => {
  it('emits a token the command grammar cannot mangle', () => {
    const flag = payloadFlag({ title: TRICKY })
    expect(flag.startsWith('--payload=')).toBe(true)
    const body = flag.slice('--payload='.length)
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  it('round-trips quotes, CJK, backslashes and newlines byte for byte', () => {
    const flag = payloadFlag({ title: TRICKY, authors: ['O’Brien, P.', 'Smith, J.'] })
    const parsed = parseStoreCommand(`save ${flag}`)
    if ('error' in parsed) throw new Error(parsed.error)
    expect(JSON.parse(decodePayload(parsed.payload))).toEqual({
      title: TRICKY,
      authors: ['O’Brien, P.', 'Smith, J.'],
    })
  })

  it('no longer rewrites ASCII apostrophes into curly quotes', () => {
    const title = "Kucsko's measurement"
    const flag = payloadFlag({ title })
    const parsed = parseStoreCommand(`save ${flag}`)
    if ('error' in parsed) throw new Error(parsed.error)
    const decoded = JSON.parse(decodePayload(parsed.payload)) as { title: string }
    expect(decoded.title).toBe(title)
    expect(decoded.title).not.toContain('’')
  })

  it('still accepts the legacy --json form for quote-free payloads', () => {
    const parsed = parseStoreCommand(`save --json='{"title":"Plain title"}'`)
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.payload).toBe('')
    expect(JSON.parse(parsed.json)).toEqual({ title: 'Plain title' })
  })

  it('rejects a save without either flag', () => {
    expect(parseStoreCommand('save')).toEqual({ error: 'save needs a JSON payload (--payload=<base64url> or --json=<json>)' })
  })
})

describe('saving through the encoded payload', () => {
  let workspace: string
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'refkeeper-payload-'))
  })
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('stores the field text exactly as typed', async () => {
    // The panel parses "surname, initials" itself and sends structured authors.
    const payload = { title: TRICKY, authors: [{ family: 'O’Brien', given: 'P.' }], doi: '10.1038/nature12373', year: 2024 }
    const result = await runStoreCommand(`save ${payloadFlag(payload)}`, {
      workspace,
      verify: () => Promise.resolve(VERIFIED),
    })
    expect(result.kind).toBe('success')
    const raw = JSON.parse(await readFile(join(workspace, 'refs', 'refs.json'), 'utf8')) as {
      references: Array<{ title: string; authors: Array<{ family: string; given?: string }> }>
    }
    expect(raw.references[0]?.title).toBe(TRICKY)
    expect(raw.references[0]?.authors).toEqual([{ family: 'O’Brien', given: 'P.' }])
  })
})
