# dsh-refkeeper 0.1.8 Release Notes

- CSL-JSON exports preserve the original title in the Unicode-friendly `id` field, while BibTeX citation keys remain ASCII-friendly (for example, `anon2024`).
- Configure base URLs for Crossref, DataCite, OpenAlex, arXiv, PubMed and Open Library independently in `refs/settings.json`.
- Optionally configure a `mailto` contact address to include with registry requests.
- Capture results report whether the scan budget truncated the conversation and how many characters were retained.
- Opt-in private mode makes no registry requests during capture, `ref_verify`, `/refs verify`, re-verification or non-manual promotion. Captures are saved as manual and marked not verified.

## Install

```bash
npm install dsh-refkeeper@0.1.8
```

See the [full changelog](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

# dsh-refkeeper 0.1.8 发布说明

- CSL-JSON 导出会在支持 Unicode 的 `id` 字段中保留原始标题；BibTeX 引用键仍保持 ASCII 兼容（例如 `anon2024`）。
- 可在 `refs/settings.json` 中分别配置 Crossref、DataCite、OpenAlex、arXiv、PubMed 和 Open Library 的基础 URL。
- 可选配置 `mailto` 联系地址，并随注册表请求发送。
- 捕获结果会说明扫描预算是否截断了对话，以及保留了多少字符。
- 主动开启隐私模式后，捕获、`ref_verify`、`/refs verify`、重新核验和非手动提升均不会发出注册表请求。捕获条目会作为手动记录保存，并标记为未经核验。

## 安装

```bash
npm install dsh-refkeeper@0.1.8
```

完整更新记录见[变更日志](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
