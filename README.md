# dsh-refkeeper

**English** · [简体中文](README.zh.md)

![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg) ![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

**A citation manager for the references a conversation already cites — it keeps
why each work matters, not just that it exists.**

DeepSeek Harness agents quote papers mid-answer: a DOI in a tool result, an
APA line in a summary, a report named two turns ago. `dsh-refkeeper` collects
those, checks them against Crossref / OpenAlex / arXiv / DataCite, attaches the
model's reading of each one, and writes BibTeX or RIS for the ones you keep.

## The annotation is the point

A citation you can check is not the same as a citation you can trust. Every
entry carries four annotations, and they travel with the reference all the way
into the export:

| Annotation | Answers | Lands in |
| --- | --- | --- |
| `summary` | what the work actually says | BibTeX `abstract`, RIS `AB`, `annotated.md` |
| `relevance` | why it matters for *this* task | RIS `N1`, `annotated.md` |
| `evidence` | the exact claim in the conversation that grounds it | RIS `N1` (`Evidence: …`), `annotated.md` |
| `caveats` | limits you should know before citing it | BibTeX `note`, RIS `N1` (`Caveats: …`), `annotated.md` |

That is the difference between a BibTeX generator and a reference manager: what
gets stored is not just the paper, but the reason it is in the manuscript.

## What it does

1. **Capture.** The current turn, the previous N turns, or the whole session.
   Candidates come from identifiers (DOI, arXiv id, ISBN, report number) and
   from parsed reference lines in APA, GB/T 7714 and IEEE shapes. Tool output is
   excluded by default — search results echo DOIs and would otherwise drown the
   list; `--include-tools` opts back in.
2. **Verify.** Four registries are queried in parallel. An entry enters the main
   library only when all three gates pass *and* at least one registry answered.
3. **Annotate.** The four fields above are written by the model, editable in the
   panel, and exported with the reference.
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

**Tool output is excluded for a reason.** A web-search result quotes ten DOIs
that nobody cited. Including tool roles by default produced 33 "references" for
a conversation with three real papers; the default now trusts the user's and the
assistant's text only.

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
refs/annotated.md       the human-readable view: summary, why it matters, evidence, caveats
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
