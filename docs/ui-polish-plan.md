# 捕获面板 UI 改版方案 — 实施稿 v2

状态：**方案已拍板，待实施。**
基线：`main@ec5404f`（v0.1.2），`src/client.tsx` 1165 行。
版本差异：v2 相比 v1，5 个待拍板项已全部定案，新增「手动入表」通路设计与 `authors.ts` 处置结论。

---

## 〇、已定决策（不再讨论，实施时按此执行）

| # | 决策项 | 结论 |
|---|---|---|
| D1 | JSX 写法 | **经典转换**（esbuild `jsx: 'transform'` + `jsxFactory: 'React.createElement'`）。产物只依赖 `react`，不引入 `react/jsx-runtime`。 |
| D2 | 面板宽度 | **420px**（暂定值）。两视图统一，不做变宽动画。 |
| D3 | 「选择文件夹」按钮 | **不做**。手填路径是既定方案，禁止重新引入任何 picker 通路。详见 §3.3。 |
| D4 | 「跳过」条目 | **保留「手动入表」入口**。走 `/refs save --payload=…`，宿主零改动。详见 §3.4。 |
| D5 | `src/ui/authors.ts` | **保留并接线，不删**。它是仓库里唯一正确的作者解析实现。详见 §3.5。 |

---

## 一、现状诊断

### 1.1 结构性问题（截图可见）

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| P1 | 条目详情用原生 `<details>/<summary>` 内联展开 | `client.tsx:697` | 露出浏览器默认三角标记；展开后 14 个字段把面板拉到数千像素高，列表被顶出视野 |
| P2 | 字段标签固定在 92px 左列 | `client.tsx:615` | 「作者（每行一个）」被挤成两行；输入框被压到不足 200px |
| P3 | 详情表单是单列 14 行 | `client.tsx:512` | 年份/卷/期/页码四者纵向排开，高度是必要的 3 倍 |
| P4 | 「条目类型」是自由文本 `<input>` | `client.tsx:513` | 可填出 `RefType`（7 种）以外的任意值，导出时静默失败 |
| P5 | 状态是纯色文字，不是徽章 | `client.tsx:722` | 四态只能靠颜色区分，无形状差异 |
| P6 | 条目只有标题 | `client.tsx:738` | 4 条长标题互相无法区分，必须逐条展开 |
| P7 | 「刷新列表」挂在文件夹行右侧 | `client.tsx:1065` | 语义错位：它刷的是捕获批次，不是文件夹 |
| P8 | 按钮是浏览器默认 `<button>` | `client.tsx:641,751` | 默认灰底边框，与面板其余部分割裂 |
| P9 | `BatchEntry.reason` 从未被渲染 | 全文无 `entry.reason` | 隔离条目为什么没入表，界面查不到——这是用户最需要的信息 |
| P10 | 面板宽 360px | `client.tsx:839` | 长标题截断过早，元信息副行放不下 |

### 1.2 一个真 bug（不是 polish，是写错了变量名）

现有代码引用的语义色变量在宿主里**根本不存在**，所以每次都落在 fallback 上：

| 代码里写的 | 宿主实际提供 | 后果 |
|---|---|---|
| `var(--dsw-alias-success, #1a7f37)` | `--dsw-alias-state-success-primary` | 恒为绿，宿主换主题不跟随 |
| `var(--dsw-alias-warn, #b26a00)` | `--dsw-alias-state-warn-primary` | 恒为橙 |
| `var(--dsw-alias-danger, #b42318)` | `--dsw-alias-state-error-primary` | 恒为红 |
| `var(--dsw-alias-fg-secondary, #6b7280)` | `--dsw-alias-label-secondary` | 恒为灰 |

已从 `DeepSeek Harness.app/Contents/Resources/app.asar` 逐个核实（§4.2）。
`--dsw-alias-bg-l1`、`--dsw-alias-bg-l2`、`--dsw-alias-border-l1`、`--dsw-alias-brand-primary` 这四个**是存在的**，可继续用。

### 1.3 死代码

| 项 | 位置 | 处置 |
|---|---|---|
| `import { parseAuthors }` | `client.tsx:29` | **不删**（改接线，见 §3.5） |
| `payloadFlag` import | `client.tsx:32` | 删（`src/ui/payload.ts` 保留，宿主与测试在用） |
| `exportChooseDir` 键 | `client.tsx:105,184,259` | 删 —— 这是当年被废弃的「选择导出目录…」按钮的遗留（见 §3.3） |
| 其余 20 个 i18n 键零引用 | `client.tsx` | 删：`includeTools / exportNone / captureAndSave / manualToggle / manualHint / title / doi / year / authors / summary / relevance / evidence / caveats / save / list / enrich / needTitle / detailsShow / detailsHide` |
| `dev/gui-fill.mjs` / `.json` | `dev/` | 填的是已删除的「手动添加」表单，脚本已失效 → 删除 |

---

## 二、改动边界

| 约束 | 说明 |
|---|---|
| **宿主命令协议一字不改** | 现有 `/refs capture` / `/refs export` / `/refs edit` / `/refs promote` / `/refs dir` 全部保持原样；D4 新增 `/refs save --payload=…`，但这是**宿主已有的子命令**（`store-command.ts:57` 的 `STORE_SUBCOMMANDS` 已含 `save`），不是新协议。 |
| **不碰** | `src/core/`、`src/host/`、`src/store/`、`src/export/`、`src/verify/`、`src/index.ts`。一条宿主逻辑都不动。 |
| **构建边界** | `tsdown.config.ts` 入口只有 `src/index.ts`，宿主 bundle 不含 React。新 UI 模块只允许被 `src/client.tsx` 引用；若被 `src/index.ts` 引入，`react/jsx-runtime` 会被打进 Node 侧 bundle，直接炸。 |
| **入库产物** | `lib/client.js` 是 git 跟踪的（`git ls-files lib` 命中），改完必须重新 `npm run build` 并提交，否则用户装的是旧界面。 |

---

## 三、关键功能设计

### 3.1 视图与布局

- `CapturePanel` 内部持有 `view`：
  ```ts
  type PanelView = { kind: 'list' } | { kind: 'detail'; id: string; mode: 'edit' | 'create' }
  ```
- 列表行末尾的 `›` 是真 `<button>`，点击 → 切到详情视图，列表整体卸载。
- 详情视图左上角 `‹` 返回；`Esc` 也能返回。
- 面板宽度两视图统一 **420px**，`maxWidth: calc(100vw - 32px)` 保留。
- 详情视图进入时焦点移到标题；返回后焦点回到原来那行的 `›` 按钮。

### 3.2 导出区（按 D3 调整）

导出区只保留：

```
导出                        已勾选 N 条
文件夹  [手填路径输入框]   [保存文件夹] [清除]
格式    ☑ BibTeX  ☑ RIS
        [导出本次捕获]  [导出全部文献]
```

**不出现「选择文件夹」「选择导出目录…」任何字样的按钮。**

### 3.3 D3 的技术约束（写死，实施时不得违反）

**背景**：宿主确实还留着 picker 能力（`store-command.ts:76` 的 `dirChoose`、`--choose-dir` 标记），但：

- `picker.pick(signal)` 是**阻塞 await 的原生选择器**（`store-command.ts` 的 `setDefaultDirectory`）；
- `deps.signal` 缺失时用的是一个**没有超时**的 `new AbortController().signal` → 选择器可以无限期挂起，宿主命令 promise 永不 resolve；
- 宿主可能根本没装 `directoryPicker` 服务 → 直接返回 `"directory picker service is missing"`；
- 面板在命令 pending 期间会随 transcript 事件持续重渲染 → 原生模态框盖在上面时整个界面失去响应。这正是当年「特别卡顿」的成因。

**手填路径当前不卡的结构性原因（必须保持）**：

| 机制 | 位置 | 说明 |
|---|---|---|
| 本地 state | `client.tsx:911` `dirDraft` | 输入框内容不进 React 树之外的状态源 |
| `onChange` 只 setState | `client.tsx:1077` | **不触发 transcript 重扫，不触发宿主往返** |
| 宿主往返只在点按钮时发生一次 | `client.tsx:1085` | `/refs dir --set=…` |
| transcript 扫描有缓存 | `client.tsx:468-480` `dirCache`（按 sessionId + nonce 键） | 不在每次 render 重扫 |

**硬约束（违反即视为实现失败）**：

1. 客户端**不得**发出 `/refs dir --choose` 或 `/refs export --choose-dir`。
2. 不得新增任何目录枚举 / 浏览 / 文件树 UI。
3. 路径输入框的 `onChange` / `onFocus` / `onBlur` **不得**触发 transcript 重扫或宿主往返；只在用户点「保存文件夹」时走一次宿主命令。
4. 新 UI 组件的 `onChange` 一律只写本地 state；任何宿主往返必须由显式按钮点击触发。

### 3.4 D4：「跳过」条目的「手动入表」通路

**宿主零改动。** 复用已存在的 `/refs save --payload=<base64url>`：

```
saveFromPayload(payload, deps)          store-command.ts:461
  → buildReference(payload)             store-command.ts:432
      → coerceReference(payload)        仅硬性要求：title 非空
  → deps.verify(ref)                    有 verifier 则先核验
  → status = report.status ?? (deps.allowManualConfirm ? 'manual' : undefined)
      undefined → 报错 "no verifier available on this host…"
  → accepted = status === 'verified' || status === 'manual'
      accepted   → 写入 refs/refs.json（主表）
      否则        → 写入 refs/quarantine.json（⚠ 隔离区）
```

这与当年被删掉的 `manualHint` 文案完全一致：*"先校验，通过才入主表，不通过进 ⚠ 区。"*

**UI 流程**：

1. 列表行（跳过/无 id 的条目）右侧显示「手动入表」按钮；
2. 点击 → 详情视图，`mode: 'create'`：
   - 预填该条目已捕获到的 `title` / `doi` / `arxivId`；
   - **标题必填**（宿主硬性要求），其余字段用户自填；
   - 详情视图底部主按钮文案为「保存并入表」；
3. 提交 → `/refs save --payload=<base64url>`（**不是** `/refs edit`）；
4. 提交后从宿主返回文本判定结果（`saved … → refs/refs.json` / `⚠ quarantined …`），就地更新该行的本地状态并给出提示条。

**注意**：batch 是持久化快照（`last-capture.json`），`/refs save` 不会产生新的 `refkeeper-batch:` 标记，所以列表状态不会自动刷新 —— 必须由客户端就地更新该行状态，并在提示条里说明「下次捕获会记录为已入表」。

### 3.5 D5：`src/ui/authors.ts` 的处置 —— 保留并接线

**结论：不删。接线到客户端作者字段。**

理由：

1. **它是仓库里唯一正确的作者解析实现**，且已有单测覆盖最容易出错的输入：
   - `'Kucsko, G., Maurer, P.'` → `[{family:'Kucsko',given:'G.'},{family:'Maurer',given:'P.'}]`
   - `'Kucsko'` → `[{family:'Kucsko'}]`
   - `'张伟，李娜'` → `[{family:'张伟'},{family:'李娜'}]`
   - `'Kucsko, G., R.'` → `[{family:'Kucsko',given:'G.'},{family:'R.'}]`
2. **宿主有两处朴素实现，都只按第一个逗号切**：
   - `capture-save.ts:76` `authorPayload()` —— `split(',')` 取首段作 family、其余作 given；
   - `store-command.ts:1204` `authorsFromStrings()` —— 同样的首逗号切法。

   后果：用户在作者框**一行**里写 `Kucsko, G., Maurer, P.`，宿主会把它当成**一个**作者，`family='Kucsko'`、`given='G., Maurer, P.'`，导出到 BibTeX / RIS 也是错的。
3. **`parseAuthors` 同时正确处理两种写法**：「姓, 名」单作者，以及逗号分隔的多作者。
4. **`literal` 与 `family` 的差异对导出完全无害**：
   - `bibtex.ts:36` `bibtexAuthor()` —— 有 literal 取 literal；有 family+given 拼 `"family, given"`；只有单个名字时 `family` 与 `literal` 两条路输出相同。
   - `ris.ts:4` `risAuthor()` —— 同理。
   - 所以「无 given 的作者」被宿主存成 `{literal}` 还是 `{family}`，导出字节一致，**没有副作用**。
5. 首作者核验走的是候选侧原始字符串（`verify/judge.ts:26` `firstAuthorMatches(candidate.authors, record.authors)`），不经过 `RefAuthor`，所以接线不影响核验。

**接线位置：客户端**（不改宿主，守住 §二 边界）。

详情表单提交前，对作者框的**每一行**单独调用 `parseAuthors`，把结果展平，再序列化成 host 期待的 `"Family, Given"` 字符串数组，走原有 payload 通道。

**必须注意的实现细节**：`parseAuthors` 的分隔符是 `/[,，;；]/u`，**不含换行**。所以不能把整个 textarea 当一整串传进去 —— `"Daly, C.\nHalbleib, M."` 会切成 `["Daly", "C.\nHalbleib", "M."]`，中间那坨因含换行不匹配 initials 规则，会变成一个独立的错误作者。

正确做法（**逐行**调用后展平）：

```ts
// 落在 src/ui/entry.ts 或新的 src/ui/authors.ts 里
export function parseAuthorLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => parseAuthors(line))
    .flat()
    .map(formatAuthor)
    .filter((s) => s !== '')
}

// 与 parseAuthors 的结构对齐：有 given → "family, given"；无 given → "family"
export function formatAuthor(author: ParsedAuthor): string {
  return author.given === undefined || author.given === ''
    ? author.family
    : `${author.family}, ${author.given}`
}
```

同时修正 `src/ui/authors.ts` 的模块头注释 —— 现在写的是「面板与测试共用」，与事实不符（此前面板从未调用它）。

**新增测试**：`test/ui-authors.test.ts` 补多行输入用例（`"Daly, C.\nHalbleib, M."` → 2 个作者），以及 `formatAuthor` 的往返用例。

### 3.6 其余交互补齐

- **元信息副行**：格式 `作者 · 年份 · 出版物`，缺失段自动跳过；`entry.reason` 存在时追加在末尾。
  作者摘要：1 位 → 全名；2 位 → `A 与 B`；≥3 位 → `首作者 et al.`。数据全部来自 `entry.fields`（`BatchFields` 已有 `authors` / `year` / `containerTitle` / `volume` / `issue`），宿主不动。
- **P9 的 `reason`**：隔离/失败条目的副行末尾显示 `entry.reason`（宿主给的是 `stored.status`，英文原文）；详情视图加一条琥珀色提示条说明当前状态与处置方式。
- **条目类型下拉**：原生 `<select>`，选项取 `REF_TYPES`（`src/store/types.ts` 已导出；该文件只 import `src/core/text.ts`，后者零 import、无 Node 内建 → 前端可安全引入）。
  7 项：journalArticle / conferencePaper / preprint / report / thesis / book / webpage。
- **选中计数**：`pickedIds.length` 已在计算，直接显示「已勾选 N 条」。
- **刷新按钮归位**：从文件夹行移到「最近一次捕获 · N」标题行右侧。
- **空态**：无批次时给一张带图标的空态卡，取代现在的一行灰字。

---

## 四、实现规格

### 4.1 JSX 转换（决策 D1 的确切配置）

`scripts/build-client.mjs` 里 esbuild 配置改为：

```js
jsx: 'transform',
jsxFactory: 'React.createElement',
jsxFragment: 'React.Fragment',
```

`src/client.tsx` 保留 `import * as React from 'react'`（经典转换依赖它）。
`tsconfig.json` 的 `jsx: react-jsx` **不用动**（只影响类型检查）。

external 列表保持 `['react', 'react-dom', 'react/jsx-runtime']` 不变也无妨 —— 经典转换不会产出 `jsx-runtime` 的 require。

**门禁**：产物里不得出现 `jsx-runtime` 字符串（见 §6.1）。

### 4.2 语义色变量（照抄宿主真实名字）

```
成功  --dsw-alias-state-success-primary   (→ --dsw-static-green-500)
警告  --dsw-alias-state-warn-primary      (→ --dsw-static-amber-500)
错误  --dsw-alias-state-error-primary     (→ --dsw-static-red-400 / red-600)
中性  --dsw-alias-state-idle-primary
文字  --dsw-alias-label-primary / -secondary / -tertiary / -quaternary / -caption / -dimmed
背景  --dsw-alias-bg-base / -l1 / -l2 / -layer-1..4 / -overlay
边框  --dsw-alias-border-l1 .. -l4, --dsw-alias-separator-primary
按钮  --dsw-alias-button-primary-fill / -hover / -dimmed, -contrast-fill,
      -elevated-fill, -floating-fill / -hover, -ghost-active-fill / -hover / -border
交互  --dsw-alias-interactive-bg-hover / -accent / -danger / -solid, -active
品牌  --dsw-alias-brand-primary / -invert, --dsw-alias-brand-text
```

徽章底色用 `color-mix(in srgb, <语义色> 14%, transparent)`，并保留一层不依赖 `color-mix` 的 `background` 兜底（老 Chromium 上由后者生效）。

### 4.3 文件级改动清单

**新建**

| # | 文件 | 职责 |
|---|---|---|
| N1 | `src/ui/strings.ts` | `Strings` 接口 + `EN`/`ZH` 字典 + `stringsFor()`。新增 7 个类型名、3 个分组名、选中计数、空态、手动入表等键；删掉 21 个死键。纯 TS，可单测。 |
| N2 | `src/ui/tokens.ts` | 设计 token：间距、圆角、字号、语义色映射（修正 §1.2）。纯常量。 |
| N3 | `src/ui/primitives.tsx` | 原子组件：`Button`（primary/ghost/outline）、`StatusBadge`、`Segmented`、`TextField`、`SectionLabel`、`ChevronButton`、`Notice`。 |
| N4 | `src/ui/entry.ts` | `BatchEntry` 上的纯函数：`entryMeta()`、`authorSummary()`、`typeLabel()`、`parseAuthorLines()` / `formatAuthor()`（§3.5）。纯 TS，可单测。 |
| N5 | `src/ui/EntryList.tsx` | 条目行：复选框 + 状态徽章 + 标题 + 元信息副行 + `›`；跳过条目额外给「手动入表」。 |
| N6 | `src/ui/EntryDetail.tsx` | 详情视图：标识/书目/出版三组 + 保存/还原 + 隔离提示条 + `mode:'create'` 的「保存并入表」。 |
| N7 | `src/ui/CapturePanel.tsx` | 面板外壳：头部、范围区、列表区、导出区、视图切换。 |
| N8 | `test/ui-entry.test.ts` | N4 的单测（作者摘要、元信息拼接、类型标签、缺字段降级、多行作者）。 |

**修改**

| # | 文件 | 改动 |
|---|---|---|
| M1 | `src/client.tsx` | 1165 行 → ~260 行。保留：插件注册、locale 订阅、session 事件流读取（`commandTexts` / `latestBatchOf` / `latestDirOf` / 快照缓存）、`dispatch()`、`captureLine()` / `exportLine()` / `formatFlag()`。迁出：全部渲染代码与 i18n 字典。 |
| M2 | `scripts/build-client.mjs` | esbuild 改经典转换（§4.1）。 |
| M3 | `src/ui/authors.ts` | **保留**。修正模块头注释；新增 `formatAuthor`（或放 N4）。 |
| M4 | `src/ui/payload.ts` | 不动。仅从 `client.tsx` 移除未使用的 `payloadFlag` import。 |
| M5 | `test/ui-authors.test.ts` | 补多行作者用例 + `formatAuthor` 往返用例。 |
| M6 | `dev/gui-fill.mjs` / `dev/gui-fill.json` | 删除（失效脚本）。 |
| M7 | `docs/images/panel.png`、`panel-en.png` | 用新版界面重新截图（README 两处都在引用）。 |
| M8 | `README.md`、`README.zh.md` | 「使用」小节的界面描述同步。 |
| M9 | `CHANGELOG.md` | 记一条 UI 改版 + 语义色变量修正 + 手动入表入口。 |

---

## 五、建议执行顺序

分三批，每批独立可验证、独立可回滚：

| 批次 | 内容 | 为什么单独一批 |
|---|---|---|
| **B1** | 修 §1.2 语义色变量 + 抽 `tokens.ts` / `strings.ts` + 删死代码 + `authors.ts` 接线与 `formatAuthor` + esbuild 改经典转换 | 纯视觉与卫生改动，不动结构，风险最低，先把地基改对 |
| **B2** | 列表视图重做：徽章 + 元信息副行 + `reason` 显示 + 刷新归位 + 选中计数 + 空态 + 「手动入表」按钮 | 面板里最常用的一块，独立可见 |
| **B3** | 详情视图独立化：拆 `<details>` → 独立视图 + 三组字段 + 类型下拉 + 焦点管理 + `mode:'create'` 保存并入表 | 结构改动最大，依赖 B2 的行组件 |

每批结束后跑 §6.1 全部门禁 + §6.2 的 V1–V5，截图留档，再进下一批。

---

## 六、验证方案（pass / fail 判据）

### 6.1 静态门禁（必过）

| 判据 | 命令 / 断言 |
|---|---|
| 类型零错误 | `npm run typecheck` → 0 error |
| 现有用例不回退 | `npx vitest run` → 现有 16 文件 / 193 用例全过 |
| 新增用例 | `test/ui-entry.test.ts` + 扩充后的 `test/ui-authors.test.ts` 全过 |
| 产物可加载 | `npm run build` → `node --check lib/client.js` 通过 |
| **无新增运行时依赖** | `grep -c "jsx-runtime" lib/client.js` → **0** |
| 产物已更新 | `git status` 显示 `lib/client.js` 变更 |
| 无 picker 通路 | `grep -c "choose" lib/client.js` → **0**（客户端不得引用任何 picker 命令） |

### 6.2 GUI 实证（沿用仓库现成流程，见 `docs/m4-gui-slot-verification.md`）

隔离 profile `refkeeper-web` → `dsh web --profile refkeeper-web --port 3099` → headless Edge `--remote-debugging-port=9333`
→ `node dev/gui-probe.mjs 9333 .e2e-panel.png` / `node dev/gui-eval.mjs 9333 "<expr>"`

| # | 断言 | 判据 |
|---|---|---|
| V1 | 面板存在且宽 420 | `section[aria-label="dsh-refkeeper panel"]` 的 `getBoundingClientRect().width === 420` |
| V2 | 无原生三角 | 面板内 `details` / `summary` 元素数 === 0 |
| V3 | 状态是徽章 | 徽章 `border-radius` 计算值 ≥ 999，且四态底色互不相同 |
| V4 | 标题单行截断 | 标题 `scrollWidth > clientWidth` 且 `textOverflow === 'ellipsis'` |
| V5 | 类型是下拉 | 条目类型控件 `tagName === 'SELECT'`，`options.length === 7` |
| V6 | 详情三组 | 详情视图含「标识 / 书目 / 出版」三个分组标题 |
| V7 | reason 可见 | 隔离条目文本中包含 `entry.reason` 的内容 |
| V8 | 语义色跟随主题 | 切到深色后，状态徽章 computed color ≠ §1.2 表里的 fallback 值 |
| V9 | 命令字面量不变 | 改版前后 transcript 中 `/refs capture` / `/refs export` / `/refs edit` / `/refs promote` / `/refs dir` 的命令字符串逐字 diff 一致 |
| V10 | 多作者解析正确 | 作者框输入 `Kucsko, G., Maurer, P.` 一行 → 保存后 `refs/refs.json` 里是 **2 个** author 对象（`family` 分别为 `Kucsko` / `Maurer`） |
| V11 | 手动入表走 save | 跳过条目点「手动入表」→ 提交后 transcript 里出现 `/refs save --payload=…`，且**不是** `/refs edit` |
| V12 | 面板内无 picker | 面板 DOM 里没有任何「选择文件夹」「选择导出目录」字样的可点元素 |

### 6.3 文档同步

`docs/images/panel.png` / `panel-en.png` 重新截图 → README 两处引用同步 → CHANGELOG 记一条。

---

## 七、实施者须知（易踩的坑）

1. **`parseAuthors` 不认换行** —— 必须逐行调用后展平（§3.5）。
2. **JSX 用经典转换** —— `React.createElement` 由 esbuild 生成，`import * as React from 'react'` 必须留着；不要改成 `import React from 'react'`（经典转换要求 `React` 这个标识符在作用域内，命名空间导入满足）。
3. **新组件别被 `src/index.ts` 引用** —— 一旦被引用，`react/jsx-runtime` 会被打进 Node 侧 bundle。
4. **路径输入框的 `onChange` 只能 setState** —— 见 §3.3 的四条硬约束。
5. **batch 是快照** —— 手动入表后不会自动刷新列表，要客户端就地更新行状态（§3.4）。
6. **`lib/client.js` 要提交** —— 否则 npm 用户装到的是旧界面。
7. **不要改宿主** —— 手动入表、多作者解析都能在客户端侧解决，别去动 `src/host/`。
