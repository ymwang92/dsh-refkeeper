import { describe, expect, it } from 'vitest'
import { parseVerifyArgs, renderVerify, runVerifyCommand } from '../src/host/verify-command.ts'
import type { VerifyOutcome, LookupResult } from '../src/verify/lookup.ts'
import type { VerificationReport } from '../src/verify/types.ts'

const lookup: LookupResult = { records: [], errors: [], timedOut: false, answered: [] }

function outcome(report: VerificationReport): VerifyOutcome {
  return { report, lookup }
}

const verified: VerificationReport = {
  status: 'verified',
  title: { pass: true, ours: '深度学习综述', theirs: '深度学习综述', score: 1 },
  year: { pass: true, ours: '2024', theirs: '2024', score: -1 },
  firstAuthor: { pass: true, ours: 'Zhang', theirs: 'Zhang', score: 1 },
  passed: 3,
  sources: ['crossref', 'openalex'],
  matchedSource: 'crossref',
  partial: false,
  reasons: [],
}

describe('parseVerifyArgs', () => {
  it('accepts an identifier or a quoted title', () => {
    expect(parseVerifyArgs('--doi=10.1000/xyz')).toMatchObject({ doi: '10.1000/xyz' })
    expect(parseVerifyArgs('--title="深度学习 综述"')).toMatchObject({ title: '深度学习 综述' })
    expect(parseVerifyArgs('--arxiv=2301.00001 --json')).toMatchObject({ arxivId: '2301.00001', json: true })
  })

  it('carries the year and first author the reviewer found missing', () => {
    const parsed = parseVerifyArgs('--title="Attention Is All You Need" --year=2017 --author=Vaswani --author=Shazeer')
    expect(parsed).toMatchObject({ year: 2017, authors: ['Vaswani', 'Shazeer'] })
  })

  it('refuses a year that is not a 4-digit number', () => {
    // A silently ignored --year would turn a 3-condition check into 2.
    expect(parseVerifyArgs('--title=x --year=17')).toHaveProperty('error')
    expect(parseVerifyArgs('--title=x --year=20x4')).toHaveProperty('error')
  })

  it('rejects unknown options, missing values and empty claims', () => {
    expect(parseVerifyArgs('--titel=x')).toHaveProperty('error')
    expect(parseVerifyArgs('--doi=')).toHaveProperty('error')
    expect(parseVerifyArgs('')).toHaveProperty('error')
  })
})

describe('runVerifyCommand', () => {
  it('forwards title, year and authors to the verifier as one claim', async () => {
    const seen: unknown[] = []
    const result = await runVerifyCommand('--title="Attention Is All You Need" --year=2017 --author=Vaswani', {
      verify: async (claim) => {
        seen.push(claim)
        return outcome(verified)
      },
    })
    expect(result.kind).toBe('success')
    expect(seen[0]).toMatchObject({
      title: 'Attention Is All You Need',
      year: 2017,
      authors: ['Vaswani'],
    })
  })
})

describe('renderVerify', () => {
  it('shows the verdict and the three conditions', () => {
    const text = renderVerify(outcome(verified))
    expect(text).toContain('verified')
    expect(text).toContain('passed 3/3')
    expect(text).toContain('✓ title')
    expect(text).toContain('matched crossref')
  })

  it('warns instead of crying fabrication when sources are down', () => {
    const text = renderVerify(
      outcome({
        ...verified,
        status: 'unverified',
        passed: 0,
        conditions: undefined,
        reasons: ['timeout', 'no-source-hit'],
        partial: true,
      } as unknown as VerificationReport),
    )
    expect(text).toContain('retry later')
    expect(text).toContain('partial')
  })
})

describe('runVerifyCommand', () => {
  it('passes an identity through and renders the verdict', async () => {
    const seen: string[] = []
    const result = await runVerifyCommand('--doi=10.1000/xyz', {
      verify: async (identity) => {
        seen.push(identity.doi ?? '')
        return outcome(verified)
      },
    })
    expect(seen).toEqual(['10.1000/xyz'])
    expect(result.kind).toBe('success')
    expect(result.text).toContain('verified')
  })

  it('returns machine-readable JSON on --json', async () => {
    const result = await runVerifyCommand('--doi=10.1000/xyz --json', { verify: async () => outcome(verified) })
    const parsed = JSON.parse(result.text) as { report: VerificationReport; records: unknown[] }
    expect(parsed.report.status).toBe('verified')
    expect(parsed.records).toEqual([])
  })

  it('never calls the network for a malformed command', async () => {
    let called = false
    const result = await runVerifyCommand('--nope', {
      verify: async () => {
        called = true
        return outcome(verified)
      },
    })
    expect(result.kind).toBe('error')
    expect(called).toBe(false)
  })
})
