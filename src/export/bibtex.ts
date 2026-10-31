import type { RefAuthor, RefType, StoredReference } from '../store/types.ts'

export const MANUAL_NOTE = 'Manual entry: stored without registry verification.'

const TYPE_MAP: Record<RefType, string> = {
  journalArticle: 'article',
  conferencePaper: 'inproceedings',
  preprint: 'misc',
  report: 'techreport',
  thesis: 'phdthesis',
  book: 'book',
  webpage: 'misc',
}

/** BibTeX specials. Braces are escaped too: reference titles occasionally carry
 * literal braces, and an unbalanced brace silently breaks the whole entry. */
const SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  _: '\\_',
  $: '\\$',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

export function escapeBibtex(value: string): string {
  let out = ''
  for (const char of value) out += SPECIALS[char] ?? char
  return out.replace(/\s+/gu, ' ').trim()
}

export function bibtexAuthor(author: RefAuthor): string {
  if (author.literal) return escapeBibtex(author.literal)
  const family = author.family ?? ''
  const given = author.given ?? ''
  if (family && given) return `${escapeBibtex(family)}, ${escapeBibtex(given)}`
  return escapeBibtex(family || given)
}

function normalisePages(pages: string): string {
  if (pages.includes('--')) return pages
  return pages.replace(/\s*[-–—]\s*/gu, '--')
}

function asciiKeyPart(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
}

/** `familyYYYYfirstword`, ASCII-only, de-duplicated with a/b/c suffixes. */
export function makeCiteKey(ref: StoredReference, taken: Set<string>): string {
  if (ref.bibtexKey && !taken.has(ref.bibtexKey)) return ref.bibtexKey
  const first = ref.authors[0]
  const family = first ? (first.family ?? first.literal ?? '') : ''
  const surname = asciiKeyPart(family) || 'anon'
  const year = ref.year !== undefined ? String(ref.year) : 'nd'
  const word = ref.title
    .split(/\s+/u)
    .map((part) => asciiKeyPart(part))
    .find((part) => part.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(part))
  const base = `${surname}${year}${word ?? ''}`
  let key = base
  let suffix = 0
  while (taken.has(key)) {
    suffix += 1
    key = `${base}${String.fromCharCode(96 + suffix)}`
  }
  return key
}

export function bibtexFields(ref: StoredReference): Array<[string, string]> {
  const fields: Array<[string, string]> = []
  const push = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') fields.push([name, value])
  }
  if (ref.authors.length > 0) push('author', ref.authors.map(bibtexAuthor).join(' and '))
  push('title', escapeBibtex(ref.title))
  if (ref.type === 'journalArticle') push('journal', ref.containerTitle ? escapeBibtex(ref.containerTitle) : undefined)
  if (ref.type === 'conferencePaper') {
    push('booktitle', ref.containerTitle ? escapeBibtex(ref.containerTitle) : undefined)
  }
  if (ref.year !== undefined) push('year', String(ref.year))
  push('volume', ref.volume)
  push('number', ref.issue)
  push('pages', ref.pages ? normalisePages(ref.pages) : undefined)
  if (ref.type === 'report') {
    push('number', ref.identifiers.reportNumber ?? ref.issue)
    push('institution', ref.publisher)
  } else if (ref.type === 'thesis') {
    push('school', ref.publisher)
  } else if (ref.type === 'book') {
    push('publisher', ref.publisher)
    push('address', ref.publisherPlace)
  } else {
    push('publisher', ref.publisher)
  }
  if (ref.identifiers.isbn) push('isbn', ref.identifiers.isbn)
  if (ref.identifiers.doi) push('doi', ref.identifiers.doi)
  if (ref.identifiers.arxiv) {
    push('eprint', ref.identifiers.arxiv)
    push('archivePrefix', 'arXiv')
  }
  if (ref.type === 'preprint') push('howpublished', 'arXiv preprint')
  if (ref.type === 'webpage') push('howpublished', 'web')
  push('url', ref.url)
  if (ref.accessed) push('urldate', ref.accessed)
  push('language', ref.language)
  const annotation = ref.annotation
  // The annotation is the reason this plugin exists: carry the summary as the
  // abstract and the caveats as a note so it survives a trip through BibTeX.
  if (annotation?.summary) push('abstract', escapeBibtex(annotation.summary))
  // A manual entry never touched a registry, and BibTeX has no verdict field:
  // say it in the note so a reader of the .bib cannot mistake it for verified.
  const noteParts = [
    annotation?.caveats ?? '',
    ref.verification.status === 'manual' ? MANUAL_NOTE : '',
  ].filter((part) => part !== '')
  if (noteParts.length > 0) push('note', escapeBibtex(noteParts.join(' ')))
  return fields
}

export function renderBibtexEntry(ref: StoredReference, taken: Set<string>): string {
  const key = makeCiteKey(ref, taken)
  taken.add(key)
  const fields = bibtexFields(ref)
  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n')
  return `@${TYPE_MAP[ref.type]}{${key},\n${body}\n}\n`
}

/** Entries are ordered by author-year-title so repeated exports are byte-stable. */
export function renderBibtex(refs: readonly StoredReference[]): string {
  const sorted = [...refs].sort((a, b) => {
    const left = `${bibtexAuthor(a.authors[0] ?? {})}|${String(a.year ?? 0)}|${a.title}`
    const right = `${bibtexAuthor(b.authors[0] ?? {})}|${String(b.year ?? 0)}|${b.title}`
    return left < right ? -1 : left > right ? 1 : 0
  })
  const taken = new Set<string>()
  const entries = sorted.map((ref) => renderBibtexEntry(ref, taken))
  return `% Generated by dsh-refkeeper. Verified entries only.\n\n${entries.join('\n')}`
}
