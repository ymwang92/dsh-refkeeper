# dsh-refkeeper 0.1.7 Release Notes

- The panel now displays ISBN, report number, LCCN, OCLC and Open Library ID in its identifier group, and lets users edit these values back into a reference record.
- Re-verification now queries available ISBN, report number, PMID and PMCID identifiers; failed checks also refresh status and reasons, and quarantine shows the latest verification reason.
- Verdicts follow registries that actually return records, so a timeout or error from another source no longer vetoes evidence already found.
- A near-identical title without a publication year is no longer sent straight to quarantine.
- Reference writes try temporary-file-plus-rename first and fall back to immutable snapshots with a validation journal only when the atomic write fails.
- BibTeX and RIS exports now indicate when a registry did not respond during verification.

## Install

```bash
npm install dsh-refkeeper@0.1.7
```

See the [full changelog](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

# dsh-refkeeper 0.1.7 发布说明

- 面板现在会在标识符组中显示 ISBN、报告号、LCCN、OCLC 和 Open Library ID，并允许编辑后写回文献记录。
- 重新核验会查询可用的 ISBN、报告号、PMID 和 PMCID；核验失败时也会刷新状态与原因，隔离区会显示最近一次核验的原因。
- 判定依据是实际返回记录的注册表来源，因此其他来源超时或报错，不会否决已经取得的证据。
- 对于缺少年份但标题几乎一致的条目，不再直接送入隔离区。
- 文献写入优先采用临时文件加重命名的原子写入；只有该方式失败时，才降级为不可变快照加校验日志。
- 核验期间若有注册表未能响应，BibTeX 与 RIS 导出会注明这一情况。

## 安装

```bash
npm install dsh-refkeeper@0.1.7
```

完整更新记录见[变更日志](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
