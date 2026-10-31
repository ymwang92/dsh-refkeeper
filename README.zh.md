# dsh-refkeeper

[English](README.md) · **简体中文**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![version](https://img.shields.io/badge/version-0.1.0-blue.svg)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。它读取一段对话，把对话里引用过的文献收集起来，逐条到 Crossref、OpenAlex、arXiv、DataCite 核对，通过核对的条目导出为 BibTeX 或 RIS。没通过的放进单独的隔离文件，不进主库。

![输入框上方的捕获面板](docs/images/panel.png)

## 功能

- **收集引用**。范围可以是本轮、前 N 轮或整个对话。识别 DOI、arXiv 编号、ISBN、报告号，也识别按 APA、GB/T 7714、IEEE 格式写出的参考文献行。
- **对照注册表核对**。只有标题匹配、年份相差不超过一年、第一作者匹配，并且至少有一个注册表返回了记录，条目才会被接受。
- **生成注解**。捕获后，由当前会话使用的模型为每条写四个字段：摘要、与本书稿的关系、一段原文引证、注意事项。引证如果没在对话里逐字出现，会被丢弃。
- **导出**。BibTeX、RIS 或两者。导出范围可以是最近一次捕获、你勾选的条目，或整个文献库。

## 为什么不自己复制

三篇文献，手动复制就好。多了以后容易出错：一个 DOI 在工具结果里，一条 APA 在摘要里，还有一篇是两轮前只提过名字的。

让模型直接生成 `.bib` 更快，但模型会编页码、DOI 和作者顺序，这类错误往往到投稿前才被发现。

| | 手动复制 | 让模型生成 `.bib` | 本插件 |
| --- | --- | --- | --- |
| 条目从哪来 | 自己往回翻 | 模型的记忆 | 从你选定的对话里解析 |
| 元数据是否核对 | 没有 | 没有 | Crossref、OpenAlex、arXiv、DataCite |
| 核对不通过时 | 无 | 照样保留 | 移入 `refs/quarantine.json`，不参与导出 |
| 编造的页码、DOI、作者 | 无 | 可能出现 | 字段取自注册表记录；无依据的字段留空 |
| 为什么稿子里有这篇 | 丢失 | 丢失 | 注解加一句原文引证 |
| 同一份库导出两次 | 无 | 不保证一致 | 字节相同；条目排序、citekey 稳定 |
| 没有引用过的文献 | 不会带入 | 会被带入 | 默认排除；工具输出不算引用 |

## 安装

在 DSH 的**设置 → 插件**里添加 GitHub 源 `github:ymwang92/dsh-refkeeper`，在当前 profile 中启用，然后重载。仓库里已带构建好的 `lib/`，不需要自己构建。npm 包还在计划中，目前支持从 Git 安装。

## 使用

1. 打开引用过文献的那个对话，点开输入框上方的捕获面板。
2. 选择范围，点**捕获并保存**。
3. 面板会列出哪些已入库、哪些进了 ⚠ 隔离区。取消勾选这次不需要的条目。
4. 选择 BibTeX 和/或 RIS，点**导出本次捕获**。

同样的事情用命令：

```text
/refs capture --scope=all --save
/refs export --format=both
```

文件写在会话工作区的 `refs/` 目录下。要导出到别处，在面板里粘贴一次文件夹路径即可，之后记在 `refs/settings.json` 里。会话工作区之外的文件夹会被拒绝，因为宿主只允许写入工作区内。

## 输出示例

`refs/annotated.md` 是给人看的版本：

```markdown
### Physiographically sensitive mapping of temperature and precipitation across the conterminous United States

- Daly, C.; Halbleib, M.; Smith, J. I. et al. · 2008 · International Journal of Climatology 28 15 2031-2064 · DOI [10.1002/joc.1688](https://doi.org/10.1002/joc.1688)
- verification: **verified** 3/3 · crossref, openalex

> **Summary** — PRISM 插值：基于台站数据并做地形调整，生成美国本土的气温与降水格点。
> **Why it matters** — 第 3 节 800 m 气候常年值所用的数据集。
> **Evidence** — "we use the PRISM 800 m normals (Daly et al., 2008) as the baseline for the downscaling."
```

对应的 BibTeX 条目：

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

对话里没写卷、期、页码、出版社或语言时，这些字段从注册表记录补齐。对话和注册表都没有依据的字段不写进文件。

## 判定规则

```text
对话文本
   │  标识符：DOI、arXiv 编号、ISBN、报告号
   │  参考文献行：APA、GB/T 7714、IEEE
   ▼
候选条目 ──► Crossref、OpenAlex、arXiv、DataCite（并行查询）
   │
   ├─ 接受条件：标题匹配 · 年份相差 ±1 · 第一作者匹配
   │             且至少一个注册表返回记录
   ├─ 接受 ──► refs/refs.json        （verified）
   └─ 拒绝 ──► refs/quarantine.json  （⚠，保留可见，默认不导出）
```

还有第三种状态 `unverified`，用于注册表连不上的情况：条目留在库里，之后可以重试。网络故障不能说明引文有错。`quarantined` 则是注册表有应答、但结论不一致。

## 注解

四个字段：`summary`、`relevance`、`evidence`、`caveats`。捕获后由当前 profile 的默认模型根据提到这篇文献的对话行生成。提示词和解析层都拒绝描述「信息缺失」的句子（例如「摘录未提及本文」），这类内容存为空字符串，导出时整个字段省略，因此 BibTeX 里不会出现空的 `note`，RIS 里不会出现空的 `N1`。

模型调用每次捕获一次，上限 60 秒，最多覆盖 12 条。超出预算的条目、或当前没有可用模型的捕获，只保留书目字段，捕获结果会说明跳过注解的原因。`ref_save` 工具仍然接受你自己写的注解，已有的用户注解不会被覆盖。

## 中文文献

GB/T 7714 格式的参考文献行与 APA、IEEE 一起解析。中文标题按字符二元组与注册表记录比对（Dice ≥ 0.90），而不是按词元，否则罗马化的记录永远对不上。`language` 字段会写进两种导出格式。

中文期刊在开放注册表里的元数据很少。CNKI、万方、维普的链接只用于提取标识符，不作为注册表查询。中文条目需要手工修正的地方会比有英文 DOI 的文献多。

## 面板

| 控件 | 作用 |
| --- | --- |
| 范围 | 本轮、前 N 轮、整个对话 |
| 捕获并保存 | 捕获、核对、生成注解并入库；结果列出保存了哪些、哪些进了隔离区 |
| 每条前的复选框 | 决定下一次导出包含哪些条目；已入库的默认勾选，⚠ 的默认不勾 |
| 展开条目 | 显示已保存的字段；修改按条目保存 |
| 导出格式 | BibTeX、RIS 或两者 |
| 文件夹 | 导出目录；留空表示 `refs/exports/` |
| 导出本次捕获 | 写出勾选的条目 |
| 导出全部文献 | 写出整个文献库 |

## 命令

| 要做的事 | 命令 |
| --- | --- |
| 先看对话里引用了什么，不写入 | `/refs capture --scope=all --dry-run` |
| 捕获并入库 | `/refs capture --scope=lastN --turns=5 --save` |
| 核对一条 | `/refs verify --doi=10.1002/joc.1688` |
| 查看文献库 | `/refs list [--quarantine]` |
| 补齐卷、页码、出版社 | `/refs enrich [--quarantine]` |
| 修改一个字段 | `/refs edit --id=<id> --payload=<base64url(json)>` |
| 删除条目 | `/refs remove <id\|doi\|arxiv>...` 或 `/refs remove --all --yes` |
| 导出 | `/refs export [--format=bibtex\|ris\|both] [--all] [--ids=...] [--out=path]` |
| 设置导出文件夹 | `/refs dir --set=<base64url(path)>` 或 `/refs dir --clear` |

<details>
<summary>完整命令列表</summary>

```text
/refs                                                     查看捕获状态
/refs capture [--scope=turn|lastN|all] [--turns=N] [--save] [--dry-run] [--include-tools]
/refs verify --doi=... | --arxiv=... | --title=... [--json]
/refs save --json='{...}'
/refs list [--limit=N] [--quarantine]
/refs edit --id=<id> --payload=<base64url(json)>
/refs enrich [--quarantine]
/refs remove <id|doi|arxiv>... [--quarantine]
/refs remove --all --yes [--quarantine]
/refs export [--format=bibtex|ris|both] [--out=path] [--include-quarantine]
/refs export [--ids=id,id] [--choose-dir] [--all]
/refs dir [--set=<base64url(path)>|--clear]
```

不带 `--save` 时，`/refs capture` 只预览候选。导出默认只导最近一次捕获，加 `--all`
导出整个库。较长的 id 用 base64url 传输，因为真实 id 里含空格、`<>`、`;` 和括号。

</details>

## 工具

| 工具 | 用途 |
| --- | --- |
| `ref_capture` | 从对话里收集候选文献 |
| `ref_verify` | 对照注册表核对一个标识符或标题 |
| `ref_save` | 保存一条文献，可附带自己写的注解 |
| `ref_export` | 为一个批次、一组勾选或整个库写出 BibTeX/RIS |
| `ref_ping` | 报告哪些宿主服务和注册表可用 |

## 文件

```text
refs/refs.json          已接受的文献，含注解
refs/quarantine.json    ⚠ 未通过核对的条目
refs/last-capture.json  最近一次捕获的结果，也是默认导出范围
refs/settings.json      记住的导出文件夹
refs/annotated.md       阅读版：记录、核对结论、注解
refs/exports/           默认导出目录
```

都是普通 JSON 和 Markdown，可以和稿子一起提交、一起对比。

## 限制

- 不能替代 Zotero。跨年份的个人文献库（PDF、样式、同步）该用 Zotero。这个插件管的是一篇稿子的引用，来源是一段对话。
- 不读 PDF。所有信息来自对话文本和注册表。
- 导出受宿主沙箱限制，只能写进会话工作区。
- 每次捕获会调用一次模型（上限 60 秒），最多为 12 条生成注解。
- 中文期刊的注册表元数据稀疏，见上文。

## 数据与隐私

- 只有核对请求会离开本机：标识符或标题发给 Crossref、OpenAlex、arXiv、DataCite。
- 注解使用会话里已经配置的模型，插件本身不持有 API key。
- 没有埋点。文献库就是一个本地文件。

## 开发

```sh
npm ci
npm test          # vitest
npm run typecheck
npm run build     # 先用 tsdown 打包宿主，再打客户端 bundle
```

`tsdown` 会清空 `lib/`，所以客户端 bundle 要在它之后执行。需要 Node 22 或更高版本。

## 许可

MIT，见 [LICENSE](LICENSE)。
