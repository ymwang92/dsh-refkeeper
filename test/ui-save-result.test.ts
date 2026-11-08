import { describe, expect, it } from 'vitest'

import {
  cachedCommandSnapshot,
  entryReasonForMeta,
  parseManualSaveResult,
} from '../src/ui/save-result.ts'

describe('manual save result parsing', () => {
  it.each([
    ['saved record', 'saved main-1 → refs/refs.json', { id: 'main-1', status: 'saved', outcome: 'saved' }],
    ['updated record', 'updated main-2 → refs/refs.json', { id: 'main-2', status: 'saved', outcome: 'saved' }],
    ['edited main record', 'edited main-3 → refs/refs.json', { id: 'main-3', status: 'saved', outcome: 'saved' }],
    ['edited quarantined record', 'edited quarantine-1 → refs/quarantine.json', { id: 'quarantine-1', status: 'quarantined', outcome: 'quarantined' }],
    ['quarantined record', '⚠ quarantined quarantine-2 → refs/quarantine.json', { id: 'quarantine-2', status: 'quarantined', outcome: 'quarantined' }],
    ['already-in-library record', 'already in the library main-4; no changes made', { id: 'main-4', status: 'saved', outcome: 'already' }],
  ] as const)('parses %s', (_label, text, result) => {
    expect(parseManualSaveResult(text)).toEqual(result)
  })

  it('returns undefined without throwing for unknown output', () => {
    expect(() => parseManualSaveResult('unrecognized command output')).not.toThrow()
    expect(parseManualSaveResult('unrecognized command output')).toBeUndefined()
  })
})

describe('entry metadata reason', () => {
  it('suppresses the stale quarantine reason for a saved entry', () => {
    expect(entryReasonForMeta('saved', 'quarantined: missing author')).toBeUndefined()
  })

  it('preserves a quarantine reason for a quarantined entry', () => {
    expect(entryReasonForMeta('quarantined', 'missing author')).toBe('missing author')
  })
})

describe('command snapshot serialization cache', () => {
  it('reuses the same serialized value while session, revision and size are unchanged', () => {
    const cache = { current: undefined }
    let calls = 0
    const serialize = (): string => {
      calls += 1
      return `snapshot-${calls}`
    }

    const first = cachedCommandSnapshot(cache, 'session-1', 7, 4, serialize)
    const second = cachedCommandSnapshot(cache, 'session-1', 7, 4, serialize)

    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  it('recomputes after revision, size or session changes', () => {
    const cache = { current: undefined }
    let calls = 0
    const serialize = (): string => {
      calls += 1
      return `snapshot-${calls}`
    }

    const first = cachedCommandSnapshot(cache, 'session-1', 7, 4, serialize)
    const revised = cachedCommandSnapshot(cache, 'session-1', 8, 4, serialize)
    const resized = cachedCommandSnapshot(cache, 'session-1', 8, 5, serialize)
    const otherSession = cachedCommandSnapshot(cache, 'session-2', 8, 5, serialize)

    expect([first, revised, resized, otherSession]).toEqual(['snapshot-1', 'snapshot-2', 'snapshot-3', 'snapshot-4'])
    expect(calls).toBe(4)
  })
})
