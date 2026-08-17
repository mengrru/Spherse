# Design：web 端去掉后台恢复强制刷新（resume-reload → resume-sync）

- 日期：2026-08-17
- 状态：设计中（待评审）
- 需求：优化 web 端体验，去掉强制刷新。调研结论：强制刷新是 PR4b 为 iOS PWA 后台挂起选的「最简方案」，用整体 reload 顺带解决数据同步；代价是任何浏览器后台 ≥30s 回前台都白屏重载、丢失滚动位置/路由/浮层/焦点。本设计以**增量恢复**替代。

## 背景

### 现状（代码事实）

强制刷新唯一来源：`packages/web/src/resume-reload.ts` 的 `setupWebResumeReload()`（web shell `main.tsx` 启动时挂载）：

- `visibilitychange`：页面 hidden ≥ 30s（`RESUME_RELOAD_THRESHOLD_MS`）后 visible → `location.reload()`；
- `pageshow` 且 `event.persisted`（bfcache 恢复）→ `location.reload()`。

reload 实际替我们做了 5 件事，各子系统自愈现状盘点：

| # | reload 重建的内容 | 当前自愈能力 | 去掉 reload 后的 gap |
|---|---|---|---|
| 1 | bus WS（trigger/agent/fs-watch/debug） | ✅ 完备：指数退避重连（1s→30s）+ 30s 心跳/60s 超时强制断开 + 重连后 `replaySubscriptions`；重连时重读 localStorage baseUrl | 无，但 iOS 挂起恢复后靠心跳发现死链最长要 ~60–90s，收敛慢 |
| 2 | 每会话 chat WS | ✅ 完备：重连（上限 10 次）+ 心跳 + **重连后 `reconcileHistory` 拉最近 10 turns 补齐漏事件** + 断连横幅/消息防丢失/自动重试（chat-resilience 已做） | 同上收敛慢；且要求 `attachedCount > 0`（正在看该会话） |
| 3 | 项目列表（`app-store.restoreProjects`） | ❌ 仅 App 启动调用一次，无刷新入口 | **最大 gap**：桌面新建/切换项目后 web 端看不到 |
| 4 | agents/sessions 列表 | ❌ `ProjectScope` 有缓存即跳过（`if (cached?.agents?.length) return`）+ 仅靠 bus `agent_updated` 事件驱动 | 断线期间错过的事件不补，列表陈旧 |
| 5 | fs-watch 消费者（file tree / content browser / welcome page / custom theme / agent theme） | ❌ 仅挂载时拉一次 + 事件驱动 | 断线期间文件变化丢失，UI 陈旧 |

其它事实：

- 草稿按 session 存 localStorage（Composer `spherse:draft:<sessionId>`），reload 无损的前提早已成立；去掉 reload 只会更无损。
- 连接配置（baseUrl/token）：bus 重连会重读 localStorage ✅；但 **chat runtime 的 `params.baseUrl` 与 ApiClient 是启动时快照**——tunnel 重启换 URL 后不 reload 不生效；`refreshConnection` 仅桌面 MobileAccessPanel 调用，web 无入口。
- SW `autoUpdate` + inline 注册与 resume-reload 无关，不受本设计影响。
- `resume-reload.ts` 无任何测试；`ProjectScope` 的缓存守卫使「导航也无法刷新列表」。

## 方案

### 备选对比

| 方案 | 做法 | 评估 |
|---|---|---|
| A. 直接删除 resume-reload | 依赖既有 WS 自愈 + 用户手动导航刷新 | 不够：gap 3/4/5 真实存在（项目列表永远陈旧），等于把同步问题丢回给用户 |
| **B. 集中式 resume-sync（选定）** | 恢复可见时统一触发「WS 主动探测 + 数据 resync」，替换 reload | 复用既有自愈设施，只补缺的刷新入口与收敛提速；状态零丢失 |
| C. HTTP polling 降级 | 定时轮询替代 WS | 重实现，PR4b 时已明确推迟；WS 自愈已可用，没必要 |
| D. 保留 reload 但仅 iOS 判定 | UA/平台 gate | 平台判定脆弱；桌面 web tab 同样受害，治标不治本 |

### 选定方案 B：细节

#### 1. web shell：删除 resume-reload

- 删除 `packages/web/src/resume-reload.ts`，`main.tsx` 移除调用。恢复逻辑上移到共享层（见 2），web shell 回到纯薄壳。

#### 2. app 层：`useResumeSync(bridge)` hook（挂载于 `App.tsx`）

- 内部 gate：仅 `bridge.kind === "web"` 生效（desktop 项目列表是本地 IPC 真源，无此问题，不扩大范围）。
- 监听：
  - `visibilitychange`：hidden 记录时间戳；visible 且 hidden ≥ `RESUME_SYNC_THRESHOLD_MS`（沿用 30s）→ 触发 resync；短时切换不触发（避免频繁切 tab 打请求）。
  - `pageshow` 且 `event.persisted`（bfcache）→ 直接触发 resync（不再 reload）。
- 触发去重：resync in-flight 时忽略新触发；距上次成功 resync < 5s 的重复触发忽略。

#### 3. resync 序列（hook 内按序执行，全部失败容忍）

1. **`app-store` 新增 `refreshProjects(bridge)`**：调 `bridge.project.restoreProjects()`（web 为 HTTP 只读、desktop 为 IPC，均幂等）后**合并**进现有 `projects` Map（新增/更新 lastOpened/删除已不存在项），**不动 `activeProjectId`**（active 被删才回退）、**不置 `initializing`**（避免全屏 loading 闪烁——这是不能直接复用 `restoreProjects` 的原因）。失败 → toast 提示连接不可用（不 reload）。
2. **刷新当前项目数据**：对 `activeProjectId` 直接调 `refreshAgents` + `refreshSessions`（直接调 store action，绕过 `ProjectScope` 的缓存守卫）。
3. **WS 主动探测提速**（不等心跳超时，解决 iOS 恢复后 ~60–90s 才收敛的问题）：
   - `bus-store` 新增 `probeNow()`：若非 OPEN 交由既有重连；若 OPEN 且 `lastPongAt` 已超时 → 立即 close 触发重连；否则立即发 ping 并安排 ~5s 短探测，仍无 pong → close。
   - `chat-session-runtime` 新增 `probeNow()`（同语义，基于 `awaitingPongSince`）；`streaming-store` 新增 `probeAll()` 遍历 attached sessions。
4. **通知 fs-watch 消费者**：新增极简 pub/sub 模块 `lib/resync-events.ts`（`subscribeResync(cb)` / `emitResync(reason)`，无 zustand 必要）。fs-watch 消费者 hook（`useFsWatchRefresh` / `useContentAutoRefresh` / `useCustomTheme` / `useAgentTheme` / welcome page）各加一行订阅，回调复用各自的既有刷新逻辑（如 `useCustomTheme` 抽出 link 重建函数供 effect 与 resync 共用）。
5. 成功时静默（无 toast）；仅失败 toast（i18n 三语新增 `app.resumeSyncFailed`）。

#### 4. 明确不做（记 backlog / 已知限制）

- **chat runtime / ApiClient baseUrl 快照不感知连接变更**：tunnel 重启换 URL 后，已 attach 会话仍连旧地址直到重挂载；手动路径（connect 页重连 → `restoreProjects` 更新 connection → 组件重建）已可用。记 backlog。
- **resync 失败不回退 reload**：reload 兜底会复活「丢状态」原问题；WS/HTTP 各自退避重试 + toast + connect 页手动路径已构成兜底。
- HTTP polling 降级（维持 PR4b 决策）。

## 接口与数据

| 位置 | 变更 |
|---|---|
| `packages/web/src/main.tsx` | 移除 `setupWebResumeReload` 调用；删除 `resume-reload.ts` |
| `packages/app/src/hooks/useResumeSync.ts` | 新增：visibility/pageshow 监听 + 阈值/去重 + resync 序列 |
| `packages/app/src/stores/app-store.ts` | 新增 `refreshProjects(bridge)`（合并语义、保 active、不置 initializing） |
| `packages/app/src/stores/bus-store.ts` | 新增 `probeNow()` |
| `packages/app/src/features/chat/runtime/chat-session-runtime.ts` / `streaming-store.ts` | 新增 `probeNow()` / `probeAll()` |
| `packages/app/src/lib/resync-events.ts` | 新增极简 pub/sub |
| fs-watch 消费者 5 处 hook | 各加 resync 订阅一行 |
| `packages/i18n` | `app.resumeSyncFailed` 三语 |

- **无** server 契约、持久化、路由、HostBridge 接口变更，无迁移。
- `restoreProjects`（既有）与 `refreshProjects`（新增）语义对照：前者启动全量重建（置 initializing、重算 active），后者运行时增量合并。

## 测试策略

- `useResumeSync`（jsdom）：hidden < 30s 不触发 / ≥ 30s 触发；`pageshow persisted` 触发；in-flight 与 5s 去重；非 web bridge 不注册监听；失败 toast 仅一次。
- `app-store.refreshProjects`：新增/删除/更新合并；activeProjectId 保持、被删时回退；不置 `initializing`。
- `bus-store.probeNow` / `chat-session-runtime.probeNow`：OPEN 且新鲜 → 仅 ping；OPEN 且心跳已超时 → close；非 OPEN → 无害不抛。
- fs-watch 消费者：既有测试文件补「resync 事件触发刷新」用例（至少 `useFsWatchRefresh`、`useCustomTheme`）。
- 回归：app/web build、既有 bus-store / streaming-store / app-store 测试全绿；`npm run lint` 0 error。
- 手动验证：iOS PWA 真机挂起恢复（≥30s / bfcache）不 reload、列表与聊天自动追平；桌面 electron 行为不变（hook 被 gate）。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| iOS 半死连接（ping 发出收不到 pong 且探测前无 pending ping） | 收敛仍需至多 ~60s（心跳兜底） | `probeNow` 主动 ping + 5s 短探测把常见情形压到 ~5s；极端情形由既有心跳兜底 |
| resync 期间用户正在操作（如正在重命名会话） | 列表刷新竞态 | `refreshSessions` 本身是 merge 语义、分页 offset 保留；resync 不清空任何本地态 |
| server 不可达/tunnel 重启 | 项目刷新失败 | toast 提示 + WS 既有退避重连；connect 页手动重连路径不变；不做 reload 兜底（见「明确不做」） |
| SW 新版本在长驻页面不生效 | 用户跑旧 chunk | SW autoUpdate 既有行为，与 resume-reload 无关（原 reload 也仅在 hidden ≥30s 时偶然发生）；不处理 |
| 删除 reload 后某未知状态依赖「重启即修复」 | 隐藏 bug 显性化 | 各子系统自愈能力已在背景节逐一核实；E2E/单测覆盖主要路径 |
