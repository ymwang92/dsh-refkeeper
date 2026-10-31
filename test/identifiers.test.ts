import { describe, expect, it } from 'vitest'
import {
  extractIdentifiers,
  isValidIsbn10,
  isValidIsbn13,
  normalizeArxiv,
  normalizeDoi,
  normalizeIsbn,
} from '../src/core/identifiers.ts'

function kinds(text: string): string[] {
  return extractIdentifiers(text).map((hit) => `${hit.kind}:${hit.value}`)
}

describe('normalize', () => {
  it('lowercases DOIs and strips dangling punctuation', () => {
    expect(normalizeDoi('10.1000/ABC.Def.')).toBe('10.1000/abc.def')
  })

  it('drops the arXiv version suffix', () => {
    expect(normalizeArxiv('2401.01234v3')).toBe('2401.01234')
  })

  it('keeps only ISBN digits and X', () => {
    expect(normalizeIsbn('978-7-302-12345-6')).toBe('9787302123456')
  })
})

describe('extractIdentifiers', () => {
  it('turns a doi.org URL into a DOI, not a URL', () => {
    expect(kinds('see https://doi.org/10.1038/s41586-024-00001-x for details')).toEqual([
      'doi:10.1038/s41586-024-00001-x',
    ])
  })

  it('strips a trailing full stop glued to a bare DOI', () => {
    expect(kinds('As shown (doi:10.1016/j.cell.2023.01.001).')).toEqual(['doi:10.1016/j.cell.2023.01.001'])
  })

  it('turns an arxiv.org abs URL into an arXiv id', () => {
    expect(kinds('https://arxiv.org/abs/2401.01234v2')).toEqual(['arxiv:2401.01234'])
  })

  it('reads bare arXiv mentions', () => {
    expect(kinds('preprint arXiv: 2106.09685')).toEqual(['arxiv:2106.09685'])
  })

  it('recognises report numbers and standards', () => {
    // Report numbers compare with internal whitespace removed, so "GB/T 7714-2015"
    // and "GB/T7714-2015" are one identifier rather than two.
    expect(kinds('NUREG-1234 and GB/T 7714-2015')).toEqual(['report:NUREG-1234', 'report:GB/T7714-2015'])
  })

  it('keeps a strong-host URL but does not dedupe it against a DOI', () => {
    const hits = extractIdentifiers('https://www.nature.com/articles/s41586-024-00001-x')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'url', confidence: 0.7 })
  })

  it('marks an unrecognised host as a weak lead', () => {
    const hits = extractIdentifiers('https://example.org/some/path')
    expect(hits[0]).toMatchObject({ kind: 'url', confidence: 0.3 })
  })

  it('dedupes the same identifier seen twice', () => {
    expect(kinds('10.1000/xyz and again 10.1000/XYZ')).toEqual(['doi:10.1000/xyz'])
  })

  it('keeps the angle brackets inside a legacy AMS DOI', () => {
    // 10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2 is a real id; stopping at
    // "<" would resolve to a different work.
    const hits = extractIdentifiers('doi:10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.value).toBe('10.1175/1520-0442(2004)017<2335:aspdsi>2.0.co;2')
  })

  it('reads the same AMS DOI once from a doi.org URL', () => {
    const hits = extractIdentifiers('https://doi.org/10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'doi', host: 'doi.org' })
  })

  it('does not keep a dangling angle bracket', () => {
    expect(kinds('see <10.1000/abc> for details')).toEqual(['doi:10.1000/abc'])
  })
})

describe('ISBN detection', () => {
  it('reads a compact ISBN-13 without separators', () => {
    expect(kinds('ISBN 9780306406157')).toEqual(['isbn:9780306406157'])
  })

  it('reads a grouped ISBN-13', () => {
    expect(kinds('ISBN 978-0-306-40615-7')).toEqual(['isbn:9780306406157'])
  })

  it('rejects a 13-digit number whose check digit is wrong', () => {
    // One digit off the valid 978-0-306-40615-7: a typo, not a citation.
    expect(kinds('ISBN 9780306406158')).toEqual([])
  })

  it('reads a labelled ISBN-10, compact or grouped', () => {
    expect(kinds('ISBN 0306406152')).toEqual(['isbn:0306406152'])
    expect(kinds('ISBN 0-306-40615-2')).toEqual(['isbn:0306406152'])
  })

  it('ignores an unlabelled 10-digit number', () => {
    expect(kinds('order 0306406152 shipped')).toEqual([])
  })

  it('validates both check digits', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true)
    expect(isValidIsbn13('9780306406158')).toBe(false)
    expect(isValidIsbn10('0306406152')).toBe(true)
    expect(isValidIsbn10('0306406153')).toBe(false)
    expect(isValidIsbn10('097522980X')).toBe(true)
  })
})
