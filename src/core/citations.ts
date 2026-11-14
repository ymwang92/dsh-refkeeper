/**
 * Pass 2 extraction: reference strings that are already formatted as citations.
 *
 * Three styles cover the material this plugin meets in practice: GB/T 7714
 * (Chinese journals), APA and IEEE (English journals). The parser is
 * deliberately shallow — it fills title/year/authors/container and leaves the
 * authoritative fields to the identifier pass or the model (Pass 3). A citation
 * string that misses a year or a plausible title is dropped rather than stored
 * half-parsed, because a wrong year is worse than no entry.
 */

import { normalizeDoi } from './identifiers.ts'
import { hasCjk, stripMarkup } from './text.ts'

/** Recognized reference-string styles. */
export type CitationStyle = 'gbt7714' | 'apa' | 'ieee' | 'vancouver' | 'bibtex'

/** Item type carried into BibTeX/RIS mapping later. */
export type ItemType =
  | 'journalArticle'
  | 'conferencePaper'
  | 'preprint'
  | 'report'
  | 'thesis'
  | 'book'
  | 'webpage'

/** One parsed reference string. */
export interface CitationHit {
  readonly style: CitationStyle
  readonly type: ItemType
  readonly title: string
  readonly authors: readonly string[]
  /** Undefined when the string carries no plausible year. */
  readonly year: number | undefined
  readonly container: string
  readonly volume: string
  readonly issue: string
  readonly pages: string
  readonly doi: string
  readonly raw: string
  readonly confidence: number
}

/** GB/T 7714 type codes on the `[J]` marker. */
const GBT_TYPE: Readonly<Record<string, ItemType>> = {
  J: 'journalArticle',
  C: 'conferencePaper',
  M: 'book',
  D: 'thesis',
  R: 'report',
  'EB/OL': 'webpage',
  'J/OL': 'journalArticle',
  'M/OL': 'book',
  'C/OL': 'conferencePaper',
}

/**
 * A journal name left with a dangling separator (`International Journal of
 * Climatology,`) or emphasis residue is not the journal name.
 */
function cleanContainer(raw: string): string {
  return stripMarkup(raw)
    .replace(/^[\s,.;:，。；：]+/u, '')
    .replace(/[\s,;:，。；：]+$/u, '')
    .replace(/^[([（【]+/u, '')
    .replace(/[)\]）】]+$/u, '')
}

function plausibleYear(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const year = Number.parseInt(raw, 10)
  if (!Number.isFinite(year) || year < 1800 || year > 2100) return undefined
  return year
}

/**
 * A title is plausible when it is long enough to be a title rather than a label.
 * CJK titles pack the same information into far fewer characters, so the floor
 * is 4 rather than 6 there: "数据结构" is a real book, "Data" is not a title.
 */
function plausibleTitle(title: string): boolean {
  const trimmed = title.trim()
  return hasCjk(trimmed) ? trimmed.length >= 4 : trimmed.length >= 6
}

/** "S.", "S. A.", "J.-P." — an initials fragment, never a surname on its own. */
const INITIALS_ONLY = /^(?:[A-Z]\.\s*-?\s*)+$/u

/**
 * Split an author list without tearing "Surname, I. I." in half.
 *
 * APA and GB/T both write `Surname, I. I.` inside a comma-separated list, so a
 * naive split on `,` yields `['Zhang', 'S.', 'Li', 'W.']` — four people where
 * there are two, which then makes "first author" comparison compare a surname
 * against an initial. Comma-separated fragments that are only initials are
 * folded back into the surname they belong to. `&`/`and`/`;` stay hard
 * separators because they never appear inside one name.
 */
export function splitAuthors(raw: string): string[] {
  const parts = raw
    .replace(/\s*(?:&|\band\b)\s*/gu, ',')
    .split(/[,，;；、]/u)
    .map((part) => stripMarkup(part))
    .filter((part) => part !== '')
  const authors: string[] = []
  for (const part of parts) {
    const previous = authors.at(-1)
    if (previous !== undefined && INITIALS_ONLY.test(part)) {
      authors[authors.length - 1] = `${previous}, ${part}`
      continue
    }
    authors.push(part)
  }
  return authors.filter((author) => author.length < 80).slice(0, 50)
}

/** Grab volume/issue/pages out of a `, 47(3): 1-15` style tail. */
function parseVolumeIssuePages(tail: string): { volume: string; issue: string; pages: string } {
  const volumeIssue = tail.match(/(\d{1,5})\s*[（(]\s*(\d{1,4})\s*[)）]/u)
  // APA states pages after a comma (`17(12), 2335–2351`); GB/T and IEEE use a
  // colon or `pp.`. All three shapes end in a range.
  const pages = tail.match(/(?:[:：]\s*|pp?\.?\s*|,\s*)([A-Za-z]?\d{1,6}\s*[-–—~]\s*[A-Za-z]?\d{1,6})/u)
  return {
    volume: volumeIssue?.[1] ?? '',
    issue: volumeIssue?.[2] ?? '',
    pages: pages?.[1]?.replace(/\s+/gu, '') ?? '',
  }
}

// Legacy AMS ids carry angle brackets (`...017<2335:ASPDSI>2.0.CO;2`); keep the
// pattern identical to the identifier pass or the two disagree on one DOI.
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/iu

/** GB/T 7714: `作者. 标题[J]. 刊名, 2024, 47(3): 1-15.` */
function parseGbt7714(line: string): CitationHit | undefined {
  const match = line.match(/^(.{2,300}?)[.．]\s*(.{4,300}?)\s*\[([A-Z]{1,2}(?:\/OL)?)\]\s*[.．]?\s*(.*)$/u)
  if (match === null) return undefined
  const typeCode = match[3] ?? ''
  const type = GBT_TYPE[typeCode]
  if (type === undefined) return undefined
  const title = stripMarkup(match[2] ?? '')
  if (!plausibleTitle(title)) return undefined
  const tail = stripMarkup(match[4] ?? '')
  const year = plausibleYear(tail.match(/\b(1[89]\d{2}|20\d{2})\b/u)?.[1])
  if (year === undefined) return undefined
  const container = cleanContainer(tail.split(/[,，]/u)[0] ?? '')
  return {
    style: 'gbt7714',
    type,
    title,
    authors: splitAuthors(match[1] ?? ''),
    year,
    container,
    ...parseVolumeIssuePages(tail),
    doi: normalizeDoiIn(tail),
    raw: line,
    confidence: 0.55,
  }
}

const APA = /^(.{2,200}?)\(\s*(1[89]\d{2}|20\d{2})\s*\)\s*[.．]\s*(.{4,300}?)[.．]\s*(.*)$/u

/** Drop prose that introduces the citation (`Please cite: Wells, N., …`). */
function trimLeadIn(block: string): string {
  const at = Math.max(block.lastIndexOf(':'), block.lastIndexOf('：'))
  if (at < 0) return block
  const tail = block.slice(at + 1).trim()
  return tail === '' ? block : tail
}

/** APA: `Author, A. A. (2024). Title. Journal, 12(3), 45–67.` */
function parseApa(line: string): CitationHit | undefined {
  const match = line.match(APA)
  if (match === null) return undefined
  const title = stripMarkup(match[3] ?? '')
  if (!plausibleTitle(title)) return undefined
  const tail = stripMarkup(match[4] ?? '')
  return {
    style: 'apa',
    type: 'journalArticle',
    title,
    authors: splitAuthors(trimLeadIn(match[1] ?? '')),
    year: plausibleYear(match[2]),
    container: cleanContainer(tail.split(/[,，.]/u)[0] ?? ''),
    ...parseVolumeIssuePages(tail),
    doi: normalizeDoiIn(line),
    raw: line,
    confidence: 0.5,
  }
}

const CONFERENCE_HINT = /\b(proc\.?|proceedings|conference|symposium|workshop|congress)\b/iu

const IEEE = /^\[\d{1,3}\]\s*(.{2,200}?)\s*["“”](.{4,300}?)["“”]\s*[,，]?\s*(.*)$/u

/** IEEE: `[1] A. Author, "Title," Journal, vol. 12, no. 3, pp. 45–67, 2024.` */
function parseIeee(line: string): CitationHit | undefined {
  const match = line.match(IEEE)
  if (match === null) return undefined
  // IEEE puts the separator comma inside the quotes: "Title," Journal.
  const title = stripMarkup(match[2] ?? '').replace(/[,，.．]\s*$/u, '')
  if (!plausibleTitle(title)) return undefined
  const tail = stripMarkup(match[3] ?? '')
  const year = plausibleYear(tail.match(/\b(1[89]\d{2}|20\d{2})\b/u)?.[1])
  if (year === undefined) return undefined
  const volume = tail.match(/vol\.?\s*(\d{1,5})/iu)?.[1] ?? ''
  const issue = tail.match(/no\.?\s*(\d{1,4})/iu)?.[1] ?? ''
  const pages = tail.match(/pp\.?\s*([A-Za-z]?\d{1,6}\s*[-–—~]\s*[A-Za-z]?\d{1,6})/iu)?.[1] ?? ''
  return {
    style: 'ieee',
    // "in Proc. NeurIPS" / "in Proceedings of ..." is a conference paper even
    // though the record keeps the IEEE field layout.
    type: CONFERENCE_HINT.test(tail) ? 'conferencePaper' : 'journalArticle',
    title,
    authors: splitAuthors(match[1] ?? ''),
    year,
    container: cleanContainer(tail.split(/[,，]/u)[0] ?? ''),
    volume,
    issue,
    pages: pages.replace(/\s+/gu, ''),
    doi: normalizeDoiIn(line),
    raw: line,
    confidence: 0.6,
  }
}

const VANCOUVER = /^(?:[1-9]|1[0-9]|2[0-5])\.\s*(.{2,500}?)\.\s*(.{6,300}?)\.\s*(.{2,200}?)\.\s*(1[89]\d{2}|20\d{2})(?:\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?\s*;\s*(.*)$/iu

/** Convert Vancouver surname-first names without changing legacy author parsing. */
function splitVancouverAuthors(raw: string): string[] {
  return raw
    .split(/[,，]/u)
    .map((part) => stripMarkup(part).trim())
    .filter((author) => author !== '')
    .map((author) => {
      const match = author.match(/^(.*?)\s+([A-Z](?:[A-Z.-]{0,4}))$/u)
      if (match === null) return author
      const surname = match[1]?.trim() ?? ''
      const initials = match[2]?.replace(/[^A-Z]/gu, '') ?? ''
      return surname !== '' && initials.length > 0 && initials.length <= 3
        ? `${surname}, ${initials}`
        : author
    })
    .slice(0, 50)
}

/** Numbered Vancouver: `1. Author J. Title. Journal. 2024 Mar;47(3):1-15.` */
function parseVancouver(line: string): CitationHit | undefined {
  const match = line.match(VANCOUVER)
  if (match === null) return undefined
  const title = stripMarkup(match[2] ?? '')
  if (!plausibleTitle(title)) return undefined
  const year = plausibleYear(match[4])
  if (year === undefined) return undefined
  const tail = stripMarkup(match[6] ?? '')
  const parsed = parseVolumeIssuePages(tail)
  const pagination = tail.match(/^\s*(\d{1,5})(?:\s*[（(]\s*(\d{1,4})\s*[)）])?\s*[:：]\s*(e?\d{1,6}(?:\s*[-–—~]\s*e?\d{1,6})?)/iu)
  return {
    style: 'vancouver',
    type: 'journalArticle',
    title,
    authors: splitVancouverAuthors(match[1] ?? ''),
    year,
    container: cleanContainer(match[3] ?? ''),
    volume: parsed.volume || pagination?.[1] || '',
    issue: parsed.issue || pagination?.[2] || '',
    pages: parsed.pages || pagination?.[3]?.replace(/\s+/gu, '') || '',
    doi: normalizeDoiIn(line),
    raw: line,
    confidence: 0.5,
  }
}

function normalizeDoiIn(text: string): string {
  const match = text.match(DOI_IN_TEXT)
  // Reuse the identifier pass normaliser: a reference line usually ends with a
  // full stop (`… doi:10.1000/x.`), and a DOI that keeps that stop fails every
  // downstream resolver query.
  return match === null ? '' : normalizeDoi(match[0])
}

/** Lines longer than this are prose that happens to contain brackets. */
const MAX_LINE = 600

/**
 * Parse reference strings out of a text block, one per line.
 *
 * Only lines that parse end-to-end become hits: a partial match is exactly the
 * failure mode that produces plausible-looking wrong entries.
 */
/**
 * Citation strings wrap: a chat bubble or a PDF copy puts the year on one line
 * and the page range on the next. `^...$` parsers then miss every wrapped
 * reference, so each line is also tried glued to its successor when the first
 * line clearly continues (no terminal punctuation, or the next line opens with
 * a URL, a digit or a lowercase word).
 */
function candidateLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const out: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    out.push(line)
    const next = lines[index + 1]
    if (next === undefined) continue
    const continues = !/[.。!?！？;；]$/u.test(line) || /^(https?:\/\/|\d|\(|\[|[a-z])/u.test(next)
    if (!continues) continue
    const glued = `${line} ${next}`
    if (glued.length <= MAX_LINE) out.push(glued)
  }
  return out
}

/** How much a parse actually filled in; used to prefer the richer duplicate. */
function scoreHit(hit: CitationHit): number {
  let score = 0
  if (hit.doi !== '') score += 4
  if (hit.pages !== '') score += 2
  if (hit.volume !== '') score += 1
  if (hit.issue !== '') score += 1
  if (hit.authors.length > 0) score += 1
  return score
}

interface BibtexBlock {
  readonly start: number
  readonly end: number
  readonly type: string
  readonly raw: string
  readonly body: string
}

class BibtexParseError extends Error {}

/** Find complete @records without being confused by nested braces or quotes. */
function scanBibtexBlocks(text: string): BibtexBlock[] {
  const matcher = /@([a-z][a-z0-9_-]*)\s*([({])/giu
  const blocks: BibtexBlock[] = []
  let match = matcher.exec(text)
  while (match !== null) {
    const start = match.index
    const type = (match[1] ?? '').toLowerCase()
    const opening = match[2] ?? ''
    let braceDepth = opening === '{' ? 1 : 0
    let parenDepth = opening === '(' ? 1 : 0
    let quoted = false
    let escaped = false
    let end = -1
    for (let index = matcher.lastIndex; index < text.length; index += 1) {
      const character = text[index] ?? ''
      if (quoted) {
        if (escaped) escaped = false
        else if (character.charCodeAt(0) === 92) escaped = true
        else if (character === '\"') quoted = false
        continue
      }
      if (character === '\"' && (opening === '{' ? braceDepth === 1 : braceDepth === 0)) {
        quoted = true
        continue
      }
      if (character === '{') {
        braceDepth += 1
        continue
      }
      if (character === '}' && braceDepth > 0) {
        braceDepth -= 1
        if (opening === '{' && braceDepth === 0) {
          end = index + 1
          break
        }
        continue
      }
      if (opening === '(' && braceDepth === 0) {
        if (character === '(') parenDepth += 1
        else if (character === ')') {
          parenDepth -= 1
          if (parenDepth === 0) {
            end = index + 1
            break
          }
        }
      }
    }
    if (end < 0) {
      matcher.lastIndex = start + 1
      match = matcher.exec(text)
      continue
    }
    const raw = text.slice(start, end).trim()
    const bodyStart = matcher.lastIndex
    const bodyEnd = end - 1
    blocks.push({ start, end, type, raw, body: text.slice(bodyStart, bodyEnd).trim() })
    matcher.lastIndex = end
    match = matcher.exec(text)
  }
  return blocks
}

function splitBibtexTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let start = 0
  let braceDepth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (quoted) {
      if (escaped) escaped = false
      else if (character.charCodeAt(0) === 92) escaped = true
      else if (character === '\"') quoted = false
      continue
    }
    if (character === '\"' && braceDepth === 0) {
      quoted = true
      continue
    }
    if (character === '{') braceDepth += 1
    else if (character === '}' && braceDepth > 0) braceDepth -= 1
    else if (character === delimiter && braceDepth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function topLevelIndex(value: string, delimiter: string): number {
  let braceDepth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (quoted) {
      if (escaped) escaped = false
      else if (character.charCodeAt(0) === 92) escaped = true
      else if (character === '\"') quoted = false
      continue
    }
    if (character === '\"' && braceDepth === 0) {
      quoted = true
      continue
    }
    if (character === '{') braceDepth += 1
    else if (character === '}' && braceDepth > 0) braceDepth -= 1
    else if (character === delimiter && braceDepth === 0) return index
  }
  return -1
}

function parseBibtexFields(block: BibtexBlock, includeFirstAssignment: boolean): Map<string, string> {
  const parts = splitBibtexTopLevel(block.body, ',')
  const fields = new Map<string, string>()
  for (const part of parts.slice(includeFirstAssignment ? 0 : 1)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const equals = topLevelIndex(trimmed, '=')
    if (equals < 0) {
      if (includeFirstAssignment) throw new BibtexParseError(`Invalid @string definition: ${trimmed}`)
      continue
    }
    const name = trimmed.slice(0, equals).trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]*$/u.test(name)) {
      throw new BibtexParseError(`Invalid BibTeX field name: ${name || trimmed}`)
    }
    fields.set(name, trimmed.slice(equals + 1).trim())
  }
  return fields
}

function isWrappedByBraces(value: string): boolean {
  if (!value.startsWith('{') || !value.endsWith('}')) return false
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (character === '{') depth += 1
    else if (character === '}') depth -= 1
    if (depth === 0 && index < value.length - 1) return false
    if (depth < 0) return false
  }
  return depth === 0
}

function cleanBibtexText(value: string): string {
  return value
    .replace(/\\([{}#%&_$])/gu, '$1')
    .replace(/\\(["\\])/gu, '$1')
    .replace(/[{}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function cleanBibtexLiteral(value: string): string {
  const cleaned = cleanBibtexText(value)
  if (cleaned === '') return ''
  return `${/^\s/u.test(value) ? ' ' : ''}${cleaned}${/\s$/u.test(value) ? ' ' : ''}`
}

function cleanBibtexAuthorText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function expandBibtexValue(
  expression: string,
  macros: ReadonlyMap<string, string>,
  field: string,
  stack: readonly string[] = [],
  preserveAuthorBraces = false,
): string {
  return splitBibtexTopLevel(expression, '#')
    .map((part) => {
      const value = part.trim()
      if (value === '') return ''
      if (isWrappedByBraces(value)) {
        const inner = value.slice(1, -1)
        return preserveAuthorBraces ? cleanBibtexAuthorText(inner) : cleanBibtexLiteral(inner)
      }
      if (value.startsWith('\"') && value.endsWith('\"')) {
        const inner = value.slice(1, -1)
        return preserveAuthorBraces ? cleanBibtexAuthorText(inner) : cleanBibtexLiteral(inner)
      }
      if (/^\d+$/u.test(value) || /^\d+[a-z0-9./:+_-]*$/iu.test(value)) return value
      if (/^[a-z][a-z0-9_-]*$/iu.test(value)) {
        const macro = value.toLowerCase()
        const expansion = macros.get(macro)
        if (expansion === undefined) {
          throw new BibtexParseError(`Unexpandable BibTeX macro "${value}" in field "${field}"`)
        }
        if (stack.includes(macro)) {
          throw new BibtexParseError(`Cyclic BibTeX macro "${value}" in field "${field}"`)
        }
        return expandBibtexValue(expansion, macros, field, [...stack, macro], preserveAuthorBraces)
      }
      if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/iu.test(value)) return value
      throw new BibtexParseError(`Unexpandable BibTeX value "${value}" in field "${field}"`)
    })
    .join('')
}

function splitBibtexAuthors(raw: string): string[] {
  const names: string[] = []
  let start = 0
  let braceDepth = 0
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? ''
    if (character === '{') braceDepth += 1
    else if (character === '}' && braceDepth > 0) braceDepth -= 1
    if (braceDepth !== 0) continue
    const separator = raw.slice(index).match(/^\s+and\s+/iu)?.[0]
    if (separator === undefined) continue
    names.push(raw.slice(start, index).trim())
    index += separator.length - 1
    start = index + 1
  }
  names.push(raw.slice(start).trim())
  return names
    .filter((name) => name !== '')
    .map((name) => {
      const corporate = isWrappedByBraces(name)
      const cleaned = cleanBibtexText(name)
      if (corporate || cleaned.includes(',')) return cleaned
      const words = cleaned.split(/\s+/u)
      if (words.length < 2) return cleaned
      const surname = words.pop() ?? ''
      return `${surname}, ${words.join(' ')}`
    })
}

const BIBTEX_TYPES: Readonly<Record<string, ItemType>> = {
  article: 'journalArticle',
  inproceedings: 'conferencePaper',
  conference: 'conferencePaper',
  book: 'book',
  inbook: 'book',
  incollection: 'book',
  techreport: 'report',
  report: 'report',
  unpublished: 'report',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  misc: 'webpage',
}

const BIBTEX_MONTHS: Readonly<Record<string, string>> = {
  jan: '{January}', feb: '{February}', mar: '{March}', apr: '{April}', may: '{May}', jun: '{June}',
  jul: '{July}', aug: '{August}', sep: '{September}', oct: '{October}', nov: '{November}', dec: '{December}',
}

function normalizeBibtexDoi(value: string): string {
  const normalizedValue = value.trim()
  const lowercase = normalizedValue.toLowerCase()
  const prefixes = ['https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/', 'http://dx.doi.org/']
  const prefix = prefixes.find((candidate) => lowercase.startsWith(candidate))
  return normalizeDoi(prefix === undefined ? normalizedValue : normalizedValue.slice(prefix.length))
}

function parseBibtexRecord(block: BibtexBlock, macros: ReadonlyMap<string, string>): CitationHit | undefined {
  if (block.type === 'comment' || block.type === 'string' || block.type === 'preamble') return undefined
  const rawFields = parseBibtexFields(block, false)
  const fields = new Map<string, string>()
  for (const [name, expression] of rawFields) {
    // Expand even fields that CitationHit cannot represent (e.g. publisher), so
    // an unknown macro is always explicit rather than silently discarded.
    const preserveAuthorBraces = name === 'author'
    const expanded = expandBibtexValue(expression, macros, name, [], preserveAuthorBraces)
    fields.set(name, preserveAuthorBraces ? expanded.trim() : cleanBibtexText(expanded))
  }
  const title = fields.get('title') ?? ''
  if (title === '') return undefined
  const yearText = fields.get('year') ?? ''
  const yearMatch = yearText.match(/^((?:18|19|20|21)\d{2})(?:-(?:0[1-9]|1[0-2])|\/(?:0[1-9]|1[0-2]))?$/u)
  const year = yearMatch === null ? undefined : plausibleYear(yearMatch[1])
  const doiText = fields.get('doi') ?? ''
  return {
    style: 'bibtex',
    type: BIBTEX_TYPES[block.type] ?? 'webpage',
    title,
    authors: splitBibtexAuthors(fields.get('author') ?? ''),
    year,
    container: fields.get('journal') ?? fields.get('booktitle') ?? '',
    volume: fields.get('volume') ?? '',
    issue: fields.get('number') ?? '',
    pages: fields.get('pages') ?? '',
    doi: doiText === '' ? '' : normalizeBibtexDoi(doiText),
    raw: block.raw,
    confidence: 0.9,
  }
}

function reportBibtexFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn('[refkeeper] BibTeX parse failed:', message)
}

function bibtexMacros(blocks: readonly BibtexBlock[]): Map<string, string> {
  const macros = new Map<string, string>(Object.entries(BIBTEX_MONTHS))
  for (const block of blocks) {
    if (block.type !== 'string') continue
    try {
      for (const [name, expression] of parseBibtexFields(block, true)) macros.set(name, expression)
    } catch (error) {
      reportBibtexFailure(error)
    }
  }
  return macros
}

function parseBibtexRecords(blocks: readonly BibtexBlock[]): CitationHit[] {
  const macros = bibtexMacros(blocks)
  const hits: CitationHit[] = []
  for (const block of blocks) {
    try {
      const hit = parseBibtexRecord(block, macros)
      if (hit !== undefined) hits.push(hit)
    } catch (error) {
      reportBibtexFailure(error)
    }
  }
  return hits
}

/** Parse BibTeX records in a text block, expanding @string definitions first. */
export function parseBibtexBlocks(text: string): CitationHit[] {
  return parseBibtexRecords(scanBibtexBlocks(text))
}

/** Parse one BibTeX record; throws when a referenced macro cannot be expanded. */
export function parseBibtexBlock(block: string, macros: ReadonlyMap<string, string> = new Map()): CitationHit | undefined {
  const located = scanBibtexBlocks(block)[0]
  return located === undefined ? undefined : parseBibtexRecord(located, macros)
}

function removeBibtexBlocks(text: string, blocks: readonly BibtexBlock[]): string {
  if (blocks.length === 0) return text
  const remaining: string[] = []
  let cursor = 0
  for (const block of blocks) {
    remaining.push(text.slice(cursor, block.start))
    cursor = block.end
  }
  remaining.push(text.slice(cursor))
  return remaining.join('\n')
}

export function extractCitations(text: string): CitationHit[] {
  const blocks = scanBibtexBlocks(text)
  const hits = parseBibtexRecords(blocks)
  const seen = new Set<string>()
  for (const line of candidateLines(removeBibtexBlocks(text, blocks))) {
    if (line.length < 12 || line.length > MAX_LINE) continue
    const hit = parseGbt7714(line) ?? parseIeee(line) ?? parseVancouver(line) ?? parseApa(line)
    if (hit === undefined) continue
    const key = `${hit.style}:${hit.title.toLowerCase()}`
    if (seen.has(key)) {
      // The same title parsed twice — once from a wrapped line, once from the
      // whole string. Keep whichever carries more fields instead of the first.
      const index = hits.findIndex((existing) => `${existing.style}:${existing.title.toLowerCase()}` === key)
      if (index >= 0 && scoreHit(hit) > scoreHit(hits[index] as CitationHit)) hits[index] = hit
      continue
    }
    seen.add(key)
    hits.push(hit)
  }
  return hits
}
