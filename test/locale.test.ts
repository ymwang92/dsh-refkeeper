import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The host reads display text from `<package>/locale/<language-id>.json` and
 * looks the language up by the *exact* lowercased tag in the client's fallback
 * chain, which ships `zh` and `en`. A file named `zh-CN.json` therefore loads
 * as `zh-cn` and is never selected — the card silently falls back to the
 * English `package.json` description. These tests pin the ids that work.
 */
const LOCALE_DIR = fileURLToPath(new URL('../locale/', import.meta.url))
const BUILT_IN_LOCALES = ['en', 'zh'] as const

interface Meta {
  readonly title?: string
  readonly description?: string
}

async function metaOf(file: string): Promise<Meta> {
  const parsed: unknown = JSON.parse(await readFile(`${LOCALE_DIR}${file}`, 'utf8'))
  const meta = (parsed as { meta?: unknown }).meta
  return typeof meta === 'object' && meta !== null ? (meta as Meta) : {}
}

describe('locale resources', () => {
  it('ships exactly the language ids the client resolves', async () => {
    const files = (await readdir(LOCALE_DIR)).filter(name => name.endsWith('.json')).sort()
    expect(files).toEqual(BUILT_IN_LOCALES.map(id => `${id}.json`))
  })

  it('gives every language a title and a description', async () => {
    for (const id of BUILT_IN_LOCALES) {
      const meta = await metaOf(`${id}.json`)
      expect(meta.title?.trim()).toBeTruthy()
      expect(meta.description?.trim()).toBeTruthy()
    }
  })

  it('actually translates the Chinese card instead of copying English', async () => {
    const en = await metaOf('en.json')
    const zh = await metaOf('zh.json')
    expect(zh.title).not.toBe(en.title)
    expect(zh.description).not.toBe(en.description)
  })
})
