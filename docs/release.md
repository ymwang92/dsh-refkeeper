# Release checklist

Everything below assumes the repository is `github.com/ymwang92/dsh-refkeeper`
and the npm package is `dsh-refkeeper`.

## 0. Before the first push

- [ ] `npm ci && npm test && npm run typecheck && npm run build` all pass.
- [ ] `lib/` is committed. It is the built artifact, and `dsh plugin add
      github:ymwang92/dsh-refkeeper` installs the repository as-is — without a
      committed `lib/` that command installs a package that cannot load.
- [ ] `package.json` has `repository`, `homepage` and `bugs` pointing at the
      real URL (the placeholders `ymwang92` are replaced).
- [ ] `npm pack --dry-run` lists README.md, README.zh.md, LICENSE, lib/,
      cordis.patch.yml and locale/.

## 1. Publish to GitHub

```sh
cd dsh-refkeeper
git init
git add -A
git commit -m "dsh-refkeeper 0.1.0"
git branch -M main
git remote add origin git@github.com:ymwang92/dsh-refkeeper.git
git push -u origin main
```

Then, on the repository page:

- [ ] Add the topic **`dsh-plugin`** (About → gear → Topics). The registry
      checks for it.
- [ ] Confirm the repo is at least one day old before opening the registry PR.
      The check is automatic and a resubmission later is fine.

## 2. Publish to npm

```sh
npm login                      # once per machine
npm publish                    # publishes 0.1.0 as public
```

Verify the install path the registry documents actually works:

```sh
dsh plugin --profile <profile> add dsh-refkeeper
```

Later releases: `npm version patch|minor`, `git push --follow-tags`,
`npm publish`.

## 3. Submit to the registry (this is what puts it in dsh-market)

The market reads the curated registry at
`github.com/awesome-dsh-plugin/awesome-dsh-plugin`. Submission is **one YAML
file**, not an edit to the README:

1. Fork that repository.
2. Add `data/plugins/ymwang92__dsh-refkeeper.yml` with the contents of
   [`dsh-registry-entry.yml`](dsh-registry-entry.yml).
3. Open a pull request.

Notes that decide whether it merges:

- `url` must match the repository exactly.
- Only `description.en` is required; a maintainer fills in `zh` if missing.
- A description that claims counts or commands is checked against the code.
  Name only what exists.
- `package.json` must declare `dsh.bundle` (ours does) — `dsh.client` alone is
  not installable and is the most common rejection reason.
- Pick the category that matches the behaviour; maintainers correct a near miss
  rather than rejecting it.

The site and dsh-market pick the entry up automatically, usually within a day.
Do not open PRs against `dsh-market/dsh-market` itself — that repository is the
market app, not the catalog.

## 4. Optional

- Add a storefront icon (`icon:` in the YAML, a GitHub-hosted raster image).
- Add the badge to the README:
  `![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)`
- Announce in the DSH community channel with a one-paragraph "what it is for"
  and a screenshot of the panel.
