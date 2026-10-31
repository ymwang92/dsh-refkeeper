import { renderBibtex } from './bibtex.ts'
import { renderRis } from './ris.ts'
import { usefulAnnotationText } from '../core/annotation-text.ts'
import { stripMarkup } from '../core/text.ts'
import type { StoredReference } from '../store/types.ts'

export { renderBibtex, makeCiteKey, escapeBibtex } from './bibtex.ts'
export { renderRis, renderRisEntry } from './ris.ts'

export type ExportFormat = 'bibtex' | 'ris'

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  bibtex: 'bib',
  ris: 'ris',
}

/**
 * Strip Markdown decoration that slipped in before the parsers cleaned it.
 *
 * The library outlives the parser: rows written by an earlier version still
 * carry `> Daly, C.` in the author list and `*International Journal of
 * Climatology*` in the journal, and re-capturing every paper to fix a stray
 * character is not a reasonable ask. Cleaning at the render boundary keeps one
 * rule — what leaves the plugin is clean — without rewriting the user's library
 * behind their back. Identifiers and URLs stay untouched: `*` is legal in a
 * quarantine id and `_` is legal in a DOI.
 */
function cleanAnnotation(annotation: StoredReference['annotation']): StoredReference['annotation'] {
  if (annotation === undefined) return undefined
  const kept = {
    summary: usefulAnnotationText(annotation.summary),
    relevance: usefulAnnotationText(annotation.relevance),
    evidence: usefulAnnotationText(annotation.evidence),
    caveats: usefulAnnotationText(annotation.caveats),
  }
  const rows = {
    ...(kept.summary === '' ? {} : { summary: kept.summary }),
    ...(kept.relevance === '' ? {} : { relevance: kept.relevance }),
    ...(kept.evidence === '' ? {} : { evidence: kept.evidence }),
    ...(kept.caveats === '' ? {} : { caveats: kept.caveats }),
  }
  // Nothing survived: exporting an empty `note` field would just be a blank line.
  if (Object.keys(rows).length === 0) return undefined
  // Spread `annotation` first only for provenance: re-adding the old fields
  // would undo the filter, because an omitted key leaves the stale one in place.
  return {
    ...(annotation.source === undefined ? {} : { source: annotation.source }),
    ...(annotation.status === undefined ? {} : { status: annotation.status }),
    ...(annotation.updatedAt === undefined ? {} : { updatedAt: annotation.updatedAt }),
    ...rows,
  }
}

function cleanForExport(ref: StoredReference): StoredReference {
  return {
    ...ref,
    ...(ref.annotation === undefined ? {} : { annotation: cleanAnnotation(ref.annotation) }),
    title: stripMarkup(ref.title),
    ...(ref.containerTitle === undefined ? {} : { containerTitle: stripMarkup(ref.containerTitle) }),
    ...(ref.publisher === undefined ? {} : { publisher: stripMarkup(ref.publisher) }),
    ...(ref.publisherPlace === undefined ? {} : { publisherPlace: stripMarkup(ref.publisherPlace) }),
    authors: ref.authors.map((author) =>
      author.literal !== undefined && author.literal !== ''
        ? { ...author, literal: stripMarkup(author.literal) }
        : {
            ...author,
            ...(author.family === undefined ? {} : { family: stripMarkup(author.family) }),
            ...(author.given === undefined ? {} : { given: stripMarkup(author.given) }),
          },
    ),
  }
}

export function renderExport(format: ExportFormat, refs: readonly StoredReference[]): string {
  const clean = refs.map(cleanForExport)
  return format === 'bibtex' ? renderBibtex(clean) : renderRis(clean)
}
