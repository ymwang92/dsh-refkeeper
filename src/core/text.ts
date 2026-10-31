/**
 * Text normalization shared by extraction, dedupe and (later) verification.
 *
 * Every comparison in this plugin — is this the same paper, is this title the
 * same as the source's — goes through these helpers, so the rules live in one
 * place instead of being re-guessed per call site.
 */

/** Collapse every whitespace run (including full-width spaces) to one space. */
export function collapseSpace(input: string): string {
  return input.replace(/[\s\u3000]+/gu, ' ').trim()
}

/** NFKC + lowercase + collapsed spaces: the comparison form for Latin text. */
export function foldText(input: string): string {
  return collapseSpace(input.normalize('NFKC')).toLowerCase()
}

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u

/** True when the string carries CJK characters (switches the similarity metric). */
export function hasCjk(input: string): boolean {
  return CJK.test(input)
}

/**
 * Dedupe key for titles: letters and digits only.
 *
 * Punctuation differs wildly between a chat message and a registry record
 * ("Attention Is All You Need" vs "Attention is all you need."), so the key
 * drops everything else rather than trying to normalize punctuation.
 */
export function titleKey(input: string): string {
  return foldText(input).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Token set for Jaccard similarity; single characters are dropped. */
export function titleTokens(input: string): Set<string> {
  const tokens = foldText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1)
  return new Set(tokens)
}

/**
 * Token Jaccard similarity in `[0, 1]`.
 *
 * Used for Latin titles; returns 0 when either side has no tokens so callers
 * never treat "nothing to compare" as a match.
 */
export function jaccard(a: string, b: string): number {
  const left = titleTokens(a)
  const right = titleTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** Character bigrams, ignoring spaces; CJK titles have no word boundaries. */
function bigrams(input: string): Set<string> {
  const compact = foldText(input).replace(/[\s\u3000]+/gu, '')
  const grams = new Set<string>()
  for (let i = 0; i + 1 < compact.length; i += 1) grams.add(compact.slice(i, i + 2))
  return grams
}

/** Sørensen–Dice on character bigrams, the CJK title metric. */
export function diceBigrams(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

/**
 * Strip Markdown decoration that chat text carries but a reference field must
 * not: blockquote markers (`> Daly, C.`), list bullets, emphasis asterisks
 * (`*International Journal of Climatology*`), backticks and scriptio continua
 * underscores. A model answer renders a citation line as a quotation, so this
 * runs before parsing rather than after — otherwise the marker becomes part of
 * the stored author or journal name.
 */
export function stripMarkup(input: string): string {
  return collapseSpace(
    input
      // leading blockquote markers, possibly nested and repeated per line
      .replace(/^(?:[ \t]*>)+[ \t]*/gmu, '')
      // leading list bullets, but keep a hyphen that starts a word (`-19` dates)
      .replace(/^[ \t]*[•·][ \t]*/gmu, '')
      .replace(/^[ \t]*[-+][ \t]+/gmu, '')
      // emphasis and code markers; `*` never occurs in a real citation field
      .replace(/[*`]+/gu, '')
      .replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, '$1'),
  )
    .replace(/^[\s>•*]+/u, '')
    .replace(/[\s*]+$/u, '')
}

/** Truncate to `limit` characters, appending `…` when it actually cut. */
export function clip(input: string, limit: number): string {
  return input.length <= limit ? input : `${input.slice(0, Math.max(0, limit - 1))}…`
}
