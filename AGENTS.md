# dsh-refkeeper — 代理工作说明

本文件是给任何在本仓库干活的代理（人或模型）看的入口。

## 当前任务：捕获面板 UI 改版

**不要重新设计方案。** 已批准的实施稿在 [`docs/ui-polish-plan.md`](docs/ui-polish-plan.md)，
视觉对照在 [`docs/ui-mockup.html`](docs/ui-mockup.html)（浏览器直接打开，左图 B2 目标 / 右图 B3 目标）。
里面有全部现状诊断、决策、设计规格、文件级清单、验证判据和踩坑清单。
**先完整读它们，再动手。** 本文件只列不能违反的硬约束，其余以实施稿为准。

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

### 当前批次：M1（存储落盘）→ M2（视觉验收）

B1 → B2 → B3 暂停。当前推进 **M1 → M2**：

| 批次 | 内容 | 授权边界 |
|---|---|---|
| **M1** | 修 `refs/` 落盘失败（`writeFileAtomic` 在宿主沙箱下 rename/unlink 不可用） | **本项目唯一被授权破例触碰 `src/store/` 的批次** |
| **M2** | 捕获面板视觉验收，逐条给 V1–V12 的 pass / fail / **未测** | **不改产品代码**，只产出验收记录与截图 |

**M1 破例说明**：上面「不碰 src/core、src/host、src/store、src/export、src/verify、src/index.ts」
这条约束对 M1 **不适用**。M1 只允许动 `src/store/atomic.ts` 及必要的 `src/store/io.ts`；
其余目录（`src/host/`、`src/verify/`、`src/export/`、`src/core/`、`src/index.ts`、`src/client.tsx`、
`src/ui/`）仍然**一律不碰**。发现不改 host 层就修不了时，**停下来报告，不要自行扩大范围**。

**M2 的判定纪律**：没验到的断言写「**未测**」，不许写成「通过」。

### 已知待修（2026-11-05 18:57 验收 B1+B2 发现，进 B3 前必须修掉）

B1 的 P1（作者解析回归）与 P2（悬空指令）**已修复并复验通过**。以下是 B2 验收新发现的。

**P3（严重，功能不可用）——「手动入表」永远进不了主表。**
表单只收 `{title, doi, arxivId}`，但宿主核验要求三项全中：

```
coerceReference(payload)        → year=undefined, authors=[], type 强制 journalArticle
yearMatches(undefined, X)       → false          （verify/match.ts:75）
firstAuthorMatches([], X)        → false          （verify/match.ts:99）
passed ≤ 1 → status='quarantined'                （verify/judge.ts:138）
accepted = status==='verified' || status==='manual' → false
→ 写入 refs/quarantine.json，不是主表
```

按钮写着「手动入表」，实际只能产出隔离条目。**修法：表单补齐「年份 + 首作者 + 条目类型」**，
让核验能拿 3/3；或把按钮降级为「补全后入表」并在表单里明示必填项。

**P4（中）—— 新引入了一个宿主不存在的 CSS 变量。**
`--dsw-alias-fg-muted` 在宿主 `app.asar` 里 **0 次出现**，每次都落在 fallback 上 —— 与 B1 修掉的
是同一类 bug。出现在 `src/client.tsx` 的 478 行（空态卡）与 572 行（元信息副行）。
**修法**：改用 `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary`（这两个宿主确实有）。

**P5（轻）——「手动入表」按钮与表单提交按钮同文案。**
`src/client.tsx` 569 行（打开表单）与 605 行（提交）都用 `text.manualSave`，点开后两个按钮长得一样。
**修法**：拆成两个键，如 `manualOpen` / `manualSave`。

**P6（轻）—— 手动表单的预填值与列表显示值不一致。**
列表显示用 `titleOf(entry) === '' ? entry.doi ?? entry.arxivId ?? '—' : titleOf(entry)`，
表单预填却直接用 `entry.title`。只识别到 DOI 的条目，表单标题框会被预填成 DOI 串而非留空。
**修法**：与列表用同一个兜底取值函数；标题为空且无 DOI 时留空让用户手填。

**P7（提示）—— 字体权重不统一**：空态卡用 `fontWeight: 600`，批次标题用 `<strong>`（默认 700），
其余继承。目标稿是 500。统一成 500 更贴宿主。

### 易踩的坑

实施稿 §7 列了 7 条，其中最容易出错的两条：

- `parseAuthors` 的分隔符**不含换行**，必须**逐行**调用后展平（实施稿 §3.5）。
- batch 是**持久化快照**，手动入表后列表不会自动刷新，要客户端就地更新行状态（实施稿 §3.4）。

## GUI 实证（2026-11-05 已打通，脚本可直接用）

旧流程失效的原因：隔离 profile 随工作区重建丢失了。**下面这套是实测通过的版本。**

```bash
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
REPO="/Users/ymwang/Documents/deepseek-harness/default-workspace/dsh-refkeeper"
VH="$HOME/.dsh-refkeeper-verify"          # 隔离 HOME 放仓库外，凭据不进项目树
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

# 1) 隔离 HOME + 凭据（关键：缺 DeepSeek 凭据就没有模型 → 输入框禁用 → 面板不出现）
mkdir -p "$VH/.dsh"
cp ~/.dsh/.credentials.yaml "$VH/.dsh/.credentials.yaml" && chmod 600 "$VH/.dsh/.credentials.yaml"

# 2) profile 必须从出厂 web 模板派生，否则缺 @deepseek-ai/dsh-web-app，不会起 HTTP 服务
DSH_HOME="$VH/.dsh" "$CLI" refkeeper-web --from-default-profile web
DSH_HOME="$VH/.dsh" "$CLI" plugin --profile refkeeper-web add "$REPO"

# 3) 起 web（--no-open 免得弹浏览器；日志里拿 token）
cd "$REPO" && DSH_HOME="$VH/.dsh" "$CLI" --profile refkeeper-web --port 3099 --no-open
#   → dsh web: http://127.0.0.1:3099/?token=XXXX

# 4) 起 headless Edge（只留一个 target，不要 Page.reload）
pkill -f "remote-debugging-port=9333"; rm -rf /tmp/dsh-edge
"$EDGE" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/dsh-edge \
  --no-first-run --no-default-browser-check "http://127.0.0.1:3099/?token=XXXX" &

# 5) 驱动
node dev/gui-probe.mjs 9333 .e2e-panel.png     # 截图
node dev/gui-eval.mjs 9333 "$(cat /tmp/expr.js)"   # 读 DOM（表达式放文件，避免 shell 吃掉引号）
```

### 三个必须手动做的前置动作

| 动作 | 为什么 |
|---|---|
| **选一个模型**（`DeepSeek-V4.1-Flash` / `DeepSeek-V4-Pro`） | 没选 → 发送按钮禁用 → 面板不出现。日志里出现 `model listing ... loaded 2 model(s)` 即凭据已生效 |
| **先发一条消息建会话** | `conversation.composer.dock` 插槽**只在真实会话里挂载**；欢迎页 hero 上只有 `conversation.input.left`，所以按钮在、面板不在 |
| **从斜杠命令补全菜单里选中 `refs`** | 面板的 `inputActions.setDraft` + `submit()` 在 web composer 里**不生效**（命令根本没进会话）；手动输入 `/refs` 会弹出「指令 → refs」菜单，选中后再补参数回车即可执行 |

### 已实测通过的断言

| # | 断言 | 实测值 |
|---|---|---|
| V1 | 面板宽度 | **420** ✓ |
| V2 | `details` / `summary` 元素数 | **0** ✓ |
| V12 | 面板内「选择文件夹」字样 | **无** ✓ |

### 尚未验证（需要条目才能测）

V3 徽章底色 / V4 标题截断 / V5 类型下拉 / V6 详情三组 / V7 reason 显示，
都要求批次里**有真实条目**。当前阻塞见下方「已知宿主侧问题」。

### 已知宿主侧问题（不是本次 UI 改版引入）

> **第 1 条由 M1 修复。** M1 完成后回来把这一条标成「已修」。

1. **`refs/` 落盘失败**：`writeFileAtomic` 的 `open+write` 成功、`rename` 未完成 —— 目录里只剩
   `*.tmp` 和 `.lock`，`refs.json` / `last-capture.json` 不存在 → `writeBatch` 返回 false →
   **batch 不带 `refkeeper-batch:` 标记** → 客户端读不到批次，面板停在空态。
   宿主暴露的 `HostFsLike` 只有 `writeText(createIfAbsent)`，**没有 rename / rm**。
   验证：普通 node 进程在同一目录 rename 完全正常（`open+write/rename/unlink` 全 OK），
   所以是宿主沙箱内的差异，不是文件系统权限问题。
   **注意连锁伤害**：`.lock` 的释放同样依赖 rename/rm，锁残留会让下一次 capture 撞上
   `lock-timeout`，M1 要一并处理。
2. **DOI 抽取被回复文本污染**：模型回复里的 `[10 54–58 (2013) · 1038/nature12373](https://doi…)`
   会让抽取器把 DOI 读成 `10 54–58 (2013) · 1038/nature12373`，该条目最终 `status: failed`。
   要测出「已入表」条目，消息里得写成**带标题的完整引用**，别用裸 DOI。

## 其他

- 发布前必看 `docs/m4-gui-slot-verification.md`：里面有隔离 profile + CDP 驱动 GUI 实证的原始流程。
- 改动用户可见界面时，`docs/images/panel.png` 与 `panel-en.png` 需要重新截图（README 两处都在引用）。
