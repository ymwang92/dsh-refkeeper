import type { RefAuthor, RefType, StoredReference } from '../store/types.ts'

const RIS_TYPE: Record<RefType, string> = {
  journalArticle: 'JOUR',
  conferencePaper: 'CONF',
  preprint: 'UNPB',
  report: 'RPRT',
  thesis: 'THES',
  book: 'BOOK',
  webpage: 'ELEC',
}

function risAuthor(author: RefAuthor): string {
  if (author.literal) return author.literal
  const family = author.family ?? ''
  const given = author.given ?? ''
  if (family && given) return `${family}, ${given}`
  return family || given
}

function pages(pages: string | undefined): Array<[string, string]> {
  if (!pages) return []
  const [start, end] = pages.split(/\s*(?:--|[-–—])\s*/u, 2)
  if (!start) return []
  const rows: Array<[string, string]> = [['SP', start]]
  if (end) rows.push(['EP', end])
  return rows
}

export function renderRisEntry(ref: StoredReference): string {
  const rows: Array<[string, string]> = [['TY', RIS_TYPE[ref.type]]]
  for (const author of ref.authors) {
    const value = risAuthor(author)
    if (value) rows.push(['AU', value])
  }
  rows.push(['TI', ref.title])
  if (ref.containerTitle) {
    rows.push(['T2', ref.containerTitle])
  }
  if (ref.year !== undefined) rows.push(['PY', String(ref.year)])
  if (ref.volume) rows.push(['VL', ref.volume])
  if (ref.issue) rows.push(['IS', ref.issue])
  rows.push(...pages(ref.pages))
  if (ref.publisher) rows.push(['PB', ref.publisher])
  if (ref.publisherPlace) rows.push(['CY', ref.publisherPlace])
  if (ref.identifiers.doi) rows.push(['DO', ref.identifiers.doi])
  if (ref.identifiers.arxiv) rows.push(['AN', `arXiv:${ref.identifiers.arxiv}`])
  if (ref.identifiers.isbn) rows.push(['SN', ref.identifiers.isbn])
  if (ref.identifiers.reportNumber) rows.push(['AN', ref.identifiers.reportNumber])
  if (ref.url) rows.push(['UR', ref.url])
  const annotation = ref.annotation
  if (annotation?.summary) rows.push(['AB', annotation.summary])
  if (annotation?.relevance) rows.push(['N1', annotation.relevance])
  if (annotation?.evidence) rows.push(['N1', `Evidence: ${annotation.evidence}`])
  if (annotation?.caveats) rows.push(['N1', `Caveats: ${annotation.caveats}`])
  if (ref.verification.status === 'manual') {
    rows.push(['N1', 'Status: manual entry, stored without registry verification.'])
  }
  if (ref.language) rows.push(['LA', ref.language])
  for (const tag of ref.tags ?? []) rows.push(['KW', tag])
  rows.push(['ER', ''])
  return `${rows.map(([tag, value]) => `${tag}  - ${value}`).join('\n')}\n`
}

/** Same ordering rule as BibTeX: author, year, title. */
export function renderRis(refs: readonly StoredReference[]): string {
  const sorted = [...refs].sort((a, b) => {
    const left = `${risAuthor(a.authors[0] ?? {})}|${String(a.year ?? 0)}|${a.title}`
    const right = `${risAuthor(b.authors[0] ?? {})}|${String(b.year ?? 0)}|${b.title}`
    return left < right ? -1 : left > right ? 1 : 0
  })
  return sorted.map((ref) => renderRisEntry(ref)).join('\n')
}
