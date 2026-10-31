# M2 交付：四源校验（2026-10-28 13:05）

M2 完成。四条权威源接通、三条件判定接进宿主、真实网络与真实 host 双路径均有证据。
存储（refs.json / 原子写 / BibTeX-RIS 导出）与 ⚠ 区落盘仍属 M3。

## 交付内容

| 文件 | 行数 | 职责 |
|---|---:|---|
| `src/verify/types.ts` | 68 | `SourceId`、`SourceRecord`、`ReasonCode`、`ConditionCheck`、`VerificationStatus`、`VerificationReport` |
| `src/verify/clients.ts` | 268 | 四源 URL 构造 + 响应解析；`ContactOptions`/`withMailto`；`arxivIdUrl` 走 `id_list` |
| `src/verify/match.ts` | 110 | `titleSimilarity`/`titleMatches`/`yearMatches`/`firstAuthorMatches`/`familyName`/`editDistance` |
| `src/verify/judge.ts` | 139 | `scoreRecord`、`MIN_RECORD_SCORE = 0.75`、判定矩阵、成功零命中归 `quarantined` |
| `src/verify/lookup.ts` | 387 | 传输层：`LookupCache`（TTL 10 分钟）、单源 4s / 整轮 8s 预算、429/5xx 单次退避、404 视作「该源无此作品」、`verifyCandidate` |
| `src/host/verify-command.ts` | 130 | `/refs verify` 解析（支持 `--title="两 个 词"`）、`renderVerify`、`runVerifyCommand` |
| `src/index.ts` | 589 | `/refs verify` 分流 + `ref_verify` 工具注册 |

## 评审卡四条的处置

| 问题 | 处置 |
|---|---|
| `refkeeper@example.invalid` 假联系方式 | 删除硬编码；改为 `ContactOptions.mailto`，未配置时**完全不带** `mailto` 参数（宁可慢池，不伪造身份） |
| arXiv 用 `search_query=all:<id>` 模糊查 | 新增 `arxivIdUrl()` 走 `id_list=<id>`，并剥 `arxiv:` 前缀与 `vN` 后缀 |
| Crossref envelope 与解析假设不一致 | `parseCrossrefWork` 同时接受 `{message:{…}}` 与扁平 work；单测覆盖 envelope |
| 成功零命中被判 `unverified` | `judgeCandidate` 在「所有源都答复但无命中」时返回 `quarantined`；`unverified` 只保留给「源不可达/超时」 |

另外修掉一个评审未列、但真实网络立刻暴露的问题：**DataCite 404 被计为 `source-error`**，导致每个 Crossref 命中的判定都带 `partial: true`。现在 404 记为「该源答复：无此作品」，只影响 `answered`，不影响 `partial`。

## 判定口径（按 `refkeeper-plugin-plan.md` §5.3）

| 条件 | 实现 |
|---|---|
| 标题强重合 | 拉丁：token Jaccard ≥0.85 且编辑相似度 ≥0.85，或任一 ≥0.95；CJK：字符二元组 Dice ≥0.90 |
| 年份 ±1 | `abs(ours - theirs) <= 1`；任一侧 unknown 记 fail |
| 首作者 | 姓归一化相等；≥4 字符允许编辑距离 ≤1；CJK 比全名；任一侧空 → fail |
| 记录选择 | `score = 0.60·titleSim + 0.25·yearOk + 0.15·authorOk`，`< 0.75` → `quarantined` + `ambiguous-record` |
| 矩阵 | 3/3 且有源 → `verified`；2/3 → `warning`；≤1/3 或无命中 → `quarantined`；源不可达 → `unverified` |
| 仅标识符 | 无标题、只有 DOI/arXiv id 时，以命中记录充当 claim（存在性核查），否则可解析的 DOI 会因 0/3 误入 ⚠ |

## 证据

离线（全部可重复）：

| 检查 | 结果 |
|---|---|
| `npx vitest run` | **12 文件 / 128 用例通过**（M1 收口 76 → M2 部分交付 112 → 本轮 128，新增 16） |
| `npm run typecheck` | 0 error |
| `npm run build` | `lib/index.js` 80.50 kB · d.ts 3.47 kB · client 2997 B |
| `node --check lib/client.js` | 通过 |

真实网络（`dev/smoke-verify.mts`，直连 Crossref/OpenAlex/DataCite）：

- `10.1038/nature12373` + 声明标题/年份/首作者 → `verified`，3/3，`sources: crossref, openalex`，无 `partial`。
- 虚构 DOI `10.1000/refkeeper-does-not-exist` → `quarantined` + `no-source-hit`（不是 `unverified`：源是通的，只是没这篇）。

真实宿主（headless `refkeeper-dev`，mock 发 `ref_verify` 调用，插件连真实注册表）：

```
[refkeeper] mounted dsh-refkeeper (sdk 0.2.1-rc.2)
verified · passed 3/3 · matched crossref
{"report":{"sources":["crossref","openalex"],"partial":false,"matchedSource":"crossref","status":"verified",
 "title":{"pass":true,"score":1},"year":{"pass":true,"ours":"2013","theirs":"2013"},
 "firstAuthor":{"pass":true,"ours":"Kucsko","theirs":"Kucsko"},"passed":3,"reasons":[]}, "records":[…]}
```

## 未覆盖 / 限制

1. **中文期刊库以 Crossref 为准**：多数中文刊在 Crossref 只有英文元数据或干脆没有；三条件对纯中文记录仍可过（Dice ≥0.90），但覆盖率取决于该刊是否注册 DOI。
2. **`mailto` 未配置**：走慢池，Crossref/OpenAlex 在流量大时可能限速；配置入口留给 M5 的设置面。
3. **缓存是进程级**：现在由宿主共享一个 `LookupCache`（工具与命令共用），但重启即失效；持久缓存放 M3 与 refs.json 同目录。
4. **标题检索的召回**：`/refs verify --title=` 对中文长标题依赖 Crossref 的 `query.bibliographic`，命中率未系统测量。
5. **斜杠命令仍未在 GUI 实机验证**：headless 宿主不派发斜杠命令，`/refs verify` 只能靠纯函数单测覆盖；等 M4 装进 desktop profile 再验。

## 下一步（M3）

1. `refs/refs.json` + `quarantine.json` + `annotated.md`，原子写与 schema 迁移。
2. BibTeX / RIS 导出（中英字段：`language`、`journal`/`journaltitle`、`issn`、`publisher`）。
3. 把 `ref_verify` 的判定结果写进主表或 ⚠ 区，并让导出默认跳过 ⚠。

## 评审修复（2026-10-28 13:40）

独立复核指出三项与本轮相关的缺口，另有一项超时未取消费用。四项已全部修复并补测。

| 问题 | 后果 | 处置 |
|---|---|---|
| HTTP 200 坏响应（非法 JSON / 错 envelope / 坏 XML）被解析成空数组 | 源被计为「已答复且无命中」，可持久化成 `quarantined + no-source-hit`，把暂时性故障写成确定性结论 | 新增 `parseSourceBody(source, basis, body)`：结构不符抛 `SourceBodyError`，记账为 `source-error`；只有「envelope 合法但无记录」才算答复 |
| `no-source-hit` 在全部源报错时也会出现 | 同上，是错误结论的一半 | `judgeCandidate` 增加 `answered` 输入；只有至少一个源真正答复过才附 `no-source-hit` |
| `/refs verify` 文档写 `--year` 但解析器不收，身份类型也没有年份/首作者 | 标题路径永远无法完成三条件判定，只能落 2/3 | 解析器新增 `--year`（必须 4 位数字，否则报错）与 `--author`（可重复，取首位）；命令入参改为 `VerificationClaim` |
| 单源超时只 `race` 不 `abort` | 每次校验最多留 3 个孤儿请求在跑 | `fetchWithTimeout` 在计时器触发时 `controller.abort()`，并把外层 signal 转发进去 |
| 宿主未注入 `LookupCache` | 同一 DOI 反复校验每次都打网络 | `src/index.ts` 建进程级 `verifyCache`，工具与 `/refs verify` 共用 |

新增用例 13 个（`test/verify-body.test.ts` 9 + `verify-command` 3 + `judge` 1），并修正 4 处按旧语义写死的断言——旧断言要求「全源宕机也报 `no-source-hit`」，正是这次要消灭的行为。

证据：

| 检查 | 结果 |
|---|---|
| `npx vitest run` | **13 文件 / 141 用例通过** |
| `npm run typecheck` | 0 error |
| `npm run build` | `lib/index.js` 85.06 kB |
| 真实网络 smoke | `10.1038/nature12373` → verified 3/3；虚构 DOI → `quarantined` + `no-source-hit`（真答复） |
| 真实宿主 E2E（带 year/authors 的 `ref_verify`） | `verified · passed 3/3 · matched crossref`，`partial: false` |

坏响应的三种典型形态（HTML 网关页、错 envelope、截断 XML）现在都走 `source-error`，因此 M3 落盘时 `no-source-hit` 只可能来自「源答了、但没有这篇」。

## arXiv 截断 feed 定向修复（2026-10-28 13:45）

上一节的「坏响应」修复按 `body` 里是否含 `<feed` 子串判断，但截断响应依然带着这个前缀：`<feed …><entry><title>broken` 会走到 `parseArxivFeed`、匹配不到闭合 `entry`、返回 `[]`，于是 arXiv 被记成「已答复、无命中」。独立复核实测 `verifyCandidate({arxivId:'2401.12345'})` → `quarantined` + `no-source-hit` + `answered:['arxiv']`，正是要禁止的持久化形态。

只做一处定向修复，不动 XML 解析器结构：

- 新增 `assertAtomFeed(source, body)`（`src/verify/clients.ts`）：先跳过 XML 声明/注释/空白，要求根元素就是 `<feed`（`<html><feed` 这类错根直接拒）；再要求存在闭合 `</feed>`，否则抛 `SourceBodyError('Atom feed is truncated (no closing </feed>)')`。
- `parseSourceBody('arxiv', …)` 改为先 `assertAtomFeed` 再 `parseArxivFeed`。合法但空的 `<feed></feed>` 仍返回 `[]`——那是真实答复（arXiv 没有这篇）。

回归用例 4 个（`test/verify-body.test.ts` 9 → 13）：

| 输入 | 期望 |
|---|---|
| `{"feed":"nope"}`（非 XML） | `body is not an Atom feed` |
| `<feed …><entry><title>broken`（带前缀的截断） | `Atom feed is truncated (no closing </feed>)` |
| `<?xml …?>` + 未闭合 `<feed>` | 同上 |
| `<html><body><feed …></feed></body></html>`（错根） | `body is not an Atom feed` |
| `verifyCandidate({arxivId})` + 截断响应 | `unverified` + `source-error`，**不含** `answered:['arxiv']`、不含 `no-source-hit` |

证据：

| 检查 | 结果 |
|---|---|
| `npx vitest run` | **13 文件 / 145 用例通过** |
| `npm run typecheck` / `npm run build` | 0 error · `lib/index.js` 85.81 kB |
| 真实 arXiv 合法 feed（`id_list=1706.03762`） | 200，解析出 1 条，标题正确——未误伤正常响应 |
| 真实 arXiv 空 feed（`id_list=2401.99999`） | 闭合 feed、0 条 → `answered:['arxiv']` + `quarantined` + `no-source-hit`（这是正确答复） |

M3 的 verdict 持久化门禁据此解除：现在 `no-source-hit` 只可能来自「源答复了、但没有这篇」。

## arXiv 内部标签截断修复（2026-10-28 13:58）

前一轮只校验了根元素与 `</feed>` 闭合，遗漏了「根闭合但内部被截断」这一形态：

`<feed><entry><title>truncated</entry></feed>` —— `feed` 与 `entry` 都闭合，只有 `<title>` 没闭合。`parseArxivFeed` 用 `<entry>…</entry>` 正则取块，块内 `<title>` 无闭合 → `xmlText` 返回空 → 整条 entry 被丢弃 → `[]`，于是 arXiv 记成「已答复、无命中」。

修复仍限定在 `assertAtomFeed` 内，不引入 XML 解析器：

- 新增 `XML_TAG`（单标签 token，属性值可含 `>`）与栈式扫描：遇到开标签入栈、闭标签必须与栈顶同名、自闭合不入栈、扫描结束后栈必须为空。
- 错误分三类，便于判读：`Atom feed is malformed (unexpected </x>)`、`Atom feed is truncated (unclosed <x>)`、`body is not well-formed XML`（游离 `<`）。
- 先剥 XML 声明与注释再扫描；合法空 feed 与合法多 entry feed 行为不变。

回归用例 5 个（`test/verify-body.test.ts` 13 → 18），含评审给出的原始输入：

| 输入 | 期望 |
|---|---|
| `<feed><entry><title>truncated</entry></feed>` | `Atom feed is malformed (unexpected </entry>)` |
| `<feed><entry><title>t</title><id>i</id></feed>`（entry 未闭合） | `Atom feed is malformed (unexpected </feed>)` |
| `<feed><entry><title>a < b</title></entry></feed>`（游离 `<`） | `body is not well-formed XML` |
| 自闭合 `<link …/>` 的合法 feed | 解析 1 条，正常取 arxivId |
| 上述截断经 `verifyCandidate({arxivId})` | `unverified` + `source-error`，不含 `no-source-hit`、不含 `answered:['arxiv']` |

真实响应未误伤（标签平衡检查对正常 feed 无副作用）：

| 请求 | 结果 |
|---|---|
| `id_list=1706.03762`（2,962 B） | 200 → 1 条记录 |
| `id_list=1706.03762,1810.04805`（4,835 B） | 200 → 2 条记录 |
| `search_query=all:thermometry`（7,237 B） | 200 → 3 条记录 |

门禁：13 文件 / **150 用例**、tsc 0 error、`lib/index.js` 87.23 kB。至此「坏响应 → `source-error`」覆盖根级截断、内部截断、错根、非 XML 四类；M3 的 verdict 持久化门禁解除。

## Atom 标签大小写敏感性修复（2026-10-28 14:12）

上一轮修完标签平衡后，复核仍能把坏响应读成「源答了、但没有这篇」：校验器对标签名做了大小写归一化（根正则带 `i`、栈内 `toLowerCase()`），于是 `<Feed><Entry>…</Entry></feed>` 通过根检查与平衡检查，而 `parseArxivFeed` 只认小写 `<entry>`，解析出 0 条 → `answered: ['arxiv']` → `no-source-hit`。

XML 本身区分大小写，Atom 规定元素名为小写，所以这里不该归一化。改动集中在 `src/verify/clients.ts`：

| 位置 | 改动 |
|---|---|
| 根元素检查 | `/^<feed\b[^>]*>/u`，去掉 `i`；`<Feed>` 直接判 `body is not an Atom feed` |
| 闭合检查 | `/</feed\s*>/u`，去掉 `i` |
| 栈内标签名 | 不再 `toLowerCase()`，大小写不一致即 `malformed (unexpected </X>)` |
| entry 解析兜底 | 文档里出现 `entry` 标记但解析出 0 条 → `Atom feed has entries that could not be read`（结构合法但内容读不出，不能当成权威源的「无此篇」） |

单靠平衡校验无法证明 entry 可读：标签大小写不同、或缺 `title`/`id` 子元素，都会「看起来结构完好、实际读不出」。兜底把这类情形统一降级为 `source-error`。

回归 4 例（`test/verify-body.test.ts` 18 → 22）：

| 输入 | 期望 |
|---|---|
| `<Feed …><Entry><Title>T</Title></Entry></Feed>` | `body is not an Atom feed` |
| `<feed …><Entry><Title>T</Title><Id>i</Id></Entry></feed>` | `Atom feed has entries that could not be read` |
| 同上经 `verifyCandidate({arxivId})` | `unverified` + `source-error`，无 `no-source-hit`、`answered` 不含 arxiv |
| 带 `opensearch:totalResults` 等驼峰外部命名空间标签的真实结构 feed | 正常解析 1 条（不误伤） |

真实响应复核：

| 请求 | 结果 |
|---|---|
| arXiv `search_query=all:thermometry&max_results=3`（7,237 B，含 `opensearch:` 驼峰标签） | 200 → 3 条记录 |
| `10.1038/nature12373`（真实网络 smoke） | `verified` 3/3，crossref + openalex |
| 虚构 DOI `10.1000/refkeeper-does-not-exist` | `quarantined` + `no-source-hit`（源确实答了「没有」） |

门禁：13 文件 / **154 用例**、tsc 0 error、`lib/index.js` 87.38 kB（gzip 26.68 kB）。至此 Atom 侧的失败关闭覆盖：错根（含大小写）、根级截断、内部标签畸形、大小写混用、entry 不可读。

## M3 前置 smoke 复跑（2026-10-28 15:06）

在开启 M3 前补跑了一次「真实注册源 + 真实宿主」双证据。当前宿主版本已升到 **0.2.1-rc.3**（插件 `peerDependencies` 全 `*` + optional 的策略在此再次生效：无需改动即挂载成功）。

### 门禁

| 项 | 结果 |
|---|---|
| `npx vitest run` | 13 文件 / **166 用例**通过 |
| `npm run typecheck` | 0 error |
| `npm run build` | `lib/index.js` 89.5 kB 级（total 94.01 kB）、`lib/index.d.ts` 3.79 kB、client 2997 B |

### 真实注册源（`dev/smoke-verify.mts` + 两条 arXiv 探针）

| 输入 | 结果 |
|---|---|
| DOI `10.1038/nature12373` + 标题/年份/首作者 | `verified` 3/3，`sources: crossref, openalex`，`partial: false` |
| 虚构 DOI `10.1000/refkeeper-does-not-exist` | `quarantined` + `no-source-hit`（源确实答复了「没有」） |
| arXiv `1706.03762`（`id_list` 通路） | `verified` 3/3，`sources: arxiv`，`answered: ["arxiv"]`，`errors: 0` |
| arXiv `2499.99999`（不存在的 id） | `quarantined` + `no-source-hit`，`answered: ["arxiv"]`，`errors: 0` |

### 真实宿主（headless `refkeeper-dev` + mock 派发 `ref_verify`）

命令：`HOME=$PWD/.dsh-dev DSH_HOME=$PWD/.dsh-dev/.dsh DEEPSEEK_API_KEY=mock DEEPSEEK_BASE_URL=http://127.0.0.1:3999 REFKEEPER_DEBUG=1 dsh --profile refkeeper-dev "…"`

| 场景 | 宿主输出 |
|---|---|
| 真实 DOI + 标题/年份/首作者 | `[refkeeper] mounted dsh-refkeeper (sdk 0.2.1-rc.3)` → `verified · passed 3/3 · matched crossref`，records 含 crossref + openalex |
| 虚构 DOI | `quarantined · passed 0/3`，`reasons: ["no-source-hit"]`，`records: []`，文案「Kept out of the main table」 |

两条路径都在宿主进程内真实请求了外网注册源，说明 M2 的 verdict 在「真实宿主 + 真实源」组合下既会放行也会拦下，符合「校验不过标 ⚠ 不入表」的产品要求。

### 未覆盖（如实列出）

- 坏 200 / 超时 / 429 的宿主级表现仍只有单测覆盖（未在宿主进程内制造网络故障）。
- 斜杠命令 `/refs verify` 仍无法在 headless 宿主派发，GUI 实机验证留待 M4。
- 缓存不复用跨进程（每次 E2E 都是冷启动）。
