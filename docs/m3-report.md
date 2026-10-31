# M3 交付：持久化与导出（2026-10-28 15:20）

M3 完成。文献库落盘到工作区、⚠ 区独立归档、`annotated.md` 可重生成、BibTeX/RIS 导出默认只收 verified，三条路径都在真实宿主（DSH 0.2.1-rc.3，headless `refkeeper-dev`）跑通。

## 交付内容

| 文件 | 行数 | 职责 |
|---|---:|---|
| `src/store/types.ts` | 169 | `SCHEMA_VERSION = 1`、7 类 `RefType`、`StoredReference`/`RefAnnotation`/`RefVerification`、`referenceId`、`sortReferences`、`StoreError` 错误码 |
| `src/store/atomic.ts` | 121 | `writeFileAtomic`（`*.tmp` → fsync → rename）、`withStoreLock`（`.lock` + 进程内串行队列）、`serialize` |
| `src/store/io.ts` | 334 | 读写 `refs/refs.json` 与 `refs/quarantine.json`、`coerceReference` 容错、v0 裸数组迁移并写 `refs.json.bak-<ts>`、容量上限 |
| `src/store/annotated.ts` | 113 | `renderAnnotated`：按类型分组 + ⚠ 区独立小节，可从主库重生成 |
| `src/export/bibtex.ts` | 139 | 转义、作者格式、`makeCiteKey`（ASCII + 冲突后缀）、字段映射、稳定排序 |
| `src/export/ris.ts` | 70 | `TY/AU/TI/T2/PY/VL/IS/SP/EP/DO/AN/SN/UR/AB/N1/LA/KW/ER` |
| `src/host/store-command.ts` | 389 | `/refs save|export|list` 解析与渲染；`saveFromPayload`/`exportLibrary`/`listLibrary` 供工具复用 |
| `src/index.ts` | 825 | `ref_save`/`ref_export` 两个工具 + `/refs` 的 save/export/list 分流 |

## 关键决策

| 决策 | 理由 |
|---|---|
| 库放在工作区 `refs/`，不写 `~/.dsh` | 可随论文仓库 git 管理、可 review、跨设备迁移；插件不拥有用户数据 |
| 写入 `*.tmp` → fsync → rename + 目录 `.lock` | 断电/并发写不会留下半个 JSON；同一进程内再加串行队列避免自锁 |
| `schemaVersion: 1` + 读取时迁移 | 未来加字段不算破坏性变更；迁移前先备份 `refs.json.bak-<ts>` |
| ⚠ 区单独文件 `quarantine.json` | 主表"可引用"语义不被污染；导出缺省不碰它 |
| 导出只收 `verified` | 与「校验不过不入表」的承诺一致；`--include-quarantine` 才带 ⚠ 区 |
| 注解写进导出载荷（BibTeX `abstract`/`note`，RIS `AB`/`N1`） | 注解是本插件的差异化产出，导出后不能丢 |
| 工具输出只放字符串 + JSON 文本 | DSH 要求无损 JSON，`undefined` 会让整次调用失败 |

## 门禁

| 项 | 结果 |
|---|---|
| `npx vitest run` | **15 文件 / 188 用例通过**（新增 `store.test.ts` 11 例、`export.test.ts` 11 例） |
| `npm run typecheck` | 0 error |
| `npm run build` | `lib/index.js` 136.87 kB、`lib/index.d.ts` 4.08 kB、`lib/client.js` 2997 B、`node --check` 通过 |

## 真实宿主 E2E（headless `refkeeper-dev` + mock 派发工具参数）

命令模板：
`HOME=$PWD/.dsh-dev DSH_HOME=$PWD/.dsh-dev/.dsh DEEPSEEK_API_KEY=mock DEEPSEEK_BASE_URL=http://127.0.0.1:3999 REFKEEPER_DEBUG=1 dsh --profile refkeeper-dev "<prompt>"`，mock 侧 `MOCK_TOOL=ref_save|ref_export` + `MOCK_ARGS`。

| 场景 | 宿主输出 | 落盘结果 |
|---|---|---|
| `ref_save` 真实 DOI + 四段注解 | `saved doi:10.1038/nature12373 → refs/refs.json`、`verification: verified 3/3` | `refs/refs.json` 主表 1 条，`provenance.trigger: "tool"`，注解四段齐全 |
| `ref_export format=both` | `exported 1 reference(s)` | `refs/exports/refs-<ts>.bib`（含 `abstract` + `note`）、`.ris`（含 `AB` + 三条 `N1`） |
| `ref_save` 虚构 DOI | `⚠ quarantined doi:10.1000/refkeeper-nope`、`quarantined 0/3 · no-source-hit` | 主表不变，`refs/quarantine.json` 1 条，`checks.title = 0` |
| `annotated.md` | 随保存自动重生成 | 含 `## Journal articles` 与 `## ⚠ Quarantine (excluded from export)` |

## 本次 E2E 抓到的真实缺陷（已修）

1. **`saveSchema` 用了 schema 级 `required: [...]`** → 宿主加载即报 `JsonSchemaError: schema.required is not supported by the value schema DSL`，整个插件 `failed to import`。改为删掉数组（必填靠参数上的 `required: true`）。单测与 `tsc` 都发现不了，只有真实宿主能暴露。
2. **`provenance.trigger` 被 `coerceReference` 丢掉** → 工具写入的记录退化显示为 `command`。补 `isTrigger` 守卫后保留 `button|command|tool`。
3. **注解 summary 未进 BibTeX** → 补 `abstract` 字段，否则导出后注解只剩 caveats。

## 未覆盖 / 限制

- `/refs save|export|list` 斜杠命令仍只做离线单测，未在 GUI 实机点过（headless 宿主不派发斜杠命令）。
- 并发锁是「进程内队列 + 目录 `.lock`」，跨进程杀进程残留需人工删 `.lock`（已有 staleness 判断，但未做超时抢占测试）。
- 5,000 条上限只在新增时检查，替换已有条目不受限。
- `annotated.md` 每次保存重写全量，库很大时是 O(n) 写放大；v0.2 再考虑增量。

## 验收修复（2026-10-28 15:40）

隔壁只读验收对 M3 提出三项，已全部修复并有回归用例：

| # | 缺陷 | 修复 | 证据 |
|---|---|---|---|
| 1 | 迁移备份 `copyFile` 失败被吞，仍按「已迁移」继续写库 | `store/io.ts`：`backupLegacy()` 失败即抛 `StoreError('backup-failed')`；`loadStore` 不再 `rm` 原文件，只读 | `test/lock.test.ts`「refuses to migrate when the backup cannot be written」断言 `backup-failed`、原文件字节不变、无 `.bak-*` 残留 |
| 2 | `.lock` 回收按路径 `unlink`，多个等待者可能删除别人刚建的锁 | `store/atomic.ts`：回收走 `claim` 硬链接（`link` 失败即 `EEXIST` → 别人赢了）；释放由目录 inode 守卫（写锁时记录 `statSync(dir).ino`，释放时 ino 变化则不动手，返回 `released:false`） | `test/lock.test.ts`「lets only one concurrent reclaimer through」「leaves a live lock in place」 |
| 3 | `manual` 确认标记是条件项，导出侧不写 `verification.note`，容易被误读为已检 | v0.1 **保持关闭**（不产生 manual 条目）；放开时必须同时写 `note: "manually confirmed; not machine verified"` 并跳过默认导出 | 本报告「未覆盖」条 + 白板「边界与不做」 |

另修一处：`saveReference` 的容量错误在旧签名里带 `references.length`，现统一为 `StoreError('capacity')` 携带 `limit`。

门禁复跑（修复后）：`npx vitest run` → **16 文件 / 193 用例通过**；`npm run typecheck` 0 error；`npm run build` → 2 files / 138.59 kB、client 2997 B。

## 下一步

M4 = 客户端 UI（输入框「捕获」按钮 + 候选预览/确认 + 注解编辑），并把 `sessionQuery` 的 turn 边界与按钮路径在真实 GUI 上验一遍。
