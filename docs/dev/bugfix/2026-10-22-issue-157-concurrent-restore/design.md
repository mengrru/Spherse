# #157 并发恢复同一会话：核实与最小修复

- 日期：2026-10-22
- 状态：已核实（A 阶段结论成立），已实施最小修复
- 类型：bugfix（并发 / 生命周期）
- 影响范围：`packages/core`（`session-manager.ts`）
- 来源：[#157](https://github.com/mengrru/Spherse/issues/157)

## 1. 核实阶段（A）

### 1.1 基线

- 分支基线 SHA：`333e67723c45e0073793f64d8c3795b1112b182f`（origin/dev，2026-10-22）
- issue 审视基线为 `bab06342`，所指行号与当前代码一致：
  - `packages/core/src/session/session-manager.ts:53-70`（`restoreSession`：同步 `sessions.has()` 检查 → `await AgentRunner.initForRestore` 异步窗口 → 无条件 `sessions.set()`）
  - `packages/core/src/session/agent-runner.ts:79-100`（`initForRestore`：每次调用新建 `SessionControlBus`、`Agent`、`SessionEventLog.open` 独立内存副本并可能 append 修复事件）
- 真实并发入口（读代码核实）：
  - server `chat/chat-channel.ts:230`：多个客户端（或 WS 与 HTTP 路径）同时打开同一冷会话 channel，各自 `ensureReady → restoreSession`
  - core `trigger/executor.ts:95,102`：trigger 触发（existing_session / reusable_session 模式）与用户打开会话并发恢复

### 1.2 危害链条（代码证据）

1. 双初始化：两次 `initForRestore` 各自创建 `Agent`、`SessionControlBus` 与 `SessionEventLog`（`entries` 内存数组独立、底层同一 SQLite 行集，event-log.ts:12-19）
2. 覆盖：后完成者 `sessions.set()` 覆盖先完成者；若先完成者已开始 turn（busy），`abortSession` 打到新实例，正在运行的 turn 无法中止
3. 日志快照过期：覆盖后 `readSessionEventsAfter` / `getSessionLastSeq`（session-manager.ts:143-168）从新 runner 的旧 `entries` 读取，缺先发布 runner 已落库的事件
4. 事件序号冲突：新 runner 后续 `appendBatch` 以过期 `entries.length` 计算下一 seq，`SessionStore.appendEvents` 的连续性守卫（store/session.ts:243-247）抛 `Event seq must continue at ...`，或命中 `PRIMARY KEY (session_id, seq)` 冲突
5. 修复事件双写：torn log（turn/start 无 turn/end）场景两个并发 `initForRestore` 从同一 base 各算一份 `repairLog` 追加，第二轮被同一守卫拒绝

### 1.3 复现方式

确定性并发测试：`packages/core/src/__tests__/session/restore-concurrency.test.ts`。真实 `createProject` 运行时 + 真实 better-sqlite3 存储，仅按本仓库测试惯例 mock `ModelCatalog`（LLM provider 边界）；「turn 挂起/abort 命中」用例按既有惯例 stub 了 pi-agent-core `Agent` 实例的 `subscribe`/`prompt`/`abort`（第三方库边界方法，非被测核心类）。被测核心 `SessionManager.restoreSession` / `AgentRunner.initForRestore` / 生命周期方法全部真实，无 mock。可控 barrier 为注入的自定义 capability：`tools()` 计数初始化尝试（buildPromptAndTools 早期同步段），`contextBlocks()` 按 session 挂起/放行（存储打开之后、Agent 构建中段）。初始化失败接缝用真实 `readIndex` 的 EISDIR（AGENTS.md 换成目录；project.ts:259-267 仅吞 ENOENT）。

复现命令：

```bash
npm test --workspace=packages/core -- --run session/restore-concurrency
```

基线（修复前）结果：**exit code 1，8 failed / 2 passed**（pretest `npm rebuild better-sqlite3` 成功，全部失败均为业务 `AssertionError`，非安装/编译失败；2 个通过项为健康路径锚点：独立会话并行不受全局串行影响、in-flight 期间跨 agent 请求不干扰本轮）。复核方式：`git checkout 333e6772 -- packages/core/src/session/session-manager.ts` 还原基线实现后运行，退出码与失败明细直接取自 vitest 完整输出（不经管道截断）。

### 1.4 逐项结论

| # | issue 主张 | 基线实测 | 结论 |
|---|---|---|---|
| 1 | 两个并发 restore 各自创建 runner，后完成者覆盖已开始工作的实例 | 双 restore：`AssertionError: expected 2 to be 1`（restore-concurrency.test.ts:158，buildAgent 计数=2，两套 Agent/EventLog）；「先发布实例开始 turn 后滞后者 settle」场景：runner 引用被替换、`agent.abort` 未打到运行中实例（期望 1 次实为 0 次） | **成立** |
| 2 | abort 指向错误实例 | 同上：覆盖后 `abortSession` 命中新 idle runner，busy 实例的 turn 继续运行 | **成立** |
| 3 | 初始化失败语义 | EISDIR 失败：`AssertionError: expected Error … to be Error …`（test.ts:226，两个等待者收到**不同** Error 实例，两次独立初始化）；基线无 in-flight 记录、失败后可重试（本项基线即正确，无「失败后永久卡死」问题） | 部分成立（双实例成立；失败清理基线无缺陷） |
| 4 | 初始化期间 destroy/evict/close 后复活 | 三者基线均 `AssertionError: promise resolved … instead of rejecting`（test.ts:269,297,313）：in-flight restore 照常发布（store 级 archive 有二次 `assertRestorable` 挡住，manager 级完全无防护） | **成立**（issue 未显式列出，属同一交错族） |
| 5 | 身份一致性 | 已发布 runner 下跨 agent restore 基线 `promise resolved … instead of rejecting`（test.ts:350）返回成功（无 agentId 校验）；`sessionExists` 跨 agent 也返回 true | **成立**（issue 建议方向「核验 session/agent/project 生命周期」的补充） |

### 1.5 关联但不在本次范围

- #156 abort-and-drain 全套（本次仅保证 abort 打到正确实例）
- #158 配置存储
- `releaseSession` 与 in-flight 的交错：release 语义为「移除 idle runner」，无 runner 在 map 时返回 false，无需失效标记
- trigger executor 侧的并发入队节流（上游自然受益于 single-flight）
- in-flight 初始化期间 agent profile 更新不会给随后发布的 runner 打 reload 标记（`agent_updated` 只遍历已发布 sessions，session-manager.ts:22-27）：基线同样存在，窗口极窄，需等下一次 `agent_updated` 才 reload，留待后续按需处理

## 2. 修复设计（B，最小范围）

统一语义：**同一 session 的并发恢复共享一次初始化（single-flight，按 sessionId 键控）；初始化失败清理 in-flight 记录、所有等待者收到同一 rejection、后续可重试；发布前核验 store 级有效性 + manager 级失效标记；跨 agent 身份不合并。不同 session 互不串行（无全局锁）。**

### 2.1 `session-manager.ts`

- 新增 `pendingRestores: Map<sessionId, PendingRestore>`，记录 `{ agentId, invalidated, promise }`（显式 deferred 构造，record 一次性完整成型后注册，无占位字段；不用 `Promise.withResolvers`——仓库 target ES2022）
- `restoreSession`：
  - map 快路径：已有 runner 时校验 `getAgentId() === agentId`，不匹配抛 `NotFoundError`
  - pending 命中：同 agentId 返回共享 `promise`；不同 agentId 抛 `NotFoundError`（不合并跨 agent 请求）
  - 新一轮：同步注册 record 后执行 `initializeRunner`；promise settle 后按引用相等（generation）删除自身记录——旧一轮的 finally 不会删除更新一轮的记录
  - 失效窗口语义：destroy/evict/closeAll 置 invalidated 后、pending settle 前，新到的 restore 加入被标记轮次并收到同一 `NotFoundError`（不开启新一轮）；settle 后才能开启新一轮
- `initializeRunner`：保持原有前置 `assertRestorable` / `ensureMigrated` / store-closed 映射；新增两道发布前核验，两条丢弃路径统一 `session.abort()`（现有释放契约：controlBus rejectAll + agent abort；对从未发布的 runner 二者均为 no-op——pi-agent-core `Agent.abort` 为 `activeRun?.abortController.abort()`，无 activeRun 时纯 no-op，无内部定时器/订阅资源，abort 属防御性统一释放）：
  - `record.invalidated`（manager 级失效标记）→ abort + `NotFoundError`
  - 后置 `assertRestorable`（store 级：会话仍 active、agent 仍存在）失败 → abort + 原样上抛
- 生命周期失效标记：
  - `destroySession(sessionId)`：标记该 session 的 pending
  - `evictAgent(agentId)`：标记该 agent 的全部 pending（不影响其他 agent）
  - `closeAll()`：标记全部 pending
- `sessionExists`：map 路径改为按 `getAgentId() === agentId` 判定，与 restore 身份语义一致

### 2.2 明确不做

- 不改 `AgentRunner` / `SessionEventLog` / `SessionStore`（接缝已由 single-flight 消除双实例）
- 不改公共 API 签名；行为修正仅两处收紧：跨 agent restore 由静默成功改为 `NotFoundError`、`sessionExists` 跨 agent 由 true 改为 false
- 不引入全局初始化队列（pending 按 session 键控，不同会话天然并行）

## 3. 测试

`restore-concurrency.test.ts` 10 例：并发共享单次初始化（含第三次顺序 restore 幂等）、先发布实例开始 turn 后滞后者 settle 不覆盖且 abort 命中运行实例、初始化失败同错误拒绝全部等待者且重试新建、独立会话并行、destroy/evict（含他 agent 不受影响）/closeAll/archive 期间恢复失效、跨 agent in-flight 不合并不干扰、已发布 runner 跨 agent 拒绝。#159 审批/取消语义由既有套件回归保护（control-persistence-faults、ws-chat、chat-channel 等全绿）。

## 4. 验证

- `npm test --workspace=packages/core -- --run session/restore-concurrency`：基线实现 exit code 1（8 failed，全部业务断言）；修复后 exit code 0（10 passed）
- `npm test --workspace=packages/core`：1405 passed（含新增 10 例）
- `npm test --workspace=packages/server`：394 passed
- `npm test --workspace=packages/desktop`：280 passed；`packages/i18n` 10 passed；`packages/app` 1415 passed
- `npm run lint`：0 errors（16 warnings 为存量，与基线一致）
- `npm run typecheck --workspace=packages/core`：通过
