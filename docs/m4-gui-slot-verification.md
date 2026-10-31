# GUI 插槽实证 — 2026-10-28

本轮目标（用户指定）：先只做「查看并实证插件卡片 / GUI 插槽」，暂不开启 M4。
结论分两半：**插槽已实证通过**，**插件卡片未能在隔离 profile 中实证**（环境侧阻塞，非插件报错），
并顺带发现一处发布前必须补的元数据缺口。

## 环境

| 项 | 值 |
|---|---|
| 宿主 | DeepSeek Harness 0.2.1-rc.3（桌面应用内捆绑的 CLI） |
| profile | 隔离 home `dsh-refkeeper/.dsh-dev` 下的 `refkeeper-web`（bundles：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-refkeeper`） |
| 安装方式 | `dsh plugin --profile refkeeper-web add $PWD`（pnpm link，未发布到 npm） |
| GUI | `dsh web --profile refkeeper-web --port 3099`，用 headless Edge + CDP（9333）驱动 |
| 驱动脚本 | `dev/gui-probe.mjs`（点击 + 截图）、`dev/gui-eval.mjs`（读 DOM）、`dev/gui-console.mjs`（控制台，未取到输出） |

## 一、插槽：已实证

先修掉一个真实缺陷：客户端原先用 `key:` 注册 list 插槽，宿主直接拒绝该插件。

```
Error: list slot "conversation.input.left" requires options.id
    at SI.register (assets/index-*.js)
```

`packages/client/ui-slots` 的 list 插槽要求 `id`，chain/single 才用 `key`。改为
`{ name, id: 'refkeeper-capture', order: 10, registrant: 'dsh-refkeeper' }`（`src/client.tsx:64`）后：

| 证据 | 结果 |
|---|---|
| 启动 payload | 含 `dsh-refkeeper` 条目，`/plugins/??…,dsh-refkeeper/client.js&rev=…` 返回 200 |
| DOM | `[aria-label="dsh-refkeeper capture"]` 存在，文本 `❝ Refs`，盒子 59×28 @ (258,306) |
| 真实鼠标点击 | `Input.dispatchMouseEvent` pressed+released 后文本变为 `❝ Refs 1` → React 事件处理器真的挂上了 |
| 截图 | `Page.captureScreenshot` 正常出图（`.e2e-slot.png`，已 gitignore） |

位置在输入框左下的工具行，与「+」「工作区内修改」并排；这是 `conversation.input.left` 的既有排布，
不是额外偏移。

## 二、插件卡片：已实证（上一轮的「环境阻塞」判断已更正）

上一轮把侧栏「插件」页常驻骨架屏（≥60s、26 个 skeleton 节点）判断为环境阻塞，**这个判断是错的**。
真实原因是驱动侧：同一个 CDP target 被 `Page.reload` 与多次 `Runtime.evaluate` 反复探测后进入坏死状态，
该 target 上的后续导航与脚本都不再返回。换成「杀干净旧 headless 实例 → 同一 user-data-dir 只启一个 target →
不打 `Page.reload`」之后，插件页正常渲染。

| 证据 | 结果 |
|---|---|
| 骨架屏节点 | `skel: 0`（上一轮 ≥26） |
| 列表主体 | 「已安装插件 / Reference Keeper / Capture references mentioned in the conversation…」 |
| 图标 | 页面图片列表末位为 `data:image/png;base64,iVBORw0KGg…`，即 `docs/images/icon.png` |
| 截图 | `.e2e-card.png`：图标 + 标题 + 描述 + 启停开关 |

因此**不需要**再把插件装进真实 desktop profile 才能看卡片；隔离 profile 已足以复验。

## 三、发布前必须补的元数据缺口（本轮新发现）

`package.json` 声明了 `exports["./locale/*.json"]` 与 `files: ["locale", …]`，但**仓库里没有 `locale/` 目录**。

后果：

- `npm pack` 会因 `files` 指向不存在的目录而丢文件（至少是发布包与声明不一致）；
- 插件卡片/设置页拿不到本地化标题，会退化显示原始包名 `dsh-refkeeper`，
  而不是「引用管理器」这类可读名字。

建议在 M4 之前补 `locale/zh-CN.json` 与 `locale/en-US.json`（至少 `title` + `description`），
或先删掉 `exports`/`files` 里的 locale 项，避免发布时才暴露。

## 四、门禁

| 项 | 结果 |
|---|---|
| `npx vitest run` | 16 文件 / 193 用例通过 |
| `npm run typecheck` | 0 error |
| `npm run build` | `lib/index.js` 134.51 kB（gzip 38.97 kB）、d.ts 4.08 kB、client 2997 B |
| `node --check lib/client.js` | 通过 |

未覆盖：界面语言切换后的 `zh-cn` 标题实拍；`.e2e-*.png` 证据图未入库（刻意，体积与噪声）。

## 五、locale 与图标元数据补齐（2026-10-28 16:20）

### 新增文件

| 文件 | 大小 | 内容 |
|---|---|---|
| `locale/en.json` | 208 B | `meta.title = "Reference Keeper"`、`meta.description` 一句式说明 |
| `locale/zh-CN.json` | 164 B | `meta.title = "引用管理器"`、中文描述 |
| `docs/images/icon.png` | 1,373 B | 256×256 RGBA，引号 + 三条书目线；由 `dev/make-icon.py` 生成，无字体依赖 |

`package.json` 原本就声明了 `exports["./locale/*.json"]`、`files: ["locale", "docs/images/icon.png"]` 和 `"icon"`，
本轮只是把缺的文件补上，未改声明。图标同时满足 `readPluginMeta` 的四条限制：manifest 内相对路径、PNG、
1.4 KB（上限 256 KiB）、`realpath` 后仍在包目录内。

### 为什么文件名是 `en.json` 而不是 `en-US.json`

`packages/boot/app-boot/src/package-meta.ts` 的 `readPluginMeta` **硬编码**先解析 `<pkg>/locale/en.json`；
只有它存在时才枚举同目录其它 `*.json` 作为额外语言，文件名必须是语言 id。所以英文必须叫 `en.json`，
其余（`zh-CN.json` → `zh-cn`）自由。

### 验证证据（宿主 API，非静态推断）

从运行中的宿主直接取插件清单（RPC 信封必须是 `{type:'client-request', rpcId, method:'<endpoint>', payload:{args:{}}}`）：

```
POST /api/pluginInventory/list
→ entries[].moduleName = "dsh-refkeeper"
   meta.title       = { en: "Reference Keeper", "zh-cn": "引用管理器" }
   meta.description = { en: "Capture references …", "zh-cn": "从对话中捕获文献…" }
   meta.icon        = "data:image/png;base64,iVBORw0KGgo…"
POST /api/pluginManager/listBundles
→ { name: "dsh-refkeeper", version: "0.0.0", meta: { title: {…}, description: {…} } }
```

界面层（`.e2e-card.png`）：「插件 → 已安装插件」渲染出图标 + **Reference Keeper** + 描述 + 启停开关，
骨架屏消失。英文标题是当前 UI 语言下的实际渲染结果；`zh-cn` 词条由上面同一份 `meta` 提供，
切换界面语言即可命中（本轮未做语言切换截图）。

### 上一轮「卡片不可实证」的更正

上一轮把插件页常驻骨架屏归因于「环境侧阻塞」。本轮换成**全新浏览器实例 + 单一页面**后，
同一页面正常渲染（骨架屏归零）。更准确的结论是：**页面本身没问题，上一轮的 CDP 目标已经被反复探测弄坏**
（多个残留 target、`Page.reload`/`Runtime.evaluate` 超时）。宿主三个 API（inventory / listBundles /
listPlugins）始终是 200 且毫秒级返回。

### 打包核对

`npm pack --dry-run`：8 个文件、44.1 kB，含 `docs/images/icon.png`、`locale/en.json`、`locale/zh-CN.json`。
门禁：16 文件 / 193 用例、typecheck 0 error、`lib/index.js` 134.51 kB。
