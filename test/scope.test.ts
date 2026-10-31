import { describe, expect, it } from 'vitest'
import { describeScope, parseScope, resolveScope } from '../src/core/scope.ts'

const TURNS = [10, 40, 70, 100, 130]
const LAST = 160

describe('parseScope', () => {
  it('defaults to the current turn', () => {
    expect(parseScope('', '')).toEqual({ kind: 'turn' })
  })

  it('reads lastN with the default of five turns', () => {
    expect(parseScope('lastN', '')).toEqual({ kind: 'lastN', turns: 5 })
    expect(parseScope('lastN', '2')).toEqual({ kind: 'lastN', turns: 2 })
  })

  it('rejects out-of-range turns and unknown scopes', () => {
    expect(parseScope('lastN', '0')).toHaveProperty('error')
    expect(parseScope('lastN', '501')).toHaveProperty('error')
    expect(parseScope('lastN', 'abc')).toHaveProperty('error')
    // `parseInt` would have accepted both of these as 1 and 2.
    expect(parseScope('lastN', '1.5')).toHaveProperty('error')
    expect(parseScope('lastN', '2oops')).toHaveProperty('error')
    expect(parseScope('lastN', '+3')).toHaveProperty('error')
    expect(parseScope('lastN', ' 3')).toHaveProperty('error')
    expect(parseScope('everything', '')).toHaveProperty('error')
  })

  it('describes each scope', () => {
    expect(describeScope({ kind: 'turn' })).toBe('current turn')
    expect(describeScope({ kind: 'lastN', turns: 3 })).toBe('last 3 turn(s)')
    expect(describeScope({ kind: 'all' })).toBe('whole conversation')
  })
})

describe('resolveScope', () => {
  it('covers only the last turn for "turn"', () => {
    const resolution = resolveScope(TURNS, LAST, { kind: 'turn' })
    expect(resolution).toMatchObject({ startSeq: 130, endSeq: LAST, turns: 1, degraded: '' })
  })

  it('walks back exactly N turns for "lastN"', () => {
    const resolution = resolveScope(TURNS, LAST, { kind: 'lastN', turns: 2 })
    expect(resolution).toMatchObject({ startSeq: 100, endSeq: LAST, turns: 2, degraded: '' })
  })

  it('flags a request for more turns than the session has', () => {
    const resolution = resolveScope(TURNS, LAST, { kind: 'lastN', turns: 9 })
    expect(resolution).toMatchObject({ startSeq: 10, turns: 5, requestedTurns: 9, degraded: 'n-exceeds-total' })
  })

  it('treats N equal to the total as exact, not degraded', () => {
    const resolution = resolveScope(TURNS, LAST, { kind: 'lastN', turns: 5 })
    expect(resolution).toMatchObject({ startSeq: 10, turns: 5, degraded: '' })
  })

  it('covers everything for "all"', () => {
    expect(resolveScope(TURNS, LAST, { kind: 'all' })).toMatchObject({ startSeq: 0, endSeq: LAST, turns: 5 })
  })

  it('widens and reports when no turn boundary exists', () => {
    const resolution = resolveScope([], LAST, { kind: 'turn' })
    expect(resolution).toMatchObject({ startSeq: 0, endSeq: LAST, turns: 0, degraded: 'no-turn-boundaries' })
  })

  it('handles an empty session', () => {
    expect(resolveScope([], -1, { kind: 'all' })).toMatchObject({ startSeq: 0, endSeq: 0, turns: 0 })
  })
})
