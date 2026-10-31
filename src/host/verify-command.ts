/**
 * `/refs verify` — the human entry point to the verification stage.
 *
 * Pure formatting plus one injected `verify` call, so the command can be tested
 * against fixtures; the real network path is wired in `src/index.ts`.
 */

import type { VerificationClaim } from '../verify/lookup.ts'
import type { ConditionCheck, VerificationReport } from '../verify/types.ts'
import type { VerifyOutcome } from '../verify/lookup.ts'

export interface VerifyCommandDeps {
  readonly verify: (claim: VerificationClaim) => Promise<VerifyOutcome>
}

export const VERIFY_USAGE = [
  'usage:',
  '  /refs verify --doi=10.1000/xyz',
  '  /refs verify --arxiv=2301.00001',
  '  /refs verify --title="论文标题" [--year=2024] [--author=Zhang] [--json]',
  '',
  'Checks title / year (±1) / first author against Crossref, OpenAlex, arXiv and',
  'DataCite. Anything short of 3/3 with a real source goes to the ⚠ region.',
].join('\n')

export interface ParsedVerify {
  readonly doi: string
  readonly arxivId: string
  readonly title: string
  /** Claimed year; absent means "not claimed", which cannot satisfy year ±1. */
  readonly year: number | undefined
  /** Claimed authors in citation order; only the first is compared. */
  readonly authors: string[]
  readonly json: boolean
}

/** Split on whitespace but keep `--title="two words"` as one token. */
function tokenize(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const char of raw) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/u.test(char)) {
      if (current !== '') out.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') out.push(current)
  return out
}

export function parseVerifyArgs(raw: string): ParsedVerify | { readonly error: string } {
  const tokens = tokenize(raw)
  const parsed = {
    doi: '',
    arxivId: '',
    title: '',
    year: undefined as number | undefined,
    authors: [] as string[],
    json: false,
  }
  for (const token of tokens) {
    if (token === '--json') {
      parsed.json = true
      continue
    }
    const match = /^--(doi|arxiv|title|year|author)=(.*)$/u.exec(token)
    if (match === null) return { error: `unknown option "${token}"\n${VERIFY_USAGE}` }
    const option = match[1] ?? ''
    const value = match[2] ?? ''
    if (value === '') return { error: `--${option} needs a value\n${VERIFY_USAGE}` }
    if (option === 'doi') parsed.doi = value
    else if (option === 'arxiv') parsed.arxivId = value
    else if (option === 'title') parsed.title = value
    else if (option === 'author') parsed.authors.push(value)
    else {
      // Without a year the title path can never pass year ±1; accepting a
      // non-year here would silently turn a 3-condition check into a 2-condition
      // one, which is exactly the failure a reviewer has to catch by hand.
      if (!/^\d{4}$/u.test(value)) return { error: `--year expects a 4-digit year, got "${value}"\n${VERIFY_USAGE}` }
      parsed.year = Number(value)
    }
  }
  if (parsed.doi === '' && parsed.arxivId === '' && parsed.title === '') {
    return { error: `supply --doi, --arxiv or --title\n${VERIFY_USAGE}` }
  }
  return parsed
}

function mark(pass: boolean): string {
  return pass ? '✓' : '✗'
}

function condition(label: string, check: ConditionCheck): string {
  const score = check.score < 0 ? '' : ` (${check.score.toFixed(2)})`
  return `  ${mark(check.pass)} ${label}: ${check.ours} ↔ ${check.theirs}${score}`
}

const STATUS_LABEL: Record<VerificationReport['status'], string> = {
  verified: 'verified — enters the main table',
  warning: '⚠ warning — needs a human look before export',
  quarantined: '⚠ quarantined — no authoritative source confirms this work',
  unverified: '⚠ unverified — the registries could not be reached; retry later',
}

/** Human-readable verdict, shared by the command and the tool renderer. */
export function renderVerify(outcome: VerifyOutcome): string {
  const { report } = outcome
  const lines = [
    `dsh-refkeeper verify — ${STATUS_LABEL[report.status]}`,
    `passed ${String(report.passed)}/3 · sources: ${report.sources.length === 0 ? 'none' : report.sources.join(', ')}${report.matchedSource === undefined ? '' : ` · matched ${report.matchedSource}`}`,
    condition('title ', report.title),
    condition('year  ', report.year),
    condition('author', report.firstAuthor),
  ]
  if (report.reasons.length > 0) lines.push(`reasons: ${report.reasons.join(', ')}`)
  if (report.partial) lines.push('partial: at least one registry errored or timed out')
  if (outcome.lookup.records.length > 0) {
    lines.push('records:')
    for (const record of outcome.lookup.records.slice(0, 5)) {
      const year = record.year === undefined ? 'n.d.' : String(record.year)
      lines.push(`  · ${record.source} · ${year} · ${record.title}`)
    }
  }
  return lines.join('\n')
}

export async function runVerifyCommand(
  raw: string,
  deps: VerifyCommandDeps,
): Promise<{ readonly kind: 'success' | 'error'; readonly text: string }> {
  const parsed = parseVerifyArgs(raw.trim())
  if ('error' in parsed) return { kind: 'error', text: parsed.error }
  const claim: VerificationClaim = {
    doi: parsed.doi,
    arxivId: parsed.arxivId,
    title: parsed.title,
    year: parsed.year,
    authors: parsed.authors,
  }
  const outcome = await deps.verify(claim)
  if (parsed.json) {
    return { kind: 'success', text: JSON.stringify({ report: outcome.report, records: outcome.lookup.records }, null, 2) }
  }
  return { kind: 'success', text: renderVerify(outcome) }
}
