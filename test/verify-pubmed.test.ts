import { describe, expect, it } from 'vitest'
import {
  parsePmcSearchUid,
  parsePmcSummaryPmid,
  parsePubMedSummary,
  pmcSearchUrl,
  pmcSummaryUrl,
  pubmedIdUrl,
} from '../src/verify/index.ts'

const pubmed25882522 = JSON.stringify({
  header: { type: 'esummary', version: '0.3' },
  result: {
    uids: ['25882522'],
    '25882522': {
      uid: '25882522',
      pubdate: '2015 Jul 15',
      epubdate: '2015 Mar 28',
      source: 'Bioorg Med Chem',
      authors: [{ name: 'Stepniewski TM' }, { name: 'Filipek S' }],
      lastauthor: 'Filipek S',
      title:
        'Non-peptide ligand binding to the formyl peptide receptor FPR2--A comparison to peptide ligand binding modes.',
      volume: '23',
      issue: '14',
      pages: '4072-81',
      lang: ['eng'],
      pubtype: ['Comparative Study', 'Journal Article', "Research Support, Non-U.S. Gov't"],
      articleids: [
        { idtype: 'pubmed', idtypen: 1, value: '25882522' },
        { idtype: 'doi', idtypen: 3, value: '10.1016/j.bmc.2015.03.062' },
        { idtype: 'pii', idtypen: 4, value: 'S0968-0896(15)00258-8' },
      ],
      fulljournalname: 'Bioorganic & medicinal chemistry',
    },
  },
})

describe('PubMed E-utilities', () => {
  it('builds exact-ID URLs and validates identifiers', () => {
    expect(pubmedIdUrl('25882522')).toBe(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=25882522&retmode=json&tool=dsh-refkeeper',
    )
    expect(pmcSearchUrl('PMC7840891')).toBe(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=PMC7840891%5Bpmc%5D&retmode=json&tool=dsh-refkeeper',
    )
    expect(pmcSummaryUrl('7840891')).toBe(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=7840891&retmode=json&tool=dsh-refkeeper',
    )
    // An identifier that cannot resolve must not throw: the DOI URL helpers
    // behave the same way, and a thrown error here aborted the whole
    // verification — and with it the save.
    expect(pubmedIdUrl('12345')).toContain('id=12345')
    expect(pubmedIdUrl('PMC7840891')).toContain('id=PMC7840891')
    expect(pmcSearchUrl('7840891')).toContain('term=7840891%5Bpmc%5D')
    expect(pmcSummaryUrl('not-a-uid')).toContain('id=not-a-uid')
  })

  it('resolves a PMCID through its PMC UID to the linked PMID', () => {
    expect(parsePmcSearchUid('{"esearchresult":{"idlist":["7840891"]}}')).toBe('7840891')
    expect(parsePmcSearchUid('{"esearchresult":{"idlist":[]}}')).toBeUndefined()
    expect(
      parsePmcSummaryPmid(
        '{"result":{"7840891":{"articleids":[{"idtype":"pmid","value":"33248227"}]}}}',
        '7840891',
      ),
    ).toBe('33248227')
  })

  it('normalizes the real PMID 25882522 ESummary fields', () => {
    const [record] = parsePubMedSummary(pubmed25882522)

    expect(record).toMatchObject({
      source: 'pubmed',
      id: '25882522',
      title: 'Non-peptide ligand binding to the formyl peptide receptor FPR2--A comparison to peptide ligand binding modes',
      authors: ['Stepniewski, TM', 'Filipek, S'],
      year: 2015,
      doi: '10.1016/j.bmc.2015.03.062',
      type: 'journalArticle',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25882522/',
      container: 'Bioorganic & medicinal chemistry',
      volume: '23',
      issue: '14',
      pages: '4072-81',
      language: 'eng',
    })
  })

  it('cleans markup and uses safe fallbacks for incomplete summaries', () => {
    const [record] = parsePubMedSummary(
      JSON.stringify({
        result: {
          uids: ['12345678'],
          '12345678': {
            title: ' <i>Fallback</i>\n record. ',
            pubdate: '2020 Winter',
            authors: [{ name: 'Example AB' }],
            source: 'Fallback Journal',
            pubtype: ['Comparative Study'],
          },
        },
      }),
    )

    expect(record).toMatchObject({
      title: 'Fallback record',
      authors: ['Example, AB'],
      year: 2020,
      doi: '',
      type: 'journalArticle',
      container: 'Fallback Journal',
    })
  })

  it('rejects malformed JSON and invalid PMID records', () => {
    expect(() => parsePubMedSummary('{')).toThrow('body is not JSON')
    expect(() =>
      parsePubMedSummary('{"result":{"uids":["12345"],"12345":{"title":"Bad PMID"}}}'),
    ).toThrow('summary contains invalid PMID values')
  })
})
