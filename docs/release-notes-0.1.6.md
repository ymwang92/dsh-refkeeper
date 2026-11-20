# dsh-refkeeper 0.1.6 Release Notes

This release adds book-link identifiers and clarifies the boundary between candidate discovery and verification. LCCN, OCLC and Open Library identifiers are stored and exported with book references, but do not count as verification evidence. DataCite can search technical report numbers, and Open Library can find book candidates by ISBN; a lookup hit still must pass the existing title, year and first-author checks. Route PMID and PMCID lookups through PubMed and PMC search/crosswalk respectively. The capture result now reports whether the conversation was cut short by the length budget. An ISBN without a title remains quarantined. The npm `prepack` hook runs `npm run build` before packing or publishing so generated `lib/` artifacts are current.

The host-independent `dsh-refkeeper/core` subpath is available for pure citation helpers such as `extractIdentifiers`.

## Install

```bash
npm install dsh-refkeeper@0.1.6
```

See the [full changelog](../CHANGELOG.md).

# dsh-refkeeper 0.1.6 发布说明

本版本新增图书链接标识符，并明确候选发现与正式核验的边界。LCCN、OCLC 和 Open Library 标识符会随图书文献保存并参与导出，但不作为核验依据。DataCite 可按报告号搜索，Open Library 可按 ISBN 查找图书候选；查询命中仍须通过既有的标题、年份和第一作者比对。PMID 与 PMCID 分别路由至 PubMed 和 PMC 搜索/交叉解析。捕获结果现在会报告会话内容是否因长度预算被截断。只有 ISBN 而没有标题的条目仍会进入隔离区。npm `prepack` 钩子会在打包或发布前运行 `npm run build`，以刷新生成的 `lib/` 产物。

现在也可通过不依赖宿主的 `dsh-refkeeper/core` 子路径导入 `extractIdentifiers` 等纯引用处理函数。

## 安装

```bash
npm install dsh-refkeeper@0.1.6
```

完整更新记录见[变更日志](../CHANGELOG.md)。
