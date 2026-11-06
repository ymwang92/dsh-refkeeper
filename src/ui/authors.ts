/**
 * Author-list parsing shared by the capture panel and its tests.
 *
 * This is pure text handling with no React or DOM dependency, so it can be
 * unit-tested by the normal vitest run (the client bundle itself is exercised
 * through the GUI).
 */

const INITIALS = /^(?:[A-Za-z]\.){1,4}$/u

/** One structured author, mirroring `RefAuthor` without importing the store. */
export interface ParsedAuthor {
  readonly family: string
  readonly given?: string
}

/**
 * Turn the free-text author box into structured names.
 *
 * `"Kucsko, G., Maurer, P."` is the shape people actually type out of a paper,
 * and a plain `split(',')` reads it as four literal authors — which then breaks
 * first-author matching in verification and emits four `AU` fields in RIS. An
 * initials-looking token therefore attaches to the previous surname as `given`.
 */
export function parseAuthors(raw: string): ParsedAuthor[] {
  const tokens = raw
    .split(/[,，;；]/u)
    .map((token) => token.trim())
    .filter((token) => token !== '')
  const authors: Array<{ family: string; given?: string }> = []
  for (const token of tokens) {
    const previous = authors.at(-1)
    if (INITIALS.test(token) && previous !== undefined && previous.given === undefined) {
      previous.given = token
      continue
    }
    authors.push({ family: token })
  }
  return authors
}

/** Format a parsed name as the host's accepted `Family, Given` text shape. */
export function formatAuthor(author: ParsedAuthor): string {
  return author.given === undefined || author.given === '' ? author.family : `${author.family}, ${author.given}`
}

/** `Surname, Initial` (repeatable) is the only unambiguous multi-author line shape. */
const SEVERAL_AUTHORS = /^[^\n,]+,\s*(?:[A-Za-z]\.){1,4}(?:\s*,\s*[^\n,]+(?:\s*,\s*(?:[A-Za-z]\.){1,4})?)*$/u

export function parseAuthorLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => (SEVERAL_AUTHORS.test(line) ? parseAuthors(line) : [{ family: line }]))
    .map(formatAuthor)
    .filter((author) => author !== '')
}
