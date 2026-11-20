import { afterEach, describe, expect, it, vi } from 'vitest'
import { refCaptureTool, refVerifyTool } from '../src/index.ts'

const runContext = undefined as unknown as Parameters<typeof refVerifyTool.execute>[1]

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function pubmedSummary(id: string): unknown {
  return {
    header: { type: 'esummary', version: '0.3' },
    result: {
      uids: [id],
      [id]: {
        uid: id,
        pubdate: '2020',
        title: 'Example record',
        authors: [{ name: 'Example AB' }],
        source: 'Example Journal',
        articleids: [{ idtype: 'pubmed', value: id }],
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('model-facing tools', () => {
  it('routes a PMID-only claim through PubMed', async () => {
    const id = '98765431'
    const urls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return response(pubmedSummary(id))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await refVerifyTool.execute({ pmid: id }, runContext)
    const report = JSON.parse(result.reportJson) as { records: Array<{ source: string }> }

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain(`db=pubmed&id=${id}`)
    expect(report.records[0]?.source, result.reportJson).toBe('pubmed')
  })

  it('routes a PMCID-only claim through PMC search and the PMID crosswalk', async () => {
    const pmcUid = '7840891'
    const pmid = '98765432'
    const urls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('esearch.fcgi?db=pmc')) {
        return response({ esearchresult: { idlist: [pmcUid] } })
      }
      if (url.includes('esummary.fcgi?db=pmc')) {
        return response({
          result: { [pmcUid]: { articleids: [{ idtype: 'pmid', value: pmid }] } },
        })
      }
      return response(pubmedSummary(pmid))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await refVerifyTool.execute({ pmcid: `PMC${pmcUid}` }, runContext)
    const report = JSON.parse(result.reportJson) as { records: Array<{ source: string }> }

    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain(`db=pmc&term=PMC${pmcUid}%5Bpmc%5D`)
    expect(urls[1]).toContain(`db=pmc&id=${pmcUid}`)
    expect(urls[2]).toContain(`db=pubmed&id=${pmid}`)
    expect(report.records[0]?.source, result.reportJson).toBe('pubmed')
  })

  it('does not query a claim without an identity', async () => {
    const fetchMock = vi.fn(async () => response({}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await refVerifyTool.execute({}, runContext)
    const report = JSON.parse(result.reportJson) as { note: string }

    expect(result.reasonsJson).toBe('["no-identity"]')
    expect(result.note).toContain('Nothing was queried')
    expect(report.note).toContain('PMID')
    expect(report.note).toContain('PMCID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('includes both capture truncation states in rendered output', () => {
    for (const truncated of [true, false]) {
      const rendered = refCaptureTool.output.render({}, {
        accepted: true,
        scope: 'all',
        readMode: 'full',
        turns: 4,
        messages: 12,
        chars: 500,
        truncated,
        candidatesJson: '[]',
        note: 'Capture complete.',
      })

      const first = rendered[0]
      if (first?.type !== 'text') throw new Error('Expected text output.')
      expect(first.text).toContain(`truncated: ${String(truncated)}`)
    }
  })
})
