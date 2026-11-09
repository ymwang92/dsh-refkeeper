# 捕获面板现状诊断（2026-11-05，B1 之前）

本文是实施稿最初的一章，诊断对象是 B1 改造之前的界面。
B1/B2/B3 之后这些条目大部分已修，**留档用于追溯**；
后续状态看 AGENTS.md 与 docs/verification-log.md。

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

