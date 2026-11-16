import { $ as isValidIsbn13, A as candidateFromModel, B as splitAuthors, F as rankCandidates, G as formatAuthorName, H as collapseSpace, I as sanitizeEvidence, J as stripMarkup, K as hasCjk, L as extractCitations, M as extractCandidates, N as hasIdentity, O as candidateFromCitation, P as mergeCandidates, Q as isValidIsbn10, R as parseBibtexBlock, U as diceBigrams, V as clip, W as foldText, X as titleTokens, Y as titleKey, Z as extractIdentifiers, _ as makeCiteKey, a as editDistance, c as firstAuthorMatches, d as yearMatches, et as normalizeArxiv, f as EXPORT_EXTENSIONS, g as escapeBibtex, h as renderRisEntry, i as TITLE, j as dedupeKey, k as candidateFromIdentifier, l as titleMatches, m as renderRis, n as judgeCandidate, nt as normalizeIsbn, o as editSimilarity, p as renderExport, q as jaccard, r as scoreRecord, s as familyName, t as MIN_RECORD_SCORE, tt as normalizeDoi, u as titleSimilarity, v as renderBibtex, x as REF_TYPES, y as usefulAnnotationText, z as parseBibtexBlocks } from "./judge-C0IgP5Fz.js";
// src/verify/types.ts
/**
* Types for the verification stage (M2).
*
* The shape is deliberately record-in / report-out: no network type appears
* here, so the judgement can be tested exhaustively against fixtures and the
* HTTP clients can be tested separately by parsing canned payloads.
*/
/** The known verification registries; plugin extensions may add other sources. */
const SOURCE_IDS = [
	"crossref",
	"openalex",
	"arxiv",
	"datacite",
	"pubmed"
];
export { EXPORT_EXTENSIONS, MIN_RECORD_SCORE, REF_TYPES, SOURCE_IDS, TITLE, candidateFromCitation, candidateFromIdentifier, candidateFromModel, clip, collapseSpace, dedupeKey, diceBigrams, editDistance, editSimilarity, escapeBibtex, extractCandidates, extractCitations, extractIdentifiers, familyName, firstAuthorMatches, foldText, formatAuthorName, hasCjk, hasIdentity, isValidIsbn10, isValidIsbn13, jaccard, judgeCandidate, makeCiteKey, mergeCandidates, normalizeArxiv, normalizeDoi, normalizeIsbn, parseBibtexBlock, parseBibtexBlocks, rankCandidates, renderBibtex, renderExport, renderRis, renderRisEntry, sanitizeEvidence, scoreRecord, splitAuthors, stripMarkup, titleKey, titleMatches, titleSimilarity, titleTokens, usefulAnnotationText, yearMatches };
