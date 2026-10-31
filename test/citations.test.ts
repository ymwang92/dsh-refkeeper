import { describe, expect, it } from 'vitest'
import { extractCitations } from '../src/core/citations.ts'

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
