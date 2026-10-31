import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/core/candidates.ts'
import { judgeCandidate, scoreRecord } from '../src/verify/judge.ts'
import type { SourceRecord } from '../src/verify/types.ts'

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    key: 'doi:10.1000/abc',
    type: 'journalArticle',
    origins: ['citation'],
    doi: '10.1000/abc',
    arxivId: '',
    isbn: '',
    reportNumber: '',
    url: '',
    title: '深度学习在医学影像中的应用综述',
    authors: ['张三', '李四'],
    year: 2024,
    container: '计算机学报',
    volume: '47',
    issue: '3',
    pages: '1-12',
    confidence: 0.8,
    needsModelEnrichment: false,
    evidence: [3],
    ...overrides,
  }
}

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    source: 'crossref',
    id: '10.1000/abc',
    title: '深度学习在医学影像中的应用综述',
    authors: ['张三', '李四'],
    year: 2024,
    container: '计算机学报',
    doi: '10.1000/abc',
    type: 'journal-article',
    url: 'https://doi.org/10.1000/abc',
    ...overrides,
  }
}

describe('scoreRecord', () => {
  it('scores a full match at 1', () => {
    expect(scoreRecord(candidate(), record())).toBeCloseTo(1, 5)
  })

  it('drops below the 0.75 gate when title and author both miss', () => {
    const wrong = record({ title: '基于图神经网络的推荐算法研究', authors: ['Wang, L.'], year: 2019 })
    expect(scoreRecord(candidate(), wrong)).toBeLessThan(0.75)
  })
})

describe('judgeCandidate matrix', () => {
  it('verifies when all three conditions pass against a real source', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [record()] })
    expect(report.status).toBe('verified')
    expect(report.passed).toBe(3)
    expect(report.sources).toEqual(['crossref'])
    expect(report.matchedSource).toBe('crossref')
    expect(report.reasons).toEqual([])
  })

  it('does not verify a perfect returned record when another source failed', () => {
    const report = judgeCandidate({
      candidate: candidate(),
      records: [record()],
      errors: ['openalex'],
      answered: ['crossref'],
    })
    expect(report.status).toBe('unverified')
    expect(report.passed).toBe(3)
    expect(report.partial).toBe(true)
    expect(report.reasons).toContain('source-error')
  })

  it('does not downgrade a partial round to a conclusive warning', () => {
    const report = judgeCandidate({
      candidate: candidate(),
      records: [record({ year: 2020 })],
      errors: ['openalex'],
      answered: ['crossref'],
    })
    expect(report.status).toBe('unverified')
    expect(report.passed).toBe(2)
    expect(report.reasons).toEqual(expect.arrayContaining(['year-mismatch', 'source-error']))
  })

  it('warns when the year is off by more than one', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [record({ year: 2020 })] })
    expect(report.status).toBe('warning')
    expect(report.passed).toBe(2)
    expect(report.reasons).toContain('year-mismatch')
    expect(report.year.ours).toBe('2024')
    expect(report.year.theirs).toBe('2020')
  })

  it('warns when the first author differs but title and year agree', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [record({ authors: ['王五'] })] })
    expect(report.status).toBe('warning')
    expect(report.reasons).toContain('author-mismatch')
  })

  it('quarantines when the best record is too weak to judge', () => {
    const wrong = record({ title: '基于图神经网络的推荐算法研究', authors: ['Wang, L.'], year: 2019 })
    const report = judgeCandidate({ candidate: candidate(), records: [wrong] })
    expect(report.status).toBe('quarantined')
    expect(report.reasons).toContain('ambiguous-record')
    expect(report.reasons).not.toContain('no-source-hit')
  })

  it('does not quarantine a weak record when another source failed', () => {
    const wrong = record({ title: '基于图神经网络的推荐算法研究', authors: ['Wang, L.'], year: 2019 })
    const report = judgeCandidate({ candidate: candidate(), records: [wrong], errors: ['openalex'] })
    expect(report.status).toBe('unverified')
    expect(report.reasons).toEqual(expect.arrayContaining(['ambiguous-record', 'source-error']))
    expect(report.reasons).not.toContain('no-source-hit')
  })

  it('never verifies without a source, even if a record were perfect', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [], errors: ['openalex'] })
    expect(report.status).toBe('unverified')
    expect(report.passed).toBe(0)
    expect(report.partial).toBe(true)
    // With an error in the round and no record of who answered, "no source hit"
    // is not something this layer can assert.
    expect(report.reasons).toEqual(['source-error'])
  })

  it('quarantines with no-source-hit only when a source actually answered', () => {
    const report = judgeCandidate({
      candidate: candidate(),
      records: [],
      errors: [],
      answered: ['crossref', 'datacite'],
    })
    expect(report.status).toBe('quarantined')
    expect(report.reasons).toContain('no-source-hit')
  })

  it('reports a timeout as partial', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [], timedOut: true })
    expect(report.status).toBe('unverified')
    expect(report.partial).toBe(true)
    expect(report.reasons).toContain('timeout')
  })

  it('picks the best record across sources rather than the first', () => {
    const report = judgeCandidate({
      candidate: candidate(),
      records: [
        record({ source: 'openalex', title: '基于图神经网络的推荐算法研究', authors: ['Wang, L.'], year: 2019 }),
        record({ source: 'crossref' }),
      ],
    })
    expect(report.status).toBe('verified')
    expect(report.sources).toEqual(['openalex', 'crossref'])
    expect(report.matchedSource).toBe('crossref')
  })

  it('treats an unknown registry year as a failed condition', () => {
    const report = judgeCandidate({ candidate: candidate(), records: [record({ year: undefined })] })
    expect(report.year.pass).toBe(false)
    expect(report.status).toBe('warning')
  })
})
