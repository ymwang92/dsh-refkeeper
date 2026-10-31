# M4 报告 · GUI 客户端（按钮 / 面板 / 命令结果 / 注解编辑 / i18n）

日期：2026-10-28 · 宿主版本：DSH 0.2.1-rc.3 · 结论：M4 交付完成，GUI 实机全链路通过

## 1. 交付物

| 文件 | 行数 | 内容 |
| --- | ---: | --- |
| `src/client.tsx` | 428 | 客户端半边：输入框左侧按钮、面板、手动注解表单、zh/en 文案、命令派发 |
| `src/ui/authors.ts` | 39 | 作者串解析（面板与测试共用；纯函数，无 React 依赖） |
| `src/store/io.ts` | +18 | `coerceReference` 接受扁平 `doi`/`arxivId`/`isbn`/`reportNumber` |
| `src/host/refs-command.ts` | +6 | capture 文案改为「candidates only」并指向 `/refs verify` |
| `test/ui-authors.test.ts` | 32 | 5 例（姓名对、裸姓、全名+CJK 分隔符、双缩写不并、空段） |
| `test/store.test.ts` | +40 | `describe('reference identity')` 3 例（扁平 DOI 生成 `doi:` 身份） |
| `dev/gui-eval.mjs`、`dev/gui-click-at.mjs` | — | CDP 实测工具（求值 / 真实鼠标点击） |

门禁：**17 文件 / 201 用例通过**，`tsc` 0 error，`lib/index.js` 139.26 kB（gzip ≈ 39 kB），client bundle **14,759 B**。

## 2. 关键决策

1. **客户端不注册 Remote 命名空间**。命名空间清单在宿主侧静态装配，第三方插件拿不到 `ctx.remote.refkeeper`；`CommandResult` 也只有 `{kind, text?}`。因此客户端不做数据面板，只负责「组装斜杠命令 + 交给输入机」，结果由转写渲染。
2. **派发用 `inputActions.setDraft` + `submit()`，中间隔 60ms**：同一 tick 提交会提交到旧草稿快照。
3. **面板放 `conversation.composer.dock`，不放 `conversation.input.overlay`**。overlay 实测压在草稿与发送按钮上（透明背景），dock 是 composer 下方的独立条带。代价：dock 是 363px 的居中 flex 条，面板按内容收缩到 286px，因此显式写 `width:340px` 才拿到可用行宽。
4. **作者输入用「姓, 名缩写」语法解析**，不做自由文本猜测：`Kucsko, G., Maurer, P.` → 两个作者，缩写挂到前一个姓的 `given`；单独成一个模块是为了能进 vitest（client bundle 只能靠 GUI 验证）。
5. **i18n 跟随 `document.documentElement.lang`**：`zh` 开头用中文表，否则英文；两套字段一一对应。

## 3. GUI 实机证据（隔离 profile `refkeeper-web`，3099；headless Edge 9333）

| 场景 | 观测 |
| --- | --- |
| 按钮挂载 | `button[aria-label="dsh-refkeeper capture"]`，59×28，文案 `❝ 引用`（zh） |
| 面板展开 | `section[aria-label="dsh-refkeeper panel"]`，340×666，范围单选 + 三按钮 + 折叠表单 |
| 捕获派发 | 真实点击「捕获」→ 转写出现 `capture — candidates only, nothing saved yet / scope: current turn / window: seq 4..19, 1 turn(s), read via sessionQuery` |
| 手动保存 | 填 DOI + 年份 + 作者 → `saved doi:10.1038/nature12373 → refs/refs.json`、`verification: verified 3/3`（Crossref + OpenAlex 真实网络） |
| 落盘内容 | `id: "doi:10.1038/nature12373"`、`authors: [{family:"Kucsko",given:"G."},{family:"Maurer",given:"P."}]`、`provenance.trigger: "button"`、`annotation.source: "user"` |
| ⚠ 分支 | 只填标题时 → `⚠ quarantined … 0/3 · ambiguous-record, timeout, source-error`，主表不变，`quarantine.json` 1 条 |
| 导出 | 面板「导出 BibTeX + RIS」→ `refs/exports/refs-20261028-2102.{bib,ris}`；BibTeX 含 `abstract`（注解 summary），RIS 含 `AB` + `N1`（relevance） |

截图：`.e2e-form.png`（面板与表单）、`.e2e-card.png`（插件页卡片）。

## 4. GUI 联调暴露的两个真实缺陷（已修）

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| `/refs save` 丢掉 DOI | `coerceReference` 只读嵌套 `identifiers.*`，而 usage 与面板传的是扁平字段；无标识符时去重键退化为 `title|year`，会合并同标题同年的不同论文 | `identifiers()` 同时接受两种形状，嵌套优先；3 例单测锁定 |
| 作者串拆成四个 literal | 面板把逗号分隔串整体当作者数组 | `parseAuthors` 按「姓 + 缩写」配对，5 例单测锁定 |

两者都只有 GUI 端到端才能发现——单测各自覆盖到 `coerceReference` 与 `parseAuthors` 之后才成为回归防线。

## 5. 未覆盖 / 限制

1. 面板固定 340px：dock 是 363px 条带，表单为单列紧凑布局（doi/year 两列），字段多时需要滚动。
2. 候选表仍在转写里：客户端拿不到结构化 payload（见决策 1），无法把候选渲染成可点击的卡片。
3. GUI 只在隔离 dev profile 验证：`refkeeper-web` 额外补了 `@deepseek-ai/dsh-commands` 等 bundle 才让斜杠命令可用；真实用户 profile 自带这些，但未在真实 profile 上复测。
4. 手动注解通过 `/refs save --json='…'` 传递，`quoteJson` 把 `'` 换成 `’` 规避分词；注解含该字符时会被改写。
5. `dev/smoke-verify.mts` 仍无断言、未进 `npm run` 门禁（沿用 M3 的已知项）。

## 6. 下一步（M5）

- 候选预览与勾选入表：需要宿主提供结构化通道（Remote 命名空间或工具结果面板），是 v0.2 的架构性改动。
- 中文期刊字段补全（`language` / `journalAbbreviation` / `ISSN` 的 UI 入口）。
- 发布准备：README / LICENSE / 版本号 / `npm pack` 校验 / GitHub 仓库。

## 7. 验收修复（2026-10-28 21:20）

针对验收提出的两项基础问题，改动如下（§5 第 4 条因此失效：`quoteJson` 已删除）。

| 问题 | 根因 | 修复 | 回归测试 |
| --- | --- | --- | --- |
| 字段被静默改写 | `quoteJson` 把 `JSON.stringify` 结果里的 ASCII `'` 换成 `’`，以躲开命令分词 | 改 base64url：`src/ui/payload.ts` 的 `payloadFlag()` 产出 `--payload=<b64url>`（字符集 `[A-Za-z0-9_-]`，无引号空白）；宿主 `src/host/store-command.ts` 加 `decodePayload()` 与 `--payload=` 分支，`--json` 保留为兼容路径 | `test/payload.test.ts` 6 例 |
| 锁回收竞态 | `stealStaleLock` 先 `stat` 比 inode 再 `rm(lockPath)`，窗口内可能删掉别人新建的活锁 | `rename(lockPath, claimPath)` 原子取走 → 比对 `LockIdentity {ino, content}`（inode 会复用）→ 匹配才删，否则 `link` 放回（`copyFile(COPYFILE_EXCL)` 兜底）；释放路径共用 `unlinkIfSame()` | `test/lock.test.ts` 4 例 + 释放期替换 1 例 |

修复过程中另修两处实现缺陷：`sleep()` 里 `timer.unref()` 会让「只剩等待定时器」的事件循环排空、唤醒丢失；同进程 5 路并发抢锁时抢锁方互搬对方锁会造成临界区重叠，改为 `withAcquireTurn()` 串行化取锁段，并在 `open(wx)` 成功后回查 `stat(lockPath).ino` 仍是自己。

### 复测证据（隔离 `refkeeper-web` @3099 + headless Edge 9333）

| 场景 | 落盘结果 |
| --- | --- |
| 标题 `Kucsko's "thermometry" — 中文’引号 test` + 真实 DOI | `refs/quarantine.json`：title 逐字一致、`id: doi:10.1038/nature12373`、reasons `['ambiguous-record']`（标题与 DOI 不符，分流正确） |
| 真实标题 + DOI + `Kucsko, G., Maurer, P.` + 含撇号的注解 | `refs/refs.json`：title 逐字、`authors: [{family:'Kucsko',given:'G.'},{family:'Maurer',given:'P.'}]`、`verified 3 ['crossref','openalex']`、`annotation.summary` = `It's a solid-state thermometer.`、`caveats` = `Quote ' inside` |
| 「文献库」按钮 | 转写显示 `refs/refs.json · 1 reference(s)` + `refs/quarantine.json · 1 entry` |
| 「导出 BibTeX + RIS」按钮 | `refs/exports/refs-20261028-2123.bib` / `.ris`，`abstract = {It's a solid-state thermometer.}`、`note = {Quote ' inside}` 保真 |
| 「全部对话」范围 | 转写显示 `scope: whole conversation`、`window: seq 0..43`、`read via sessionQuery` |

门禁：**18 文件 / 212 用例**、`tsc` 0 error、`lib/index.js` 137.92 kB（gzip 40.27 kB）、client bundle 15,038 B。

## 8. 实机验收二次修复（2026-10-28 18:10）

用户在 desktop profile 重启后复测：黑框已去、面板已浮在右侧，但捕获仍失败。转写里出现两类宿主错误：

| 错误 | 根因 | 修复 |
|---|---|---|
| `session "…" has no event at seq 51` | 锚点 seq 取自 `max(日志末条, turn 起点, session.seq)`，而 `session.seq` 常领先于已持久化的日志 | 锚点只取持久化日志末条；投影 turn 起点先按 `<= lastSeq` 过滤 |
| `before must be an integer between 0 and 50` | `readEvent` 单次窗口上限 50（`SESSION_QUERY_READ_WINDOW_MAX`），宽 scope 直接超限 | `before = min(inWindow-1, 49)`，被截断时 `truncated: true` |

根因不止于两处参数：**长会话的持久化日志会分段**，`listEvents` 只覆盖最近一段，靠它做文本源必然读不到早期轮次。因此把文本来源改为「活的 surface」优先：

- 新增 `surfaceSegments(session, startSeq)`：遍历 `session.surface.nodes` 取 `eventAt(seq)`，只收 `user/message`、`assistant/message`、`tool/result` 的文本块；`eventAt` 不存在时返回空（能力探测，不抛错）。
- `readTranscript` 顺序：`sessionQuery` 求 turn 边界与窗口 → 若有 surface 文本则 `readMode: 'session-surface'`，否则走 `readEvent`（`readMode: 'sessionQuery'`）。
- 日志读取包进 `readViaLog()`：宿主报错时降级到 surface；**没有 surface 时重新抛出**，避免把「读失败」伪装成「没找到」。
- `ref_capture` 允许「只给 scope 不给文献字段」的纯窗口查询；无身份时不生成空候选（此前会多一条 `key: ""` 的幽灵行）。

真实宿主 E2E（DSH 0.2.1-rc.3、headless `refkeeper-dev`、mock 调 `ref_capture`）：

| 输入 | 结果 |
|---|---|
| `{"scope":"all"}` | `accepted: true · scope: whole conversation · read: session-surface`，命中 `10.1175/1520-0442(2004)017<2335:aspdsi>2.0.co;2` |
| `{"scope":"lastN","turns":3}` | `scope: last 3 turn(s) · read: session-surface`，同样命中该 DOI，`evidence: [8]` |

门禁：18 文件 / **221 用例**、`tsc` 0 error、`lib/index.js` 141.75 kB（gzip 41.23 kB）、`lib/client.js` 15,159 B。
日志路径改为分页回读：`readEvent` 单次上限 50，改为从最新锚点向前最多翻 `MAX_READ_PAGES = 4` 页（≤200 事件），按 seq 去重；实际读到的事件少于窗口所需时标 `truncated: true`。

未覆盖：desktop 实机需用户重启后确认；surface 不可用时最多回读 200 条事件，超过部分仍会截断。

## 九、捕获质量与「捕获并保存」（2026-10-28 18:4x，响应实机反馈）

实机反馈：同一会话里三次候选全是 `(title unknown)`、同一篇文献拆成 1 个 DOI 变体 + 1 个 URL 变体，点文献库为空、导出为空；用户问「操作顺序对不对」。

四处修正：

| 问题 | 根因 | 修复 |
|---|---|---|
| 候选没有标题/作者/年份 | 引文串在气泡里换行，`^…$` 解析器对跨行文本全失效 | `extractCitations` 同时尝试「本行 + 下一行」拼接（上一行无句末标点、或下一行以 URL/数字/小写词开头时拼接） |
| 同一标题解析两次、丢掉带 DOI 的那份 | 去重按 `style:title` 保留先到者 | 同标题保留字段更全的一份（`scoreHit`：DOI 4 分、页码 2 分、卷期作者各 1 分） |
| 引文 DOI 被截断、与标识符通道不一致 | `citations.ts` 的 `DOI_IN_TEXT` 少了 `<>` | 与 `identifiers.ts` 对齐；APA 页码补 `, 2335–2351` 形态 |
| 作者首位带引导语（`Please cite: Wells, N.`） | APA 作者块直接取 `(yyyy)` 之前全部文本 | `trimLeadIn` 在最后一个冒号处切掉引导语 |

另有交互缺口：捕获只产出候选，没有任何入口把它们存进库，用户只能手填表单。新增 `/refs capture --save`：

- 有标题的候选 → 逐个走 `saveFromPayload`（先校验，`verified` 入主表、其余入 `refs/quarantine.json`）；
- 无标题候选计为 `skipped`，不猜、不入库；
- 输出追加一行 `saved: N · quarantine: M · skipped (no title): K · failed: F`；
- 面板新增「捕获并保存」按钮。

门禁：**227 用例**（新增 6）、`tsc` 0 error、`lib/index.js` 146.09 kB（gzip 42.61）、client 15,536 B。真实宿主 E2E（headless + mock）对跨行引文返回单条完整候选：title、year 2004、container `Journal of Climate`、17(12)、pages、DOI。

未覆盖：`--save` 的 GUI 点击链路只经单测（命令与面板按钮），未在实机点第三次；未测「同一轮里两篇不同文献标题相同」的合并边界。
