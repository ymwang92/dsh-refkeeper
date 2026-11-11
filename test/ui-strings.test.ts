import { describe, expect, it } from 'vitest'
import { EN, ZH } from '../src/ui/strings'

describe('capture panel strings', () => {
  it('uses clear capture and export labels in both languages', () => {
    expect(ZH.capture).toBe('捕获文献')
    expect(ZH.defaultDirLabel).toBe('导出到')
    expect(EN.capture).toBe('Capture references')
    expect(EN.defaultDirLabel).toBe('Export to')

    for (const strings of [EN, ZH]) {
      const values = Object.values(strings).join('\n')
      expect(values).not.toContain('捕获并保存')
      expect(values).not.toContain('Capture & save')
      expect(strings.storedNotice).toContain('{n}')
    }

    expect(ZH.storedNotice).toBe('{n} 条已存入工作区的 refs/refs.json')
    expect(EN.storedNotice).toBe('{n} saved to refs/refs.json in this workspace')
  })
})
