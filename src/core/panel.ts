/**
 * Panel channel markers.
 *
 * A client plugin cannot register its own Remote namespace and a slash command
 * only returns text, so the dock panel reads structured state back out of the
 * `command/done` transcript: the host appends one marker line and the panel
 * decodes it. Keeping the marker and its codec here means both ends agree on a
 * single definition.
 */

/** Line prefix for "the default export folder changed" (or was reported). */
export const DIR_MARKER = 'refkeeper-dir:'

export interface DirectorySetting {
  /** Canonical absolute path, or `null` when no default folder is set. */
  readonly dir: string | null
}

export function encodeDir(setting: DirectorySetting): string {
  return `${DIR_MARKER} ${JSON.stringify(setting)}`
}

/** Last marker wins: the newest command result is the current setting. */
export function decodeDir(text: string): DirectorySetting | undefined {
  const at = text.lastIndexOf(DIR_MARKER)
  if (at < 0) return undefined
  const rest = text.slice(at + DIR_MARKER.length)
  const newline = rest.indexOf('\n')
  const line = (newline < 0 ? rest : rest.slice(0, newline)).trim()
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const dir = (parsed as { dir?: unknown }).dir
    if (dir === null) return { dir: null }
    if (typeof dir === 'string' && dir !== '') return { dir }
    return undefined
  } catch {
    return undefined
  }
}
