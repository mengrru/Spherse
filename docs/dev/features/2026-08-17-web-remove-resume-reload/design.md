# Design：web 端去掉后台恢复强制刷新（resume-reload → 重连驱动的数据补偿）

- 日期：2026-08-17
- 状态：已实现（2026-08-17）
- 需求：优化 web 端体验，去掉强制刷新。调研结论：强制刷新是 PR4b 为 iOS PWA 后台挂起选的「最简方案」，用整体 reload 顺带解决数据同步；代价是任何浏览器后台 ≥30s 回前台都白屏重载、丢失滚动位置/路由/浮层/焦点。本设计以「连接恢复驱动的数据补偿」替代，且**推广 chat 侧已验证的 reconcile-on-reconnect 模式到全局**，不做打补丁式的中心编排。

## 背景

### 现状（代码事实）

强制刷新唯一来源：`packages/web/src/resume-reload.ts` 的 `setupWebResumeReload()`（web shell `main.tsx` 启动时挂载）：

- `visibilitychange`：页面 hidden ≥ 30s（`RESUME_RELOAD_THRESHOLD_MS`）后 visible → `location.reload()`；
- `pageshow` 且 `event.persisted`（bfcache 恢复）→ `location.reload()`。

reload 实际替我们做了 5 件事，各子系统自愈现状盘点：

| # | reload 重建的内容 | 当前自愈能力 | 去掉 reload 后的 gap |
|---|---|---|---|
| 1 | bus WS（trigger/agent/fs-watch/debug） | ✅ 完备：指数退避重连（1s→30s）+ 30s 心跳/60s 超时强制断开 + 重连后 `replaySubscriptions`；重连时重读 localStorage baseUrl | iOS 挂起恢复后靠心跳发现死链最长要 ~60–90s，收敛慢 |
| 2 | 每会话 chat WS | ✅ 完备：重连（上限 10 次）+ 心跳 + **重连后 `reconcileHistory` 拉最近 10 turns 补齐漏事件** + 断连横幅/消息防丢失/自动重试 | 同上收敛慢；且要求 `attachedCount > 0` |
| 3 | 项目列表（`app-store.restoreProjects`） | ❌ 仅 App 启动调用一次，无刷新入口 | **最大 gap**：桌面新建/切换项目后 web 端看不到 |
| 4 | agents/sessions 列表 | ❌ `ProjectScope` 有缓存即跳过（`if (cached?.agents?.length) return`）+ 仅靠 bus `agent_updated` 事件驱动 | 断线期间错过的事件不补，列表陈旧 |
| 5 | fs-watch 消费者（file tree / content browser / welcome page / custom theme / agent theme） | ❌ 仅挂载时拉一次 + 事件驱动 | 断线期间文件变化丢失，UI 陈旧 |

其它事实：

- 草稿按 session 存 localStorage（Composer `spherse:draft:<sessionId>`），reload 无损的前提早已成立；去掉 reload 只会更无损。
- 连接配置（baseUrl/token）：bus 重连会重读 localStorage ✅；但 **chat runtime 的 `params.baseUrl` 与 ApiClient 是启动时快照**——tunnel 重启换 URL 后不 reload 不生效；`refreshConnection` 仅桌面 MobileAccessPanel 调用，web 无入口。
- SW `autoUpdate` + inline 注册与 resume-reload 无关，不受本设计影响。
- `resume-reload.ts` 无任何测试。

### 仓库里已有的两个架构锚点（本设计的地基）

1. **reconcile-on-reconnect 先例**（chat 侧）：`chat-session-runtime` 在 WS `onopen` 后调 `reconcileHistory()` 拉最近 10 turns 历史补齐漏掉的事件。语义：「**重连成功 = 可能错过事件 = 用幂等读补偿**」。本设计把这个已验证模式从 per-session chat 推广为全局数据同步范式。
2. **bus-store 即全局连接健康中心**：唯一全局 WS（trigger/agent/fs-watch/debug 四 channel 复用），zustand store（`status` 已被组件消费），已有心跳、退避重连、订阅重放。连接健康信号天然应从这里发出，不需要新的通知机制。

## 方案

### 备选对比

| 方案 | 做法 | 评估 |
|---|---|---|
| A. 直接删除 resume-reload | 依赖既有 WS 自愈 + 用户手动导航刷新 | 不够：gap 3/4/5 真实存在（项目列表永远陈旧） |
| B. visibility 驱动的中心编排（v1 草案，弃） | `useResumeSync` hook 内硬编码四步序列 + 新造 `resync-events.ts` pub/sub | 补丁式：中心编排每加数据域都要改；第三套通知机制与 store 体系并行；触发器选「页面可见性」是 iOS 挂起的代理指标，覆盖不了网络闪断/server 重启等无可见性变化的断连；连接活着时也会无谓全量刷新 |
| **C. 连接恢复驱动（选定）** | bus 重连成功 `onopen` 时更新 `resumedAt` 信号，各数据域自治订阅补偿；visibility 恢复只负责「加速暴露死链」的 probe | 推广既有范式而非新造机制：触发语义准确（WS 曾断开才是「可能漏事件」的权威信号）、覆盖一切断连诱因、无编排中心、扩展与既有 fs-watch 订阅同构 |
| D. 保留 reload 但仅 iOS 判定 | UA/平台 gate | 平台判定脆弱；桌面 web tab 同样受害，治标不治本 |

### 选定方案 C：细节

#### 1. 核心模型

```
各种断连诱因（互不相识）          bus-store（全局连接健康中心）         各数据域（自治订阅，互不相识）

iOS 挂起恢复 ──probe──► resumeProbe()      ┌────────────────────────────────┐
（web shell，仅加速器）  │ 死链 → 主动 close │ replaySubscriptions（既有）     │
                       │                  │ + resumedAt = now   ★唯一新信号 │
网络闪断 ───────────────► onclose（自动）─►│ onopen                          │
server 重启 ────────────► onclose（自动）─►│ 退避重连（既有）                 │
任何端长挂起 ────────────► 心跳超时（自动）►└────────────────────────────────┘
                                          │
             ┌────────────────────────────┼────────────────────────────┐
             ▼                            ▼                            ▼
       项目列表                      agents/sessions              fs-watch 消费者 ×5
       refreshProjects              useAgentBusRefresh           useReconnectedSync(cb)
       （App 挂订阅）                （加一个 resumedAt 订阅）    （与挂 fs-watch 事件同构）
```

三条设计公理：

- **WS 存活 = 数据新鲜**（事件一直在推），什么都不刷——桌面 tab 切走 30s 回来这种「最冤的 reload」场景，现在零动作；
- **WS 曾断开 = 可能漏事件** = 需要补偿——不管诱因是 iOS 挂起、网络闪断还是 server 重启，统一走 `onopen → resumedAt → 各域补偿`；
- **visibility 恢复只是加速器**（iOS 挂起时 WS 静默死、无 onclose，需要有人主动踢一脚暴露死链），不再是数据刷新触发器。

#### 2. web shell：删除 resume-reload，换成一行 probe

- 删除 `packages/web/src/resume-reload.ts`；`main.tsx` 的 `setupWebResumeReload()` 调用替换为 `setupWebResumeProbe()`（同文件新 ~15 行）：监听 `visibilitychange`（hidden ≥ 30s 后 visible）与 `pageshow persisted` → 调 `useBusStore.getState().resumeProbe()` + `useStreamingStore.getState().resumeProbeAll()`。去抖：10s 内重复 probe 忽略。无 i18n、无 UI，仍是薄壳。

#### 3. bus-store：补一个信号 + 一个扳机

- 新增 state `resumedAt: number | null`：每次 `onopen`（含首连）置 `Date.now()`。消费者用 zustand 订阅（`useEffect(..., [resumedAt])`），与现在消费 `status` 同一模式——**不新造 pub/sub 模块**。
- 新增 `resumeProbe()`：非 OPEN → 交给既有重连逻辑（无动作）；OPEN 且 `Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS` → 立即 close（触发重连）；否则发 ping 并安排 5s 短探测，仍无 pong → close。probe 误杀活链的代价 = 一次幂等重连 + 补偿读，可接受。

#### 4. chat 侧：完全复用既有 reconcile，只补提速扳机

- `chat-session-runtime` 新增 `probe()`：`awaitingPongSince` 未定义时立即发 ping 并设 5s 短超时，无 pong → close。死链暴露后走**既有** `scheduleReconnect → onopen → reconcileHistory`，一行数据逻辑都不新增。
- `streaming-store` 新增 `resumeProbeAll()`：遍历 attached sessions 调 `runtime.probe()`。

#### 5. app-store：新增 `refreshProjects(bridge)`（本就该有的刷新入口）

- 调 `bridge.project.restoreProjects()`（web 为 HTTP 只读、desktop 为 IPC，均幂等），然后**合并**进现有 `projects` Map（新增/更新 lastOpened/移除已消失项），**不动 `activeProjectId`**（active 被删才回退）、**不置 `initializing`**（避免全屏 loading 闪烁——这是不能直接复用 `restoreProjects` 的原因）。
- 订阅位置：`App.tsx` 挂 `useEffect(..., [resumedAt])` → `refreshProjects(bridge)`；失败 toast（i18n 三语 `app.resumeSyncFailed`），不 reload。

#### 6. agents/sessions：既有事件驱动 hook 加一种订阅

- `useAgentBusRefresh` 内加 `useEffect`：`resumedAt` 变化 → `refreshAgents` + `refreshSessions`（store action 本身幂等 + merge）。
- `ProjectScope` 的 mount effect（含缓存守卫）**保持不变**——mount 缓存跳过与 resumed 强制刷新是两个正交触发，无需绕过守卫，消除 v1 的补丁感。

#### 7. fs-watch 消费者：与事件订阅同构的一行

- 新增 ~10 行小 hook `useReconnectedSync(cb)`（内部即 `useEffect(() => { if (resumedAt) cb(); }, [resumedAt])`）。
- 五个消费者（`useFsWatchRefresh` / `useContentAutoRefresh` / `useCustomTheme` / `useAgentTheme` / welcome page）各加一行，回调复用各自收到 fs-watch 事件时的既有刷新逻辑（如 `useCustomTheme` 抽出 link 重建函数供 effect 与回调共用）。

#### 8. 扩展模型（可维护性的直接体现）

```
接入新的「事件驱动」数据域：  useBusSubscription(projectId, "fs-watch", cb)
接入新的「可恢复」数据域：    useReconnectedSync(cb)          ← 完全同构，无需改任何中心文件
```

#### 9. 明确不做（记 backlog / 已知限制）

- **chat runtime / ApiClient baseUrl 快照不感知连接变更**：tunnel 重启换 URL 后，已 attach 会话仍连旧地址直到重挂载；手动路径（connect 页重连 → `restoreProjects` 更新 connection → 组件重建）已可用。记 backlog。
- **server `projects` 广播 channel**（Phase2 演进）：bus 加 projects channel 后，项目列表可变纯事件驱动，`resumedAt` 补偿降级为兜底。本次不动 server。
- **resync 失败不回退 reload**：reload 兜底会复活「丢状态」原问题；WS/HTTP 各自退避重试 + toast + connect 页手动路径已构成兜底。
- HTTP polling 降级（维持 PR4b 决策）。

## 接口与数据

| 位置 | 变更 | 性质 |
|---|---|---|
| `packages/web/src/resume-probe.ts`（原 resume-reload.ts 删除重写） | `setupWebResumeProbe()`：visibility/pageshow → probe，10s 去抖 | 薄壳，无数据逻辑 |
| `packages/app/src/stores/bus-store.ts` | + `resumedAt` state（onopen 置位）、+ `resumeProbe()` | 既有健康中心补信号与扳机 |
| `packages/app/src/stores/app-store.ts` | + `refreshProjects(bridge)`（合并语义、保 active、不置 initializing） | 新刷新入口 |
| `packages/app/src/features/chat/runtime/chat-session-runtime.ts` / `streaming-store.ts` | + `probe()` / `resumeProbeAll()` | 提速扳机，reconcile 全复用 |
| `packages/app/src/hooks/useReconnectedSync.ts` | 新增 ~10 行小 hook | 与 `useBusSubscription` 同构 |
| `App.tsx` / `useAgentBusRefresh` / 五个 fs-watch 消费者 | 各加一个 `resumedAt`/`useReconnectedSync` 订阅 | 自治订阅 |
| `packages/i18n` | `app.resumeSyncFailed` 三语 | 仅失败 toast |

- **无** server 契约、持久化、路由、HostBridge 接口变更，无迁移。
- `restoreProjects`（既有）与 `refreshProjects`（新增）语义对照：前者启动全量重建（置 initializing、重算 active），后者运行时增量合并。
- `resumedAt` 首连也置位 → 启动时各域会多一次幂等刷新，与启动本来要拉的数据重合，无害（且让「首连也是一次恢复」语义自洽）。

## 测试策略

- `bus-store`：`resumeProbe` 三分支（非 OPEN 无动作 / OPEN 且心跳已超时立即 close / OPEN 且正常发 ping+5s 短探测）；`resumedAt` 在 onopen 置位、teardown 复位。
- `chat-session-runtime.probe`：活链发 ping 短超时、死链 close、非 OPEN 无害。
- `app-store.refreshProjects`：新增/删除/更新合并；activeProjectId 保持、被删时回退；不置 `initializing`。
- `useReconnectedSync` / `useAgentBusRefresh` / `App` 订阅：`resumedAt` 变化触发一次刷新回调；首连触发可接受（语义见上）。
- `useFsWatchRefresh` / `useCustomTheme`：既有测试文件补「reconnected 触发刷新」用例。
- `setupWebResumeProbe`（jsdom）：hidden < 30s 不 probe / ≥ 30s probe；`pageshow persisted` probe；10s 去抖。
- 回归：app/web build、既有 bus-store / streaming-store / app-store 测试全绿；`npm run lint` 0 error。
- 手动验证：iOS PWA 真机挂起恢复（≥30s / bfcache）不 reload、列表与聊天自动追平；**网络闪断**（无可见性变化）后自动补偿；桌面 tab 后台 30s 回来零动作零 reload；桌面 electron 行为不变。

## 侵入性评估（评审补充）

按「删除 / 改动既有逻辑 / 新增」分类：

| 类别 | 位置 | 量级 | 说明 |
|---|---|---|---|
| 删除 | `resume-reload.ts` + `web/main.tsx` 2 行 | ~26 行 | 需求目标本身，唯一被删的既有行为 |
| **改动既有逻辑** | `bus-store.ts` | **~2 行** | `onopen` 既有 `set()` 加 `resumedAt` 字段 + `teardown` 复位；重连/心跳/退避/订阅重放一行不动 |
| **改动既有逻辑** | `useCustomTheme.ts` | ~10 行 | 机械抽取 link 重建函数，逻辑零变化 |
| 新增 | `resumeProbe()` / `probe()` / `resumeProbeAll()` / `refreshProjects()` / `useReconnectedSync.ts` / `resume-probe.ts` | 全新代码 | 新方法/新文件，不触碰既有执行路径 |
| 新增 | `App.tsx` / `useAgentBusRefresh` / 5 个 fs-watch 消费者 | 各 1~5 行 | 挂订阅，同构于挂 fs-watch 事件 |

侵入性低的结构保证：probe 只调用既有 `close()`（不碰连接状态机）；chat reconcile 原样复用；server 契约零改动；`resumedAt` 是普通 zustand state（无第二套通知体系）；v1 中最有侵入性的两处（绕过 `ProjectScope` 缓存守卫、改 `ProjectScope`）已消除。各改动块相互独立、可单独 revert。

**desktop 语义决策点（唯一行为外溢）**：bus-store 为 desktop/web 共享，`resumedAt` 在 desktop 重连后同样触发补偿（IPC 读 + 列表刷新）。选定 **A. 接受统一语义**：「重连 = 补偿」语义自洽、desktop 读为本地 IPC 代价可忽略、desktop 本就存在同款陈旧问题类（server 重启窗口）、避免订阅点散落 `bridge.kind` 分支。备选 B（信号源一行 gate 到 web、desktop 逐字节不变）保留记录，若实现中发现 desktop 补偿有实际副作用可降级到 B。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| iOS 半死连接（probe 前 5s 内恰无 pong） | 收敛仍需至多 ~60s（心跳兜底） | probe 主动 ping + 5s 短探测把常见情形压到 ~5s；极端情形由既有心跳兜底 |
| probe 误杀活链（网络抖动 pong 慢） | 一次无谓重连 + 全域补偿读 | 幂等读 + merge，无状态丢失；触发条件保守（仅短探测无 pong 才 close） |
| resumedAt 触发多域并发补偿 | 请求突增 | 各域本就分散请求；补偿读均为第一页/浅层（sessions 每页 10 条、history 10 turns） |
| resync 期间用户正在操作 | 列表刷新竞态 | store action 均为 merge 语义；resync 不清空任何本地态 |
| server 不可达/tunnel 重启 | 项目刷新失败 | toast 提示 + WS 既有退避重连；connect 页手动重连路径不变；不回退 reload |
| SW 新版本在长驻页面不生效 | 用户跑旧 chunk | SW autoUpdate 既有行为，与 resume-reload 无关；不处理 |
| 删除 reload 后某未知状态依赖「重启即修复」 | 隐藏 bug 显性化 | 各子系统自愈能力已在背景节逐一核实；chat reconcile 先例已在生产验证该模式 |
