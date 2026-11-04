## 0.1.2 — 2026-11-04

Quarantined references can be promoted, and the same work can no longer be stored twice.

- **Promote quarantined entries.** `/refs promote` re-checks each quarantined row against Crossref, OpenAlex, arXiv and DataCite and moves only the rows that verify. `--ids` limits it to the rows ticked in the panel; `--manual --reason=<text>` moves a row without a live check and records `manual` plus the reason. A promoted row that already exists in the library replaces it.
- **One work, one record.** Entries are matched by identity (DOI, arXiv id, ISBN, otherwise title + year, with Markdown stripped and NFKC case folding), so a reference that quarantined first and was captured successfully later leaves no duplicate. Exports merge both tables by identity, keep the library row, and report how many duplicates were skipped.
- **`remove` and `edit` touch both tables**, so a leftover quarantine copy cannot resurface in an `--include-quarantine` export.
- **No phantom quarantine rows.** A reference already in the library used to be reported as `⚠ quarantined` on the next capture while `quarantine.json` stayed empty; it now reports "already in the library", and `promote` says the same instead of "not in quarantine".
- **Export file names no longer collide.** Two exports in the same minute write `refs-…-2.bib`, `refs-…-3.bib` instead of failing on an existing file.
- **Empty capture scope is stated, not silently widened.** If nothing from the last capture is still in the library, the export says so instead of writing the whole library.
- Panel: the edit command no longer sends `--ids=--ids=…` to the host.

**Install**

```sh
# in DSH: Settings → Plugins → Add plugin
dsh-refkeeper@0.1.2
```

Upgrade from 0.1.1 by adding the version explicitly, then fully quit and reopen DSH.

Full notes, including what changed in 0.1.1: [CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

---

## 0.1.2 — 2026-11-04（中文）

隔离区的文献现在可以提升入表，同一篇文献也不会再存两份。

- **隔离条目可以提升了。** `/refs promote` 会重新到 Crossref、OpenAlex、arXiv、DataCite 核对，只把核验通过的条目移入主表；`--ids` 只处理面板勾选的行，`--manual --reason=<文本>` 不经在线核验直接入库，并记录 `manual` 状态和原因。主表里已有同一篇文献时，用新记录替换旧行。
- **同一篇文献只存一份。** 按身份合并（DOI、arXiv ID、ISBN，否则题名 + 年份；题名会去掉 Markdown 标记并做 NFKC 小写折叠），先进隔离区、后来捕获成功的文献不会再留下重复副本。导出时两张表按身份合并、以主表为准，并报告跳过多少条重复。
- **`remove` 和 `edit` 同时作用于两张表**，隔离区的遗留副本不会在 `--include-quarantine` 导出里冒出来。
- **不再有幻影隔离记录。** 已在库中的文献再次捕获时曾显示 `⚠ 隔离`，而 `quarantine.json` 是空的；现在显示「已在库中」，`promote` 也这么说，不再报「不在隔离区」。
- **导出文件名不再撞车。** 同一分钟内第二次导出会写成 `refs-…-2.bib`，而不是报「cannot overwrite existing」失败。
- **捕获范围为空时如实说明**，不再静默改导整库。
- 面板：编辑命令不再把 `--ids=--ids=…` 传给宿主。

**安装**

在 DSH 打开 设置 → 插件 → 添加插件，输入 `dsh-refkeeper@0.1.2`。从 0.1.1 升级要显式写版本号，装完完全退出 DSH 再打开。

完整更新记录（含 0.1.1 的修复）：[CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
