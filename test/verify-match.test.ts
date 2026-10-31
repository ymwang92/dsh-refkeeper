import { describe, expect, it } from 'vitest'
import {
  editDistance,
  editSimilarity,
  familyName,
  firstAuthorMatches,
  titleMatches,
  titleSimilarity,
  yearMatches,
} from '../src/verify/match.ts'

describe('editDistance', () => {
  it('counts single edits', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1)
    expect(editDistance('same', 'same')).toBe(0)
    expect(editDistance('', 'abc')).toBe(3)
  })

  it('is case and punctuation insensitive through editSimilarity', () => {
    expect(editSimilarity('Attention Is All You Need', 'attention is all you need.')).toBe(1)
  })
})

describe('titleMatches', () => {
  it('accepts case, punctuation and spacing differences', () => {
    expect(titleMatches('Attention Is All You Need', 'attention is all you need.')).toBe(true)
    expect(titleMatches('Deep Residual Learning for Image Recognition', 'Deep  residual learning, for image recognition')).toBe(true)
  })

  it('rejects a subtitle extension under the plan thresholds', () => {
    // Deliberate: §5.3 requires Jaccard and edit similarity both >= 0.85, and
    // "…: a survey" is a different work often enough to be worth the miss.
    expect(titleMatches('Attention is all you need', 'Attention is all you need: a survey')).toBe(false)
  })

  it('rejects an unrelated Latin title', () => {
    expect(titleMatches('Attention is all you need', 'Deep residual learning for image recognition')).toBe(false)
  })

  it('accepts the same Chinese title with one typo', () => {
    expect(titleMatches('深度学习在医学影像中的应用综述', '深度学习在医学影像中的应用综述')).toBe(true)
    expect(titleSimilarity('深度学习在医学影像中的应用综述', '深度学习在医学影像中的应用')).toBeGreaterThan(0.8)
  })

  it('rejects a different Chinese title', () => {
    expect(titleMatches('深度学习在医学影像中的应用综述', '基于图神经网络的推荐算法研究')).toBe(false)
  })
})

describe('yearMatches', () => {
  it('allows one year of drift in either direction', () => {
    expect(yearMatches(2024, 2023)).toBe(true)
    expect(yearMatches(2024, 2025)).toBe(true)
    expect(yearMatches(2024, 2022)).toBe(false)
  })

  it('treats an unknown year as no match, never as pass', () => {
    expect(yearMatches(undefined, 2024)).toBe(false)
    expect(yearMatches(2024, undefined)).toBe(false)
  })
})

describe('firstAuthorMatches', () => {
  it('reads the family name out of an APA author', () => {
    expect(familyName('Zhang, S.')).toBe('Zhang')
    expect(familyName('S. Zhang')).toBe('Zhang')
    expect(familyName('张三')).toBe('张三')
  })

  it('matches across APA and initials-first forms', () => {
    expect(firstAuthorMatches(['Zhang, S.'], ['S. Zhang'])).toBe(true)
    expect(firstAuthorMatches(['张三', '李四'], ['张三'])).toBe(true)
  })

  it('rejects a different surname', () => {
    expect(firstAuthorMatches(['Zhang, S.'], ['Li, W.'])).toBe(false)
  })

  it('allows one typo only for long names', () => {
    expect(firstAuthorMatches(['Vaswani, A.'], ['Vaswani, A'])).toBe(true)
    // Short surnames must match exactly: one edit in "Li" is "Lo".
    expect(firstAuthorMatches(['Li, W.'], ['Lo, W.'])).toBe(false)
  })

  it('never matches when either side is empty', () => {
    expect(firstAuthorMatches([], ['Zhang, S.'])).toBe(false)
    expect(firstAuthorMatches(['Zhang, S.'], [])).toBe(false)
  })
})
