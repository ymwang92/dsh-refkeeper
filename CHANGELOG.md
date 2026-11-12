# Changelog

## 0.1.4 — 2026-11-11

Compared with v0.1.3, this release adds labeled PMID/PMCID verification and storage, restores historical arXiv identifiers, and clarifies where captured references are stored versus where exports are written.

### Added

- **Labeled PMID/PMCID recognition.** Before 0.1.4, `PMID: 12345678` and
  `PMCID: PMC1234567` produced no identifier, candidate, or lookup. The tagged
  forms now each create a candidate; unlabeled 6–8 digit numbers remain ignored.
- **PubMed as a fifth registry.** PMID uses PubMed ESummary; PMCID resolves
  through PMC ESearch, PMC ESummary, then the returned PMID. The record supplies
  bibliographic fields to the existing verification path.
- **Optional identifier storage and export.** PMID and PMCID are optional
  `StoredReference` fields; the schema version is unchanged. Identity still
  resolves in the order DOI, arXiv id, ISBN, report number, then title and year,
  and neither PMID nor PMCID takes part in it. BibTeX writes them in `note`;
  RIS writes them as prefixed `AN` rows.
- **Historical arXiv identifiers.** `math.GT/0309136`, `cs/0112017`, and
  `hep-th/9901001` previously returned no result because only modern IDs such
  as `2301.00001` were matched. The historical category whitelist now recognizes
  these forms, preserves their category paths, and avoids matches inside
  unrelated URLs.

### Changed

- **PubMed metadata normalization.** Titles may contain markup or a trailing
  period; markup is removed, whitespace collapsed, and the final period trimmed.
  `Steffen W` is normalized to `Steffen, W` for first-author matching, and the
  year is parsed from `pubdate`. Since `pubtype` mixes publication kinds with
  study designs (for example, `["Comparative Study", "Journal Article", …]`),
  the document type is selected from a publication-kind whitelist rather than
  the first value.
- **Capture-panel wording and layout.** The capture button reads “Capture
  references”; “Export to” names the export directory, not the library at
  `refs/refs.json`. The panel reports how many references were stored. The edit
  page has its own header and save/reset footer, while the list scrolls
  independently so export controls remain reachable.

### Fixed

- **Unresolvable PubMed IDs no longer abort saving.** Previously, entering a
  PMCID in the PMID box could make a URL helper throw and abort verification
  and save. An unresolved identifier now returns an empty lookup instead.

Tests: 30 files / 390 tests.

### 中文

相较于 v0.1.3，本版本新增带标签的 PMID/PMCID 识别与 PubMed 核验，恢复旧式 arXiv 编号支持，并明确区分捕获文献的存储位置与文件导出目录。

### 新增

- **识别带标签的 PMID/PMCID。** 0.1.4 以前，`PMID: 12345678` 和
  `PMCID: PMC1234567` 都无法生成标识符、候选或查询。现在两种带标签的写法都能识别，
  其中任意一个就足以生成候选；没有标签的 6–8 位数字仍会忽略。
- **将 PubMed 纳入第五个注册表。** PMID 通过 PubMed ESummary 查询；PMCID 依次经过
  PMC ESearch、PMC ESummary，再用返回的 PMID 查询 PubMed。记录提供书目字段，并进入
  现有核验流程。
- **可选存储并导出标识符。** PMID 和 PMCID 是 `StoredReference` 上的可选字段，schema
  版本不变。身份仍依次由 DOI、arXiv 编号、ISBN、报告号、题名+年份判定，PMID 与 PMCID
  都不参与。BibTeX 将它们写入 `note`；RIS 将它们写成带前缀的 `AN` 行。
- **识别旧式 arXiv 编号。** `math.GT/0309136`、`cs/0112017` 和 `hep-th/9901001`
  以前无法识别，因为只匹配 `2301.00001` 等新式编号。现在按历史类别白名单识别并保留
  类别路径，也不会把其他 URL 中看似旧式的编号误当成标识符。

### 变更

- **规范化 PubMed 元数据。** 标题可能含标记或尾部句点；现在会去除标记、合并空白并
  删除末尾句点。作者 `Steffen W` 会规范为首作者匹配所需的 `Steffen, W`，年份从
  `pubdate` 解析。由于 `pubtype` 混有出版物类型和研究设计（例如
  `["Comparative Study", "Journal Article", …]`），文献类型改为从出版物类型白名单中
  选择，而不再取第一项。
- **调整捕获面板文案与布局。** 捕获按钮显示为“捕获文献”；“导出到”指向导出目录，不是
  工作区的 `refs/refs.json` 文献库。面板会显示成功存储的文献数量。编辑页有独立的标题栏
  和保存/还原底栏；文献列表独立滚动，导出控件始终可用。

### 修复

- **无法解析的 PubMed 标识符不再中断保存。** 以前在 PMID 输入框中填写 PMCID 可能让
  URL 构造器抛错，进而中断核验和保存。现在无法解析的标识符会返回空查询结果。

测试：30 个文件 / 390 项。

## 0.1.3 — 2026-11-08

The capture panel becomes a real panel, and the reference store survives hosts
that refuse `rename` and `unlink`.

- **The panel opens in the top-right corner**, anchored to the window instead of
  floating over the transcript. It is rendered through a portal into
  `document.body`, so a host container with a `transform` can no longer drag it
  into the corner.
- **Opening a row opens an independent edit page.** The fourteen fields used to
  expand in place and push the list off screen; they now live on their own
  page, grouped into identifiers, bibliography and publication, with a `Back to
  list` link and the focus returning to the row you came from.
- **Entry type is a dropdown** of the seven `REF_TYPES` values. It was a free
  text field, so a typo produced an entry that failed silently at export time.
- **Every row carries a badge** — saved, ⚠ quarantined, skipped, failed — so
  the state is readable without opening anything, and the sub-line shows the
  first author, the year, the venue and, when the check failed, why.
- **The batch header says how many entries it holds**, and a `Refresh list`
  action reloads it.
- **Manual entry reuses the same form.** A skipped row can be completed with
  the full metadata and stored; the old single-purpose form only collected five
  fields and could never satisfy the host's own check.
- **The library is written without `rename` or `unlink`.** Some hosts deny
  both, which left the reference store unable to commit anything at all.
  References now live in immutable versioned snapshots with a newline-delimited
  SHA-256 journal as the commit point, so a half-written file is never visible
  and an interrupted write falls back to the previous commit. A failed write is
  reported instead of being swallowed.
- **Saving from the panel is matched to its own command.** The result is paired
  by command id and exact arguments, so an unrelated command, an error, or an
  unrecognised reply no longer leaves the row claiming it was saved.
- **A stored entry no longer shows a stale reason.** A row that was quarantined
  and later stored kept the old `quarantined` note next to its "saved" badge.

### 中文

捕获面板真正变成了一个面板，文献库也能在禁止 `rename` 与 `unlink` 的宿主上正常落盘。

- **面板开在窗口右上角**，固定在窗口边缘，不再压在对话记录上。它通过 portal 渲染到
  `document.body`，所以宿主里带 `transform` 的容器不会再把它拖到角落。
- **点条目打开独立的编辑页。** 原来十四个字段在列表里就地展开，会把列表顶出视野；
  现在它们在自己的页面上，按标识信息、书目信息、出版信息分成三组，带「返回列表」，
  关闭后焦点回到原来的那一行。
- **条目类型改成下拉框**，七种 `REF_TYPES` 选一。原来是自由文本，打错字会得到一条
  在导出时静默失败的条目。
- **每行都带状态徽章** —— 已入表、⚠ 隔离、跳过、失败 —— 不用展开就知道结果；副行显示
  第一作者、年份、出版物，核验没通过时还带上那句原因。
- **批次标题会写明有多少条**，另有「刷新列表」可以重新载入。
- **手动入表复用同一套表单。** 跳过的条目可以在那里补全元数据后入库；旧的专用表单
  只收五个字段，永远过不了宿主自己的核对。
- **文献库的写入不再依赖 `rename` 与 `unlink`。** 有些宿主两个都禁，文献库因此什么都
  存不进去。现在文献存在不可变的版本快照里，以逐行 SHA-256 校验日志作为提交点：
  写了一半的文件永远不会被读到，中断的写入会退回上一个提交。写失败会明确报出来，
  不再被吞掉。
- **面板里的保存按它自己的那条命令配对。** 结果按命令 id 和精确参数匹配，无关的命令、
  报错、认不出来的回复，都不会再让那一行显示成「已保存」。
- **已入库的条目不再挂旧原因。** 先隔离后入库的行，会在「已入表」徽章旁边继续显示
  `quarantined`。

## 0.1.2 — 2026-11-04

Quarantined references can now be promoted, and the same work can no longer be
stored twice.

- **Promote quarantined entries.** `/refs promote` re-checks each quarantined
  row against Crossref, OpenAlex, arXiv and DataCite and moves only the rows
  that verify. `--ids` limits it to the rows ticked in the panel; `--manual
  --reason=<text>` moves a row without a live check and records `manual` plus
  the reason. A promoted row that already exists in the library replaces it.
- **One work, one record.** Entries are matched by identity (DOI, arXiv id,
  ISBN, otherwise title + year, with Markdown stripped and NFKC case folding),
  so a reference that quarantined first and was captured successfully later
  does not leave a duplicate behind. Exports merge both tables by identity,
  keep the library row, and report how many duplicates were skipped.
- **`remove` and `edit` touch both tables**, so a leftover quarantine copy can
  no longer resurface in an `--include-quarantine` export.
- **No phantom quarantine rows.** A reference already in the library used to be
  reported as `⚠ quarantined` on the next capture while `quarantine.json` stayed
  empty; it now reports "already in the library", and `promote` says the same
  instead of "not in quarantine".
- **Export file names no longer collide.** Two exports in the same minute write
  `refs-…-2.bib`, `refs-…-3.bib` instead of failing on an existing file.
- **Empty capture scope is stated, not silently widened.** If nothing from the
  last capture is still in the library, the export says so instead of writing
  the whole library.
- Panel: the edit command no longer sends `--ids=--ids=…` to the host.

Tests: 25 files / 340 tests.

### 中文

- **隔离条目可以提升了。** `/refs promote` 会重新到 Crossref、OpenAlex、arXiv、
  DataCite 核对，只把核验通过的条目移入主表；`--ids` 只处理面板勾选的行，
  `--manual --reason=<文本>` 不经在线核验直接入库，并记录 `manual` 状态和原因。
  主表里已有同一篇文献时，用新记录替换旧行。
- **同一篇文献只存一份。** 按身份合并（DOI、arXiv ID、ISBN，否则题名 + 年份；
  题名会去掉 Markdown 标记并做 NFKC 小写折叠），先进隔离区、后来捕获成功的文献
  不会再留下重复副本。导出时两张表按身份合并、以主表为准，并报告跳过多少条重复。
- **`remove` 和 `edit` 同时作用于两张表**，隔离区的遗留副本不会在
  `--include-quarantine` 导出里冒出来。
- **不再有幻影隔离记录。** 已在库中的文献再次捕获时曾显示 `⚠ 隔离`，而
  `quarantine.json` 是空的；现在显示「已在库中」，`promote` 也这么说，
  不再报「不在隔离区」。
- **导出文件名不再撞车。** 同一分钟内第二次导出会写成 `refs-…-2.bib`，而不是
  报「cannot overwrite existing」失败。
- **捕获范围为空时如实说明**，不再静默改导整库。
- 面板：编辑命令不再把 `--ids=--ids=…` 传给宿主。

测试：25 个文件 / 340 项。

## 0.1.1 — 2026-11-01

- Activation fix: the plugin loads as an object plugin and no longer imports
  `@deepseek-ai/cordis` at runtime, which made `npm` installs fail with
  `ERR_MODULE_NOT_FOUND`. Capture, verification and export are unchanged.
- 中文：修复启用失败——改为 object plugin，运行时不再 import
  `@deepseek-ai/cordis`；捕获、校验、导出逻辑不变。

## 0.1.0 — 2026-10-31

- First release: capture references from a conversation, verify them against
  Crossref / OpenAlex / arXiv / DataCite, annotate them with the profile model,
  and export BibTeX or RIS.
- 中文：首个版本——从对话捕获文献，到权威来源核对，用当前模型补注解，导出
  BibTeX 或 RIS。
