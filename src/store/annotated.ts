import { usefulAnnotationText } from '../core/annotation-text.ts'
import { REF_TYPES } from './types.ts'
import type { QuarantineState, RefAuthor, RefType, StoredReference, StoreState } from './types.ts'

const TYPE_LABEL: Record<RefType, string> = {
  journalArticle: 'Journal articles',
  conferencePaper: 'Conference papers',
  preprint: 'Preprints',
  report: 'Reports',
  thesis: 'Theses',
  book: 'Books',
  webpage: 'Web pages',
}

export function formatAuthor(author: RefAuthor): string {
  if (author.literal) return author.literal
  const family = author.family ?? ''
  const given = author.given ?? ''
  if (family && given) return `${family} ${given}`
  return family || given
}

function authorLine(ref: StoredReference): string {
  const names = ref.authors.map(formatAuthor).filter((name) => name !== '')
  if (names.length === 0) return 'n.a.'
  if (names.length <= 3) return names.join('; ')
  return `${names.slice(0, 3).join('; ')} et al.`
}

function statusSuffix(ref: StoredReference): string {
  return ref.verification.status === 'manual' ? ' ⚑ manual' : ''
}

function metaLine(ref: StoredReference): string {
  const parts = [authorLine(ref)]
  if (ref.year !== undefined) parts.push(String(ref.year))
  const container = [ref.containerTitle, ref.volume, ref.issue, ref.pages]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
  if (container) parts.push(container)
  const ids = [
    ref.identifiers.doi ? `DOI [${ref.identifiers.doi}](https://doi.org/${ref.identifiers.doi})` : '',
    ref.identifiers.arxiv ? `arXiv [${ref.identifiers.arxiv}](https://arxiv.org/abs/${ref.identifiers.arxiv})` : '',
    ref.identifiers.isbn ? `ISBN ${ref.identifiers.isbn}` : '',
    ref.identifiers.reportNumber ? `Report ${ref.identifiers.reportNumber}` : '',
  ].filter((part) => part !== '')
  if (ids.length > 0) parts.push(ids.join(' · '))
  return parts.join(' · ')
}

function annotationBlock(ref: StoredReference): string[] {
  const annotation = ref.annotation
  if (!annotation) return []
  // Rows written before the annotator rejected meta-commentary still hold
  // "the excerpt does not cite this work". It is dropped here, at the render
  // boundary, so the view is clean without rewriting the user's library.
  const summary = usefulAnnotationText(annotation.summary)
  const relevance = usefulAnnotationText(annotation.relevance)
  const evidence = usefulAnnotationText(annotation.evidence)
  const caveats = usefulAnnotationText(annotation.caveats)
  const rows: string[] = []
  if (summary !== '') rows.push(`**Summary** — ${summary}`)
  if (relevance !== '') rows.push(`**Why it matters** — ${relevance}`)
  if (evidence !== '') rows.push(`**Evidence** — ${evidence}`)
  if (caveats !== '') rows.push(`**Caveats** — ${caveats}`)
  if (rows.length === 0) return []
  const provenance = annotation.source ? ` _(${annotation.source})_` : ''
  return ['', ...rows.map((row) => `> ${row}`), provenance ? provenance.trim() : ''].filter(
    (line, index, all) => !(line === '' && all[index - 1] === ''),
  )
}

function verificationLine(ref: StoredReference): string {
  const v = ref.verification
  const passed = v.passed !== undefined ? ` ${String(v.passed)}/3` : ''
  const sources = v.sources && v.sources.length > 0 ? ` · ${v.sources.join(', ')}` : ''
  const reasons = v.reasons && v.reasons.length > 0 ? ` · ${v.reasons.join(', ')}` : ''
  return `- verification: **${v.status}**${passed}${sources}${reasons}`
}

function entryBlock(ref: StoredReference, index: number): string[] {
  const heading = `### ${String(index)}. ${ref.title}${statusSuffix(ref)}`
  const lines = [heading, '', metaLine(ref), '']
  lines.push(...annotationBlock(ref))
  lines.push(verificationLine(ref))
  if (ref.tags && ref.tags.length > 0) lines.push(`- tags: ${ref.tags.join(', ')}`)
  return [...lines, '']
}

/** Human-readable mirror of the store. Deterministic: no wall-clock timestamps,
 * so regenerating an unchanged store produces identical bytes. */
export function renderAnnotated(state: StoreState, quarantine?: QuarantineState): string {
  const lines: string[] = ['# Reference library', '']
  const quarantined = quarantine?.entries.length ?? 0
  lines.push(
    `${String(state.references.length)} reference(s)` +
      (quarantined > 0 ? ` · ${String(quarantined)} in ⚠ quarantine` : '') +
      ` · updated ${state.updatedAt}`,
  )
  lines.push('')

  for (const type of REF_TYPES) {
    const group = state.references.filter((ref) => ref.type === type)
    if (group.length === 0) continue
    lines.push(`## ${TYPE_LABEL[type]}`, '')
    group.forEach((ref, index) => {
      lines.push(...entryBlock(ref, index + 1))
    })
  }
  if (state.references.length === 0) {
    lines.push('_No verified references yet._', '')
  }

  if (quarantine && quarantine.entries.length > 0) {
    lines.push('## ⚠ Quarantine (excluded from export)', '')
    lines.push(
      'Verification did not pass the three-condition gate. These entries are kept for review and are **never** exported by default.',
      '',
    )
    quarantine.entries.forEach((ref, index) => {
      lines.push(...entryBlock(ref, index + 1))
    })
  }
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}
