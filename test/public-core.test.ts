// Run `npm run build` before Vitest: the isolation tests intentionally exercise built artifacts.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/core/candidates.ts'
import {
  extractCandidates as extractCandidatesInternal,
} from '../src/core/candidates.ts'
import { extractCitations as extractCitationsInternal } from '../src/core/citations.ts'
import { extractIdentifiers as extractIdentifiersInternal } from '../src/core/identifiers.ts'
import { usefulAnnotationText as usefulAnnotationTextInternal } from '../src/core/annotation-text.ts'
import { renderBibtex as renderBibtexInternal, renderRis as renderRisInternal } from '../src/export/index.ts'
import {
  firstAuthorMatches as firstAuthorMatchesInternal,
  titleMatches as titleMatchesInternal,
  titleSimilarity as titleSimilarityInternal,
  yearMatches as yearMatchesInternal,
} from '../src/verify/match.ts'
import { judgeCandidate as judgeCandidateInternal } from '../src/verify/judge.ts'
import { REF_TYPES as refTypesInternal } from '../src/store/types.ts'
import * as publicCore from '../src/public-core.ts'
import type { QuarantineState, RefAuthor, RefType, StoreState, StoredReference } from '../src/public-core.ts'

const typeOnlySurface: {
  readonly refType: RefType
  readonly author: RefAuthor
  readonly reference: StoredReference
  readonly quarantine: QuarantineState
  readonly store: StoreState
} | undefined = undefined

const modulePath = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url))

function citationCandidate(): Candidate {
  const [candidate] = extractCandidatesInternal([
    { seq: 3, text: 'See https://doi.org/10.1038/s41586-024-00001-x' },
    { seq: 9, text: 'As reported in 10.1038/S41586-024-00001-X earlier.' },
  ])
  if (candidate === undefined) throw new Error('Expected the DOI example to produce a candidate')
  return candidate
}

describe('public pure-core entry', () => {
  it('exposes the intended runtime APIs without store or DSH internals', () => {
    const expectedFunctions = [
      'extractIdentifiers',
      'extractCitations',
      'extractCandidates',
      'titleMatches',
      'yearMatches',
      'firstAuthorMatches',
      'titleSimilarity',
      'judgeCandidate',
      'renderBibtex',
      'renderRis',
    ]
    for (const name of expectedFunctions) {
      expect(typeof publicCore[name as keyof typeof publicCore], name).toBe('function')
    }
    expect(publicCore.REF_TYPES).toEqual([
      'journalArticle',
      'conferencePaper',
      'preprint',
      'report',
      'thesis',
      'book',
      'webpage',
    ])
    expect(publicCore.REF_TYPES).toEqual(refTypesInternal)
    expect(typeOnlySurface).toBeUndefined()

    for (const name of [
      'SCHEMA_VERSION',
      'DEFAULT_MAX_REFERENCES',
      'StoreError',
      'emptyStore',
      'emptyQuarantine',
      'identityKey',
      'sortStoredReferences',
      'defineTool',
      'ctx',
    ]) {
      expect(name in publicCore).toBe(false)
    }
    expect(Object.keys(publicCore).some((name) => name.startsWith('@deepseek-ai/dsh-'))).toBe(false)

    const source = readFileSync(modulePath('../src/public-core.ts'), 'utf8')
    expect(source).not.toMatch(/@deepseek-ai\/dsh-/u)
    expect(source).not.toMatch(/\bdefineTool\b|\bctx\b/u)
  })

  it('matches the internal pure functions for the same inputs', () => {
    const text = 'See https://doi.org/10.1038/s41586-024-00001-x'
    const sources = [
      { seq: 3, text },
      { seq: 9, text: 'As reported in 10.1038/S41586-024-00001-X earlier.' },
    ]
    const candidate = citationCandidate()

    expect(publicCore.extractIdentifiers(text)).toEqual(extractIdentifiersInternal(text))
    expect(publicCore.extractCitations('Smith J. A title. Journal. 2024;12(3):45-67.')).toEqual(
      extractCitationsInternal('Smith J. A title. Journal. 2024;12(3):45-67.'),
    )
    expect(publicCore.extractCandidates(sources)).toEqual(extractCandidatesInternal(sources))
    expect(publicCore.usefulAnnotationText('A concise note about the paper.')).toBe(
      usefulAnnotationTextInternal('A concise note about the paper.'),
    )
    expect(publicCore.titleSimilarity('A title', 'A title')).toBe(titleSimilarityInternal('A title', 'A title'))
    expect(publicCore.titleMatches('A title', 'A title')).toBe(titleMatchesInternal('A title', 'A title'))
    expect(publicCore.yearMatches(2024, 2024)).toBe(yearMatchesInternal(2024, 2024))
    expect(publicCore.firstAuthorMatches(['Smith, J'], ['Smith, J'])).toBe(
      firstAuthorMatchesInternal(['Smith, J'], ['Smith, J']),
    )
    expect(publicCore.judgeCandidate({ candidate, records: [] })).toEqual(
      judgeCandidateInternal({ candidate, records: [] }),
    )
    expect(publicCore.renderBibtex([])).toBe(renderBibtexInternal([]))
    expect(publicCore.renderRis([])).toBe(renderRisInternal([]))
  })

  it('resolves the package subpath to the generated public entry', () => {
    const packageJson = JSON.parse(readFileSync(modulePath('../package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(packageJson.exports['./core']).toEqual({
      types: './lib/public-core.d.ts',
      default: './lib/public-core.js',
    })
  })

  it('imports and calls only the public entry from an isolated non-DSH process', () => {
    const entryUrl = pathToFileURL(modulePath('../lib/public-core.js')).href
    const script = `
      import { extractCandidates } from ${JSON.stringify(entryUrl)}
      const candidates = extractCandidates([{ seq: 1, text: 'https://doi.org/10.1000/isolated-core' }])
      if (candidates.length !== 1 || candidates[0]?.doi !== '10.1000/isolated-core') {
        throw new Error('public-core returned an unexpected candidate result')
      }
      console.log('isolated-core-ok')
    `
    const env = { ...process.env }
    delete env.DSH_HOME
    delete env.DSH_PROFILE
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      { cwd: process.env.TMPDIR ?? '/tmp', encoding: 'utf8', env, timeout: 60_000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('isolated-core-ok')
  })

  it('resolves the published package subpath from an isolated non-DSH consumer', () => {
    const packageDirectory = mkdtempSync(join(tmpdir(), 'dsh-refkeeper-package-'))
    try {
      const repositoryRoot = modulePath('..')
      const packed = spawnSync('npm', ['pack', '--pack-destination', packageDirectory], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(packed.error).toBeUndefined()
      expect(packed.status, packed.stderr).toBe(0)

      const tarball = readdirSync(packageDirectory).find(
        (name) => name.startsWith('dsh-refkeeper-') && name.endsWith('.tgz'),
      )
      if (tarball === undefined) throw new Error('npm pack did not create a dsh-refkeeper tarball')

      const initialized = spawnSync('npm', ['init', '-y'], {
        cwd: packageDirectory,
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(initialized.error).toBeUndefined()
      expect(initialized.status, initialized.stderr).toBe(0)

      const installed = spawnSync(
        'npm',
        [
          'install',
          join(packageDirectory, tarball),
          '--no-audit',
          '--no-fund',
          '--ignore-scripts',
          '--offline',
        ],
        { cwd: packageDirectory, encoding: 'utf8', timeout: 60_000 },
      )
      expect(installed.error).toBeUndefined()
      expect(installed.status, installed.stderr).toBe(0)

      const script = `
        import { extractCandidates, REF_TYPES } from 'dsh-refkeeper/core'
        const candidates = extractCandidates([{ seq: 1, text: 'https://doi.org/10.1000/isolated-core' }])
        if (candidates.length !== 1 || candidates[0]?.doi !== '10.1000/isolated-core') {
          throw new Error('published public-core returned an unexpected candidate result')
        }
        if (REF_TYPES.length !== 7 || REF_TYPES[0] !== 'journalArticle') {
          throw new Error('published public-core returned unexpected REF_TYPES')
        }
        console.log('published-core-ok')
      `
      const env = { ...process.env }
      delete env.DSH_HOME
      delete env.DSH_PROFILE
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: packageDirectory,
        encoding: 'utf8',
        env,
        timeout: 60_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('published-core-ok')
    } finally {
      rmSync(packageDirectory, { recursive: true, force: true })
    }
  })
})
