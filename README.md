# dsh-refkeeper

**English** · [简体中文](README.zh.md)

![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg) ![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

**A reference manager for the citations a conversation already made.** It pulls
them out of the transcript, checks each one against four registries, and exports
BibTeX or RIS — carrying the agent's annotations along when there are any.

![The capture panel above the composer](docs/images/panel-en.png)

DeepSeek Harness agents quote papers mid-answer: a DOI in a tool result, an APA
line in a summary, a report named two turns ago. `dsh-refkeeper` collects those,
verifies them against Crossref / OpenAlex / arXiv / DataCite, and keeps the ones
that survive.

## Two layers: the record, and the reading of it

Every entry starts with a bibliographic record and a verdict — title, authors,
year, venue, identifiers, and `verification: verified 3/3 · crossref, openalex`.
That layer is always there, whatever path produced the entry.

On top of it sit four **optional** annotation fields, written either
automatically after a capture or explicitly through `ref_save`; when present they
travel with the entry all the way into the export:

| Annotation | Answers | Lands in |
| --- | --- | --- |
| `summary` | what the work actually says | BibTeX `abstract`, RIS `AB`, `annotated.md` |
| `relevance` | why it matters for *this* task | RIS `N1`, `annotated.md` |
| `evidence` | the exact claim in the conversation that grounds it | RIS `N1` (`Evidence: …`), `annotated.md` |
| `caveats` | limits you should know before citing it | BibTeX `note`, RIS `N1` (`Caveats: …`), `annotated.md` |

A capture asks the profile's default model for these four fields after the
record is stored, grounding each one in the transcript lines that actually cite
the work. `evidence` is checked against those lines and dropped if the model
quotes something that is not there. When no model is configured, or the excerpt
is not in the captured range, the entry stays bibliographic and the capture
result says why.

Export and `annotated.md` work either way: an entry without annotations is still
written in full, verdict included. What annotations add is traceability: why the
work is in the manuscript, and which sentence put it there.

A field the excerpt does not support stays **empty** — no `note` field at all in
BibTeX, no `N1` row in RIS, no line in `annotated.md`. Sentences that only
describe the absence ("the excerpt does not mention this work", "no citation
sentence is available") are rejected at the same gate as fabricated quotes: they
say nothing about the paper, and in a `.bib` they read as content.

## What it does

1. **Capture.** The current turn, the previous N turns, or the whole session.
   Candidates come from identifiers (DOI, arXiv id, ISBN, report number) and
   from parsed reference lines in APA, GB/T 7714 and IEEE shapes. Tool output is
   excluded by default — search results echo DOIs and would otherwise drown the
   list; `--include-tools` opts back in. Saving also makes one model call for
   annotations, so a capture takes a few seconds longer (60 s cap).
2. **Verify.** Four registries are queried in parallel. An entry enters the main
   library only when all three gates pass *and* at least one registry answered.
3. **Annotate.** After a capture the profile's default model writes the four
   fields above, grounded in the lines that cite the work; fields the excerpt
   does not support stay empty. (`ref_save` can still carry them by hand.)
4. **Export.** BibTeX and/or RIS, for the last capture, the rows you ticked, or
   the whole library, into `refs/exports/` or a folder you set once.

## How it works

```text
conversation text
   │  identifiers (DOI · arXiv · ISBN · report no.)
   │  reference lines (APA · GB/T 7714 · IEEE)
   ▼
candidates ──► Crossref · OpenAlex · arXiv · DataCite (parallel)
   │
   ├─ three gates: title strongly matches · year within ±1 · first author matches
   │               and at least one registry returned a record
   ├─ pass ──► refs/refs.json        (verified)
   └─ fail ──► refs/quarantine.json  (⚠ kept, visible, excluded from export)
```

**Three gates, one vote of confidence.** No single fuzzy score decides. The
title must match strongly — Jaccard over folded tokens for Latin scripts,
character-bigram Dice ≥ 0.90 for CJK titles, which is the only sane way to
compare a Chinese title to the romanised record a registry returns. Volume,
issue, pages, publisher and language are filled from the registry record when the
citation did not carry them.

**`unverified` is not `quarantined`.** If the registries cannot be reached, the
entry is marked `unverified` and kept — the network being down says nothing
about whether the citation is real, and it can be retried later. `quarantined`
means the registries answered and disagreed. Collapsing the two would either
throw away good references or launder bad ones; this keeps them apart.

**Exports are byte-stable.** Entries are sorted (author, year, title; citekeys
disambiguated deterministically), so exporting the same library twice produces
identical files — a diff on the `.bib` shows what actually changed.

**Writes are atomic and locked.** `refs/*.json` is written through a temporary
file + rename, guarded by an on-disk lock whose stale copies are reclaimed
atomically (inode + content identity, not path alone), so two sessions capturing
at once cannot half-write the library.

**Tool output is excluded by default.** A web-search result quotes a dozen DOIs
that nobody cited, and they bury the ones that were. The default trusts the
user's and the assistant's text; `--include-tools` opts back in.

## Install

Installable today from the repository (it ships its built `lib/`):

```sh
dsh plugin --profile <profile> add github:ymwang92/dsh-refkeeper
```

After the npm release is out, the shorter form works too:

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
| Expand a row | shows the stored fields, including the four annotations; edits are saved per entry |
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
last saved capture; `--all` exports the library instead. Long IDs travel
base64url-encoded because real ones contain spaces, `<>`, `;` and parentheses.

## Tools

| Tool | Purpose |
| --- | --- |
| `ref_capture` | pull candidate references out of the conversation |
| `ref_verify` | check one identifier or title against the registries |
| `ref_save` | store a reference with its annotations |
| `ref_export` | write BibTeX/RIS for a batch, a selection, or the library |
| `ref_ping` | report which host seams and registries are reachable |

## Files

Everything lives in `refs/` at the workspace root:

```text
refs/refs.json          verified references, with their annotations
refs/quarantine.json    ⚠ entries that failed a gate
refs/last-capture.json  what the last capture produced, and the default export scope
refs/settings.json      the remembered export folder
refs/annotated.md       the human-readable view: record, verdict, and any annotations
refs/exports/           default export destination
```

Plain JSON and Markdown: commit them with the manuscript, diff them, back them up.

## Data and privacy

- Outbound traffic is the identifier or title you are verifying, sent to
  Crossref, OpenAlex, arXiv and DataCite. Nothing else leaves the machine.
- No API keys, no accounts, no telemetry.
- The library is a local JSON file; no sync service is involved.

## Limits

- **Not a Zotero replacement.** Zotero is the right tool for a personal library
  across years: PDFs, styles, sync, a browser connector. This plugin covers one
  manuscript's citations, the ones a conversation already wrote down.
- No PDF reading; everything comes from the conversation text and the registries.
- Exports only write inside the session's workspace: the host applies the
  `workspace-write` sandbox policy, so a folder outside it is refused with a
  message rather than half-written.
- Chinese journal metadata is thinner than English in the open registries. Non-Latin
  titles are matched with CJK-aware similarity, and CNKI / Wanfang / CQVIP links are
  accepted as scholarly sources when harvesting identifiers from URLs, but v0.1 does
  not claim to resolve them as registries.

## Development

```sh
npm ci
npm test          # vitest
npm run typecheck
npm run build     # tsdown + client bundle
```

## License

MIT. See [LICENSE](LICENSE).
