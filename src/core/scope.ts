/**
 * Scope resolution: which slice of the conversation a capture covers.
 *
 * The three user-facing choices ("current turn", "previous N turns", "the whole
 * conversation") are pure arithmetic over `turn/start` seqs, so they live here
 * as a pure function and get unit tests instead of being re-derived at each
 * call site. Turn boundaries come from the host layer, which reads them from the
 * session log through `sessionQuery` (see `host/session-read.ts`).
 */

/** What the user asked to capture. */
export type CaptureScope =
  | { readonly kind: 'turn' }
  | { readonly kind: 'lastN'; readonly turns: number }
  | { readonly kind: 'all' }

/** Resolved window plus what the resolver had to compromise on. */
export interface ScopeResolution {
  /** First seq in the window; 0 means "from the beginning". */
  readonly startSeq: number
  /** Last seq in the window. */
  readonly endSeq: number
  /** How many turns the window actually covers. */
  readonly turns: number
  /** Requested N for `lastN`, -1 otherwise. */
  readonly requestedTurns: number
  /** Empty when the request was honored exactly. */
  readonly degraded: '' | 'no-turn-boundaries' | 'n-exceeds-total'
}

/** Human-readable scope label for command output. */
export function describeScope(scope: CaptureScope): string {
  switch (scope.kind) {
    case 'turn':
      return 'current turn'
    case 'lastN':
      return `last ${String(scope.turns)} turn(s)`
    default:
      return 'whole conversation'
  }
}

/** Parse `--scope=turn|lastN|all` plus an optional `--turns=N`. */
export function parseScope(scopeArg: string, turnsArg: string): CaptureScope | { readonly error: string } {
  const kind = scopeArg === '' ? 'turn' : scopeArg
  if (kind === 'turn') return { kind: 'turn' }
  if (kind === 'all') return { kind: 'all' }
  if (kind === 'lastN' || kind === 'last-n' || kind === 'turns') {
    // Strict digits only: `parseInt` would silently accept "1.5" as 1 and
    // "2oops" as 2, turning a typo into a narrower capture than asked for.
    const turns = turnsArg === '' ? 5 : /^[0-9]+$/u.test(turnsArg) ? Number(turnsArg) : Number.NaN
    if (!Number.isInteger(turns) || turns < 1 || turns > 500) {
      return { error: `--turns must be an integer in 1..500 (got ${turnsArg === '' ? '(empty)' : turnsArg})` }
    }
    return { kind: 'lastN', turns }
  }
  return { error: `--scope must be turn | lastN | all (got ${scopeArg})` }
}

/**
 * Resolve a scope against observed turn boundaries.
 *
 * `lastN` yields exactly N turns when the session has that many: the window
 * starts at the `turn/start` of the (m - N)th entry, so N=1 means "the last
 * turn only".
 */
export function resolveScope(
  turnStarts: readonly number[],
  lastSeq: number,
  scope: CaptureScope,
): ScopeResolution {
  const total = turnStarts.length
  if (lastSeq < 0) {
    return { startSeq: 0, endSeq: 0, turns: 0, requestedTurns: -1, degraded: 'no-turn-boundaries' }
  }
  if (total === 0) {
    // Without boundaries every scope collapses to "everything": better a wide
    // window the user can narrow than a silently empty capture.
    return {
      startSeq: 0,
      endSeq: lastSeq,
      turns: 0,
      requestedTurns: scope.kind === 'lastN' ? scope.turns : -1,
      degraded: 'no-turn-boundaries',
    }
  }

  switch (scope.kind) {
    case 'all':
      return { startSeq: 0, endSeq: lastSeq, turns: total, requestedTurns: -1, degraded: '' }
    case 'turn': {
      const startSeq = turnStarts[total - 1] ?? 0
      return { startSeq, endSeq: lastSeq, turns: 1, requestedTurns: -1, degraded: '' }
    }
    case 'lastN': {
      const want = scope.turns
      if (want >= total) {
        return {
          startSeq: turnStarts[0] ?? 0,
          endSeq: lastSeq,
          turns: total,
          requestedTurns: want,
          degraded: want > total ? 'n-exceeds-total' : '',
        }
      }
      const startIndex = total - want
      const startSeq = turnStarts[startIndex] ?? 0
      return { startSeq, endSeq: lastSeq, turns: want, requestedTurns: want, degraded: '' }
    }
  }
}
