/**
 * The three comparison predicates of §5.3, isolated from anything that fetches.
 *
 * Every predicate answers "do these two describe the same work" using the
 * candidate's own fields against one registry record. Thresholds are the plan's
 * defaults; they are constants here so a report can cite the number that failed.
 */

import { diceBigrams, foldText, hasCjk, jaccard, titleKey } from '../core/text.ts'

/** Title thresholds from §5.3 (Jaccard / edit similarity / CJK Dice). */
export const TITLE = {
  latinJaccard: 0.85,
  latinEdit: 0.85,
  latinStrong: 0.95,
  cjkDice: 0.9,
} as const

/** Levenshtein distance over code points, iterative two-row implementation. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a === '' || b === '') return Math.max(a.length, b.length)
  const left = [...a]
  const right = [...b]
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      const deletion = (previous[j] ?? 0) + 1
      const insertion = (current[j - 1] ?? 0) + 1
      const substitution = (previous[j - 1] ?? 0) + cost
      current[j] = Math.min(deletion, insertion, substitution)
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

/** 1 - distance/len, computed on the folded strings so case/punctuation do not count. */
export function editSimilarity(a: string, b: string): number {
  const left = titleKey(a)
  const right = titleKey(b)
  if (left === '' || right === '') return 0
  if (left === right) return 1
  const longest = Math.max([...left].length, [...right].length)
  return 1 - editDistance(left, right) / longest
}

/**
 * Title similarity 0..1.
 *
 * CJK titles are compared as character bigrams (word tokenization does not
 * exist for them); Latin titles use token overlap, which is robust to word order
 * and to the subtitle suffixes registries add.
 */
export function titleSimilarity(a: string, b: string): number {
  if (titleKey(a) === '' || titleKey(b) === '') return 0
  if (hasCjk(a) || hasCjk(b)) return diceBigrams(foldText(a), foldText(b))
  return jaccard(a, b)
}

/** Condition 1: strong overlap, per the plan's dual threshold. */
export function titleMatches(candidateTitle: string, recordTitle: string): boolean {
  if (hasCjk(candidateTitle) || hasCjk(recordTitle)) {
    return diceBigrams(foldText(candidateTitle), foldText(recordTitle)) >= TITLE.cjkDice
  }
  const tokens = jaccard(candidateTitle, recordTitle)
  const edit = editSimilarity(candidateTitle, recordTitle)
  if (tokens >= TITLE.latinStrong || edit >= TITLE.latinStrong) return true
  return tokens >= TITLE.latinJaccard && edit >= TITLE.latinEdit
}

/** Condition 2: years within one, both known. An unknown year never matches. */
export function yearMatches(candidateYear: number | undefined, recordYear: number | undefined): boolean {
  if (candidateYear === undefined || recordYear === undefined) return false
  return Math.abs(candidateYear - recordYear) <= 1
}

/**
 * Family name of one author string.
 *
 * Handles the three forms the extractors actually produce: `Zhang, S.` (family
 * before the comma), `S. Zhang` (initials first) and `张三` (no split). Anything
 * else falls back to the whole string rather than guessing a surname.
 */
export function familyName(author: string): string {
  const trimmed = author.trim()
  if (trimmed === '') return ''
  if (trimmed.includes(',')) return (trimmed.split(',')[0] ?? '').trim()
  if (hasCjk(trimmed)) return trimmed
  const parts = trimmed.split(/\s+/u).filter((part) => part !== '')
  const withoutInitials = parts.filter((part) => !/^[A-Z]\.?$/u.test(part))
  const pool = withoutInitials.length > 0 ? withoutInitials : parts
  return pool[pool.length - 1] ?? ''
}

/** Condition 3: first author's family name equal, or one edit apart when long. */
export function firstAuthorMatches(candidateAuthors: readonly string[], recordAuthors: readonly string[]): boolean {
  const ours = familyName(candidateAuthors[0] ?? '')
  const theirs = familyName(recordAuthors[0] ?? '')
  if (ours === '' || theirs === '') return false
  const left = hasCjk(ours) || hasCjk(theirs) ? foldText(ours).replace(/\s+/gu, '') : titleKey(ours)
  const right = hasCjk(ours) || hasCjk(theirs) ? foldText(theirs).replace(/\s+/gu, '') : titleKey(theirs)
  if (left === '' || right === '') return false
  if (left === right) return true
  // Single-character CJK surnames are too short for a fuzzy match to be safe.
  if ([...left].length < 4 || [...right].length < 4) return false
  return editDistance(left, right) <= 1
}
