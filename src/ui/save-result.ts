import type { BatchEntryStatus } from '../core/batch.ts'

export interface ManualSaveResult {
  readonly id: string
  readonly status: 'saved' | 'quarantined'
  readonly outcome: 'saved' | 'already' | 'quarantined'
}

export function parseManualSaveResult(text: string): ManualSaveResult | undefined {
  const quarantined = /(?:^|\s)⚠\s*quarantined\s+(\S+)\s+→\s+refs\/quarantine\.json(?:\s|$)/.exec(text)
  if (quarantined !== null && quarantined[1] !== undefined) {
    return { id: quarantined[1], status: 'quarantined', outcome: 'quarantined' }
  }

  const editedQuarantine = /(?:^|\s)edited\s+(\S+)\s+→\s+refs\/quarantine\.json(?:\s|$)/.exec(text)
  if (editedQuarantine !== null && editedQuarantine[1] !== undefined) {
    return { id: editedQuarantine[1], status: 'quarantined', outcome: 'quarantined' }
  }

  const already = /(?:^|\s)already in the library\s+(\S+);/.exec(text)
  if (already !== null && already[1] !== undefined) {
    return { id: already[1], status: 'saved', outcome: 'already' }
  }

  const saved = /(?:^|\s)(?:saved|updated|edited)\s+(\S+)\s+→\s+refs\/refs\.json(?:\s|$)/.exec(text)
  if (saved !== null && saved[1] !== undefined) {
    return { id: saved[1], status: 'saved', outcome: 'saved' }
  }
  return undefined
}

export function entryReasonForMeta(status: BatchEntryStatus, reason: string | undefined): string | undefined {
  return status === 'saved' ? undefined : reason
}

export interface CommandSnapshotCacheEntry {
  readonly sessionId: string | undefined
  readonly revision: number
  readonly size: number
  readonly serialized: string
}

export interface CommandSnapshotCache {
  current: CommandSnapshotCacheEntry | undefined
}

export function cachedCommandSnapshot(
  cache: CommandSnapshotCache,
  sessionId: string | undefined,
  revision: number,
  size: number,
  serialize: () => string,
): string {
  const current = cache.current
  if (current !== undefined && current.sessionId === sessionId && current.revision === revision && current.size === size) {
    return current.serialized
  }

  const serialized = serialize()
  cache.current = { sessionId, revision, size, serialized }
  return serialized
}
