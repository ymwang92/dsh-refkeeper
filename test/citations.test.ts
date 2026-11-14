import { describe, expect, it, vi } from 'vitest'
import { extractCitations, parseBibtexBlock, parseBibtexBlocks } from '../src/core/citations.ts'

function first(text: string) {
  const hits = extractCitations(text)
  expect(hits.length).toBeGreaterThan(0)
  return hits[0]
}

describe('GB/T 7714 (Chinese journals)', () => {
  it('parses a journal article', () => {
    const hit = first('张三, 李四. 深度学习在医学影像中的应用综述[J]. 计算机学报, 2024, 47(3): 1-15.')
    expect(hit).toMatchObject({
      style: 'gbt7714',
      type: 'journalArticle',
      title: '深度学习在医学影像中的应用综述',
      year: 2024,
      container: '计算机学报',
      volume: '47',
      issue: '3',
      pages: '1-15',
    })
    expect(hit.authors).toEqual(['张三', '李四'])
  })

  it('accepts a four-character Chinese title', () => {
    const hit = first('王五. 数据结构[M]. 北京: 高等教育出版社, 2020.')
    expect(hit).toMatchObject({ type: 'book', title: '数据结构', year: 2020 })
  })

  it('maps the report and thesis type codes', () => {
    expect(first('某机构. 中国人工智能发展报告[R]. 北京: 中国科学技术出版社, 2023.').type).toBe('report')
    expect(first('赵六. 面向大规模图数据的表示学习研究[D]. 北京: 清华大学, 2022.').type).toBe('thesis')
  })
})

describe('APA (English journals)', () => {
  it('parses author, year, title, journal, volume/issue', () => {
    const hit = first(
      'Zhang, S., & Li, W. (2024). Attention is not all you need. Nature Machine Intelligence, 6(3), 45-67.',
    )
    expect(hit).toMatchObject({
      style: 'apa',
      title: 'Attention is not all you need',
      year: 2024,
      container: 'Nature Machine Intelligence',
      volume: '6',
      issue: '3',
    })
    // Two authors, not four: initials stay attached to their surname.
    expect(hit.authors).toEqual(['Zhang, S.', 'Li, W.'])
  })
})

describe('IEEE (English journals)', () => {
  it('parses a numbered entry with vol/no/pp', () => {
    const hit = first(
      '[1] A. Vaswani, "Attention is all you need," NeurIPS, vol. 30, no. 2, pp. 5998-6008, 2017.',
    )
    expect(hit).toMatchObject({
      style: 'ieee',
      title: 'Attention is all you need',
      year: 2017,
      container: 'NeurIPS',
      volume: '30',
      issue: '2',
      pages: '5998-6008',
    })
  })
})

describe('rejection rules', () => {
  it('drops a citation string with no plausible year', () => {
    expect(extractCitations('[1] A. Author, "A title that is long enough," Journal, vol. 1, pp. 1-2.')).toEqual([])
  })

  it('drops prose that merely contains brackets', () => {
    expect(extractCitations('The paper [J] says something interesting about retrieval augmented generation.')).toEqual([])
  })

  it('drops over-long lines that are prose, not references', () => {
    const prose = `张三. ${'很长的段落文字。'.repeat(80)}[J]. 2024.`
    expect(extractCitations(prose)).toEqual([])
  })

  it('parses several references from one block, one per line', () => {
    const hits = extractCitations(
      [
        '张三, 李四. 深度学习在医学影像中的应用综述[J]. 计算机学报, 2024, 47(3): 1-15.',
        'Zhang, S. (2023). A second paper about retrieval. Journal of Testing, 2(1), 3-9.',
      ].join('\n'),
    )
    expect(hits).toHaveLength(2)
  })
})

describe('DOI punctuation', () => {
  it('drops the sentence full stop after a DOI in an APA line', () => {
    const hit = first(
      'Zhang, S., & Li, W. (2024). Attention is not all you need. Nature Machine Intelligence, 6(3), 45-67. doi:10.1000/abc.',
    )
    expect(hit.doi).toBe('10.1000/abc')
  })

  it('drops the full stop after a doi.org link in an IEEE line', () => {
    const hit = first(
      '[1] A. Author, "Deep learning for X," Journal, vol. 12, no. 3, pp. 45-67, 2024. https://doi.org/10.1000/xyz.',
    )
    expect(hit.doi).toBe('10.1000/xyz')
  })
})


describe('wrapped reference strings', () => {
  it('parses a citation split across two lines', () => {
    const text = `Wells, N., Goddard, S., & Hayes, M. J. (2004). A self-calibrating Palmer Drought Severity Index. Journal of Climate, 17(12),
2335–2351. https://doi.org/10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2`
    const hits = extractCitations(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('A self-calibrating Palmer Drought Severity Index')
    expect(hits[0]?.year).toBe(2004)
  })

  it('keeps the DOI when only the glued line carries it', () => {
    const text = `Wells, N., Goddard, S., & Hayes, M. J. (2004). A self-calibrating Palmer Drought Severity Index. Journal of Climate, 17(12),
2335–2351. https://doi.org/10.1175/1520-0442(2004)017<2335:ASPDSI>2.0.CO;2`
    const hits = extractCitations(text)
    expect(hits[0]?.doi).toBe('10.1175/1520-0442(2004)017<2335:aspdsi>2.0.co;2')
    expect(hits[0]?.pages).toBe('2335–2351')
  })
})

describe('lead-in prose before a citation', () => {
  it('does not keep the sentence that introduces the reference', () => {
    const hit = extractCitations(
      'Please cite: Wells, N., Goddard, S., & Hayes, M. J. (2004). A self-calibrating Palmer Drought Severity Index. Journal of Climate, 17(12), 2335–2351.',
    )[0]
    expect(hit?.authors[0]).toBe('Wells, N.')
  })
})

describe('Markdown decoration around a quoted reference', () => {
  // A model answer renders a reference line as a quotation and italicises the
  // journal, so the blockquote marker and the asterisks reach the parser. They
  // are presentation, not data: `> Daly, C.` is an author named Daly, and
  // `*International Journal of Climatology*` is a journal, not a wildcard.
  const quoted =
    '> Daly, C., Halbleib, M., Smith, J. I. (2008). Physiographically sensitive mapping of temperature. ' +
    '*International Journal of Climatology*, 28(15), 2031-2064. https://doi.org/10.1002/joc.1688'

  it('does not keep the blockquote marker in the first author', () => {
    const hit = first(quoted)
    expect(hit.authors[0]).toBe('Daly, C.')
    expect(hit.authors).not.toContain('> Daly, C.')
  })

  it('does not keep emphasis markers in the journal or the title', () => {
    const hit = first(quoted)
    expect(hit.container).toBe('International Journal of Climatology')
    expect(hit.title).toBe('Physiographically sensitive mapping of temperature')
  })
})

describe('BibTeX citations', () => {
  it.each([
    ['article', 'journalArticle'],
    ['inproceedings', 'conferencePaper'],
    ['conference', 'conferencePaper'],
    ['book', 'book'],
    ['inbook', 'book'],
    ['incollection', 'book'],
    ['techreport', 'report'],
    ['report', 'report'],
    ['unpublished', 'report'],
    ['phdthesis', 'thesis'],
    ['mastersthesis', 'thesis'],
    ['misc', 'webpage'],
    ['manual', 'webpage'],
  ] as const)('maps @%s to %s', (entryType, expectedType) => {
    const hit = parseBibtexBlock(`@${entryType}{key, title={A test title}, year={2024}}`)
    expect(hit?.type).toBe(expectedType)
    expect(hit?.style).toBe('bibtex')
  })

  it('maps article fields exactly, including nested braces and normalized authors', () => {
    const record = `@article{smith2024,
  author = {John Smith and Jane Q. Doe and {Research and Development Group}},
  title = {A {nested} title for testing},
  year = {2024-06},
  journal = {Journal of Tests},
  volume = {12},
  number = {3},
  pages = {101--115},
  doi = {https://doi.org/10.1000/AbC}
}`

    expect(parseBibtexBlock(record)).toEqual({
      style: 'bibtex',
      type: 'journalArticle',
      title: 'A nested title for testing',
      authors: ['Smith, John', 'Doe, Jane Q.', 'Research and Development Group'],
      year: 2024,
      container: 'Journal of Tests',
      volume: '12',
      issue: '3',
      pages: '101--115',
      doi: '10.1000/abc',
      raw: record,
      confidence: 0.9,
    })
  })

  it('preserves every author when the list exceeds ten names', () => {
    const authors = Array.from({ length: 12 }, (_, index) => `Given${index} Family${index}`)
    const record = `@article{many, title={A title with many authors}, author={${authors.join(' and ')}}, year={2024}}`
    const hit = parseBibtexBlock(record)

    expect(hit?.authors).toEqual(authors.map((author, index) => `Family${index}, Given${index}`))
  })

  it('expands @string and month macros, including concatenated values', () => {
    const text = `@string{journalname = {Journal of Tests}}
@string{titleprefix = "Macro "}
@string{titlesuffix = {Title}}
@article{macro,
  author = {Ada Lovelace},
  title = titleprefix # titlesuffix,
  journal = journalname,
  month = jan,
  year = {2024/06}
}`
    const hits = parseBibtexBlocks(text)

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      style: 'bibtex',
      title: 'Macro Title',
      authors: ['Lovelace, Ada'],
      year: 2024,
      container: 'Journal of Tests',
    })
  })

  it('scans multiple nested, quoted and parenthesized records while skipping comments and strings', () => {
    const text = `@comment{ignore this fake record @article{fake, title={Not a hit}, year=2000}}
@string{venue = {Proceedings of Tests}}
@inproceedings{nested,
  title = {A {nested} title},
  booktitle = venue,
  year = {2024}
}
@misc(quoted, title = "A quoted {nested} title with (parentheses)", year = {2024/05})`
    const hits = parseBibtexBlocks(text)

    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ type: 'conferencePaper', title: 'A nested title', container: 'Proceedings of Tests' })
    expect(hits[1]).toMatchObject({ type: 'webpage', title: 'A quoted nested title with (parentheses)', year: 2024 })
    expect(hits[0]?.raw).toContain('@inproceedings{nested,')
    expect(hits[1]?.raw).toContain('@misc(quoted,')
  })

  it('returns no hit for comments, strings, preambles and records without a title', () => {
    expect(parseBibtexBlocks('@comment{comment only}\n@string{j = {Journal}}\n@preamble{"ignored"}')).toEqual([])
    expect(parseBibtexBlock('@article{missing, author={Ada Lovelace}, year={2024}}')).toBeUndefined()
  })

  it('reports unknown and cyclic macros instead of silently dropping fields', () => {
    expect(() =>
      parseBibtexBlock('@article{unknown, title=missingtitle, year={2024}}'),
    ).toThrow('Unexpandable BibTeX macro "missingtitle" in field "title"')
    expect(() =>
      parseBibtexBlock('@article{cycle, title=first, year={2024}}', new Map([['first', 'second'], ['second', 'first']])),
    ).toThrow('Cyclic BibTeX macro "first" in field "title"')
  })

  it('extracts BibTeX before legacy prose parsing and preserves the trimmed raw block', () => {
    const record = '  @article{extract, title={BibTeX before prose}, year={2024}, doi={10.1000/test}}  '
    const hits = extractCitations(
      `${record}\nZhang, S. (2023). A legacy paper about retrieval. Journal of Testing, 2(1), 3-9.`,
    )

    expect(hits.map((hit) => hit.style)).toEqual(['bibtex', 'apa'])
    expect(hits[0]?.raw).toBe(record.trim())
    expect(hits[0]?.doi).toBe('10.1000/test')
  })

  it('reports a failed record macro and continues parsing later records', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hits = parseBibtexBlocks(
      '@article{bad, title=missingtitle, year={2024}}\n@article{good, title={A good title}, year={2024}}',
    )

    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('A good title')
    expect(warning).toHaveBeenCalledWith(
      '[refkeeper] BibTeX parse failed:',
      'Unexpandable BibTeX macro "missingtitle" in field "title"',
    )
    warning.mockRestore()
  })
})
