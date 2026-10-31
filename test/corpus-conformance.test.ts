import { describe, expect, it } from 'vitest'
import { extractCandidates } from '../src/core/candidates.ts'
import type { SourcedText } from '../src/core/candidates.ts'

/**
 * Conformance corpus: one canonical reference shape per case.
 *
 * The point is not "capture works on my conversation" but "capture behaves the
 * same on a fixed corpus". Any change to the extractor must keep these green, so
 * a real-session miss can be attributed to the input (scope/compaction) instead
 * of guessed at.
 */
function capture(text: string) {
  return extractCandidates([{ seq: 1, text, role: 'user' } satisfies SourcedText])
}

describe('capture conformance corpus', () => {
  it('parses an APA journal article with an angle-bracket DOI', () => {
    const [hit] = capture(
      'Wells, N., Goddard, S., & Hayes, M. J. (2004). A self-calibrating Palmer Drought Severity Index. Journal of Climate, 17(12), 2335–2351. https://doi.org/10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2',
    )
    expect(hit?.title).toBe('A self-calibrating Palmer Drought Severity Index')
    expect(hit?.authors?.[0]).toBe('Wells, N.')
    expect(hit?.year).toBe(2004)
    expect(hit?.doi).toBe('10.1175/1520-0442(2004)017<2335:aspdsi>2.0.co;2')
  })

  it('parses a GB/T 7714 Chinese journal article', () => {
    const [hit] = capture('张三, 李四. 深度学习在医学影像中的应用综述[J]. 计算机学报, 2024, 47(3): 1-20. doi:10.1000/abc')
    expect(hit?.title).toBe('深度学习在医学影像中的应用综述')
    expect(hit?.year).toBe(2024)
    expect(hit?.container).toBe('计算机学报')
    expect(hit?.doi).toBe('10.1000/abc')
  })

  it('parses an IEEE conference paper', () => {
    const [hit] = capture('[1] A. Vaswani, "Attention is all you need," in Proc. NeurIPS, 2017, pp. 5998-6008.')
    expect(hit?.title).toBe('Attention is all you need')
    expect(hit?.year).toBe(2017)
    expect(hit?.type).toBe('conferencePaper')
  })

  it('keeps a bare DOI mention with no other metadata', () => {
    const [hit] = capture('The DOI 10.1038/nature12373 was cited in the intro.')
    expect(hit?.doi).toBe('10.1038/nature12373')
    expect(hit?.needsModelEnrichment).toBe(true)
  })

  it('normalises an arXiv id and drops the version suffix', () => {
    const [hit] = capture('See arXiv:1706.03762v5 for the transformer.')
    expect(hit?.arxivId).toBe('1706.03762')
    expect(hit?.type).toBe('preprint')
  })

  it('recognises report numbers and ISBN-13', () => {
    const reports = capture('Report PB2012345 and NUREG-1150 are both cited.')
    expect(reports.map((r) => r.reportNumber).sort()).toEqual(['NUREG-1150', 'PB2012345'])
    const [book] = capture('ISBN 978-0-306-40615-7 covers this book.')
    expect(book?.isbn).toBe('9780306406157')
    expect(book?.type).toBe('book')
  })

  it('returns nothing for prose without identifiers or citation shapes', () => {
    expect(capture('No citation here at all, just prose about drought.')).toEqual([])
  })

  it('is stable across runs (same input, same ids)', () => {
    const text = 'Wells, N. (2004). A self-calibrating Palmer Drought Severity Index. Journal of Climate, 17(12), 2335–2351.'
    const first = capture(text).map((c) => c.key)
    const second = capture(text).map((c) => c.key)
    expect(second).toEqual(first)
  })
})
