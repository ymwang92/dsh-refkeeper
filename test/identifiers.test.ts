import { describe, expect, it } from 'vitest'
import {
  extractIdentifiers,
  isValidIsbn10,
  isValidIsbn13,
  normalizeArxiv,
  normalizeDoi,
  normalizeIsbn,
} from '../src/core/identifiers.ts'
import { arxivIdUrl, parseArxivFeed } from '../src/verify/clients.ts'

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

  it('reads old-style arXiv IDs without rewriting their category', () => {
    expect(kinds('arXiv:math.GT/0309136v2')).toEqual(['arxiv:math.GT/0309136'])
    expect(kinds('math.GT/0309136')).toEqual(['arxiv:math.GT/0309136'])
    expect(kinds('cs/0112017')).toEqual(['arxiv:cs/0112017'])
    expect(normalizeArxiv('math.GT/0309136v2')).toBe('math.GT/0309136')
  })

  it('recognizes labeled PMID and PMCID identifiers but rejects naked numbers', () => {
    expect(kinds('PMID: 12345678')).toEqual(['pmid:12345678'])
    expect(kinds('PMCID: PMC1234567')).toEqual(['pmcid:PMC1234567'])
    expect(kinds('pmid 123456')).toEqual(['pmid:123456'])
    for (const text of ['20240101', 'sample 12345678', 'run 98765432', 'PMID: 12345', 'PMCID: 1234567']) {
      expect(kinds(text)).toEqual([])
    }
  })

  it('accepts only the documented legacy arXiv category prefixes', () => {
    const ids = [
      'astro-ph/0309136', 'cond-mat/0309136', 'cs/0112017', 'econ/0309136',
      'gr-qc/0309136', 'hep-ex/0309136', 'hep-lat/0309136', 'hep-ph/0309136',
      'hep-th/9901001', 'math/0309136', 'math-ph/0309136', 'nlin/0309136',
      'nucl-ex/0309136', 'nucl-th/0309136', 'physics/0309136', 'q-bio/0309136',
      'q-fin/0309136', 'stat/0309136', 'math.GT/0309136', 'cond-mat.stat-mech/0309110',
    ]
    for (const id of ids) expect(kinds(id)).toEqual([`arxiv:${id}`])
    expect(kinds('not-a-category/0309136')).toEqual([])
  })

  it('recognizes old-style arXiv abs and pdf URLs as IDs rather than plain URLs', () => {
    for (const url of [
      'https://arxiv.org/abs/math.GT/0309136',
      'https://arxiv.org/pdf/math.GT/0309136v2',
    ]) {
      expect(extractIdentifiers(url)).toMatchObject([
        { kind: 'arxiv', value: 'math.GT/0309136', host: 'arxiv.org' },
      ])
    }
  })

  it('does not mistake ordinary dates, fractions, or new-style IDs for legacy IDs', () => {
    for (const text of ['3/14/2001', '12/25/1999', '1/2']) {
      expect(kinds(text)).toEqual([])
    }
    expect(kinds('arXiv:2301.00001')).toEqual(['arxiv:2301.00001'])
    expect(kinds('arXiv:2301.00001v2')).toEqual(['arxiv:2301.00001'])
  })

  it('does not read a legacy arXiv id out of somebody else\'s URL path', () => {
    for (const url of ['https://example.com/cs/0112017', 'https://example.com/math/12345678']) {
      // The URL itself is still a URL; what must not happen is an arXiv id
      // being read out of its path.
      expect(extractIdentifiers(url).filter((hit) => hit.kind === 'arxiv')).toEqual([])
    }
    // The absolute arxiv.org URL still resolves, through the URL branch.
    expect(kinds('https://arxiv.org/abs/math.GT/0309136')).toEqual(['arxiv:math.GT/0309136'])
  })

  it('preserves old-style arXiv IDs through exact lookup and Atom feed parsing', () => {
    expect(new URL(arxivIdUrl('math.GT/0309136')).searchParams.get('id_list'))
      .toBe('math.GT/0309136')
    const records = parseArxivFeed(`<feed><entry>
      <id>https://arxiv.org/abs/math.GT/0309136</id>
      <title>Old-style arXiv paper</title>
      <author><name>Example Author</name></author>
      <published>2003-09-13T00:00:00Z</published>
    </entry></feed>`)
    expect(records[0]?.id).toBe('math.GT/0309136')
  })

  it('recognises report numbers and standards', () => {
    // Report numbers compare with internal whitespace removed, so "GB/T 7714-2015"
    // and "GB/T7714-2015" are one identifier rather than two.
    expect(kinds('NUREG-1234 and GB/T 7714-2015')).toEqual(['report:NUREG-1234', 'report:GB/T7714-2015'])
  })

  it('preserves exact values for all existing report formats', () => {
    expect(extractIdentifiers('PB123456 NUREG-1234 WHO/AB/1234 GB/T 7714-2015 ISO 9001')).toEqual([
      { kind: 'report', value: 'PB123456', raw: 'PB123456', host: '', confidence: 0.8 },
      { kind: 'report', value: 'NUREG-1234', raw: 'NUREG-1234', host: '', confidence: 0.8 },
      { kind: 'report', value: 'WHO/AB/1234', raw: 'WHO/AB/1234', host: '', confidence: 0.8 },
      { kind: 'report', value: 'GB/T7714-2015', raw: 'GB/T 7714-2015', host: '', confidence: 0.4 },
      { kind: 'report', value: 'ISO9001', raw: 'ISO 9001', host: '', confidence: 0.4 },
    ])
  })

  describe('additional report formats', () => {
    const positives = [
      { input: 'RFC-9110', value: 'RFC-9110', confidence: 0.4 },
      { input: 'DOE/BR-123456', value: 'DOE/BR-123456', confidence: 0.8 },
      { input: 'DOE/BR123456', value: 'DOE/BR123456', confidence: 0.8 },
      { input: 'doe/er-0313', value: 'DOE/ER-0313', confidence: 0.8 },
      { input: 'NASA/TM-2020-12345', value: 'NASA/TM-2020-12345', confidence: 0.8 },
      { input: 'NASA/CP-123456', value: 'NASA/CP-123456', confidence: 0.8 },
      { input: 'nasa/cp123456', value: 'NASA/CP123456', confidence: 0.8 },
      { input: 'NTRS123456', value: 'NTRS123456', confidence: 0.8 },
      { input: 'NTRS 123456', value: 'NTRS123456', confidence: 0.8 },
      { input: 'ntrs-1234567', value: 'NTRS-1234567', confidence: 0.8 },
      { input: 'NACA 1234', value: 'NACA1234', confidence: 0.8 },
      { input: 'NACA-1234', value: 'NACA-1234', confidence: 0.8 },
      { input: 'naca123456', value: 'NACA123456', confidence: 0.8 },
      { input: 'AD-A123456', value: 'AD-A123456', confidence: 0.8 },
      { input: 'ADA123456', value: 'ADA123456', confidence: 0.8 },
      { input: 'ad-a9876543', value: 'AD-A9876543', confidence: 0.8 },
      { input: 'EPA-600-R-123', value: 'EPA-600-R-123', confidence: 0.8 },
      { input: 'EPA-600/R-14/001', value: 'EPA-600/R-14/001', confidence: 0.8 },
      { input: 'epa-123/x-99/456', value: 'EPA-123/X-99/456', confidence: 0.8 },
    ] as const

    for (const { input, value, confidence } of positives) {
      it(`recognises ${input} with its canonical value`, () => {
        expect(extractIdentifiers(input)).toEqual([
          { kind: 'report', value, raw: input, host: '', confidence },
        ])
      })
    }

    it('canonicalizes equivalent report spellings', () => {
      expect(extractIdentifiers('NTRS 123456')[0]?.value).toBe('NTRS123456')
      expect(extractIdentifiers('ntrs123456')[0]?.value).toBe('NTRS123456')
      expect(extractIdentifiers('nasa/tm-2020-12345')[0]?.value).toBe('NASA/TM-2020-12345')
    })

    const malformed = [
      { format: 'RFC', inputs: ['RFC', 'RFC 123456', 'RFC 8230', 'rfc8230', 'RFC-X 1234', 'RFC 1918', 'RFC 2616', 'RFC 5322', 'RFC 2119'] },
      { format: 'DOE', inputs: ['DOE/BR-12', 'DOE/B-123456', 'DOE BR-123456'] },
      { format: 'NASA', inputs: ['NASA/TM-12', 'NASA/T-123456', 'NASA TM-123456'] },
      { format: 'NTRS', inputs: ['NTRS12345', 'NTRS 12345', 'NTRS-12345X'] },
      { format: 'NACA', inputs: ['NACA123', 'NACA 1234567', 'NACA-ABC'] },
      { format: 'AD-A', inputs: ['AD-A12345', 'ADA12345', 'AD-A123456X'] },
      { format: 'EPA', inputs: ['EPA-60-R-123', 'EPA-600/R-14', 'EPA-600/R-014/001'] },
    ] as const

    for (const { format, inputs } of malformed) {
      it(`rejects malformed ${format} identifiers`, () => {
        for (const input of inputs) expect(extractIdentifiers(input)).toEqual([])
      })
    }

    it('does not mistake prose for report identifiers', () => {
      const negatives = [
        'we follow the RFC',
        'NASA announced a new rover',
        'the ISO standard',
        'DOE and NASA released it',
        'NTRS has a searchable archive',
        'a NACA report from 1935',
        'EPA publishes guidance documents',
      ]
      for (const input of negatives) expect(extractIdentifiers(input)).toEqual([])
    })

    it('keeps report matches in source order', () => {
      expect(extractIdentifiers('NACA-1234; NUREG-1234; RFC-9110')).toEqual([
        { kind: 'report', value: 'NACA-1234', raw: 'NACA-1234', host: '', confidence: 0.8 },
        { kind: 'report', value: 'NUREG-1234', raw: 'NUREG-1234', host: '', confidence: 0.8 },
        { kind: 'report', value: 'RFC-9110', raw: 'RFC-9110', host: '', confidence: 0.4 },
      ])
    })
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
