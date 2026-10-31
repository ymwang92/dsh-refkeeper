# M1 · 摄取与抽取（报告）

日期：2026-10-28 · 插件：`dsh-refkeeper` · 宿主验证：DSH 0.2.1-rc.2（桌面 app 内 CLI + 隔离 dev profile headless）

本轮目标（对齐 `refkeeper-plugin-plan.md` §里程碑表）：**scope 解析 → 三遍抽取 → 去重 → 候选结构**，产出是 `/refs capture --dry-run` 的候选预览。存储（`refs.json`/原子写/schema 迁移/BibTeX）属 M3，四源校验属 M2，本轮**不落盘**。

## 1. 交付内容

| 文件 | 作用 |
|---|---|
| `src/core/text.ts` | `foldText`（NFKC+小写+空白折叠）、`titleKey`、`titleTokens`、`jaccard`、`diceBigrams`（CJK 二元组）、`clip` |
| `src/core/identifiers.ts` | DOI / arXiv / ISBN / 报告号与标准号 / URL 抽取；`STRONG_HOSTS` 白名单按后缀匹配；doi.org、arxiv.org URL 先降级成标识符；置信度 doi 0.95 · arxiv 0.92 · isbn 0.85 · report 0.45 · 强域名 URL 0.7 · 弱 URL 0.3 |
| `src/core/citations.ts` | GB/T 7714、APA、IEEE 三种引用串逐行解析为结构化字段；缺年份或缺标题直接丢弃 |
| `src/core/candidates.ts` | `Candidate` 结构、`dedupeKey`（doi → arxiv → isbn → report → `title:titleKey|year` → url）、`mergeCandidates`（空位补、origin 高者覆盖）、`rankCandidates`、`extractCandidates` |
| `src/core/scope.ts` | `CaptureScope`（turn / lastN / all）、`parseScope`、`resolveScope`；退化路径 `no-turn-boundaries`、`n-exceeds-total` |
| `src/host/session-read.ts` | 会话日志读取：优先 `sessionQuery`，无 seam 时返回 `readMode: 'none'`，只有显式 `allowLegacyRead` 才走已 deprecated 的 `surface`+`eventAt` |
| `src/host/refs-command.ts` | `/refs` 的纯函数实现：`parseRefsCommand`、`collectCapture`、`renderCapture`、`runRefsCommand` |
| `src/index.ts` | 薄接线：注册 `ref_ping`、`ref_capture`、`/refs`；捕获 `sessionQuery` seam |
| `test/*.test.ts` | 6 个测试文件、59 个用例 |

## 2. 关键决策

**① 放弃自注册投影单元，改用 `ctx.sessionQuery`。** `ProjectionDefinition` 要求 `key` 落在 `SessionProjectionStateMap`（自定义 key 要 module augmentation）+ `stateSchema` 必须是 Zod 类型，等于给插件引入 zod 运行时依赖；而 `sessionQuery` 是非 deprecated 的异步读日志 seam，`listEvents` 给 turn 边界、`readEvent` 给带文本的窗口，够 M1 用。代价：一次捕获要两跳（list → read），换来零额外依赖与更宽的版本兼容面（与 `peerDependencies: *` 的漂移策略一致）。

**② 读取失败必须显式，不能装成"没找到"。** 没有 seam 时 `readMode: 'none'` 并在文案里写明原因，绝不返回空候选让人误以为"这轮没有文献"。同理 scope 无 turn 边界时退化到全对话并标 `degraded`。

**③ 抽取宁漏不错。** 引用串缺标题或年份就丢弃；裸弱 URL 不单独建候选（避免把网页链接堆成参考文献）；只有强域名 URL（doi.org、arxiv.org、nature.com、cnki.net 等）才独立成条。行内标识符只挂到同一行的引用串上。

**④ 模型字段优先。** `ref_capture` 的模型参数与正则结果按 `dedupeKey` 合并，origin 高者（model 3 > citation 2 > identifier 1）覆盖已有字段；作者列表是**整体替换**而不是拼接——把正则切出来的 `Zhang`、`S.` 拼进模型给的作者列表会毁掉下游"首作者匹配"。

**⑤ 命令逻辑抽成纯函数。** `/refs` 的 handler 只做 `runRefsCommand(rawInput, session, {query, sdkVersion})` 的转调。原因见下节：headless 宿主不派发斜杠命令，命令路径只能靠纯函数单测覆盖。

## 3. 验证证据

**门禁（全绿）**

```
npx vitest run                      # 6 files · 59 tests passed
npm run typecheck                   # tsc --noEmit · 0 error
npm run build                       # host 44.90 kB + d.ts 3.01 kB + client 2997 B
node --check lib/client.js          # OK
node -e "import('./lib/index.js')"  # PACKAGE_NAME / SERVICE_KEY / default / refPingTool / refCaptureTool
```

**真实宿主端到端（隔离 dev profile · headless · mock Messages API）**

单条含 DOI 的中文笔记：

```
[refkeeper] mounted dsh-refkeeper (sdk 0.2.1-rc.2)
accepted: true · scope: whole conversation · read: sessionQuery
candidates: 1
[{"key":"doi:10.1038/s41586-024-00001-x","origins":["citation","model"],"title":"Attention Is All You Need",
  "authors":["Vaswani, A."],"year":2017,"container":"计算机学报","volume":"47","issue":"3","pages":"1-15",
  "confidence":0.9,"evidence":[1,8]}]
```

两行不同语种引用（GB/T 7714 + IEEE）：

```
candidates: 3
1) title:attentionisallyouneed|2017  [journalArticle] Attention is all you need / A. Vaswani (2017) / NeurIPS 30(2) 5998-6008
2) title:深度学习综述|2024           [journalArticle] 深度学习综述 / 张三 (2024) / 计算机学报 47(3) 1-15
3) doi:10.1038/s41586-024-00001-x   [journalArticle] （模型参数条）
```

说明：抽取、按行切分、中文与英文引用各自成条、同轮合并（`evidence: [1,8]`）都在真实宿主上跑通。

## 4. 未覆盖 / 已知限制

1. **斜杠命令的真实派发未实证。** headless CLI 把 `/refs status` 当普通 prompt 发给模型（指向已关闭端口时直接 `TRANSPORT` 失败，证明没有本地派发）。`commands.execute` 由 UI 客户端调用，因此 `/refs` 的注册与派发只能在 GUI 实机验证。本轮把命令逻辑抽成 `runRefsCommand` 并用 8 个用例覆盖（status / capture / 未知子命令 / 非法 scope / 空结果文案），**剩余风险仅是"注册那 10 行"**。
2. **跨来源同书异键未合并。** 模型给的 DOI 条与正则给的 IEEE 条 key 不同（`doi:…` vs `title:…`），M1 不去猜它们是同一篇。这是 M2 校验阶段的工作（用 DOI/title 反查统一到权威记录）。
3. **行内标识符可能过度挂靠。** 若用户把两篇文献写在同一行，该行的 DOI 会挂到同行引用串上。按行切分是刻意的保守选择，M2 可用标题比对纠正。
4. **未接 GUI。** `src/client.tsx` 仍是 Refs 占位按钮，输入框插槽仍未实机确认（延至 M4 前）。

## 5. 下一步（M2 预备）

- 四源校验：Crossref / OpenAlex / arXiv / DataCite 并发查询 + 缓存，三条件（标题强重合、年份 ±1、首作者匹配）全过且至少一源命中才进主表。
- 校验前的候选统一：`doi:` 与 `title:` 双键互查，避免同书两条。
- 网络层要可注入（测试不打真实 API），超时与限流要有明确降级文案。

## 6. 验收缺陷修复记录（2026-10-28 12:05）

针对 M1 验收审查提出的两项数据正确性缺陷（直接影响 M2 真实数据源查询），已修复并补测：

| 缺陷 | 根因 | 修复 |
|---|---|---|
| 引文 DOI 保留尾句点（`10.1000/x.`） | `citations.ts` 的 `normalizeDoiIn` 只做 `toLowerCase()`，没走标识符通路的 `trimTrailing` | 改为 `import { normalizeDoi }` 后直接复用，APA / IEEE / GB/T 三类引文行统一收口到同一归一化 |
| 紧凑 ISBN-13 `9780306406157` 漏检 | 旧正则 `97[89][\d\-\s]{10,20}[\dXx]` 要求 978 之后再跟 10–20 位**再接**一位校验位，13 位紧凑串只给出 9 位余量 | 改为 `97[89][\d\-\s]{8,16}[\dXx]`，并新增 `isValidIsbn13` 校验位验证 |

同时补上带标签的 ISBN-10：`ISBN 0-306-40615-2`、`ISBN 0306406152` 均能识别；**裸 10 位数字不认**（形状上任何 10 位数字都成立，校验位只拒绝 1/11，噪声太大）。

校验位策略是「宁漏勿错」：ISBN-13 用 1/3 交替权重（`sum % 10 === 0`），ISBN-10 用 10..1 权重、`X` 记 10（`sum % 11 === 0`）；校验失败即丢弃，`9780306406158`（末位错一位）不再进候选。

### 验证

```
npx vitest run                      # 7 files / 69 tests passed（原 59，新增 10）
npx tsc -p tsconfig.json --noEmit    # 0 error
npm run build                        # host 46.26 kB · d.ts 3.01 kB · client 2997 B
```

新增用例覆盖：紧凑 ISBN-13、分组 ISBN-13、错校验位拒绝、带标签 ISBN-10（紧凑/分组）、裸 10 位拒绝、APA 行尾 DOI 句点、IEEE doi.org 链接句点，以及 `test/pipeline.test.ts` 里跑完整「标识符 → 引文 → 候选」链路的两个真实语料用例。

### 本轮未闭合

1. **live-host E2E 未复现成功。** 用 `dev/mock-messages-server.mjs` 对 headless 宿主重跑时，工具收到的参数为空（`scope: none`），说明工具参数在流式装配环节丢失。已修 mock 的一处问题（`content_block_start` 同时给完整 `input` 又发 `input_json_delta` 会让客户端看到两份 JSON），修后仍为空，判定为宿主侧装配细节，**未继续深挖**（与本轮修复无关）。修复证据因此来自探针、单测与纯函数全链路测试，不是真实宿主。
2. 审查清单里的其余缺陷尚未修：`--turns` 宽松解析（`1.5` / `2oops` 被 `parseInt` 接受）、空白标题产生空 key、工具结果未限定只抽 URL/DOI、APA 作者切分、模型 `evidence` seq 未校验。建议 M2 接真实数据源前一次性收口。

## 7. M1 剩余项收口与 host E2E 复核（2026-10-28 12:18）

验收审查列出的其余五项本轮全部收口，并首次以**显式非空 `MOCK_ARGS`** 复核 host E2E。

| # | 审查发现 | 修复 | 位置 |
|---|---|---|---|
| 1 | `--turns` 宽松解析（`1.5`/`2oops` 被 `parseInt` 接受） | 改为严格整数校验 `/^[0-9]+$/u`，非法值返回 `Number.NaN`，由调用方回落到默认 5 并提示 | `src/core/scope.ts` |
| 2 | 空白标题产生空 key | `dedupeKey` 在 `titleKey` 为空时返回 `''`，候选被丢弃而不是生成 `title:|2024` | `src/core/candidates.ts` |
| 3 | 工具结果应只抽 URL/DOI，却读全量文本且丢 role | `SourcedText` 增 `role`；`tool` 角色的文本走 `narrowToolText`，只保留 DOI/arXiv/强域名 URL（弱 URL 丢弃） | `src/core/candidates.ts`、`src/host/refs-command.ts` |
| 4 | APA `Zhang, S., & Li, W.` 被切成四段 | `splitAuthors` 增加首字母片段判定 `/^(?:[A-Z]\.\s*-?\s*)+$/u`，把 `S.` 并回前一段姓氏；`&` 作分隔 | `src/core/citations.ts` |
| 5 | 模型传入的 `evidence` seq 未校验 | `sanitizeEvidence(evidence, allowedSeqs)` 剔除越界/负数/非整数 seq，只保留本轮实际读到的位置 | `src/host/refs-command.ts`、`src/index.ts` |

测试从 69 → **76**（新增 `scope`、`candidates`、`citations`、`refs-command` 共 7 例覆盖上述五项），`typecheck` 0 error，`build` 输出 host 48.73 kB / d.ts 3.01 kB / client 2997 B。

### host E2E 复核（推翻上一轮的"宿主流式装配"假设）

上一轮把空工具参数归因为"宿主侧流式装配"，本轮证伪：**问题在 mock 与运行环境，不在宿主**。

| 条件 | 结果 |
|---|---|
| `MOCK_ARGS_MODE=start`（完整 `input` 放在 `content_block_start`，不发 delta） | ✅ 工具收到参数：`accepted: true`、`scope: whole conversation`、1 条候选含 `doi=10.1000/mock-e2e` |
| `MOCK_ARGS_MODE=delta`（`input: {}` + `input_json_delta`） | ✅ 同样收到：`key: doi:10.1000/delta`、`title: Delta Mode Paper`、`year: 2024` |

两种流式形态都能到达工具，说明宿主对两种装配都支持。上一轮失败的合理解释是当时 `MOCK_ARGS` 未在 mock 进程的启动环境里生效（先启动、后设变量），叠加当时 mock 的重复 `input` 缺陷，属于测试装置问题。

复核命令（`dsh` 需绝对路径，macOS 无 `timeout`）：

```bash
MOCK_PORT=3999 MOCK_TOOL=ref_capture MOCK_ARGS_MODE=delta \
MOCK_ARGS='{"title":"Delta Mode Paper","year":2024,"doi":"10.1000/delta","scope":"all"}' \
node dev/mock-messages-server.mjs &

HOME="$PWD/.dsh-dev" DSH_HOME="$PWD/.dsh-dev/.dsh" \
DEEPSEEK_API_KEY=mock DEEPSEEK_BASE_URL=http://127.0.0.1:3999 \
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile refkeeper-dev "记录这篇论文。"
```

**结论：M1 的 host 侧 E2E 现在有可复现证据，不再是"报告称通过"。** 仍然没有 GUI 输入框卡片的实测（M0 遗留），那部分按原计划延到 M4 前。
