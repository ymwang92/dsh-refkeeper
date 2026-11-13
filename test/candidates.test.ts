import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/core/candidates.ts'
import {
  candidateFromModel,
  dedupeKey,
  extractCandidates,
  mergeCandidates,
  rankCandidates,
  sanitizeEvidence,
} from '../src/core/candidates.ts'

function citationCandidate(text: string, seq: number): Candidate {
  const candidates = extractCandidates([{ seq, text }])
  expect(candidates.length).toBeGreaterThan(0)
  return candidates[0] as Candidate
}

describe('dedupeKey', () => {
  it('prefers DOI over everything else', () => {
    expect(
      dedupeKey({ key: '', doi: '10.1/x', arxivId: '2401.01234', isbn: '', reportNumber: '', title: 'T', year: 2024, url: '' }),
    ).toBe('doi:10.1/x')
  })

  it('prioritizes PMID and PMCID after DOI and arXiv', () => {
    const candidate = {
      key: '', doi: '', arxivId: '', pmid: '12345678', pmcid: 'PMC1234567',
      isbn: '', reportNumber: '', title: 'A Title', year: 2024, url: '',
    }
    expect(dedupeKey(candidate)).toBe('pmid:12345678')
    expect(dedupeKey({ ...candidate, pmid: undefined })).toBe('pmcid:PMC1234567')
  })

  it('falls back to normalized title + year', () => {
    const a = dedupeKey({ key: '', doi: '', arxivId: '', isbn: '', reportNumber: '', title: 'Attention Is All You Need', year: 2017, url: '' })
    const b = dedupeKey({ key: '', doi: '', arxivId: '', isbn: '', reportNumber: '', title: 'attention  is all you need', year: 2017, url: '' })
    expect(a).toBe(b)
    expect(a.startsWith('title:')).toBe(true)
  })
})

describe('extractCandidates', () => {
  it('merges the same DOI seen in two turns into one candidate with both seqs', () => {
    const candidates = extractCandidates([
      { seq: 3, text: 'See https://doi.org/10.1038/s41586-024-00001-x' },
      { seq: 9, text: 'As reported in 10.1038/S41586-024-00001-X earlier.' },
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.evidence).toEqual([3, 9])
    expect(candidates[0]?.doi).toBe('10.1038/s41586-024-00001-x')
  })

  it('attaches both labeled PubMed identifiers from the citation line', () => {
    const candidate = citationCandidate(
      'Smith, J. (2020). A study of PubMed identifiers. Journal of Testing, 1(2), 3-4. PMID: 12345678 PMCID: PMC1234567',
      6,
    )
    expect(candidate.pmid).toBe('12345678')
    expect(candidate.pmcid).toBe('PMC1234567')
    expect(candidate.key).toBe('pmid:12345678')
  })

  it('skips a bare weak URL but keeps a strong publisher URL', () => {
    expect(extractCandidates([{ seq: 1, text: 'https://example.org/whatever' }])).toEqual([])
    const kept = extractCandidates([{ seq: 1, text: 'https://www.nature.com/articles/abc' }])
    expect(kept).toHaveLength(1)
    expect(kept[0]?.type).toBe('webpage')
  })

  it('attaches an identifier that sits on the same line as a citation string', () => {
    const candidate = citationCandidate(
      'Zhang, S. (2024). A study of retrieval augmentation. Journal of Testing, 2(1), 3-9. doi:10.1000/jt.2024.1',
      5,
    )
    expect(candidate.doi).toBe('10.1000/jt.2024.1')
    expect(candidate.origins).toContain('citation')
    expect(candidate.title).toBe('A study of retrieval augmentation')
  })
})

describe('mergeCandidates', () => {
  it('lets model-supplied fields beat regex guesses, including the year', () => {
    const fromRegex = citationCandidate(
      'Zhang, S. (2020). Attention is not all you need. Nature, 1(1), 1-2. doi:10.1038/abc',
      1,
    )
    const fromModel = candidateFromModel({
      title: 'Attention Is All You Need',
      doi: '10.1038/ABC',
      year: 2017,
      authors: ['Vaswani, A.'],
    })
    expect(fromModel.key).toBe(fromRegex.key)

    const merged = mergeCandidates(fromRegex, fromModel)
    expect(merged.title).toBe('Attention Is All You Need')
    expect(merged.year).toBe(2017)
    expect(merged.authors).toEqual(['Vaswani, A.'])
    expect(merged.origins).toEqual(expect.arrayContaining(['citation', 'model']))
    expect(merged.needsModelEnrichment).toBe(false)
  })

  it('rekeys a title candidate when a PMID is added', () => {
    const fromCitation = citationCandidate(
      'Smith, J. (2020). A study of rekeying. Journal of Testing, 1(2), 3-4.',
      1,
    )
    const fromModel = candidateFromModel({
      title: 'A study of rekeying',
      year: 2020,
      authors: ['Smith, J.'],
      pmid: '12345678',
    })
    expect(fromCitation.key).toMatch(/^title:/u)
    expect(mergeCandidates(fromCitation, fromModel).key).toBe('pmid:12345678')
  })

  it('keeps the existing value when only the incoming field is empty', () => {
    const a = candidateFromModel({ title: 'A Study', doi: '10.1/x', year: 2020, authors: ['A'] })
    const b = candidateFromModel({ title: 'A Study', doi: '10.1/x', year: 2020, authors: [] })
    const merged = mergeCandidates(a, b)
    expect(merged.authors).toEqual(['A'])
  })
})

describe('report candidate confidence', () => {
  it('keeps high-confidence report IDs and filters bare standards', () => {
    const reports = extractCandidates([{
      seq: 1,
      text: 'PB123456; NUREG-1234; WHO/AB/1234; DOE/BR-123456; NASA/TM-2020-12345; NTRS 123456; NACA 1234; AD-A123456; EPA-600-R-123',
    }])
    expect(reports.map((candidate) => candidate.reportNumber).sort()).toEqual([
      'AD-A123456', 'DOE/BR-123456', 'EPA-600-R-123', 'NACA1234',
      'NASA/TM-2020-12345', 'NTRS123456', 'NUREG-1234', 'PB123456', 'WHO/AB/1234',
    ])
    expect(reports.every((candidate) => candidate.confidence === 0.8)).toBe(true)

    const standards = extractCandidates([{
      seq: 2,
      text: 'GB/T 12345; ISO 8601; ISO 9001; RFC-9110',
    }])
    expect(standards).toEqual([])
  })
})

describe('rankCandidates', () => {
  it('orders by confidence, then article type, then title', () => {
    const low = candidateFromModel({ title: 'B study', doi: '10.1/b', year: 2020, authors: ['B'] })
    const high = candidateFromModel({ title: 'A study', year: 2021, authors: ['A'] })
    const ranked = rankCandidates([low, { ...high, confidence: 0.99 }])
    expect(ranked[0]?.title).toBe('A study')
  })
})

describe('candidateFromModel', () => {
  it('flags incomplete model input for enrichment', () => {
    expect(candidateFromModel({ title: 'Only a title' }).needsModelEnrichment).toBe(true)
    expect(
      candidateFromModel({ title: 'Complete record', year: 2024, authors: ['A. Author'], doi: '10.1/y' }).needsModelEnrichment,
    ).toBe(false)
  })

  it('normalizes identifiers and trims fields', () => {
    const candidate = candidateFromModel({
      title: '  Spaced   title  ',
      arxivId: '2401.01234v2',
      authors: ['  Zhang, S.  '],
      year: 2024,
    })
    expect(candidate.title).toBe('Spaced title')
    expect(candidate.arxivId).toBe('2401.01234')
    expect(candidate.authors).toEqual(['Zhang, S.'])
  })
})

describe('identity requirement', () => {
  it('never mints a key from a blank title', () => {
    const key = dedupeKey({ key: '', doi: '', arxivId: '', isbn: '', reportNumber: '', title: '   ', year: 2024, url: '' })
    expect(key).toBe('')
  })

  it('drops a citation-shaped line that produced no usable identity', () => {
    const candidates = extractCandidates([{ seq: 3, text: '(2024). Something. Journal, 1(2), 3-4.' }])
    expect(candidates).toEqual([])
  })

  it('reindexes a title candidate when a later same-title citation adds PMID', () => {
    const candidates = extractCandidates([
      { seq: 1, text: 'Smith, J. (2020). A study of rekeying. Journal of Testing, 1(2), 3-4.' },
      { seq: 2, text: 'PMID: 12345678' },
      { seq: 3, text: 'Smith, J. (2020). A study of rekeying. Journal of Testing, 1(2), 3-4. PMID: 12345678' },
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.key).toBe('pmid:12345678')
    expect(candidates[0]?.evidence).toEqual([1, 2, 3])
  })

  it('keeps a citation with a real title', () => {
    const candidates = extractCandidates([
      { seq: 4, text: 'Zhang, S., & Li, W. (2024). Attention is not all you need. Nature Machine Intelligence, 6(3), 45-67.' },
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.key.startsWith('title:')).toBe(true)
  })
})

describe('tool output is opt-in', () => {
  const toolOutput = {
    seq: 9,
    role: 'tool' as const,
    text: 'found 10.1000/abc and arXiv:2401.01234; PMID: 12345678 and PMCID: PMC1234567; see also Zhang, S. (2024). A Title. Journal, 1(2), 3-4. and https://example.com/x and https://www.nature.com/articles/abc',
  }

  it('excludes tool output by default', () => {
    expect(extractCandidates([toolOutput])).toEqual([])
  })

  it('opts in to tool DOI, arXiv, PubMed IDs and strong URL candidates, but not citations or weak URLs', () => {
    const candidates = extractCandidates([toolOutput], { includeTools: true })
    expect(candidates.map((candidate) => candidate.doi)).toContain('10.1000/abc')
    expect(candidates.map((candidate) => candidate.arxivId)).toContain('2401.01234')
    expect(candidates.map((candidate) => candidate.pmid)).toContain('12345678')
    expect(candidates.map((candidate) => candidate.pmcid)).toContain('PMC1234567')
    expect(candidates.map((candidate) => candidate.url)).toContain('https://www.nature.com/articles/abc')
    expect(candidates.map((candidate) => candidate.url)).not.toContain('https://example.com/x')
    expect(candidates.map((candidate) => candidate.title)).not.toContain('A Title')
  })

  it('keeps user and assistant extraction unchanged', () => {
    const sources = [
      { seq: 10, role: 'user' as const, text: 'Zhang, S. (2024). A Title. Journal, 1(2), 3-4.' },
      { seq: 11, role: 'assistant' as const, text: 'Li, W. (2023). Another Study. Science, 1(2), 3-4.' },
    ]
    for (const options of [undefined, { includeTools: true }]) {
      const candidates = options === undefined ? extractCandidates(sources) : extractCandidates(sources, options)
      expect(candidates.map((candidate) => candidate.title)).toEqual(['A Title', 'Another Study'])
    }
  })
})

describe('sanitizeEvidence', () => {
  it('drops negative, fractional and out-of-window seqs, then dedupes and sorts', () => {
    expect(sanitizeEvidence([8, -1, 2.5, 99, 8, 3], new Set([3, 8]))).toEqual([3, 8])
  })

  it('keeps every non-negative integer when there is no window to check', () => {
    expect(sanitizeEvidence([8, -1, 4], undefined)).toEqual([4, 8])
  })
})
