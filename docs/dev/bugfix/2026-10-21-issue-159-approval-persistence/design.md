# #159 审批持久化与取消可靠性：核实与最小修复

- 日期：2026-10-21
- 状态：已核实（A 阶段结论成立），已实施最小修复
- 类型：bugfix（可靠性 / 故障语义）
- 影响范围：`packages/core`（`control-bus.ts`、`agent-runner.ts`）
- 来源：[#159](https://github.com/mengrru/Spherse/issues/159)

## 1. 核实阶段（A）

### 1.1 基线

- 分支基线 SHA：`c4912ad1f81bef9af90415f2af7f620fc7dcd914`（origin/dev，2026-10-21）
- 核心文件（基线行号）：
  - `packages/core/src/session/control-bus.ts:37-79`（`request` / `resolve` / `rejectAll` / timer）
  - `packages/core/src/session/agent-runner.ts:195-196,256-257`（persistingControlSink 装配）、`308-311`（`abort`）、`457-490`（persistingControlSink 实现）
- 真实调用链（读代码核实，非 issue 行号推测）：
  `withApproval.execute`（`tools/with-approval.ts:20`）→ `approvalGate.request`（`session/approval-gate.ts`，5min 硬编码超时）→ `bus.request`（Promise executor 内 emit `control_request`）→ persistingControlSink：先 `eventLog.append("control/requested")` 再 `onEvent(...seq)`；UI 批准 → ws `resolve_control_request` → `SessionManager.resolveControlRequest` → `AgentRunner.resolveControlRequest` → `bus.resolve`：**先 `entry.resolve(decision)` 再 `emitResolved`（落库 `control/resolved`）**。取消：`AgentRunner.abort` = `rejectAll`（逐项 reject + emitAborted）→ `agent.abort()`。

### 1.2 复现方式

故障注入测试：`packages/core/src/__tests__/session/control-persistence-faults.test.ts`（gate→runner→真实 SQLite 存储接缝；注入层为 `SessionStore.appendEvents`（真实 better-sqlite3 写入前的最后一步）按事件类型选择性抛错，模拟数据库写异常；被测核心方法 `bus.resolve/rejectAll`、runner sink 装配、`AgentRunner.abort` 全部真实）。bus 级 timer/emit 路径用抛错 sink + fake timers（`APPROVAL_TIMEOUT_MS` 硬编码 5min，无法在 runner 层等真实超时；抛错 sink 忠实模型化 persisting sink 的 append 失败模式：同步 throw）。

复现命令：

```bash
npm test --workspace=packages/core -- --run session/control-persistence-faults
```

基线结果：**7 failed / 2 passed**（2 个通过项为健康路径回归锚点：重复 resolve 幂等、健康 abort 全收敛）。

### 1.3 逐项结论

| # | issue 主张 | 基线实测 | 结论 |
|---|---|---|---|
| 1 | resolve 先兑现再持久化，resolved 写失败时等待方已拿到 approved=true，工具仍执行 | 测试 1 RED：`resolveControlRequest` 抛 EIO 的同时 marker 文件已生成（用基线断言变体单独验证：`toThrow(/EIO/)` 且 `existsSync(marker)===true` 通过） | **成立**。定性：用户已批准后的记录提交失败（决策已释放、记录缺失），不是无授权执行；但违反「持久化成功才释放批准」提交点 |
| 2 | rejectAll 单项 sink 异常中断其余 pending 清理，agent.abort 被跳过 | 测试 2 RED：`runner.abort()` 抛 EIO、abortSpy 0 次、`pendingCount===2`（循环中断且 `clear()` 未达）、第二个 waiter 永不收敛、第二条 aborted 记录缺失 | **成立** |
| 3a | timeout 写失败 → 未捕获异常 | 测试 5 RED：vitest 将 timer 回调内 throw 报为 unhandled error（生产中即进程级 uncaughtException） | **成立** |
| 3b | request 事件写失败 → 悬挂 pending/timer | 测试 6 RED：gate reject 后 `pendingCount===1`，推进假时钟后悬挂 timer 触发，对从未落库的 control_request 补发一条孤儿 `control_resolved` | **成立**（与 #159 直接关联） |
| 4 | 持久化失败与已持久化后的 UI 通知失败未区分 | 测试 3/4 RED：(a) resolved 已落库但 onEvent 抛错 → `resolveControlRequest` 照样抛错，与持久化失败不可区分；(b) requested 已落库但 onEvent 抛错 → gate 直接 reject（Promise executor 内 emit），工具失败、pending 悬挂 | **成立**（ conflated，成功事件只一次与重复回复幂等两项在基线即正确） |

证据细节：测试 1 的失败输出（`expected [Function] to not throw an error but 'Error: EIO: simulated disk full on control/resolved append' was thrown`，`control-persistence-faults.test.ts:207`）与其余 6 项见 1.2 命令输出。

### 1.4 关联但不在本次范围

- `ws-chat.ts` resolve/abort handler 对 core 抛错无兜底（修复后 core 不再抛，风险消失；server 侧契约测试另行覆盖）
- abort 后 UI pending 态残留（backlog 已有条目）、#156 shutdown/drain、#157/#158
- 重复 abort 会对同一 requestId 重复落 aborted 记录（本次修复后 rejectAll 先清空 map，二次 abort 不再重复）

## 2. 修复设计（B，最小范围）

统一提交点语义：**control 事件持久化成功才释放决策；持久化失败不放行，等待者收到 rejection 终态；通知（onEvent）失败不影响已提交事实。**

### 2.1 `control-bus.ts`

- `resolve()`：先 `clearTimeout + delete`（防 emit 期间同步重入产生第二条记录），再 `emitResolved`（持久化+通知），成功后才 `entry.resolve(decision)`；sink 抛错时 `entry.reject(err)`，方法本身不再向上抛（等待者有终态；调用方不再见到 unhandled 风险）
- `rejectAll()`：先快照并清空 `pending`，逐项 `clearTimeout + entry.reject`（无条件收敛），`emitAborted` 单项 try/catch 隔离（一项失败只丢该条记录，不中断其余清理、不向外抛）
- timer 回调：`emitResolved` 包 try/catch（失败只丢记录）；随后仍 `resolve(timeoutDecision)`——超时决策是 fail-closed 拒绝，释放无需记录前置
- `request()`：executor 内 `emit(control_request)` 抛错时 `clearTimeout + delete pending + reject(err)`，无悬挂 entry/timer、无孤儿 resolved

### 2.2 `agent-runner.ts`

- `persistingControlSink`：`eventLog.append` 失败照常向上抛（= 持久化失败信号，由 bus 统一转终态）；append 成功后的 `onEvent` 转发包 try/catch + `logger.warn`（UI 通知失败不误判为未持久化：requested 已落库则 gate 继续等待，resolved 已落库则 resolve 正常返回）
- `abort()`：`rejectAll` 包 try/catch（防御性，契约上已不抛）后无条件 `this.agent.abort()`——底层 abort 必达

### 2.3 `tools/ask-user.ts`

- gate rejection 按 message 区分归因：`session aborted` → 原「Question cancelled」结果；其他（持久化失败）→ 新「storage failure」结果，避免模型把存储故障误读为会话中止

### 2.4 不改的部分

- 事件 schema、wire 协议、`swapEventSink` 生命周期、YOLO/错误反馈路径行为不变
- server/desktop 层零改动（core 不再抛错后其现有调用方式即安全）

## 3. 测试

`control-persistence-faults.test.ts` 11 条：修复前 7 RED（见 1.3）/ 2 GREEN（当时共 9 条），修复后全 GREEN；新增「emit 期间重入 resolve 只落一条记录」与 tool/result isError 终态断言（review 反馈）。覆盖：resolved 持久化失败不放行且无悬挂、requested 持久化失败无悬挂无孤儿、rejectAll 逐项隔离 + abort 必达 + 全收敛、timer 失败 contained、通知失败与持久化失败解耦（两种事件 × 已落库断言）、成功路径单条记录 + 重复 resolve 幂等、健康 abort 全收敛。`tools/ask-user.test.ts` 补 storage-failure 归因用例。

## 4. 验证

`npm test --workspace=packages/core`（全量 1395 用例）+ `npm run lint` + `npm run typecheck` + `npm run verify`（全仓）；server 契约测试 `npm test --workspace=packages/server`（394 用例）确认无回归。

## 5. Code review 反馈处理

Review（sub agent，commit `01afe9b9`）：无 critical / important。

- **M-1（已修）**：resolve() 改为 `clearTimeout + delete` 前置于 `emitResolved`，与 timer 路径顺序对齐，消除 emit 期间同步重入的双写面；补重入测试（重入 resolve 只落一条记录）
- **m-1（已修）**：control-bus.ts 最初新增注释按红线移除；后因 eslint `no-empty` 强制保留两处 catch 内注释（与 `event-log.ts:55` 先例一致的故障语义注释）
- **m-2（已修）**：测试 1 补 tool/result `isError` + EIO message 断言，锁死「等待者收到 rejection 终态」
- **m-3（已修）**：ask_user gate rejection 按 message 区分 abort / 存储故障归因，补单测
- **m-4（不修，后续）**：server 侧缺不 mock SessionManager 的 resolve/abort 消费方契约测试——既有缺口，与本修复正交，记为后续事项
- **m-5（不修，后续）**：resolve 持久化失败时 UI 审批卡无终态反馈（需 contracts + i18n 流程），已在 §1.4 声明范围外，记为后续事项
