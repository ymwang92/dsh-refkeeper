## 0.1.5 — 2026-11-14

A link that carries an identifier now yields a reference, a pasted BibTeX
entry is read as a reference, and the report numbers that technical documents
use are recognised — while the standard numbers that technical documents also
use are not.

- **Identifiers inside links.** A bare arXiv, DOI, bioRxiv or medRxiv link
  now produces a candidate the registries can be asked about, so pasting one
  captures the paper instead of nothing.
- **BibTeX entries.** A pasted `@article{…}` block is read as a reference,
  with `@string` macros expanded, nested braces balanced and both author
  name orders normalised. Several blocks in one message are read as several
  references.
- **Vancouver reference lines.** The numbered style used in medicine is
  parsed, and electronic pagination is kept.
- **More report numbers.** RFC, DOE, NASA, NTRS, NACA, DoD `AD-A` and EPA.
- **A standard number is no longer a reference.** `ISO 9001`, `GB/T 12345`
  and `RFC-1918` are read as text but never become entries.

**Install**

```sh
# in DSH: Settings → Plugins → Add plugin
dsh-refkeeper@0.1.5
```

Or install the tarball attached to this release, or the repository itself:

```sh
dsh plugin add ./dsh-refkeeper-0.1.5.tgz
dsh plugin add github:ymwang92/dsh-refkeeper
```

Upgrade from an earlier version by naming the version explicitly, then fully
quit and reopen DSH. Existing `refs/refs.json` and `refs/quarantine.json` are
read as they are.

Full notes: [CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

---

## 0.1.5 — 2026-11-14（中文）

一个带标识符的链接现在能产生一条文献，一个粘进来的 BibTeX 条目能读成一条文献，
技术文档里用的报告号也能认出来 —— 而技术文档里同样在用的标准号不会。

- **链接里的标识符。** 一条光秃秃的 arXiv、DOI、bioRxiv 或 medRxiv 链接，
  现在能产生一个可以拿去查注册表的候选，贴进来就能捕获到那篇论文。
- **BibTeX 条目。** 粘进来的 `@article{…}` 块会被读成一条引用：
  `@string` 宏会展开，花括号会配对，两种作者姓名顺序会归一。
  一段消息里贴几个块就读成几条引用。
- **Vancouver 参考文献行。** 医学常用的编号格式能解析，电子页码会保留。
- **更多报告号。** RFC、DOE、NASA、NTRS、NACA、DoD 的 `AD-A` 与 EPA。
- **标准号不再算文献。** `ISO 9001`、`GB/T 12345`、`RFC-1918` 只被当成文本，
  不会成为条目。

**安装**

在 DSH 打开 设置 → 插件 → 添加插件，输入 `dsh-refkeeper@0.1.5`。从旧版本升级要
显式写版本号，装完完全退出 DSH 再打开。已有的 `refs/refs.json` 与
`refs/quarantine.json` 会照原样读取。

完整更新记录：[CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
