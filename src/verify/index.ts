/**
 * Verification barrel (M2).
 *
 * Exported as a module rather than wired into the host on purpose: the M2 gate
 * is "clients + judgement are correct against fixtures", and the network
 * orchestration (fetch, timeout, cache, backoff) is still open.
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
