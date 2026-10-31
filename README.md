# dsh-refkeeper

Citation and source manager for DeepSeek Harness. It captures the references a
conversation already talks about, checks them against authoritative registries,
and exports what survives as BibTeX or RIS.

Most citation tools start from a DOI list you assembled by hand. This one starts
from the conversation: the papers your agent just cited, the DOI quoted in a
tool result, the report mentioned two turns ago.

## What it does

- **Capture from the conversation.** Pick the current turn, the previous N turns,
  or the whole session. Candidates come from identifiers (DOI, arXiv id, ISBN,
  report number) and from parsed reference lines in APA, GB/T 7714 and IEEE
  shapes. Tool output is excluded by default — search results echo DOIs and would
  otherwise drown the list; `--include-tools` opts back in.
- **Verify against four registries.** Crossref, OpenAlex, arXiv and DataCite are
  queried in parallel. A reference enters the main library only when the title
  matches strongly, the year is within ±1, the first author matches, and at
  least one registry returned a record. Everything else is written to
  `refs/quarantine.json` and marked ⚠ — kept, visible, excluded from export
  until you include it on purpose.
- **Fill in what the citation left out.** Volume, issue, pages, publisher and
  language come from the registry record when the capture did not carry them.
  `/refs enrich` does the same for entries already stored.
- **Correct an entry.** Expand a row in the panel and edit its fields; the export
  uses what you saved. `/refs edit` does the same from the command line.
- **Export BibTeX and/or RIS**, either the last capture batch, the entries you
  ticked, or the whole library, into `refs/exports/` or a folder you set once.

## Install

```sh
dsh plugin --profile <profile> add dsh-refkeeper
```

Then restart DeepSeek Harness (or reload the plugin from the Plugins page). The
panel docks above the message composer.

## The panel

| Control | What it does |
| --- | --- |
| Scope | this turn · previous N turns · whole session |
| Capture & save | captures, verifies, and stores; the result lists what was saved and what went to ⚠ |
| Row checkbox | which entries the next export includes (saved rows tick by default, ⚠ rows do not) |
| Expand a row | shows the stored fields; edits are saved per entry |
| Formats | BibTeX, RIS, or both |
| Folder | the export destination; unchanged means `refs/exports/` inside the session workspace |
| Export this capture | writes the ticked entries |
| Export all references | writes the whole library |

## Commands

```text
/refs                                                     capture readiness
/refs capture [--scope=turn|lastN|all] [--turns=N] [--save] [--dry-run] [--include-tools]
/refs verify --doi=… | --arxiv=… | --title=… [--json]
/refs save --json='{…}'
/refs list [--limit=N] [--quarantine]
/refs edit --id=<id> --payload=<base64url(json)>
/refs enrich [--quarantine]
/refs remove <id|doi|arxiv>... [--quarantine]
/refs remove --all --yes [--quarantine]
/refs export [--format=bibtex|ris|both] [--out=path] [--include-quarantine]
/refs export [--ids=id,id] [--choose-dir] [--all]
/refs dir [--set=<base64url(path)>|--clear]
```

`/refs capture` without `--save` only previews candidates. Export defaults to the
last saved capture; `--all` exports the library instead.

## Tools

`ref_capture`, `ref_verify`, `ref_save`, `ref_export`, and `ref_ping` let the
agent do the same work from inside a turn.

## Files

Everything lives in `refs/` at the workspace root:

```text
refs/refs.json          verified references
refs/quarantine.json    ⚠ entries that failed verification
refs/last-capture.json  what the last capture produced, and the default export scope
refs/settings.json      the remembered export folder
refs/annotated.md       the human-readable view
refs/exports/           default export destination
```

The files are plain JSON and Markdown, so they can be committed, diffed, or
backed up alongside the manuscript.

## Limits worth knowing

- It is not a Zotero replacement. It exports BibTeX/RIS; importing into Zotero,
  JabRef, or a LaTeX project is the next step, not this plugin's job.
- No PDF reading. Everything comes from the conversation text and the registries.
- Exports only write inside the session's workspace: the host applies the
  `workspace-write` sandbox policy, so a folder outside it is refused with a
  message rather than half-written.
- Registry queries send the identifier or title to Crossref, OpenAlex, arXiv and
  DataCite. Nothing else leaves the machine, and no credentials are involved.

## Development

```sh
npm ci
npm test          # vitest
npm run typecheck
npm run build     # tsdown + client bundle
```

## License

MIT. See [LICENSE](LICENSE).
