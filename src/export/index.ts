import { renderBibtex } from './bibtex.ts'
import { renderRis } from './ris.ts'
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
function cleanForExport(ref: StoredReference): StoredReference {
  return {
    ...ref,
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
