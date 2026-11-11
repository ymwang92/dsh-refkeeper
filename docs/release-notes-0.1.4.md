## 0.1.4 — 2026-11-11

A bare PMID or PMCID in a conversation is now recognised, checked against PubMed,
stored with the reference, shown in the panel and written into the export. The
panel says where the references are stored, and the edit page no longer drags
the capture and export controls along with it.

- **PubMed identifiers are recognised and verified.** `PMID: 12345678` and
  `PMCID: PMC1234567` used to produce nothing at all. Both are recognised now,
  and PubMed joins Crossref, OpenAlex, arXiv and DataCite as a fifth registry:
  a PMID is fetched with esummary, a PMCID is resolved through the PMC database
  and its PMID crosswalk.
- **The identifiers are stored with the reference** and appear in the panel's
  edit form. They are optional fields, so the schema version does not change,
  and identity is untouched — a capture that starts from a PMID still ends up
  with the DOI the PubMed record carries.
- **They reach the export.** BibTeX has no standard field for them, so they
  join the note the caveats already use; RIS has one, the accession number,
  where they follow the same prefixed style as the arXiv id.
- **Old-style arXiv identifiers are recognised** — `math.GT/0309136`,
  `cs/0112017` — against the list of historical arXiv categories.
- **The panel says where the references are stored.** The button reads "Capture
  references" and the folder reads "Export to", because that path is the export
  directory; the library is the workspace's `refs/refs.json`.
- **The edit page carries only its own header and footer**, and **the list
  scrolls on its own**, so the export buttons stay reachable however many
  references the capture brought in.

**Install**

```sh
# in DSH: Settings → Plugins → Add plugin
dsh-refkeeper@0.1.4
```

Or install the tarball attached to this release, or the repository itself:

```sh
dsh plugin add ./dsh-refkeeper-0.1.4.tgz
dsh plugin add github:ymwang92/dsh-refkeeper
```

Upgrade from 0.1.3 by naming the version explicitly, then fully quit and reopen
DSH. Existing `refs/refs.json` and `refs/quarantine.json` are read as they are;
the new optional identifiers are simply absent from them.

Full notes: [CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

---

## 0.1.4 — 2026-11-11（中文）

对话里一个裸写的 PMID 或 PMCID，现在能被识别、拿到 PubMed 核验、随文献一起存下、
在面板里显示、并且写进导出文件。面板会说清文献存到了哪里，编辑页也不再把捕获与
导出的控件一起带过来。

- **PubMed 标识符能被识别并核验。** `PMID: 12345678` 与 `PMCID: PMC1234567`
  以前什么都不会产生。现在两种都能识别，PubMed 也作为第五个注册表加入
  Crossref、OpenAlex、arXiv、DataCite：PMID 走 esummary 取，PMCID 先经 PMC 库
  解析，再走它自带的 PMID 交叉引用。
- **标识符随文献一起存下**，并出现在面板的编辑表单里。它们是可选字段，schema
  版本不变，身份判定也不动 —— 从 PMID 开始的捕获，最后拿到的仍是 PubMed 记录里
  的那个 DOI。
- **标识符进得了导出。** BibTeX 没有标准字段，于是并进 caveats 已经在用的那个
  note；RIS 有，就是访问号，那里沿用与 arXiv 编号同样的带前缀写法。
- **旧式 arXiv 编号能被识别** —— `math.GT/0309136`、`cs/0112017` —— 按 arXiv 的
  历史类别名单匹配。
- **面板说清文献存到了哪里。** 按钮改成「捕获文献」，那个路径改成「导出到」——
  它是导出目录，文献库在工作区的 `refs/refs.json`。
- **编辑页只留自己的头与尾**，**列表自己会滚**，无论捕获带进来多少条文献，导出
  按钮都一直够得着。

**安装**

在 DSH 打开 设置 → 插件 → 添加插件，输入 `dsh-refkeeper@0.1.4`。从 0.1.3 升级要
显式写版本号，装完完全退出 DSH 再打开。已有的 `refs/refs.json` 与
`refs/quarantine.json` 会照原样读取，新加的可选标识符在里面压根不存在而已。

完整更新记录：[CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
