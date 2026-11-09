# dsh-refkeeper — 代理工作说明

本文件是给任何在本仓库干活的代理（人或模型）看的入口。**只写不能违反的规则与当前待办。**
每轮验收的详细记录在 [`docs/verification-log.md`](docs/verification-log.md)（历史附件，不是工作说明）。

## 工程纪律

这几条不是客套话，**每一条都对应本项目已经踩过的坑**。

1. **先查根因，再改代码。** M1 的 `rename` EPERM 花了五轮才定位，实际只要在宿主进程里加一行
   `console.error` 读 errno 就能拿到。**先复现、先拿到错误原文，再动手。**
2. **区分源码缺陷与工具/部署故障。** 本机 DSH 的 macOS `sandbox-exec` 根本不可用
   （见「已知宿主侧问题」第 1 条）—— 那是环境问题，不是插件问题。不要为了绕过环境去改产品代码。
3. **复用已验证的组件与既有流程。** M1 自己重写了一套原子写，而 DSH 已发布同语义的
   `@deepseek-ai/dsh-atomic-write`（在 `app.asar` 里，可读）。动手前先搜一遍宿主有没有现成实现。
4. **避免投机性的抽象、配置与 fallback 系统。** 降级路径应该是「主路径失败时才走」，
   而不是「无条件走降级」—— 后者让所有机器都为只有个别环境才存在的问题付代价。
5. **外科手术式改动。** 每批的授权文件清单写死在下面，越界就停下来报告，不要自行扩大范围。
6. **给观察到的失败加针对性回归测试。** 客户端逻辑目前零测试覆盖（见「当前待修」P4），
   这是 P1/P2 两个缺陷漏网的直接原因。
7. **保留无关的未提交文件与 Git 历史。** 本仓库里 `dev/gui-fill.*` 曾被误删。
   不碰不在任务范围内的文件，不 amend 已有提交。
8. **未经明确授权不得改动生产安全控制。** DSH 的「文件权限」设置是安全控制；
   临时提权（例如切 `danger-full-access`）必须先问用户。
9. **明确成功判据，验证后即停。** 「M1 完成」被连续声称过，实测仍有 15 个测试挂。
   **不要在判据未达成时宣布完成。**
10. **初次方案失败时重新评估假设，而不是不断叠加 workaround。** 隔离 HOME 的位置试过三个；
    每次失败都要问「我原来的假设错在哪」。
11. **交接的每个数字都必须可复现。** 自报过的「351 全过」「基准 0.307ms」都不可复现；
    贴命令 + 贴原始输出，不要只贴结论。

## 当前任务：捕获面板 UI 改版

**不要重新设计方案。** 已批准的实施稿在 [`docs/ui-polish-plan.md`](docs/ui-polish-plan.md)，
视觉对照在 [`docs/ui-mockup.html`](docs/ui-mockup.html)（浏览器直接打开，左图 B2 目标 / 右图 B3 目标）。
**先完整读它们，再动手。**

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
npx vitest run --maxWorkers=1                      # 确定性全量门禁，全过
npm run build && node --check lib/client.js        # 通过
grep -c "jsx-runtime" lib/client.js                # → 0
grep -c "choose"     lib/client.js                 # → 0
```

**Vitest 全量门禁口径**：统一用 `npx vitest run --maxWorkers=1` 做确定性验收。默认并行运行是
负载敏感的性能观察：并发压力用例在机器满载时可能超过 5 秒测试线，**不能据此判定功能失败，
也不要为压掉这些负载超时去调测试 timeout**；性能结果单独记录。

外加实施稿 §6.2 的 GUI 实证（V1–V12），截图留档。

## 当前阶段：**0.1.3 已发布（2026-11-08）**

| 产物 | 状态 |
|---|---|
| GitHub main | `9ba159d` 已推送 ✓ |
| GitHub Release | `v0.1.3`（tag 指向 `9ba159d`），附件 `dsh-refkeeper-0.1.3.tgz` ✓ |
| npm | `dsh-refkeeper@0.1.3`，`latest` tag ✓，已从 registry 装进 desktop profile 验证 ✓ |
| README | 中英双份，npm 页面渲染 tarball 里的 `README.md`（无需手动同步）✓ |

**发布要点（下次复用）**：
- `.tgz` = `npm pack` 的产物，用 `gh release create v0.1.3 --notes-file docs/release-notes-0.1.3.md dsh-refkeeper-0.1.3.tgz` 传上去；
  **`.zip` 不用管** —— GitHub 每个 release 自动提供 "Source code (zip)"。
- **`package.json` 的 `files` 是显式列表** —— 新增图片必须同时加进 `files` 和 `screenshots.json`，
  否则 npm 包里的 README 会 404，宿主市场也展示不出来。
- **`npm publish` 需要 2FA 的一次性密码**（`--otp=<code>`）。本机账号的 `tfa.mode` 是
  `auth-and-writes`，验证码来自用户的验证器 App；让用户在自己终端跑，别把码带进对话。
- `npm pack` **不是确定性的** —— 同样的内容两次打包 shasum 不同（文件大小逐个一致即可）。
- 发布顺序：**先 commit → 再 pack → 再 push → 最后 release**（未跟踪的新文件不进 tarball）。
- 剩下的可选项：注册表条目在另一个仓库（`awesome-dsh-plugin/awesome-dsh-plugin` 的
  `data/plugins/ymwang92__dsh-refkeeper.yml`），文档说「a resubmission later is fine」。

## 历史阶段：B3 已过 → 修 P1–P4 → M2 终验（均已完成）

| 批次 | 内容 | 授权边界 |
|---|---|---|
| M1 | 修 `refs/` 落盘失败（宿主沙箱下 rename/unlink 不可用） | 已收口。**唯一破例触碰 `src/store/` 的批次** |
| B3 | 详情视图独立化 + 三组分组 + 类型下拉 | 已收口。只动 `src/client.tsx`、`src/ui/` |
| **P1–P4** | B3 验收暴露的四个缺陷（见下） | 只动 `src/client.tsx`、`src/ui/`（可新增模块）、`test/` |
| M2 | V1–V12 终验，含 V9/V10/V11 | **不改产品代码**，只产出验收记录与截图 |

**M2 的判定纪律**：没验到的断言写「**未测**」，不许写成「通过」。

### 当前待修（P1–P4，全部在客户端边界内）

| # | 缺陷 | 修法要点 |
|---|---|---|
| **P1** | `status:'saved'` 的条目仍带 `reason:'quarantined'`（实测 `last-capture.json.v2`）→ 徽章「已入表」与副行「· quarantined」自相矛盾 | `entry.status === 'saved'` 时不渲染 reason。**不要改宿主侧 batch 写入** |
| **P2** | `parseManualSaveResult` 只匹配 `saved\|updated`，但宿主 `store-command.ts:1357` 输出 `edited <id> → refs/…`；且只匹配 `refs.json` 不匹配 `quarantine.json` → **「保存修改」的结果解析不出来** | 正则补 `edited` 与 quarantine 路径 |
| **P3** | `commandSnapshotOf` 每次调用都全量遍历事件流 + `JSON.stringify`，`useSyncExternalStore` 每次通知都调 → **O(N²)** | ref 缓存：仅当 `revision`/`size` 变化时重算 |
| **P4** | 客户端逻辑**零测试覆盖**（354 个测试全在 core/store/host 层）→ P1/P2 正是这个缺口漏掉的 | 把纯逻辑抽到可测模块并补单测 |

### 待验收（M2）

**V1–V8、V12 已在 B3 build 上实测通过**（见下表）。**V9 / V10 / V11 尚未测**：
命令字面量、多作者解析、手动入表走 `/refs save`。

### 一个待决策项（不在本批范围）

M1 把「不可变版本快照 + 校验日志」做成了 refs 数据**唯一**的写路径。按工程纪律第 4 条，
更合适的形态是「标准原子写（tmp + rename）优先，失败才降级」—— 否则正常机器上也要为
只有个别环境才存在的问题付 1.6 倍写延迟与额外复杂度。
**这个决定需要用户拍板，不要自行改动已收口的 M1。**

## GUI 实证（2026-11-08 实测跑通的版本）

```bash
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
REPO="/Users/ymwang/Documents/deepseek-harness/default-workspace/dsh-refkeeper"
VH="$REPO/.dsh-verify"          # 隔离 HOME 必须在仓库内，见「已知宿主侧问题」第 4 条
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

# 1) 隔离 HOME + 凭据（缺 DeepSeek 凭据就没有模型 → 输入框禁用 → 面板不出现）
mkdir -p "$VH/.dsh"
cp ~/.dsh/.credentials.yaml "$VH/.dsh/.credentials.yaml" && chmod 600 "$VH/.dsh/.credentials.yaml"

# 2) profile 必须从出厂 web 模板派生，否则缺 @deepseek-ai/dsh-web-app，不会起 HTTP 服务
DSH_HOME="$VH/.dsh" "$CLI" refkeeper-web --from-default-profile web
DSH_HOME="$VH/.dsh" "$CLI" plugin --profile refkeeper-web add "$REPO"

# 3) 启动前用【独立一条命令】删残留锁 —— 复合命令里的 rm 会被沙箱拦
rm -f "$VH/.dsh/.credentials.yaml.lock"

# 4) 起 web（--no-open 免得弹浏览器；日志里拿 token）
cd "$REPO" && DSH_HOME="$VH/.dsh" "$CLI" --profile refkeeper-web --port 3099 --no-open
#   → dsh web: http://127.0.0.1:3099/?token=XXXX

# 5) 起 headless Edge —— --no-sandbox 必须加，否则 Chromium 自己的沙箱起不来：
#    SIGTRAP: sandbox initialization failed: Operation not permitted
pkill -f "remote-debugging-port=9333"; rm -rf /tmp/dsh-edge
"$EDGE" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9333 \
  --user-data-dir=/tmp/dsh-edge --no-first-run --no-default-browser-check \
  "http://127.0.0.1:3099/?token=XXXX" &

# 6) 驱动
node dev/gui-probe.mjs 9333 .e2e-panel.png     # 截图
node dev/gui-eval.mjs 9333 "$(cat /tmp/expr.js)"   # 读 DOM（表达式放文件，避免 shell 吃掉引号）
```

### 四个必须手动做的前置动作

| 动作 | 为什么 |
|---|---|
| **删掉 `$DSH_HOME/.credentials.yaml.lock`**（独立一条命令） | 锁残留 → `connection` 插件 `unlink` 撞 EPERM → 启动失败，连带 7 个插件不激活 |
| **选一个模型**（`DeepSeek-V4.1-Flash` / `DeepSeek-V4-Pro`） | 没选 → 发送按钮禁用 → 面板不出现。日志里出现 `model listing ... loaded 2 model(s)` 即凭据已生效 |
| **先发一条消息建会话** | `conversation.composer.dock` 插槽**只在真实会话里挂载**；欢迎页 hero 上只有 `conversation.input.left`，所以按钮在、面板不在。点一下捕获按钮也会触发挂载 |
| **从斜杠命令补全菜单里选中 `refs`** | 面板的 `inputActions.setDraft` + `submit()` 在 web composer 里**不生效**（命令根本没进会话）；手动输入 `/refs` 会弹出「指令 → refs」菜单，选中后再补参数回车即可执行 |

### B3 build 实测结果（2026-11-08，宿主 GUI）

> P1–P4 修复后的 build 于 2026-11-08 16:20–17:00 复验，下表为**当前有效**的结果。
> 批次含 3 条：`10.1126/science.1259855`（saved/verified，19 位作者）、`10.18653/v1/N19-1423`
> （saved/verified，4 位作者）、`10.48550/arXiv.1706.03762`（quarantined）。

| # | 断言 | 实测 | |
|---|---|---|---|
| V1 | 面板宽度 | `420` | ✅ |
| V2 | `details`/`summary` 元素数 | `0` | ✅ |
| V3 | 徽章 | 「已入表」`rgb(34,197,94)`；「⚠ 隔离」`rgb(245,158,11)`；底色均为 14% color-mix | ✅ |
| V4 | 标题截断 | `text-overflow: ellipsis` + `nowrap` | ✅ |
| V5 | 详情类型下拉 | `<select>`，`journalArticle`，7 个选项 = `REF_TYPES` | ✅ |
| V6 | 详情三组分组 | 标识信息 / 书目信息 / 出版信息 | ✅ |
| V7 | 副行 | saved 条目：`Steffen, Will et al. · 2015 · Science`（**无 reason**，P1 生效）；quarantined 条目：`Vaswani, A. et al. · 2017 · 48550/arXiv · quarantined`（**有 reason**） | ✅ |
| V9 | 命令字面量 | `/refs capture --scope=all`（client.tsx:883-885）、`/refs save --payload=<base64url>`（:862）、`/refs export …`（:898）—— **一字未改**（静态验证） | ✅ |
| V10 | 多作者解析 | `Steffen, Will et al.`（19 位）、`Devlin, J. et al.`（4 位）、`Vaswani, A. et al.`（3 位）—— 均正确折叠为「第一作者 et al.」 | ✅ |
| V12 | 面板内「选择文件夹」字样 | 无 | ✅ |
| V11 | 手动入表走 `/refs save` | skipped 条目（`title` 空 + 查不到的 DOI）→ 面板出「手动入表」→ 独立创建视图（14 字段三组）→ 填表后「保存并入表」未禁用 → 宿主回 `already in the library doi:10.48550/arxiv.1706.03762;` → 面板显示「该文献已在文献库中。」 | ✅ |

**★ 制造 skipped 条目的正确写法（供以后复现）★**
`extractCandidates` 对带 `doi:` / `arXiv:` 前缀的文本会把前缀当标题
（`doi:10` / `arXiv:2601` / `https://doi`），那样的条目会走 **quarantined** 而不是 skipped。
**要 skipped 必须让标题真的为空**：去掉前缀即可 ——

```
Foo, B., and Bar, C. (2020). 10.9999/this-doi-does-not-exist-xyz123
  → title="" | doi="10.9999/this-doi-does-not-exist-xyz123" | year=undefined | authors=[]
```

核验查不到这个 DOI → 标题仍空 → `capture-save.ts:119` 判 `skipped` ✓
（另注：裸 DOI 会被当成「存在性检查」，核验会用 registry 记录补全字段 —— 所以
`doi:10.1126/science.1259855` 那样只写标识符也能入表，不会 skipped。）

### 面板定位偏差（Portal 修复已实现；桌面 GUI 验收待用户）

根因：祖先链上的 `transform` 等属性会改变 `position: fixed` 的包含块。用户在 748×425 的注入实测中，L5/L8 使探针由 `(304,84)` 偏到 `(297,198)`；portal 到 `body` 后保持 `(304,84)`。
修复：`CapturePanel` 将原面板 section 渲染到 `document.body`；宿主 slot、420px 样式与交互未改。
状态：静态门禁通过，Client Slot 仍 active；实际 Web DOM/交互未测，Electron 桌面位置待用户验收。完整测量与验证记录见 [`docs/verification-log.md`](docs/verification-log.md)。


### 截图现状

`docs/images/panel.png` 与 `docs/images/composer.png` 已按当前 build 重截（2026-11-08）。
**`panel-en.png` 与 `composer-en.png` 仍是旧图** —— 英文版需要把宿主 locale 切成英文后重截
（`src/ui/strings.ts` 的 `stringsFor(tag)` 由宿主 `ctx.get('locale')` 决定，宿主默认跟随系统中文；
本机 web UI 里没找到语言切换入口）。


### 已知宿主侧问题（不是本项目引入）

1. **本机 DSH 沙箱后端不可用** —— DSH 报
   `sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host …
   Runner failure: sandbox-exec: sandbox_apply: Operation not permitted`。
   macOS 的 `sandbox-exec` 在这台机器上起不来。**这一条解释了本项目历史上所有怪象**：
   `rename`/`unlink` 返回 EPERM、`connection` 插件启动失败、模型的 bash 工具全挂。
   **⇒ 本机只能验 slash command 路径**（插件自己执行，不经模型工具）；
   全链路验证需要把 DSH 的「文件权限」切到 `danger-full-access`（UI 级设置，profile patch 里没有）——
   **那是宿主环境问题，不要为了它改产品代码，也不要擅自改用户的权限设置。**
2. **`refs/` 落盘**：宿主沙箱允许创建/覆盖/追加写，但 `rename` 与 `unlink` 返回 `EPERM`。
   M1 已用「不可变版本快照 + SHA-256 校验日志」绕开，细节见 [`docs/store-fallback.md`](docs/store-fallback.md)。
3. **DOI 抽取被回复文本污染**：模型回复里的 `[10 54–58 (2013) · 1038/nature12373](https://doi…)`
   会让抽取器读出错误 DOI。要测出「已入表」条目，消息里得写成**带标题的完整引用**，别用裸 DOI。
   `10.1029/2005WR006155` 是**死 DOI**，别拿它当测试样本。
4. **隔离 HOME 必须在仓库内**（`dsh-refkeeper/.dsh-verify/.dsh`，已 gitignore）：
   放在 `default-workspace/` 或 `$HOME/` 下时，`connection` 插件仍会撞 unlink EPERM。
   真实 `~/.dsh/` 里没有残留锁，所以桌面应用一直正常。

## 易踩的坑

实施稿 §7 列了 7 条，其中最容易出错的两条：

- `parseAuthors` 的分隔符**不含换行**，必须**逐行**调用后展平（实施稿 §3.5）。
- batch 是**持久化快照**，手动入表后列表不会自动刷新，要客户端就地更新行状态（实施稿 §3.4）。

## 其他

- 历史验收记录（含 M1 各轮结论与 P1–P4 的完整证据）：[`docs/verification-log.md`](docs/verification-log.md)。
- 发布前必看 `docs/m4-gui-slot-verification.md`：里面有隔离 profile + CDP 驱动 GUI 实证的原始流程。
- 改动用户可见界面时，`docs/images/panel.png` 与 `panel-en.png` 需要重新截图（README 两处都在引用）。
