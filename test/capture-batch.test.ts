import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BATCH_MARKER,
  batchPath,
  encodeBatch,
  exportableOf,
  readBatch,
  writeBatch,
} from '../src/host/capture-batch.ts'
import type { CaptureBatch } from '../src/host/capture-batch.ts'
import { decodeBatch, findLatestBatch, normalizeBatch } from '../src/core/batch.ts'

const batch: CaptureBatch = {
  capturedAt: '2026-10-29T13:00:00.000Z',
  scope: 'whole conversation',
  entries: [
    { title: 'Daly 2008', status: 'saved', id: 'ref_saved', year: 2008, doi: '10.1002/joc.1688' },
    { title: 'Unverified paper', status: 'quarantined', id: 'ref_quarantined', year: 1994 },
    { title: '', status: 'skipped', doi: '10.1000/missing' },
    { title: 'Boom', status: 'failed', reason: 'registry timeout' },
  ],
}

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'refkeeper-batch-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('capture batch persistence', () => {
  it('round-trips through the store directory', async () => {
    expect(await writeBatch(workspace, batch)).toBe(true)
    expect(batchPath(workspace).endsWith(join('refs', 'last-capture.json'))).toBe(true)
    expect(await readBatch(workspace)).toEqual(batch)
  })

  it('propagates batch persistence failures instead of silently reporting success', async () => {
    const journalDirectory = `${batchPath(workspace)}.journal`
    await mkdir(journalDirectory, { recursive: true })
    await expect(writeBatch(workspace, batch)).rejects.toThrow()
  })

  it('treats a missing batch as absent, not as an error', async () => {
    expect(await readBatch(workspace)).toBeUndefined()
  })

  it('survives a corrupt batch file', async () => {
    await mkdir(join(workspace, 'refs'), { recursive: true })
    await writeFile(batchPath(workspace), '{not json', 'utf8')
    expect(await readBatch(workspace)).toBeUndefined()
  })
})

describe('capture batch export scope', () => {
  it('exports only saved entries by default and adds quarantined on request', () => {
    expect(exportableOf(batch, false)).toEqual(['ref_saved'])
    expect(exportableOf(batch, true)).toEqual(['ref_saved', 'ref_quarantined'])
  })
})

describe('capture batch transcript encoding', () => {
  it('encodes one line the panel can find and decode', () => {
    const line = encodeBatch(batch)
    expect(line.startsWith(BATCH_MARKER)).toBe(true)
    expect(line).not.toContain('\n')
    expect(decodeBatch(`dsh-refkeeper capture — saved\n${line}`)).toEqual(batch)
  })

  it('ignores text without a marker and unparseable payloads', () => {
    expect(decodeBatch('just a normal command result')).toBeUndefined()
    expect(decodeBatch(`${BATCH_MARKER} {oops`)).toBeUndefined()
  })

  it('picks the newest batch across transcript texts', () => {
    const older = { ...batch, capturedAt: '2026-10-29T12:00:00.000Z', entries: [] }
    const newer = { ...batch, capturedAt: '2026-10-29T14:00:00.000Z' }
    expect(findLatestBatch([encodeBatch(newer), encodeBatch(older)])?.capturedAt).toBe(newer.capturedAt)
    expect(findLatestBatch([])).toBeUndefined()
  })

  it('still finds the batch when the command result carries trailing lines', () => {
    const line = encodeBatch(batch)
    expect(decodeBatch(`${line}\n\nrun \`/refs export\` to write files`)).toBeDefined()
    expect(decodeBatch(`${line}\nnote with a stray } brace`)).toBeDefined()
  })

  it('drops entries with an unknown status instead of rendering them', () => {
    const decoded = decodeBatch(
      `${BATCH_MARKER} ${JSON.stringify({ capturedAt: 'x', scope: 's', entries: [{ title: 'ok', status: 'saved' }, { title: 'bad', status: 'weird' }] })}`,
    )
    expect(decoded?.entries).toHaveLength(1)
  })
})

describe('editable field snapshots', () => {
  it('keeps the fields a capture recorded, so the panel can edit them', () => {
    const batch = normalizeBatch({
      capturedAt: '2026-10-29T00:00:00.000Z',
      scope: 'this turn',
      entries: [
        {
          title: 'A filled entry',
          status: 'saved',
          id: 'doi:10.1000/x',
          fields: {
            type: 'journalArticle',
            title: 'A filled entry',
            authors: ['Example, A.', 'Second, B.'],
            year: 2024,
            containerTitle: 'Journal of Tests',
            volume: '3',
            issue: '2',
            pages: '10-19',
            doi: '10.1000/x',
            pmid: '12345678',
            pmcid: 'PMC1234567',
          },
          pmid: '12345678',
          pmcid: 'PMC1234567',
        },
      ],
    })
    expect(batch?.entries[0]?.fields).toEqual({
      type: 'journalArticle',
      title: 'A filled entry',
      authors: ['Example, A.', 'Second, B.'],
      year: 2024,
      containerTitle: 'Journal of Tests',
      volume: '3',
      issue: '2',
      pages: '10-19',
      doi: '10.1000/x',
      pmid: '12345678',
      pmcid: 'PMC1234567',
    })
    expect(batch?.entries[0]).toMatchObject({ pmid: '12345678', pmcid: 'PMC1234567' })
  })

  it('survives a batch without fields and drops unusable ones', () => {
    const batch = normalizeBatch({
      capturedAt: '',
      scope: '',
      entries: [
        { title: 'No fields', status: 'saved', id: 'doi:1' },
        { title: 'Bad fields', status: 'saved', id: 'doi:2', fields: 'nope' },
      ],
    })
    expect(batch?.entries[0]?.fields).toBeUndefined()
    expect(batch?.entries[1]?.fields).toBeUndefined()
  })
})

describe('Markdown decoration captured before the parsers cleaned it', () => {
  it('is stripped from display fields but never from an id', () => {
    const dirty = {
      capturedAt: '2026-10-29T13:39:46.910Z',
      scope: 'whole conversation',
      entries: [
        {
          title: '*Physiographically sensitive mapping*',
          status: 'saved',
          id: 'ref_saved',
          fields: {
            type: 'journalArticle',
            title: '*Physiographically sensitive mapping*',
            authors: ['> Daly, C.', 'Halbleib, M.'],
            containerTitle: '*International Journal of Climatology*',
            doi: '10.1002/joc.1688',
          },
        },
        {
          // A quarantined row's id embeds the title in asterisks; cleaning it
          // would stop `--ids` from finding the row again.
          title: '*Meteorological Drought*',
          status: 'quarantined',
          id: 'title:*meteorological drought*|1965',
        },
      ],
    }
    const decoded = normalizeBatch(dirty)
    const saved = decoded?.entries[0]
    expect(saved?.title).toBe('Physiographically sensitive mapping')
    expect(saved?.fields?.authors).toEqual(['Daly, C.', 'Halbleib, M.'])
    expect(saved?.fields?.containerTitle).toBe('International Journal of Climatology')
    expect(decoded?.entries[1]?.id).toBe('title:*meteorological drought*|1965')
  })
})
