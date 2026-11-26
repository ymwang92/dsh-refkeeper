import type { RefType, StoredReference } from '../store/types.ts'

const CSL_TYPES: Record<RefType, string> = {
  journalArticle: 'article-journal',
  conferencePaper: 'paper-conference',
  preprint: 'article',
  report: 'report',
  thesis: 'thesis',
  book: 'book',
  webpage: 'webpage',
}

function keyPart(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

/** A CSL id is independent of the ASCII-only BibTeX citekey and keeps Unicode names/titles. */
function cslId(ref: StoredReference, used: Set<string>): string {
  const first = ref.authors[0]
  const author = first?.family ?? first?.literal ?? first?.given ?? 'anon'
  const title = Array.from(keyPart(ref.title)).slice(0, 80).join('')
  const base = [keyPart(author) || 'anon', ref.year === undefined ? 'nd' : String(ref.year), title]
    .filter((part) => part !== '')
    .join('-')
  let id = base || 'reference'
  let suffix = 2
  while (used.has(id)) id = `${base || 'reference'}-${String(suffix++)}`
  used.add(id)
  return id
}

function issuedDate(year: number | undefined): { readonly 'date-parts': readonly (readonly number[])[] } | undefined {
  return year === undefined ? undefined : { 'date-parts': [[year]] }
}

function accessedDate(value: string | undefined): { readonly 'date-parts': readonly (readonly number[])[] } | undefined {
  if (value === undefined) return undefined
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/u.exec(value)
  if (match === null) return undefined
  const parts = [Number(match[1])]
  if (match[2] !== undefined) parts.push(Number(match[2]))
  if (match[3] !== undefined) parts.push(Number(match[3]))
  return { 'date-parts': [parts] }
}

function addText(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') target[key] = value
}

function itemOf(ref: StoredReference, used: Set<string>): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: cslId(ref, used),
    type: CSL_TYPES[ref.type],
    title: ref.title,
  }
  if (ref.authors.length > 0) {
    item['author'] = ref.authors.map((author) => {
      if (author.literal !== undefined && author.literal !== '') return { literal: author.literal }
      return {
        ...(author.family === undefined || author.family === '' ? {} : { family: author.family }),
        ...(author.given === undefined || author.given === '' ? {} : { given: author.given }),
      }
    })
  }
  const issued = issuedDate(ref.year)
  if (issued !== undefined) item['issued'] = issued
  const accessed = accessedDate(ref.accessed)
  if (accessed !== undefined) item['accessed'] = accessed
  addText(item, 'container-title', ref.containerTitle)
  addText(item, 'volume', ref.volume)
  addText(item, 'issue', ref.issue)
  addText(item, 'page', ref.pages)
  addText(item, 'publisher', ref.publisher)
  addText(item, 'publisher-place', ref.publisherPlace)
  addText(item, 'number', ref.identifiers.reportNumber)
  addText(item, 'DOI', ref.identifiers.doi)
  addText(item, 'ISBN', ref.identifiers.isbn)
  addText(item, 'PMID', ref.identifiers.pmid)
  addText(item, 'PMCID', ref.identifiers.pmcid)
  addText(item, 'URL', ref.url)
  if (ref.identifiers.arxiv !== undefined && ref.identifiers.arxiv !== '') {
    item['archive'] = 'arXiv'
    item['archive_location'] = ref.identifiers.arxiv
  }
  addText(item, 'language', ref.language)
  addText(item, 'abstract', ref.annotation?.summary)
  if (ref.tags !== undefined && ref.tags.length > 0) item['keyword'] = ref.tags.join('; ')
  const notes = [
    ref.annotation?.relevance === undefined ? undefined : `Relevance: ${ref.annotation.relevance}`,
    ref.annotation?.evidence === undefined ? undefined : `Evidence: ${ref.annotation.evidence}`,
    ref.annotation?.caveats === undefined ? undefined : `Caveats: ${ref.annotation.caveats}`,
    ref.identifiers.lccn === undefined ? undefined : `LCCN: ${ref.identifiers.lccn}`,
    ref.identifiers.oclc === undefined ? undefined : `OCLC: ${ref.identifiers.oclc}`,
    ref.identifiers.openlibraryId === undefined ? undefined : `Open Library: ${ref.identifiers.openlibraryId}`,
  ].filter((note): note is string => note !== undefined && note !== '')
  if (notes.length > 0) item['note'] = notes.join(' ')
  return item
}

/** Render a deterministic CSL-JSON array, preserving input order and Unicode text. */
export function renderCslJson(refs: readonly StoredReference[]): string {
  const used = new Set<string>()
  return `${JSON.stringify(refs.map((ref) => itemOf(ref, used)), null, 2)}\n`
}
