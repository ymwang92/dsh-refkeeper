## 0.1.3 — 2026-11-08

The capture panel becomes a real panel, and the reference store survives hosts that refuse `rename` and `unlink`.

- **The panel opens in the top-right corner**, anchored to the window instead of floating over the transcript. It is rendered through a portal into `document.body`, so a host container with a `transform` can no longer drag it into the corner.
- **Opening a row opens an independent edit page.** The fourteen fields used to expand in place and push the list off screen; they now live on their own page, grouped into identifiers, bibliography and publication, with a `Back to list` link and the focus returning to the row you came from.
- **Entry type is a dropdown** of the seven `REF_TYPES` values. It was a free text field, so a typo produced an entry that failed silently at export time.
- **Every row carries a badge** — saved, ⚠ quarantined, skipped, failed — so the state is readable without opening anything, and the sub-line shows the first author, the year, the venue and, when the check failed, why.
- **The batch header says how many entries it holds**, and a `Refresh list` action reloads it.
- **Manual entry reuses the same form.** A skipped row can be completed with the full metadata and stored; the old single-purpose form only collected five fields and could never satisfy the host's own check.
- **The library is written without `rename` or `unlink`.** Some hosts deny both, which left the reference store unable to commit anything at all. References now live in immutable versioned snapshots with a newline-delimited SHA-256 journal as the commit point, so a half-written file is never visible and an interrupted write falls back to the previous commit. A failed write is reported instead of being swallowed.
- **Saving from the panel is matched to its own command.** The result is paired by command id and exact arguments, so an unrelated command, an error, or an unrecognised reply no longer leaves the row claiming it was saved.
- **A stored entry no longer shows a stale reason.** A row that was quarantined and later stored kept the old `quarantined` note next to its "saved" badge.

**Install**

```sh
# in DSH: Settings → Plugins → Add plugin
dsh-refkeeper@0.1.3
```

Or install the tarball attached to this release, or the repository itself:

```sh
dsh plugin add ./dsh-refkeeper-0.1.3.tgz
dsh plugin add github:ymwang92/dsh-refkeeper
```

Upgrade from 0.1.2 by naming the version explicitly, then fully quit and reopen DSH. Your existing `refs/refs.json` and `refs/quarantine.json` are read as they are — the new journal only takes over on the next write.

Full notes: [CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md).

---

## 0.1.3 — 2026-11-08（中文）

捕获面板真正变成了一个面板，文献库也能在禁止 `rename` 与 `unlink` 的宿主上正常落盘。

- **面板开在窗口右上角**，固定在窗口边缘，不再压在对话记录上。它通过 portal 渲染到 `document.body`，所以宿主里带 `transform` 的容器不会再把它拖到角落。
- **点条目打开独立的编辑页。** 原来十四个字段在列表里就地展开，会把列表顶出视野；现在它们在自己的页面上，按标识信息、书目信息、出版信息分成三组，带「返回列表」，关闭后焦点回到原来的那一行。
- **条目类型改成下拉框**，七种 `REF_TYPES` 选一。原来是自由文本，打错字会得到一条在导出时静默失败的条目。
- **每行都带状态徽章** —— 已入表、⚠ 隔离、跳过、失败 —— 不用展开就知道结果；副行显示第一作者、年份、出版物，核验没通过时还带上那句原因。
- **批次标题会写明有多少条**，另有「刷新列表」可以重新载入。
- **手动入表复用同一套表单。** 跳过的条目可以在那里补全元数据后入库；旧的专用表单只收五个字段，永远过不了宿主自己的核对。
- **文献库的写入不再依赖 `rename` 与 `unlink`。** 有些宿主两个都禁，文献库因此什么都存不进去。现在文献存在不可变的版本快照里，以逐行 SHA-256 校验日志作为提交点：写了一半的文件永远不会被读到，中断的写入会退回上一个提交。写失败会明确报出来，不再被吞掉。
- **面板里的保存按它自己的那条命令配对。** 结果按命令 id 和精确参数匹配，无关的命令、报错、认不出来的回复，都不会再让那一行显示成"已保存"。
- **已入库的条目不再挂旧原因。** 先隔离后入库的行，会在"已入表"徽章旁边继续显示 `quarantined`。

**安装**

在 DSH 打开 设置 → 插件 → 添加插件，输入 `dsh-refkeeper@0.1.3`。也可以装本 release 附带的安装包，或直接装仓库：

```sh
dsh plugin add ./dsh-refkeeper-0.1.3.tgz
dsh plugin add github:ymwang92/dsh-refkeeper
```

从 0.1.2 升级要显式写版本号，装完完全退出 DSH 再打开。已有的 `refs/refs.json` 与 `refs/quarantine.json` 会照原样读取，新的校验日志要到下一次写入才开始接管。

完整更新记录：[CHANGELOG.md](https://github.com/ymwang92/dsh-refkeeper/blob/main/CHANGELOG.md)。
