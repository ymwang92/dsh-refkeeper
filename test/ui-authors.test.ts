import { describe, expect, it } from 'vitest'

import { parseAuthors } from '../src/ui/authors.ts'

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

  it('ignores empty segments', () => {
    expect(parseAuthors(' , Kucsko ,, ')).toEqual([{ family: 'Kucsko' }])
    expect(parseAuthors('')).toEqual([])
  })
})
