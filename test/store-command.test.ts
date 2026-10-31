import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coerceReference, loadStore, saveReference, writeQuarantine } from '../src/store/io.ts'
import type { HostFsLike } from '../src/host/store-command.ts'
import { isStoreSubcommand, parseStoreCommand, runStoreCommand, STORE_SUBCOMMANDS } from '../src/host/store-command.ts'
import { writeBatch } from '../src/host/capture-batch.ts'
import { decodeDir } from '../src/core/panel.ts'

const NOW = '2026-10-28T12:00:00.000Z'

type Write = {
  path: string
  content: string
  kind: 'createIfAbsent'
  signal?: AbortSignal
  sandboxPolicy?: { mode: string; workspaceRoot: string }
}

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'refkeeper-store-command-'))
  const reference = coerceReference(
    {
      title: 'A verified export fixture',
      type: 'journalArticle',
      authors: [{ family: 'Example', given: 'A.' }],
      year: 2024,
      containerTitle: 'Journal of Tests',
      identifiers: { doi: '10.1000/export-fixture' },
    },
    NOW,
  )
  if (!reference) throw new Error('fixture did not coerce')
  await saveReference(workspace, reference, { now: NOW })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function fakeFs(writes: Write[], failRis = false): HostFsLike {
  return {
    resolve: async (path) => ({ displayPath: path }),
    stat: async () => ({ type: 'directory' }),
    processPath: (target) => target.displayPath,
    writeText: async (target, content, intent, signal, sandboxPolicy) => {
      writes.push({ path: target.displayPath, content, kind: intent.kind, signal, sandboxPolicy })
      if (failRis && target.displayPath.endsWith('.ris')) throw new Error('sandbox denied')
    },
  }
}

function fencingFs(writes: Write[], inside: boolean): HostFsLike {
  return {
    ...fakeFs(writes),
    contains: () => inside,
  }
}

describe('export directory picker', () => {
  it('parses choose-dir only for export and rejects out conflicts', () => {
    expect(parseStoreCommand('export --choose-dir --format=bibtex')).toMatchObject({
      sub: 'export',
      chooseDir: true,
      format: 'bibtex',
    })
    expect(parseStoreCommand('save --choose-dir --payload=e30')).toMatchObject({ error: '--choose-dir is valid only for export' })
    expect(parseStoreCommand('export --choose-dir --format=bibtex --out=refs.bib')).toMatchObject({
      error: '--choose-dir cannot be combined with --out',
    })
  })

  it('writes selected formats with create-if-absent and reports absolute paths', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('export --choose-dir --format=bibtex', {
      workspace,
      directoryPicker: { pick: async () => '/picked/export' },
      fs: fakeFs(writes),
      now: () => NOW,
    })

    expect(result.kind).toBe('success')
    expect(result.text).toContain(
      'exported 1 of 1 file(s) for 1 of 1 reference(s) — whole library (no capture recorded yet)',
    )
    expect(result.text).toContain('/picked/export/refs-20261028-1200.bib')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.kind).toBe('createIfAbsent')
    expect(writes[0]?.content).toContain('A verified export fixture')
  })

  it('declares the session workspace as the sandbox root when writing a picked folder', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('export --choose-dir --format=bibtex', {
      workspace,
      directoryPicker: { pick: async () => join(workspace, 'exports') },
      fs: fencingFs(writes, true),
      now: () => NOW,
    })

    expect(result.kind).toBe('success')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.sandboxPolicy).toEqual({ mode: 'workspace-write', workspaceRoot: workspace })
  })

  it('refuses a picked folder outside the workspace before writing anything', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('export --choose-dir', {
      workspace,
      directoryPicker: { pick: async () => '/picked/outside' },
      fs: fencingFs(writes, false),
      now: () => NOW,
    })

    expect(result.kind).toBe('error')
    expect(result.text).toContain('outside this session\'s workspace')
    expect(result.text).toContain(workspace)
    expect(writes).toEqual([])
  })

  it('returns cleanly on picker cancellation without writing', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('export --choose-dir', {
      workspace,
      directoryPicker: { pick: async () => null },
      fs: fakeFs(writes),
      now: () => NOW,
    })

    expect(result).toEqual({ kind: 'success', text: 'export cancelled; no files were written.' })
    expect(writes).toEqual([])
  })

  it('reports partial file failures while preserving successful file paths', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('export --choose-dir', {
      workspace,
      directoryPicker: { pick: async () => '/picked/export' },
      fs: fakeFs(writes, true),
      now: () => NOW,
    })

    expect(result.kind).toBe('error')
    expect(result.text).toContain('exported 1 of 2 file(s)')
    expect(result.text).toContain('/picked/export/refs-20261028-1200.bib')
    expect(result.text).toContain('failed: /picked/export/refs-20261028-1200.ris: Error: sandbox denied')
  })

  it('reports a later path-resolution failure without hiding earlier writes', async () => {
    const writes: Write[] = []
    const baseFs = fakeFs(writes)
    let resolveCount = 0
    const fs: HostFsLike = {
      ...baseFs,
      resolve: async (path) => {
        resolveCount += 1
        if (resolveCount === 3) throw new Error('resolver unavailable')
        return { displayPath: path }
      },
    }
    const result = await runStoreCommand('export --choose-dir', {
      workspace,
      directoryPicker: { pick: async () => '/picked/export' },
      fs,
      now: () => NOW,
    })

    expect(result.kind).toBe('error')
    expect(result.text).toContain('exported 1 of 2 file(s)')
    expect(result.text).toContain('/picked/export/refs-20261028-1200.bib')
    expect(result.text).toContain('failed: /picked/export/refs-20261028-1200.ris: Error: resolver unavailable')
    expect(result.text).not.toContain('No files were written')
    expect(writes.map((write) => write.path)).toEqual(['/picked/export/refs-20261028-1200.bib'])
  })

  it('explains missing optional Host capabilities without writing', async () => {
    const result = await runStoreCommand('export --choose-dir', { workspace, now: () => NOW })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('directory picker or sandboxed filesystem service is missing')
  })
})

describe('remove', () => {
  it('parses ids, DOIs and guards destructive flags', () => {
    expect(parseStoreCommand('remove 10.1000/export-fixture')).toMatchObject({
      sub: 'remove',
      targets: ['10.1000/export-fixture'],
      all: false,
    })
    expect(parseStoreCommand('remove --quarantine ref_1 ref_2')).toMatchObject({
      sub: 'remove',
      targets: ['ref_1', 'ref_2'],
      quarantine: true,
    })
    expect(parseStoreCommand('remove')).toMatchObject({ error: 'remove needs at least one id, DOI or arXiv id (or --all --yes)' })
    expect(parseStoreCommand('remove --all')).toMatchObject({ error: 'remove --all deletes every entry; add --yes to confirm' })
    expect(parseStoreCommand('remove --all --yes ref_1')).toMatchObject({ error: '--all cannot be combined with explicit ids' })
    expect(parseStoreCommand('list --yes')).toMatchObject({ error: '--yes is valid only for remove --all' })
  })

  it('deletes a reference by DOI and leaves the rest intact', async () => {
    const second = coerceReference(
      {
        title: 'A second verified fixture',
        type: 'journalArticle',
        authors: [{ family: 'Example', given: 'B.' }],
        year: 2023,
        identifiers: { doi: '10.1000/keep-me' },
      },
      NOW,
    )
    if (!second) throw new Error('fixture did not coerce')
    await saveReference(workspace, second, { now: NOW })

    const result = await runStoreCommand('remove 10.1000/EXPORT-FIXTURE', { workspace, now: () => NOW })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('removed 1 of 2 entr')
    expect(result.text).toContain('remaining: 1')

    const store = (await loadStore(workspace, { now: NOW })).state
    expect(store.references.map((ref) => ref.identifiers.doi)).toEqual(['10.1000/keep-me'])
  })

  it('reports an unmatched target without touching the library', async () => {
    const result = await runStoreCommand('remove 10.9999/nope', { workspace, now: () => NOW })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('nothing matched')
    const store = (await loadStore(workspace, { now: NOW })).state
    expect(store.references).toHaveLength(1)
  })

  it('empties the table with --all --yes', async () => {
    const result = await runStoreCommand('remove --all --yes', { workspace, now: () => NOW })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('remaining: 0')
    const store = (await loadStore(workspace, { now: NOW })).state
    expect(store.references).toHaveLength(0)
  })
})

describe('export scope follows the last capture', () => {
  it('exports only the captured entries and points at --all for the rest', async () => {
    const store = await loadStore(workspace, { now: NOW })
    const captured = store.state.references[0]
    if (captured === undefined) throw new Error('fixture missing')
    await writeBatch(workspace, {
      capturedAt: NOW,
      scope: 'whole conversation',
      entries: [{ title: captured.title, status: 'saved', id: captured.id }],
    })

    const result = await runStoreCommand('export', { workspace, now: () => NOW })

    expect(result.kind).toBe('success')
    expect(result.text).toContain('exported 1 of 1 reference(s) — the last capture')
    expect(result.text).toContain('/refs export --all')
  })

  it('treats --all as the whole library despite a recorded batch', async () => {
    await writeBatch(workspace, {
      capturedAt: NOW,
      scope: 'whole conversation',
      entries: [{ title: 'gone', status: 'saved', id: 'ref_that_no_longer_exists' }],
    })

    const result = await runStoreCommand('export --all', { workspace, now: () => NOW })

    expect(result.kind).toBe('success')
    expect(result.text).toContain('exported 1 of 1 reference(s) — whole library')
  })

  it('falls back to the whole library when the batch has nothing exportable', async () => {
    await writeBatch(workspace, {
      capturedAt: NOW,
      scope: 'whole conversation',
      entries: [{ title: 'gone', status: 'saved', id: 'ref_that_no_longer_exists' }],
    })

    const result = await runStoreCommand('export', { workspace, now: () => NOW })

    expect(result.kind).toBe('success')
    expect(result.text).toContain('whole library (the last capture stored nothing exportable)')
  })

  it('adds the quarantined capture entries only under --include-quarantine', async () => {
    const quarantined = coerceReference(
      {
        title: 'A title that failed verification',
        type: 'journalArticle',
        authors: [{ family: 'Example', given: 'C.' }],
        year: 2021,
        identifiers: { doi: '10.1000/unsure' },
      },
      NOW,
    )
    if (!quarantined) throw new Error('fixture did not coerce')
    await writeQuarantine(workspace, { schemaVersion: 1, updatedAt: NOW, entries: [quarantined] })

    const store = await loadStore(workspace, { now: NOW })
    const saved = store.state.references[0]
    if (saved === undefined) throw new Error('fixture missing')
    await writeBatch(workspace, {
      capturedAt: NOW,
      scope: 'whole conversation',
      entries: [
        { title: saved.title, status: 'saved', id: saved.id },
        { title: quarantined.title, status: 'quarantined', id: quarantined.id },
      ],
    })

    const withoutWarning = await runStoreCommand('export', { workspace, now: () => NOW })
    expect(withoutWarning.text).toContain('exported 1 of 1 reference(s) — the last capture')

    const withWarning = await runStoreCommand('export --include-quarantine', { workspace, now: () => NOW })
    expect(withWarning.text).toContain('exported 2 of 2 reference(s) — the last capture')
    expect(withWarning.text).toContain('including 1 quarantined')
  })
})

describe('export --ids narrows the export to the ticked entries', () => {
  const idsFlag = (ids: readonly string[]): string =>
    `--ids=${Buffer.from(JSON.stringify(ids), 'utf8').toString('base64url')}`

  it('parses a base64url id list and rejects the empty or conflicting forms', () => {
    const messy = ['drought*|1965', 'doi:10.1002/joc.1688', 'a b,c']
    const parsed = parseStoreCommand(`export ${idsFlag(messy)}`)
    expect('error' in parsed ? parsed.error : parsed.ids).toEqual(messy)

    const empty = parseStoreCommand('export --ids=')
    expect('error' in empty ? empty.error : '').toContain('--ids')

    const withAll = parseStoreCommand(`export ${idsFlag(['ref_a'])} --all`)
    expect('error' in withAll ? withAll.error : '').toContain('--ids cannot be combined with --all')

    const onList = parseStoreCommand(`list ${idsFlag(['ref_a'])}`)
    expect('error' in onList ? onList.error : '').toContain('--ids is valid only for export')
  })

  it('exports exactly the ticked ids, quarantined ones included when ticked', async () => {
    const quarantined = coerceReference(
      {
        title: 'A title that failed verification',
        type: 'journalArticle',
        authors: [{ family: 'Example', given: 'C.' }],
        year: 2021,
        identifiers: { doi: '10.1000/unsure' },
      },
      NOW,
    )
    if (!quarantined) throw new Error('fixture did not coerce')
    await writeQuarantine(workspace, { schemaVersion: 1, updatedAt: NOW, entries: [quarantined] })

    const store = await loadStore(workspace, { now: NOW })
    const saved = store.state.references[0]
    if (saved === undefined) throw new Error('fixture missing')
    await writeBatch(workspace, {
      capturedAt: NOW,
      scope: 'whole conversation',
      entries: [
        { title: saved.title, status: 'saved', id: saved.id },
        { title: quarantined.title, status: 'quarantined', id: quarantined.id },
      ],
    })

    const onlySaved = await runStoreCommand(`export ${idsFlag([saved.id])}`, { workspace, now: () => NOW })
    expect(onlySaved.kind).toBe('success')
    expect(onlySaved.text).toContain('exported 1 of 2 reference(s) — your selection')

    const both = await runStoreCommand(`export ${idsFlag([saved.id, quarantined.id])}`, {
      workspace,
      now: () => NOW,
    })
    expect(both.kind).toBe('success')
    expect(both.text).toContain('exported 2 of 2 reference(s) — your selection')
    expect(both.text).toContain('including 1 quarantined')
  })
})

describe('edit', () => {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

  it('parses one id plus a payload, and refuses destructive flags', () => {
    expect(parseStoreCommand(`edit --id=ref_1 --payload=${encode({ title: 'x' })}`)).toMatchObject({
      sub: 'edit',
      targets: ['ref_1'],
    })
    expect(parseStoreCommand('edit --id=ref_1')).toMatchObject({
      error: 'edit needs --payload=<base64url(json)> with the fields to change',
    })
    expect(parseStoreCommand(`edit --payload=${encode({ title: 'x' })}`)).toMatchObject({
      error: 'edit needs exactly one reference id (--id=<id> or --ids=<payload>)',
    })
    expect(parseStoreCommand(`edit --all --id=ref_1 --payload=${encode({})}`)).toMatchObject({
      error: 'edit takes a single reference; no --all or --quarantine',
    })
  })

  it('corrects fields of a stored entry and keeps its verification', async () => {
    const result = await runStoreCommand(
      `edit --id=doi:10.1000/export-fixture --payload=${encode({
        title: 'A corrected title',
        volume: '12',
        pages: '1-9',
        authors: ['Example, A.', 'Second, B.'],
        year: 2025,
      })}`,
      { workspace, now: () => '2026-10-29T00:00:00.000Z' },
    )
    expect(result.kind).toBe('success')
    expect(result.text).toContain('edited doi:10.1000/export-fixture → refs/refs.json')
    expect(result.text).toContain('fields: title, year, volume, pages, authors')

    const store = (await loadStore(workspace, { now: NOW })).state
    const edited = store.references[0]
    expect(edited?.title).toBe('A corrected title')
    expect(edited?.volume).toBe('12')
    expect(edited?.pages).toBe('1-9')
    expect(edited?.year).toBe(2025)
    expect(edited?.authors.map((author) => author.family)).toEqual(['Example', 'Second'])
    expect(edited?.verification.status).toBe('manual')
    expect(edited?.updatedAt).toBe('2026-10-29T00:00:00.000Z')
  })

  it('edits a quarantined entry in place', async () => {
    const quarantined = coerceReference(
      {
        title: 'A quarantined fixture',
        type: 'journalArticle',
        authors: [{ family: 'Nobody', given: 'C.' }],
        year: 1999,
      },
      NOW,
    )
    if (!quarantined) throw new Error('fixture did not coerce')
    await writeQuarantine(workspace, {
      schemaVersion: 1,
      updatedAt: NOW,
      entries: [{ ...quarantined, verification: { status: 'quarantined' } }],
    })

    // Quarantine ids are titled after the raw candidate and carry spaces, so the
    // panel sends them base64url-encoded through the same flag as `--ids`.
    const result = await runStoreCommand(
      `edit --ids=${encode([quarantined.id])} --payload=${encode({ containerTitle: 'Fixed Journal' })}`,
      { workspace, now: () => NOW },
    )
    expect(result.kind).toBe('success')
    expect(result.text).toContain('refs/quarantine.json')

    const store = (await loadStore(workspace, { now: NOW })).state
    expect(store.references).toHaveLength(1)
    expect(store.references[0]?.containerTitle).toBe('Journal of Tests')
  })

  it('reports unknown ids and unusable payloads without writing', async () => {
    const missing = await runStoreCommand(`edit --id=doi:10.9999/nope --payload=${encode({ title: 'x' })}`, {
      workspace,
      now: () => NOW,
    })
    expect(missing.kind).toBe('error')
    expect(missing.text).toContain('no reference with id')

    const bad = await runStoreCommand('edit --id=doi:10.1000/export-fixture --payload=not-base64-json', {
      workspace,
      now: () => NOW,
    })
    expect(bad.kind).toBe('error')
    expect(bad.text).toContain('edit payload is not valid base64url-encoded JSON')

    const empty = await runStoreCommand(`edit --id=doi:10.1000/export-fixture --payload=${encode({ nope: 1 })}`, {
      workspace,
      now: () => NOW,
    })
    expect(empty.kind).toBe('error')
    expect(empty.text).toContain('nothing to change')

    const store = (await loadStore(workspace, { now: NOW })).state
    expect(store.references[0]?.title).toBe('A verified export fixture')
  })
})

describe('enrich', () => {
  it('parses as a bare subcommand and rejects extra arguments', () => {
    expect(parseStoreCommand('enrich')).toMatchObject({ sub: 'enrich' })
    expect(parseStoreCommand('enrich --quarantine')).toMatchObject({ sub: 'enrich', quarantine: true })
    expect(parseStoreCommand('enrich --all')).toMatchObject({
      error: 'enrich takes no arguments besides --quarantine',
    })
  })

  it('fills the blanks of an entry captured before the fields were parsed', async () => {
    const calls: string[] = []
    const result = await runStoreCommand('enrich', {
      workspace,
      now: () => '2026-10-29T00:00:00.000Z',
      resolveIdentifiers: async (doi) => {
        calls.push(doi)
        return {
          source: 'crossref',
          id: doi,
          title: 'A verified export fixture',
          authors: ['Registry, Author'],
          year: 2024,
          container: 'Journal of Tests',
          doi,
          type: 'journal-article',
          url: 'https://example.org/fixture',
          volume: '12',
          issue: '3',
          pages: '45-67',
          publisher: 'ACME Press',
          language: 'en',
        }
      },
    })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('enriched 1 of 1 reference(s)')
    expect(calls).toEqual(['10.1000/export-fixture'])

    const enriched = (await loadStore(workspace, { now: NOW })).state.references[0]
    expect(enriched?.volume).toBe('12')
    expect(enriched?.issue).toBe('3')
    expect(enriched?.pages).toBe('45-67')
    expect(enriched?.publisher).toBe('ACME Press')
    expect(enriched?.language).toBe('en')
    expect(enriched?.url).toBe('https://example.org/fixture')
    // Existing claims win: enrich never rewrites what the user already has.
    expect(enriched?.title).toBe('A verified export fixture')
    expect(enriched?.containerTitle).toBe('Journal of Tests')
    expect(enriched?.authors.map((author) => author.family)).toEqual(['Example'])
  })

  it('leaves the library alone when the host injected no resolver', async () => {
    const result = await runStoreCommand('enrich', { workspace, now: () => NOW })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('enrich needs the registry resolver')

    const untouched = (await loadStore(workspace, { now: NOW })).state.references[0]
    expect(untouched?.volume).toBeUndefined()
  })
})

describe('enrich: Markdown decoration left by an earlier capture', () => {
  it('cleans a row even when no registry record is needed', async () => {
    const stored = (await loadStore(workspace, { now: NOW })).state.references[0]
    if (stored === undefined) throw new Error('fixture missing')
    await saveReference(
      workspace,
      {
        ...stored,
        title: '*Physiographically sensitive mapping*',
        containerTitle: '*International Journal of Climatology*',
        authors: [{ family: '> Daly', given: 'C.', sequence: 0 }],
        identifiers: {},
      },
      { now: NOW },
    )

    let resolverCalls = 0
    const result = await runStoreCommand('enrich', {
      workspace,
      now: () => '2026-10-29T00:00:00.000Z',
      resolveIdentifiers: async () => {
        resolverCalls += 1
        return undefined
      },
    })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('markup')
    // No identifier means no registry lookup, but the text is still repaired.
    expect(resolverCalls).toBe(0)

    const cleaned = (await loadStore(workspace, { now: NOW })).state.references[0]
    expect(cleaned?.title).toBe('Physiographically sensitive mapping')
    expect(cleaned?.containerTitle).toBe('International Journal of Climatology')
    expect(cleaned?.authors[0]?.family).toBe('Daly')
  })
})

describe('default export folder', () => {
  it('parses dir flags and keeps them exclusive to dir', () => {
    expect(parseStoreCommand('dir')).toMatchObject({ sub: 'dir', dirChoose: false, dirClear: false })
    expect(parseStoreCommand('dir --choose')).toMatchObject({ sub: 'dir', dirChoose: true })
    expect(parseStoreCommand('dir --clear')).toMatchObject({ sub: 'dir', dirClear: true })
    expect(parseStoreCommand('dir --choose --clear')).toMatchObject({
      error: 'dir takes only one of --choose, --set or --clear',
    })
    expect(parseStoreCommand('dir --all')).toMatchObject({ error: 'dir takes only --set, --choose or --clear' })
    expect(parseStoreCommand('export --choose')).toMatchObject({
      error: '--choose, --set and --clear are valid only for dir',
    })
  })

  it('reports an unset folder with a marker the panel can decode', async () => {
    const result = await runStoreCommand('dir', { workspace, now: () => NOW })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('no default export folder')
    expect(decodeDir(result.text)).toEqual({ dir: null })
  })

  it('remembers a chosen folder and exports into it by default', async () => {
    const writes: Write[] = []
    const chosen = '/picked/default'
    const picked = await runStoreCommand('dir --choose', {
      workspace,
      directoryPicker: { pick: async () => chosen },
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(picked.kind).toBe('success')
    expect(decodeDir(picked.text)).toEqual({ dir: chosen })

    const settings: unknown = JSON.parse(
      await readFile(join(workspace, 'refs', 'settings.json'), 'utf8'),
    )
    expect(settings).toEqual({ defaultExportDir: chosen })

    const exported = await runStoreCommand('export --format=bibtex --all', {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(exported.kind).toBe('success')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path.startsWith(`${chosen}/`)).toBe(true)
  })

  it('refuses a chosen folder outside the workspace and changes nothing', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand('dir --choose', {
      workspace,
      directoryPicker: { pick: async () => '/picked/outside' },
      fs: fencingFs(writes, false),
      now: () => NOW,
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('outside this session\'s workspace')
    expect(writes).toEqual([])
    await expect(readFile(join(workspace, 'refs', 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('clears the folder so exports fall back to refs/exports/', async () => {
    const writes: Write[] = []
    await runStoreCommand('dir --choose', {
      workspace,
      directoryPicker: { pick: async () => workspace },
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    const cleared = await runStoreCommand('dir --clear', { workspace, now: () => NOW })
    expect(cleared.kind).toBe('success')
    expect(decodeDir(cleared.text)).toEqual({ dir: null })

    const exported = await runStoreCommand('export --all', { workspace, now: () => NOW })
    expect(exported.kind).toBe('success')
    expect(exported.text).toContain(join(workspace, 'refs', 'exports'))
  })
})

describe('typed default folder', () => {
  const enc = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

  it('parses --set and keeps the three modes exclusive', () => {
    const payload = enc('/picked/default')
    expect(parseStoreCommand(`dir --set=${payload}`)).toMatchObject({ sub: 'dir', dirPath: payload })
    expect(parseStoreCommand(`dir --set=${payload} --clear`)).toMatchObject({
      error: 'dir takes only one of --choose, --set or --clear',
    })
    expect(parseStoreCommand(`export --set=${payload}`)).toMatchObject({
      error: '--choose, --set and --clear are valid only for dir',
    })
  })

  it('remembers a pasted path after folding quotes, file:// and a trailing slash', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand(
      `dir --set=${enc('  "file:///picked/default/"  ')}`,
      { workspace, fs: fencingFs(writes, true), now: () => NOW },
    )
    expect(result.kind).toBe('success')
    expect(decodeDir(result.text)).toEqual({ dir: '/picked/default' })
    // The export itself must say where it wrote, otherwise "no file appeared"
    // and "the export never ran" look identical to the user.
    const exported = await runStoreCommand('export --format=bibtex --all', {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(exported.text).toContain('into /picked/default')
    const settings: unknown = JSON.parse(
      await readFile(join(workspace, 'refs', 'settings.json'), 'utf8'),
    )
    expect(settings).toEqual({ defaultExportDir: '/picked/default' })
  })

  it('rejects an empty path without touching the settings', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=${enc('   ')}`, {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('The folder path is empty')
    await expect(readFile(join(workspace, 'refs', 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('rejects a path outside the workspace', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=${enc('/picked/outside')}`, {
      workspace,
      fs: fencingFs(writes, false),
      now: () => NOW,
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('outside this session\'s workspace')
    await expect(readFile(join(workspace, 'refs', 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('unquotes the JSON payload the panel actually sends', async () => {
    // encodeFlag() runs JSON.stringify, so the decoded text is `"/picked/json"`
    // with the quotes still attached.
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=${enc('"/picked/json"')}`, {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(result.kind).toBe('success')
    expect(decodeDir(result.text)).toEqual({ dir: '/picked/json' })
  })

  it('still reads a payload that carries the flag prefix twice', async () => {
    // A panel built before the prefix fix sent `--set=--set=<payload>`, so the
    // captured value starts with the flag itself. Strip it instead of decoding
    // those bytes, which would land as U+FFFD in the folder name.
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=--set=${enc('"/picked/old"')}`, {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(result.kind).toBe('success')
    expect(decodeDir(result.text)).toEqual({ dir: '/picked/old' })
  })

  it('refuses a payload whose bytes are not readable text', async () => {
    // Bytes 0xff 0xfe are not UTF-8, which is exactly what the doubled-prefix
    // payload used to decode into.
    const broken = Buffer.from([0xff, 0xfe]).toString('base64url')
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=${broken}`, {
      workspace,
      fs: fencingFs(writes, true),
      now: () => NOW,
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('did not survive the command line')
    await expect(readFile(join(workspace, 'refs', 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('rejects a path that is not a directory', async () => {
    const writes: Write[] = []
    const result = await runStoreCommand(`dir --set=${enc('/picked/file.bib')}`, {
      workspace,
      fs: { ...fakeFs(writes), stat: async () => ({ type: 'file' }) },
      now: () => NOW,
    })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('is not an accessible directory')
  })
})

describe('subcommand routing', () => {
  it('keeps the exported routing list in step with the parser', () => {
    // `/refs` in index.ts routes on isStoreSubcommand(). `dir` once existed in
    // the parser but not in that prefix list, so `/refs dir --choose` fell
    // through to runRefsCommand and answered `unknown subcommand "dir"`.
    for (const sub of STORE_SUBCOMMANDS) {
      expect(isStoreSubcommand(sub)).toBe(true)
      const parsed = parseStoreCommand(sub)
      expect('error' in parsed ? parsed.error : '').not.toContain('unknown subcommand')
    }
    expect(isStoreSubcommand('dir')).toBe(true)
    expect(isStoreSubcommand('verify')).toBe(false)
    expect(isStoreSubcommand('capture')).toBe(false)
    expect(isStoreSubcommand('')).toBe(false)
  })
})
