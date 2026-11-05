# dsh-refkeeper — 代理工作说明

本文件是给任何在本仓库干活的代理（人或模型）看的入口。

## 当前任务：捕获面板 UI 改版

**不要重新设计方案。** 已批准的实施稿在 [`docs/ui-polish-plan.md`](docs/ui-polish-plan.md)，
里面有全部现状诊断、决策、设计规格、文件级清单、验证判据和踩坑清单。
**先完整读它，再动手。** 本文件只列不能违反的硬约束，其余以实施稿为准。

### 已定决策（不可推翻）

| # | 决策 | 结论 |
|---|---|---|
| D1 | JSX 写法 | esbuild **经典转换**（`jsx: 'transform'` + `jsxFactory: 'React.createElement'`）。产物里不得出现 `react/jsx-runtime` |
| D2 | 面板宽度 | **420px**，列表视图与详情视图统一 |
| D3 | 「选择文件夹」按钮 | **不做**。禁止任何 picker 通路 |
| D4 | 跳过条目 | 保留**「手动入表」**入口，走 `/refs save --payload=…` |
| D5 | `src/ui/authors.ts` | **保留并接线**，不删 |

### 硬约束

1. **宿主命令协议一字不改**；`src/core/`、`src/host/`、`src/store/`、`src/export/`、`src/verify/`、`src/index.ts` 一行不碰。
2. `src/client.tsx` 的 `import * as React from 'react'` **必须留着** —— 经典转换依赖 `React.createElement` 这个标识符。
3. 新 UI 模块**只许**被 `src/client.tsx` 引用。不得被 `src/index.ts` 引用，否则 `react/jsx-runtime` 会被打进 Node 侧 bundle。
4. 路径输入框的 `onChange` **只能 setState**；宿主往返必须由显式按钮点击触发。见实施稿 §3.3。
5. **不得**发出 `/refs dir --choose` 或 `/refs export --choose-dir`；不得新增任何目录枚举 UI。
6. `lib/client.js` 是 **git 跟踪的产物**。改完必须 `npm run build` 并提交，否则 npm 用户装到的是旧界面。
7. 宿主命令协议不新增子命令。D4 用的 `/refs save` 是宿主**已有**的（`STORE_SUBCOMMANDS` 已含 `save`）。

### 执行节奏

按实施稿 §5 的 **B1 → B2 → B3** 三批推进，每批独立可验证、可回滚。
每批结束必须全过下面这几条，提交后再进下一批：

```
npm run typecheck                                  # 0 error
npx vitest run                                     # 全过
npm run build && node --check lib/client.js        # 通过
grep -c "jsx-runtime" lib/client.js                # → 0
grep -c "choose"     lib/client.js                 # → 0
```

外加实施稿 §6.2 的 GUI 实证（V1–V12），截图留档。

### 易踩的坑

实施稿 §7 列了 7 条，其中最容易出错的两条：

- `parseAuthors` 的分隔符**不含换行**，必须**逐行**调用后展平（实施稿 §3.5）。
- batch 是**持久化快照**，手动入表后列表不会自动刷新，要客户端就地更新行状态（实施稿 §3.4）。

## 其他

- 发布前必看 `docs/m4-gui-slot-verification.md`：里面有隔离 profile + CDP 驱动 GUI 实证的完整流程。
- 改动用户可见界面时，`docs/images/panel.png` 与 `panel-en.png` 需要重新截图（README 两处都在引用）。
