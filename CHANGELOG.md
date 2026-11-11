# Changelog

## 0.1.4 — 2026-11-11

A bare PMID or PMCID in a conversation is now recognised, checked against
PubMed, stored with the reference, shown in the panel and written into the
export. The panel itself says where the references are stored, and the edit
page no longer drags the capture and export controls along with it.

- **PubMed identifiers are recognised.** `PMID: 12345678` and
  `PMCID: PMC1234567` used to produce nothing at all: no identifier, no
  candidate, no lookup. Both are recognised now, in the tagged forms people
  actually write, and either one is enough to build a candidate.
- **PubMed is a fifth registry.** A PMID is fetched with esummary; a PMCID is
  resolved through esearch against the PMC database and then through the PMC
  summary's own PMID crosswalk. The record supplies the same fields the other
  registries do, so a reference captured from a PMID verifies exactly like one
  captured from a DOI.
- **The PubMed payload needed three cleanups.** Titles arrive with a trailing
  period and sometimes markup; authors arrive as "Steffen W" rather than
  "Steffen, W", and the first-author check depends on the latter; and
  `pubtype` mixes publication kinds with study design — the real record reads
  `["Comparative Study", "Journal Article", …]` — so the document type is
  picked from a whitelist of publication kinds instead of the first entry.
- **The identifiers are stored with the reference.** They are optional fields
  on `StoredReference`, so the schema version does not change and an older
  file simply has no such key. Identity is untouched: a capture that starts
  from a PMID still ends up with the DOI the PubMed record carries, and
  papers old enough to predate DOIs fall back to title and year, exactly
  where they already were. A PMCID is never used for identity — one paper
  can carry several PMC identifiers, the author's copy and the published one.
- **They reach the export.** BibTeX has no standard field for them, so they
  join the note the caveats already use; RIS has one, the accession number,
  which already carries the arXiv id and the report number. They follow the
  same style there, with a prefix, so the three stay apart.
- **Old-style arXiv identifiers are recognised.** `math.GT/0309136`,
  `cs/0112017` and `hep-th/9901001` — everything published before 2007 —
  produced nothing, because only the `2301.00001` form was matched. They are
  matched now, against the list of historical arXiv categories, and the
  category path is kept as it is. A legacy id inside somebody else's URL
  path is not mistaken for one.
- **The panel says where the references are stored.** The capture button reads
  "Capture references" and the folder reads "Export to", because that path is
  the export directory, not the library — the library is the workspace's
  `refs/refs.json`. A line above the list now says how many references this
  capture stored and where.
- **The edit page carries only its own header and footer.** Editing a
  reference used to show the capture scope selector above and the export
  controls below, neither of which has anything to do with editing. It now
  has a header of its own and a footer with just the save and reset actions.
- **The list scrolls on its own.** The panel is a column with a fixed header
  and footer and a scrolling middle, so the export buttons stay reachable
  however many references the capture brought in.
- **The PubMed URL helpers no longer throw.** An identifier that cannot
  resolve is a lookup that comes back empty, not an error: throwing there
  aborted the whole verification, and with it the save, whenever a PMCID was
  typed into the PMID box.

Tests: 30 files / 390 tests.

### 中文

对话里一个裸写的 PMID 或 PMCID，现在能被识别、拿到 PubMed 核验、随文献一起存下、
在面板里显示、并且写进导出文件。面板也会说清文献存到了哪里，编辑页不再把捕获与
导出的控件一起带过来。

- **PubMed 标识符能被识别。** `PMID: 12345678` 与 `PMCID: PMC1234567` 以前什么
  都产生不了：没有标识符、没有候选、没有查询。现在两种都能识别，用的是人们实际
  会写的带标签写法，其中任意一个就够建出一个候选。
- **PubMed 是第五个注册表。** PMID 走 esummary 取；PMCID 先用 esearch 在 PMC 库里
  解析，再经 PMC summary 自带的 PMID 交叉引用拿到 PMID。记录提供的字段与其他注册表
  一致，所以从 PMID 捕获的文献与从 DOI 捕获的文献走的是同一条核验路径。
- **PubMed 的数据要清洗三处。** 标题带尾部句点、有时还带标记；作者是
  "Steffen W" 而不是 "Steffen, W"，首作者匹配依赖后者；而 `pubtype` 混着出版类型
  与研究设计 —— 真实记录是 `["Comparative Study", "Journal Article", …]` ——
  所以文献类型要按出版类型白名单去挑，不能取第一项。
- **标识符随文献一起存。** 它们是 `StoredReference` 上的可选字段，schema 版本不变，
  旧文件里压根没有这个键。身份判定完全不动：从 PMID 开始的捕获，最后拿到的仍是
  PubMed 记录里的那个 DOI；早到没有 DOI 的老文章仍旧退回题名加年份，跟原来一样。
  PMCID 绝不用于身份判定 —— 同一篇文献可能有多个 PMC 编号（作者稿与正式版）。
- **标识符进得了导出。** BibTeX 没有标准字段，于是并进 caveats 已经在用的那个
  note；RIS 有，就是访问号，而访问号里已经放着 arXiv 编号与报告号。那里沿用同样的
  写法、加前缀，三者不会混在一起。
- **旧式 arXiv 编号能被识别。** `math.GT/0309136`、`cs/0112017`、
  `hep-th/9901001` —— 2007 年以前的东西 —— 以前完全识别不了，因为只匹配
  `2301.00001` 那种形式。现在按 arXiv 的历史类别名单匹配，类别路径原样保留。
  别人 URL 路径里的旧式编号不会被误当成编号。
- **面板说清文献存到了哪里。** 按钮改成「捕获文献」，那个路径改成「导出到」——
  它是导出目录，不是文献库，文献库在工作区的 `refs/refs.json`。列表上方现在有一行
  说明这次捕获存了多少条、存到了哪里。
- **编辑页只留自己的头与尾。** 编辑文献时以前上方挂着捕获范围选择器、下方挂着导出
  控件，两者都与编辑无关。现在它有自己的头部，底部只有保存与还原。
- **列表自己会滚。** 面板变成固定头尾、中间滚动的一列，无论这次捕获带进来多少条
  文献，导出按钮都一直够得着。
- **PubMed 的 URL 构造器不再抛错。** 解析不了的标识符应该是「查了没有」，而不是错误：
  在那里抛错会中断整次核验，连带把保存也打断 —— 只要有人在 PMID 框里填进 PMCID
  就会发生。

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
