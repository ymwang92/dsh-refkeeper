import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/client.tsx', import.meta.url)), 'utf8')

/**
 * The detail form renders FIELDS through groupDefinitions: a field that is
 * not named by any group never reaches the screen. The identifiers group
 * dropped pmid and pmcid that way, and nothing failed — the storage side
 * kept the values, the panel simply could not show or edit them.
 */
describe('capture panel field groups', () => {
  // Only the FIELDS array itself; groupDefinitions also uses `key:`/`label:`.
  const fieldsBlock = source.slice(source.indexOf('const FIELDS'), source.indexOf('const FIELDS') + 2000)
  const fieldKeys = [...fieldsBlock.matchAll(/\{ key: '([a-zA-Z]+)', label:/g)].map((m) => m[1] ?? '')
  const groupBlocks = [...source.matchAll(/fields: \[([^\]]*)\]/g)].map((m) => m[1] ?? '')
  const groupedKeys = groupBlocks.flatMap((block) =>
    [...block.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] ?? ''),
  )

  it('finds the field list and the group definitions', () => {
    expect(fieldKeys.length).toBeGreaterThan(10)
    expect(groupBlocks.length).toBeGreaterThanOrEqual(3)
  })

  it('puts every field into a group', () => {
    const missing = fieldKeys.filter((key) => !groupedKeys.includes(key))
    expect(missing).toEqual([])
  })

  it('groups the PubMed identifiers with the other identifiers', () => {
    const identifiers = groupBlocks[0] ?? ''
    expect(identifiers).toContain("'pmid'")
    expect(identifiers).toContain("'pmcid'")
  })
})
