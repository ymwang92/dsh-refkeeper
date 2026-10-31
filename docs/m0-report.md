# M0 报告：脚手架 + 契约 spike

日期：2026-10-28　宿主：DSH 0.2.1-rc.2（macOS，Apple Silicon）
方案依据：`../refkeeper-plugin-plan.md`（v1.0）

## 1. M0 目标与结论

| M0 出口条件 | 状态 | 证据 |
|---|---|---|
| 包名未被占用 | ✅ | `npm view dsh-refkeeper` 返回 404 |
| 双 face 脚手节能构建 | ✅ | `npm run build` → `lib/index.js` 7.0 KB、`lib/index.d.ts` 2.6 KB、`lib/client.js` 2997 B |
| 能被真实宿主加载并挂载 | ✅ | 隔离 dev profile 启动，日志出现 `mounted dsh-refkeeper (sdk 0.2.1-rc.2)` |
| 工具能拿到当前会话 | ✅ | `ref_ping` 返回真实 session id 与 cwd |
| 工具能写工作区 | ✅ | `.refkeeper/probe.json` 落盘成功 |
| 客户端 bundle 被分发 | ✅（静态） | 启动清单暴露 `plugins/??dsh-refkeeper/client.js&rev=0e488ee627cf`，取回 200 / 2997 B |
| 客户端 UI 肉眼可见 | ❌ 未验证 | 本机 `dsh-browser-cdp` 运行时缺失（`ego-browser.mjs` exit 1），无浏览器可看 |

一句话：**脚手架的「可加载」已经用真实宿主证明，不是纸面推导。**

## 2. 产物

```
dsh-refkeeper/
├── package.json          # name dsh-refkeeper, dsh.bundle.patch, dsh.client, peer 全 * + optional
├── cordis.patch.yml      # insert id=refkeeper name=dsh-refkeeper
├── tsdown.config.ts      # host face（ESM, d.ts, .js 扩展名）
├── scripts/build-client.mjs  # client face（esbuild → CJS + __ModuleLoader__ 信封）
├── src/index.ts          # host：RefkeeperService + ref_ping（249 行）
├── src/client.tsx        # client：conversation.input.dock 占位卡片（65 行）
├── dev/mock-messages-server.mjs  # 本地假 Anthropic SSE，供无凭据启动
└── docs/m0-report.md
```

`lib/`、`.dsh-dev/`、`.refkeeper/` 均已进 `.gitignore`；`package.json` 的 `files` 天然排除 `dev/`。

## 3. 三项 spike 的结论

### spike 1：工具内能否读到「当前会话的事件」

能，但**读法需要改，且 turn 边界不在 surface 上**。

- `exec.agent.session` 可用（`agent: true`，拿到 `session-26f605f1-…`，`header.cwd` = 当前工作区）。
- `session.surface.nodes` 给的是 **client-visible 过滤后的 seq 列表**，实测只含消息事件：
  ```
  7:system/message 8:user/message 9:user/message 10:user/message 16:assistant/message
  ```
  **没有 `turn/start`**，所以按 surface 数 turn 恒为 0。
- `session.eventAt()` / `snapshotEvents()` / `ownEvents()` 在源码里标注为 **deprecated for new code**（`packages/core/session/src/index.ts:635`、`:652-664`、`:681`，agent 注记 2026-09-09）。**M1 不能把主线建在它们上面。**
- 正解是投影 seam：`ctx.sessionProjections.stateOf(session, key)`（`packages/session/session-projection/src/index.ts:312-327`）、`snapshot(session, keys?)`（`:341`）。
- 官方已有 `turnOutline` 单元（`packages/session/session-turn-outline/src/projection.ts:86`，state 为 `{ turns, draft }`，entry 为 `{ turn, seq, prompt, response }`），但**只在 web/desktop bundle 里注册**；headless profile 的 dump-config 只有 `session-projection` + `session-projection-cache`，所以探针如实返回 `(unit not registered)`。

**M1 决定**：插件**自己注册一个 host-only 投影单元**（`wire: undefined`）折 `turn/start` 与 `user/message` 锚点，用 `stateOf(session, 'refkeeperOutline')` 读；`sessionProjections` 缺失时退化为「按 `user/message` 切段」。这样既不依赖 desktop 才有的 `turnOutline`，也不碰 deprecated API。

### spike 2：工具内写工作区是否过沙箱

过。工具运行在会话 cwd 上，`ctx.fs`/`node:fs` 写 `.refkeeper/probe.json` 成功，无需额外审批（写入落在工作区内）。这条保证了 refs 存储可以直接用文件而不是自定义 storage 服务。

### spike 3：客户端 bundle 能否被宿主分发

能。关键事实：

- 分发 URL 形如 `plugins/??<packageName>/client.js&rev=<hash>`（注意是 `??` 与 `&rev=`，不是 `?rev=`；裸路径 `/plugins/<name>/client.js` 会 404）。rev 随构建变化。
- 信封是 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … } })`，`id` 用**包名**而非 patch 行 id。
- 取回内容 `node --check` 通过，且确实是我们的 factory。
- 视觉未验证（无浏览器）。

## 4. 契约修正（相对方案 v1.0）

| 方案原文 | M0 实测 | 处理 |
|---|---|---|
| 「读 `session.surface` 拿 turn 边界」 | surface 无 `turn/start` | 改为自注册投影单元，surface 只用于兜底分段 |
| 「用 `session.eventAt(seq)` 取事件」 | 已标 deprecated | 主线不用；仅在探针里保留为「契约证据」 |
| 「客户端入口按 patch 行 id 寻址」 | 实际按包名 + `rev` 哈希 | 构建脚本与 README 已按包名写 |

## 5. 验证手法（可复用）

隔离一个开发用 DSH home，完全不碰用户的 desktop profile：

```bash
export HOME="$PWD/.dsh-dev"
export DSH_HOME="$PWD/.dsh-dev/.dsh"
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

"$DSH" --profile refkeeper-dev --from-default-profile headless --dump-config   # 建 profile
"$DSH" plugin --profile refkeeper-dev add "$PWD"                              # link 本包
DEEPSEEK_API_KEY=mock-key DEEPSEEK_BASE_URL=http://127.0.0.1:3999 \
  "$DSH" --profile refkeeper-dev "run the contract probe"                     # 配 dev/mock-messages-server.mjs
```

两个坑：

1. **只设 `HOME` 不够**。`--from-default-profile` 的 staging 目录仍走真实 `~/.dsh`，必须同时设 `DSH_HOME`，否则 `EPERM: mkdtemp`。
2. **只跑 `tsdown` 会清掉 `lib/client.js`**（tsdown clean 只认自己的产物）。构建一律用 `npm run build`（tsdown + esbuild 两步）。

## 6. 门禁

```
npx tsc -p tsconfig.json --noEmit   # 0 error
npm run build                       # host 9.69 kB + client 2997 B
node --check lib/client.js          # OK
node -e "import('./lib/index.js')"  # 导出 PACKAGE_NAME / SERVICE_KEY / default / refPingTool
```

## 7. 遗留与下一步（M1）

未覆盖：
- 客户端 UI 的视觉验证（需有浏览器或用户实机）。
- desktop profile 实装（需用户重启 DSH，M0 不擅自改动）。
- 真实 LLM 路径（M0 用 mock，避免消耗用户额度）。

M1 内容：`refs/` 存储层（`refs.json` + `annotated.md` + `conflicts.md`，原子写）+ 自注册 `refkeeperOutline` 投影单元 + `ref_capture` 的候选抽取（URL/DOI/arXiv id 正则 + 去重）。
