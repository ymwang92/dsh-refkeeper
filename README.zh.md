# dsh-refkeeper

[English](README.md) · **简体中文**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![version](https://img.shields.io/badge/version-0.1.0-blue.svg)

**把对话里已经引用过的文献，核验清楚再导出**——BibTeX / RIS，注解锚定在产生它的原句上。

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。DSH 是那个回答里天然带引用的 agent 运行时。

![输入框上方的捕获面板](docs/images/panel.png)

## 二十轮之后的问题

你和 agent 聊了一下午文献综述。它引了十五篇——有的是一行 DOI 出现在工具结果里，有的是摘要里一整条 APA，还有一篇只在两轮前被提过名字。现在你要开始写了。

你可以往回翻、一条条复制，保佑自己没漏掉滚过去的那个。或者让模型「把所有引用过的文献整理成 `.bib`」，然后在投稿前发现它编了两个 DOI、一段页码和作者顺序。

`dsh-refkeeper` 走第三条路：从你指定的那段对话里把引用抽出来，逐条对着四个注册表核验，只导出通过的那些——带上模型写的注解，并且把引文原话回查一遍。

## 快速开始

从仓库安装：在 DSH 里打开 **设置 → 插件**，添加 GitHub 源
`github:ymwang92/dsh-refkeeper`，并在当前 profile 里启用。

然后在引用过文献的那个对话里：

1. 在面板里选范围——本轮、前 N 轮，或整个对话。
2. **捕获并保存**。候选会被核验并入库，没通过的进 ⚠ 隔离区，不进主库。
3. 取消勾选你这次不要的条目，选 BibTeX / RIS。
4. **导出本次捕获** → 写入会话工作区的 `refs/exports/`，或写进你设定过一次的文件夹。

同样的流程也可以用命令：

```text
/refs capture --scope=all --save
/refs export --format=both
```

## 导出长什么样

`refs/annotated.md` 是人读的视图，和 JSON 一起写盘：

```markdown
### Physiographically sensitive mapping of temperature and precipitation across the conterminous United States

- Daly, C.; Halbleib, M.; Smith, J. I. et al. · 2008 · International Journal of Climatology 28 15 2031-2064 · DOI [10.1002/joc.1688](https://doi.org/10.1002/joc.1688)
- verification: **verified** 3/3 · crossref, openalex

> **Summary** — PRISM 插值：基于台站数据并做地形调整，生成美国本土的气温与降水格点。
> **Why it matters** — 第 3 节 800 m 气候常年值的底层数据集。
> **Evidence** — "we use the PRISM 800 m normals (Daly et al., 2008) as the baseline for the downscaling."
```

以及对应的导出条目：

```bibtex
@article{daly2008physiographically,
  author = {Daly, C. and Halbleib, M. and Smith, J. I. and Gibson, W. P. and Doggett, M. K.},
  title = {Physiographically sensitive mapping of temperature and precipitation across the conterminous United States},
  journal = {International Journal of Climatology},
  year = {2008},
  volume = {28},
  number = {15},
  pages = {2031--2064},
  publisher = {Wiley},
  doi = {10.1002/joc.1688},
  url = {https://doi.org/10.1002/joc.1688},
  abstract = {PRISM interpolation: temperature and precipitation grids ...}
}
```

卷、期、页码、出版社、语言在对话里没写全时，从注册表记录补齐。对话里没有依据的字段干脆不出现在文件里——不会出现写着「没有可用的引用句」的 `note`，也不会有编出来的页码。

## 它做的四件事

1. **捕获**。本轮、前 N 轮，或整个对话。候选来自标识符（DOI、arXiv id、ISBN、报告号），也来自 APA、GB/T 7714、IEEE 三种格式的参考文献行。默认跳过工具输出——一次网页搜索会带回十几个没人引用的 DOI，把真正引用的那两条埋掉；`--include-tools` 可以显式打开。
2. **核验**。并行查 Crossref、OpenAlex、arXiv、DataCite。三道门全过、且至少有一个注册表给出记录，才进主库。
3. **注解**。捕获之后，用当前 profile 的默认模型为每条写 `summary` / `relevance` / `evidence` / `caveats`，依据是对话里真正提到它的那几行。`evidence` 逐字回查：对话里没有的原话直接丢弃。没有可用模型、或捕获范围里找不到出处？条目只保留书目信息，捕获结果里会写明原因。
4. **导出**。BibTeX 和/或 RIS，范围可以是最近一次捕获、你勾选的条目、或整个库。输出是确定性的，所以 `.bib` 的 diff 反映的是真实改动。

## 和另外两条路比

| | 手动回翻对话 | 「给我一个 `.bib`」 | `dsh-refkeeper` |
| --- | --- | --- | --- |
| 文献从哪来 | 你的眼睛，一次一次滚动 | 模型的记忆 | 从你指定的对话里解析 |
| 元数据是否对着注册表核过 | — | 没有 | Crossref · OpenAlex · arXiv · DataCite |
| 编造的页码、DOI、作者 | — | 会发生，而且发现得很晚 | 字段来自注册表记录；无依据的字段留空 |
| 为什么稿子里有这篇 | 丢了 | 丢了 | 注解 + 逐字证据原话 |
| 可复现、可 diff 的导出 | — | 没有 | 排序稳定、字节稳定的 BibTeX/RIS |
| 你从没引用过的文献 | — | 会被带进来 | 排除：工具输出不算引用 |

## 工作原理

```text
对话文本
   │  标识符（DOI · arXiv · ISBN · 报告号）
   │  参考文献行（APA · GB/T 7714 · IEEE）
   ▼
候选 ──► Crossref · OpenAlex · arXiv · DataCite（并行）
   │
   ├─ 三道门：标题强重合 · 年份 ±1 · 首作者匹配
   │          且至少一个注册表返回了记录
   ├─ 通过 ──► refs/refs.json        （verified）
   └─ 未过 ──► refs/quarantine.json  （⚠ 保留、可见、不进导出）
```

## 为什么这样设计

**三道门，一次可信判断。** 不由单一模糊分数决定。标题必须强重合、年份必须在 ±1 内、首作者必须匹配，而且至少得有一个注册表应答过。拉丁标题用折叠后的词元做 Jaccard；中日韩标题用字符二元组 Dice ≥ 0.90，否则罗马化的注册表记录永远对不上一个中文标题。

**`unverified` 不是 `quarantined`。** 注册表连不上时，条目标为 `unverified` 并保留——网络故障说明不了这条引用是真是假，而且可以重试。`quarantined` 意味着注册表应答了、但结论不一致。把两者合并，要么丢掉好文献，要么把坏文献洗白。

**空就是空。** 每个注解字段都过一道过滤器，拒绝「摘录未提及本文」这类描述缺失的句子。它们不是内容，写进 `.bib` 却读起来像内容。同一道过滤也在渲染时生效，所以在这个过滤器出现之前写下的库也会被清理，不必重新捕获。

**导出是字节稳定的。** 条目按（作者、年份、标题）排序，citekey 冲突按确定性规则消歧，同一个库导两次得到完全相同的字节。

**写入是原子且有锁的。** `refs/*.json` 走临时文件 + rename，由磁盘锁保护；陈旧锁按 inode + 内容身份原子回收（不只看路径），两个会话同时捕获也不会写出半个库。

## 中文文献

GB/T 7714 参考文献行与 APA、IEEE 一起解析；中日韩标题对着注册表记录做字符二元组相似度匹配，而不是词元重合——这是中文标题唯一能对上罗马化记录的办法。中英混排的稿子可以用，`language` 会带进两种导出格式。

诚实的边界：开放注册表对中文期刊的元数据很稀疏；CNKI / 万方 / 维普只在抽取标识符时被识别为学术站点链接，并不是被查询的注册表。中文条目需要手工修正的地方会比英文 DOI 多。

## 面板

| 控件 | 作用 |
| --- | --- |
| 范围 | 本轮 · 前 N 轮 · 全部对话 |
| 捕获并保存 | 捕获、核验、补注解、入库；结果里列出存了哪些、哪些进了 ⚠ |
| 每条前的复选框 | 下一次导出包含哪些（已入表的默认勾选，⚠ 的默认不勾） |
| 展开条目 | 显示已存字段；修改按条目保存 |
| 导出格式 | BibTeX / RIS / 两者 |
| 文件夹 | 导出目的地；未设置时写会话工作区的 `refs/exports/` |
| 导出本次捕获 | 写出勾选的条目 |
| 导出全部文献 | 写出整个库 |

## 命令

| 我想…… | 命令 |
| --- | --- |
| 先看看对话里引了什么，不写任何东西 | `/refs capture --scope=all --dry-run` |
| 捕获并入库 | `/refs capture --scope=lastN --turns=5 --save` |
| 核验一条 | `/refs verify --doi=10.1002/joc.1688` |
| 看库 | `/refs list [--quarantine]` |
| 补缺失的卷/页/出版社 | `/refs enrich [--quarantine]` |
| 改一个字段 | `/refs edit --id=<id> --payload=<base64url(json)>` |
| 删条目 | `/refs remove <id\|doi\|arxiv>...` · `/refs remove --all --yes` |
| 导出 | `/refs export [--format=bibtex\|ris\|both] [--all] [--ids=…] [--out=path]` |
| 设定一次导出文件夹 | `/refs dir --set=<base64url(path)>` · `/refs dir --clear` |

<details>
<summary>完整命令参考</summary>

```text
/refs                                                     捕获就绪状态
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

`/refs capture` 不带 `--save` 只预览候选。导出默认只导最近一次捕获；`--all`
才导整个库。较长的 id 走 base64url 传输，因为真实的 id 里含空格、`<>`、`;` 和括号。

</details>

## 工具

| 工具 | 用途 |
| --- | --- |
| `ref_capture` | 从对话里抽取候选文献 |
| `ref_verify` | 对着注册表核验一个标识符或标题 |
| `ref_save` | 存入一条文献，并附上你自己写的注解 |
| `ref_export` | 为一个批次、一组勾选或整个库写 BibTeX/RIS |
| `ref_ping` | 报告哪些宿主接口与注册表可用 |

## 文件

```text
refs/refs.json          已核验的文献，含注解
refs/quarantine.json    ⚠ 未过门的条目
refs/last-capture.json  最近一次捕获的结果，也是默认导出范围
refs/settings.json      记住的导出文件夹
refs/annotated.md       人读视图：记录、核验结论、注解
refs/exports/           默认导出目录
```

纯 JSON 和 Markdown：和稿子一起提交、一起 diff、一起备份。

## 数据与隐私

- 出网流量只有被核验的标识符或标题，发给 Crossref、OpenAlex、arXiv、DataCite。其余内容不出本机。
- 注解由当前会话正在跑的模型生成——不需要额外账号，插件自己也不持有任何 API key。
- 没有埋点。文献库就是一个本地 JSON 文件。

## 边界

- **不是 Zotero 的替代品。** 跨年份的个人文献库该用 Zotero：PDF、样式、同步、浏览器插件。这个插件管的是一篇稿子的引用，也就是对话里已经写下来的那些。
- 不读 PDF；一切都来自对话文本和注册表。
- 导出只能写在会话工作区内：宿主套用 `workspace-write` 沙箱，写到外面会明确报错，而不是写一半。
- 每次捕获会多花一次模型调用（上限 60 秒）。长会话可能触到单次捕获 12 条的注解预算，其余条目只保留书目信息。

## 安装

仓库里带着构建好的 `lib/`，所以直接从 Git 安装就够：**设置 → 插件** → 添加
`github:ymwang92/dsh-refkeeper` → 在当前 profile 启用。

npm 包是下一步；发布之后，按包名安装会成为更短的那条路径。

## 路线

- `v0.1.x` — npm 发布、上 `awesome-dsh-plugin` 列表、导出你的第一批文献。
- `v0.2` — 在链接抽取之外解析 CNKI / 万方、GB/T 7714 输出格式、面板内编辑注解。
- 更远 — 和 Zotero 互导，让它成为捕获环节而不是孤岛。

## 开发

```sh
npm ci
npm test          # vitest
npm run typecheck
npm run build     # tsdown（宿主）+ client bundle
```

`tsdown` 会清空 `lib/`，所以客户端 bundle 要在它之后跑。测试需要 Node 22+。

## 许可

MIT，见 [LICENSE](LICENSE)。
