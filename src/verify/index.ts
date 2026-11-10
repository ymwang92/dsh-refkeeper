/**
 * Public verification helpers shared by the host and fixture tests.
 * Network orchestration and caching are implemented in lookup.ts.
 */

export {
  arxivSearchUrl,
  crossrefDoiUrl,
  crossrefSearchUrl,
  dataciteDoiUrl,
  openalexDoiUrl,
  openalexSearchUrl,
  parseArxivFeed,
  parseCrossrefSearch,
  parseCrossrefWork,
  parseDataciteWork,
  parseOpenAlexSearch,
  parseOpenAlexWork,
  parsePmcSearchUid,
  parsePmcSummaryPmid,
  parsePubMedSummary,
  pmcSearchUrl,
  pmcSummaryUrl,
  pubmedIdUrl,
} from './clients.ts'
export { familyName, firstAuthorMatches, titleMatches, titleSimilarity, yearMatches } from './match.ts'
export { MIN_RECORD_SCORE, judgeCandidate, scoreRecord } from './judge.ts'
export type {
  ConditionCheck,
  ReasonCode,
  SourceId,
  SourceRecord,
  VerificationReport,
  VerificationStatus,
} from './types.ts'
