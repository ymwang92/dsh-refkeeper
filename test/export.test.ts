import { describe, expect, it } from 'vitest'
import { renderBibtex, renderBibtexEntry, makeCiteKey, escapeBibtex } from '../src/export/bibtex.ts'
import { renderRis, renderRisEntry } from '../src/export/ris.ts'
import { renderExport } from '../src/export/index.ts'
import { renderAnnotated } from '../src/store/annotated.ts'
import { coerceReference } from '../src/store/io.ts'
import type { StoredReference } from '../src/store/types.ts'

const NOW = '2026-10-28T12:00:00.000Z'

function ref(overrides: Record<string, unknown> = {}): StoredReference {
  const built = coerceReference(
    {
      title: 'Nanometre-scale thermometry in a living cell',
      type: 'journalArticle',
      authors: [{ family: 'Kucsko', given: 'G.' }],
      year: 2013,
      containerTitle: 'Nature',
      volume: '500',
      pages: '54-58',
      identifiers: { doi: '10.1038/nature12373' },
      verification: { status: 'verified', checkedAt: NOW, passed: 3 },
      ...overrides,
    },
    NOW,
  )
  if (!built) throw new Error('fixture did not coerce')
  return built
}

describe('bibtex export', () => {
  it('escapes the characters that would break a field', () => {
    expect(escapeBibtex('100% of ~5 x 10^3 & 2_000 #1 $5')).toBe(
      '100\\% of \\textasciitilde{}5 x 10\\textasciicircum{}3 \\& 2\\_000 \\#1 \\$5',
    )
  })

  it('builds a stable ascii key and de-duplicates with suffixes', () => {
    const taken = new Set<string>()
    const first = ref()
    const key = makeCiteKey(first, taken)
    expect(key).toBe('kucsko2013nanometrescale')
    taken.add(key)
    expect(makeCiteKey(ref(), taken)).toBe('kucsko2013nanometrescalea')
  })

  it('keeps a non-ascii title while still producing an ascii key', () => {
    const entry = renderBibtexEntry(
      ref({
        title: '深度学习在医学影像中的应用综述',
        authors: [{ family: '张', given: '三' }],
        year: 2024,
        identifiers: { doi: '10.1000/cn' },
      }),
      new Set<string>(),
    )
    expect(entry).toContain('深度学习在医学影像中的应用综述')
    expect(entry).toMatch(/@article\{anon2024/u)
  })

  it('writes the annotation caveats as a note and stays deterministic', () => {
    const withNote = ref({
      annotation: { summary: 'Thermometry at the nanoscale.', caveats: 'Small sample.' },
    })
    const once = renderBibtex([withNote])
    expect(once).toContain('note = {Small sample.}')
    expect(once).toContain('abstract = {Thermometry at the nanoscale.}')
    expect(renderBibtex([withNote])).toBe(once)
  })

  it('keeps PMID and PMCID in the existing single note with caveats and manual status', () => {
    const entry = renderBibtex([
      ref({
        identifiers: {
          doi: '10.1038/nature12373',
          pmid: '25882522',
          pmcid: 'PMC7840891',
        },
        annotation: { caveats: 'Small sample.' },
        verification: { status: 'manual', checkedAt: NOW },
      }),
    ])
    expect(entry).toContain('doi = {10.1038/nature12373}')
    const notes = entry.split('\n').filter((line) => line.startsWith('  note = '))
    expect(notes).toEqual([
      '  note = {Small sample. Manual entry: stored without registry verification. PMID: 25882522 PMC: PMC7840891}',
    ])
  })

  it('labels a manual entry so a .bib reader cannot mistake it for verified', () => {
    const manual = ref({ verification: { status: 'manual', checkedAt: NOW } })
    const entry = renderBibtex([manual])
    expect(entry).toContain('Manual entry: stored without registry verification.')
    const verified = renderBibtex([ref()])
    expect(verified).not.toContain('Manual entry')
  })

  it('orders entries by author, year and title', () => {
    const out = renderBibtex([
      ref({ title: 'Zeta', year: 2020, authors: [{ family: 'Zulu' }], identifiers: { doi: '10.1000/z' } }),
      ref({ title: 'Alpha', year: 1999, authors: [{ family: 'Able' }], identifiers: { doi: '10.1000/a' } }),
    ])
    expect(out.indexOf('able1999alpha')).toBeLessThan(out.indexOf('zulu2020zeta'))
  })
})

describe('ris export', () => {
  it('maps the type, author and page range', () => {
    const entry = renderRisEntry(ref())
    expect(entry.startsWith('TY  - JOUR\n')).toBe(true)
    expect(entry).toContain('AU  - Kucsko, G.')
    expect(entry).toContain('T2  - Nature')
    expect(entry).toContain('SP  - 54')
    expect(entry).toContain('EP  - 58')
    expect(entry).toContain('DO  - 10.1038/nature12373')
    expect(entry.trimEnd().endsWith('ER  -')).toBe(true)
  })

  it('adds PMID and PMCID AN rows after existing identifier rows', () => {
    const entry = renderRisEntry(
      ref({
        identifiers: {
          doi: '10.1038/nature12373',
          arxiv: '1706.03762',
          isbn: '9781450375631',
          reportNumber: 'RPT-17',
          pmid: '25882522',
          pmcid: 'PMC7840891',
        },
        url: 'https://example.test/reference',
      }),
    )
    const rows = entry.split('\n').filter((line) => line !== '')
    const expectedOrder = [
      'DO  - 10.1038/nature12373',
      'AN  - arXiv:1706.03762',
      'SN  - 9781450375631',
      'AN  - RPT-17',
      'AN  - PMID:25882522',
      'AN  - PMC:PMC7840891',
      'UR  - https://example.test/reference',
    ]
    const positions = expectedOrder.map((row) => rows.indexOf(row))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('omits empty PubMed identifiers and notes', () => {
    const reference = ref()
    const bibtex = renderBibtex([reference])
    const ris = renderRisEntry(reference)
    expect(bibtex).not.toContain('note =')
    expect(bibtex).not.toContain('PMID:')
    expect(bibtex).not.toContain('PMC:')
    expect(ris).not.toContain('AN  - PMID:')
    expect(ris).not.toContain('AN  - PMC:')
  })

  it('labels annotations with N1 rows', () => {
    const entry = renderRisEntry(
      ref({ annotation: { relevance: 'Baseline method.', evidence: 'Mentioned in turn 3.' } }),
    )
    expect(entry).toContain('N1  - Baseline method.')
    expect(entry).toContain('N1  - Evidence: Mentioned in turn 3.')
  })

  it('renders an empty library without inventing entries', () => {
    expect(renderRis([])).not.toContain('TY  -')
  })
})

describe('export facade', () => {
  it('drops annotation text that only describes the missing evidence', () => {
    const filler = ref({
      annotation: {
        relevance: 'The supplied excerpt contains no statement of why this work is cited.',
        caveats:
          'The conversation excerpt consists only of runtime and workspace context and does not mention or cite this reference.',
      },
    })
    const bib = renderExport('bibtex', [filler])
    // No caveat survives, so BibTeX has no note field at all rather than an empty one.
    expect(bib).not.toContain('note =')
    expect(bib).not.toContain('runtime and workspace context')
    const ris = renderExport('ris', [filler])
    expect(ris).not.toContain('N1  - Caveats')
    expect(ris).not.toContain('supplied excerpt')
  })

  it('keeps real annotation text while dropping the filler beside it', () => {
    const mixed = ref({
      annotation: {
        summary: 'Thermometry at the nanoscale.',
        relevance: 'No citation sentence is available in the given text.',
        caveats: 'The conversation excerpt does not mention this reference.',
      },
    })
    const bib = renderExport('bibtex', [mixed])
    expect(bib).toContain('abstract = {Thermometry at the nanoscale.}')
    expect(bib).not.toContain('No citation sentence')
    // The summary survives but the filler caveat must not resurrect the note field.
    expect(bib).not.toContain('note =')
  })

  it('picks the requested format', () => {
    expect(renderExport('bibtex', [ref()])).toContain('@article')
    expect(renderExport('ris', [ref()])).toContain('TY  - JOUR')
  })
})

describe('annotated markdown', () => {
  it('groups by type and separates the quarantine region', () => {
    const md = renderAnnotated(
      { schemaVersion: 1, updatedAt: NOW, references: [ref()] },
      { schemaVersion: 1, updatedAt: NOW, entries: [ref({ title: 'Unconfirmed', identifiers: {} })] },
    )
    expect(md).toContain('## Journal articles')
    expect(md).toContain('## ⚠ Quarantine (excluded from export)')
    expect(md).toContain('Unconfirmed')
    expect(md).toContain('1 reference(s)')
  })

  it('says so when nothing is stored', () => {
    const md = renderAnnotated({ schemaVersion: 1, updatedAt: NOW, references: [] })
    expect(md).toContain('_No verified references yet._')
  })
})

describe('Markdown decoration in a stored row', () => {
  it('is stripped from title, journal and authors on render', () => {
    const dirty = ref({
      title: '*Physiographically sensitive mapping*',
      containerTitle: '*International Journal of Climatology*',
      authors: [{ family: '> Daly', given: 'C.' }],
    })
    const bib = renderExport('bibtex', [dirty])
    const ris = renderExport('ris', [dirty])
    for (const text of [bib, ris]) {
      expect(text).not.toContain('*')
      expect(text).not.toContain('> Daly')
    }
    expect(bib).toContain('International Journal of Climatology')
    expect(ris).toContain('International Journal of Climatology')
  })
})
