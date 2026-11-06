import { describe, expect, it } from 'vitest'

import { formatAuthor, parseAuthorLines, parseAuthors } from '../src/ui/authors.ts'

describe('panel author parsing', () => {
  it('pairs an initials token with the preceding surname', () => {
    expect(parseAuthors('Kucsko, G., Maurer, P.')).toEqual([
      { family: 'Kucsko', given: 'G.' },
      { family: 'Maurer', given: 'P.' },
    ])
  })

  it('keeps a bare surname without inventing a given name', () => {
    expect(parseAuthors('Kucsko')).toEqual([{ family: 'Kucsko' }])
  })

  it('accepts full given names and CJK separators', () => {
    expect(parseAuthors('张伟，李娜')).toEqual([{ family: '张伟' }, { family: '李娜' }])
    expect(parseAuthors('Zhang Wei; Li Na')).toEqual([{ family: 'Zhang Wei' }, { family: 'Li Na' }])
  })

  it('does not attach two initials tokens to one surname', () => {
    expect(parseAuthors('Kucsko, G., R.')).toEqual([{ family: 'Kucsko', given: 'G.' }, { family: 'R.' }])
  })

  it('preserves multi-word given names and suffixes as one author', () => {
    expect(parseAuthorLines('Smith, John Paul')).toEqual(['Smith, John Paul'])
    expect(parseAuthorLines('Smith, John, Jr.')).toEqual(['Smith, John, Jr.'])
  })

  it('splits only strict surname-initial multi-author lines', () => {
    expect(parseAuthorLines('Kucsko, G., Maurer, P.')).toEqual(['Kucsko, G.', 'Maurer, P.'])
    expect(parseAuthorLines('Kucsko, G., R.')).toEqual(['Kucsko, G.', 'R.'])
  })

  it('keeps single-author and multiline input intact', () => {
    expect(parseAuthorLines('Daly, C.')).toEqual(['Daly, C.'])
    expect(parseAuthorLines('van der Waals, J.')).toEqual(['van der Waals, J.'])
    expect(parseAuthorLines('张伟')).toEqual(['张伟'])
    expect(parseAuthorLines('Daly, C.\nHalbleib, M.')).toEqual(['Daly, C.', 'Halbleib, M.'])
  })

  it('formats structured authors for the host and round-trips parsed names', () => {
    expect(formatAuthor({ family: 'Kucsko', given: 'G.' })).toBe('Kucsko, G.')
    expect(formatAuthor({ family: 'Kucsko' })).toBe('Kucsko')
    expect(parseAuthors(parseAuthorLines('Kucsko, G., Maurer, P.').join('; '))).toEqual([
      { family: 'Kucsko', given: 'G.' },
      { family: 'Maurer', given: 'P.' },
    ])
  })

  it('ignores empty segments', () => {
    expect(parseAuthors(' , Kucsko ,, ')).toEqual([{ family: 'Kucsko' }])
    expect(parseAuthors('')).toEqual([])
  })
})
