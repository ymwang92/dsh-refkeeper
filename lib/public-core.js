import { $ as isValidIsbn10, A as candidateFromIdentifier, B as parseBibtexBlocks, F as mergeCandidates, G as foldText, H as clip, I as rankCandidates, J as jaccard, K as formatAuthorName, L as sanitizeEvidence, M as dedupeKey, N as extractCandidates, P as hasIdentity, Q as extractIdentifiers, R as extractCitations, S as REF_TYPES, U as collapseSpace, V as splitAuthors, W as diceBigrams, X as titleKey, Y as stripMarkup, Z as titleTokens, _ as escapeBibtex, a as editDistance, b as usefulAnnotationText, c as firstAuthorMatches, d as yearMatches, et as isValidIsbn13, f as EXPORT_EXTENSIONS, g as renderRisEntry, h as renderRis, i as TITLE, j as candidateFromModel, k as candidateFromCitation, l as titleMatches, m as renderCslJson, n as judgeCandidate, nt as normalizeDoi, o as editSimilarity, p as renderExport, q as hasCjk, r as scoreRecord, rt as normalizeIsbn, s as familyName, t as MIN_RECORD_SCORE, tt as normalizeArxiv, u as titleSimilarity, v as makeCiteKey, y as renderBibtex, z as parseBibtexBlock } from "./judge-Cb39G36o.js";
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
export { EXPORT_EXTENSIONS, MIN_RECORD_SCORE, REF_TYPES, SOURCE_IDS, TITLE, candidateFromCitation, candidateFromIdentifier, candidateFromModel, clip, collapseSpace, dedupeKey, diceBigrams, editDistance, editSimilarity, escapeBibtex, extractCandidates, extractCitations, extractIdentifiers, familyName, firstAuthorMatches, foldText, formatAuthorName, hasCjk, hasIdentity, isValidIsbn10, isValidIsbn13, jaccard, judgeCandidate, makeCiteKey, mergeCandidates, normalizeArxiv, normalizeDoi, normalizeIsbn, parseBibtexBlock, parseBibtexBlocks, rankCandidates, renderBibtex, renderCslJson, renderExport, renderRis, renderRisEntry, sanitizeEvidence, scoreRecord, splitAuthors, stripMarkup, titleKey, titleMatches, titleSimilarity, titleTokens, usefulAnnotationText, yearMatches };
