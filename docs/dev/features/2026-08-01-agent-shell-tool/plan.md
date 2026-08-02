# 实现计划：Agent Shell Tool（run_command）

详细设计见 `design.md`。实现顺序遵循「先打通 core 最小闭环，再接审批往返，最后 renderer」。

## Phase 1 — Core 工具层（可独立测试）

### Task 1：`run_command` 工具（`core/src/tools/run-command.ts`）
- `createRunCommandTool(root)`：参数 `{ command, cwd?, timeout_ms? }`
- spawn：unix `sh -c`（detached 进程组）；windows `resolveWindowsShell()` 回退链 `pwsh.exe → powershell.exe`，`-NoProfile -NonInteractive -Command`
- stdout/stderr 分流捕获，每 chunk 调 `onUpdate` 流式推送；超 `MAX_OUTPUT`(100KB) 截断
- 超时（clamp 1s–600s，默认 60s）/ abort（unix `kill(-pid)`、win `taskkill /T /F`）杀进程树
- 返回 `details={exitCode,stdout,stderr,durationMs,timedOut}` + 结构化 `content`

### Task 2：审批闸门类型 + 包装器（`core/src/tools/with-approval.ts`）
- `ApprovalRequest`（含 `requestId`）/ `ApprovalDecision` / `ApprovalGate` 接口
- `withApproval(tool, gate)`：包 `execute`，先 `gate.request`，拒绝则返回 rejected result（不抛）

### Task 3：注册工具（`core/src/tools/tool-context.ts` + `index.ts`）
- `ToolContext` 加 `approvalGate?: ApprovalGate`
- `createToolsForProject` 注册 `run_command: withApproval(createRunCommandTool(ctx.root), ctx.approvalGate)`
- `run_command` 经 `withApproval` 时 gate 缺省则透传（便于测试）

### Task 4：core 单测
- `run-command.test.ts`：成功/超时/abort/截断/cwd 越界/跨平台 shell 探测（mock spawn）
- `with-approval.test.ts`：批准委托、拒绝返回 rejected、gate 缺省透传

## Phase 2 — Core 审批往返

### Task 5：`SessionControlBus`（`core/src/session/control-bus.ts`）
- 通用 `Map<requestId, PendingRequest>`（带 `kind` 判别）；`request/resolve/rejectAll/setEventSink`
- `APPROVAL_TIMEOUT_MS = 5min`；超时自动 resolve(approved=false)

### Task 6：`ApprovalGate` 适配器（`core/src/session/approval-gate.ts`）
- `ApprovalGate.request` → `bus.request({kind:"approval",...})`，工具层无感知 bus

### Task 7：LiveSession + SessionManager 接线（`core/src/session/live-session.ts` + `session-manager.ts` + `types.ts`）
- `SessionControlEvent` 类型（`control_request`/`control_resolved` + `kind`）
- LiveSession 持有 bus；`create`/`restore` 先建 bus→适配 gate 传 buildAgent
- `sendMessage` 进出时 `bus.setEventSink(onEvent)`/`(null)`；`abort()` 调 `bus.rejectAll`
- 暴露 `resolveControlRequest(requestId, decision)`；SessionManager 同名方法转发

### Task 8：control-bus 单测
- request→resolve、超时、rejectAll、未知 id 忽略、kind 判别、并发

## Phase 3 — Server 传输

### Task 9：contract（`server/src/contracts/websocket.ts`）
- ChatServerEvent 加 `control_request`/`control_resolved`（带 `kind`）
- ChatClientMessage 加 `resolve_control_request`

### Task 10：ws-chat 路由（`server/src/ws-chat.ts`）
- `resolve_control_request` → `sessionRuntime.resolveControlRequest`
- server 对 control 事件仍透传不解释

## Phase 4 — Renderer

### Task 11：事件解析（`app/src/features/chat/agent-event-parse.ts`）
- `control_request`/`control_resolved` 两个 case + parse 分支

### Task 12：streaming-store + reducer（`app/src/features/chat/streaming-store.ts` + `chat-session-reducer.ts`）
- reducer：`control_request` → 置 toolCall `status:"pending_approval"` + 存 `{requestId,command,cwd,timeoutMs}`；`control_resolved` → 清 pending 态
- action `respondApproval(requestId, approved)` → `ws.send resolve_control_request`

### Task 13：CommandCard（`app/src/features/chat/CommandCard.tsx` + dispatch 接入）
- 单组件全生命周期：`pending_approval`（command + 内联 Approve/Reject，Approve destructive）→ `running`（流式 stdout）→ `completed`/`error`
- `types.ts` ChatCard 加 `command` variant；reducer `extractCardDetailsFromPartial`/`buildCardFromToolResult` + `MessageItem.tsx` dispatch

### Task 14：agent 配置高级折叠（`app/src/features/agent-dialog/tool-registry.ts` + `ToolPicker.tsx`）
- `TOOL_GROUPS` 加 run_command 组 + 分组级 `advanced` 标记
- `ToolPicker` 把 advanced 组渲染为默认收起折叠区块

## Phase 5 — i18n + 验证

### Task 15：i18n（`i18n/src/locales/{zh-CN,zh-TW,en}.ts`）
- `tool.run_command`/`tool.run_command_hint`/`tool.advanced_section`/CommandCard 状态文案

### Task 16：验证 + 文档
- `npm run lint`、`npm run build`、各 workspace `npm test`
- 更新 `docs/official/`、`docs/dev/backlog.md`、`AGENTS.md`
