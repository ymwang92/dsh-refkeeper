# dsh-refkeeper

DeepSeek Harness 的引用 / 来源管理器：把对话里已经出现过的文献捕获下来，先核对权威数据库，再把通过的条目导出成 BibTeX 或 RIS。

多数引文工具要求你先手工攒一份 DOI 清单；这个插件从对话出发——刚才被引用的论文、工具结果里贴出的 DOI、两轮前提到的报告。

## 能做什么

- **从对话捕获**：可选当前轮、前 N 轮或整个会话。候选来自标识符（DOI、arXiv id、ISBN、报告号）与 APA / GB/T 7714 / IEEE 形态的参考文献行。工具输出默认不计入（搜索结果会回显 DOI，把候选淹没），需要时用 `--include-tools` 显式打开。
- **四源校验**：并行查询 Crossref、OpenAlex、arXiv、DataCite。只有标题强重合、年份 ±1、首作者匹配，且至少一个源返回记录时，条目才进主表；其余写入 `refs/quarantine.json` 并标 ⚠——保留、可见、默认不导出，需要时再显式包含。
- **补齐引文缺的字段**：卷、期、页码、出版社、语言在引文未携带时取注册表记录；`/refs enrich` 对已存条目做同样的事。
- **改正条目**：在面板展开某一行即可编辑字段，导出使用你保存后的内容；命令行等价入口是 `/refs edit`。
- **导出 BibTeX 和/或 RIS**：可导最近一次捕获、勾选的条目、或整个库，落到 `refs/exports/` 或你设定一次的文件夹。

## 安装

```sh
dsh plugin --profile <profile> add dsh-refkeeper
```

重启 DeepSeek Harness（或在插件页重载）。面板出现在输入框上方。

## 面板

| 控件 | 作用 |
| --- | --- |
| 范围 | 本轮 · 前 N 轮 · 整个会话 |
| 捕获并保存 | 捕获、校验并入库；结果会列出存了几条、几条进了 ⚠ |
| 行首勾选框 | 决定本次导出包含哪些条目（已入表默认勾选，⚠ 默认不勾） |
| 展开行 | 显示已存字段，修改按条目保存 |
| 导出格式 | BibTeX、RIS 或两者 |
| 文件夹 | 导出目的地；不改则用会话工作区内的 `refs/exports/` |
| 导出本次捕获 | 写出勾选的条目 |
| 导出全部文献 | 写出整个库 |

## 命令

```text
/refs                                                    捕获就绪状态
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

`/refs capture` 不带 `--save` 只预览候选。导出默认范围是最近一次保存的捕获；`--all` 改为导整个库。

## 工具

`ref_capture`、`ref_verify`、`ref_save`、`ref_export`、`ref_ping` 让模型在同一轮里做同样的事。

## 文件

都放在工作区根目录的 `refs/`：

```text
refs/refs.json          通过校验的条目
refs/quarantine.json    ⚠ 未通过校验的条目
refs/last-capture.json  最近一次捕获的产物，也是默认导出范围
refs/settings.json      记住的导出文件夹
refs/annotated.md       人类可读的视图
refs/exports/           默认导出目的地
```

都是纯 JSON / Markdown，可以和稿件一起提交、diff、备份。

## 已知边界

- 不是 Zotero 的替代品：只负责导出 BibTeX/RIS，导入 Zotero、JabRef 或 LaTeX 工程是下一步，不在本插件职责内。
- 不读 PDF：内容来自对话文本与注册表。
- 导出只写会话工作区内：宿主按 `workspace-write` 策略裁决，工作区外的文件夹会被明确拒绝，而不是写出半个文件。
- 校验会把标识符或标题发给 Crossref、OpenAlex、arXiv、DataCite；除此之外没有数据外发，也不涉及任何凭据。

## 开发

```sh
npm ci
npm test          # vitest
npm run typecheck
npm run build     # tsdown + 客户端 bundle
```

## 许可

MIT，见 [LICENSE](LICENSE)。
