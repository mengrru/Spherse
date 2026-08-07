# Agent 编辑热重载 Feature 设计

## 目标

编辑 agent（系统提示词、工具、预加载 context、skill catalog 等）后，已连接的 session 无需断开重连即可在下一轮对话中自动使用新配置。

## 现状分析

编辑 agent 后改动不生效，根因有三层：

1. **Session 创建时一次性"烘焙"配置快照**：`LiveSession.buildAgent()`（`packages/core/src/session/live-session.ts:312-386`）在创建/恢复 session 时读取 profile，把 `systemPrompt`、`tools`、预加载 context、skill catalog 全部序列化后交给 `new Agent({ initialState })`。此后 `this.agent` 为 `readonly`（`live-session.ts:72`），不再重新读取 profile。唯一例外是 `model`——`ensureModel()` 每轮实时解析（`live-session.ts:169-179`）。

2. **编辑路径绕过 Runtime**：`PUT /agents/:id` 路由（`packages/server/src/routes/agent-write.ts:37`）和 `manage-agent` 工具（`packages/core/src/tools/manage-agent.ts:210`）都直接调用 `projectManager.updateAgent()`，绕过 `ProjectRuntime`。而 `ProjectRuntime`（`packages/core/src/project-runtime.ts`）有 `deleteAgent`（→ `evictAgent`）和 `updateAgentMcp`（→ `invalidateMcpCache`），唯独没有 `updateAgent`。

3. **`agent_updated` 事件只刷新前端 UI**：`ws-bus.ts` 将事件转发给 `useAgentBusRefresh.ts`，后者只刷新 agent 列表 UI，无法触达服务端 `SessionManager`。

对比 `deleteAgent`/`updateAgentMcp`/全局 model 变更都会 fan-out 到 live session，唯独编辑 profile 内容没有任何 session 侧通知——这是缺失的接线，而非设计禁止。

## 设计

### 核心机制：`LiveSession` 原地重建

**关键洞察**：reload 只需在下一轮对话开始时应用，无需"立即应用到空闲 session"。因此不引入 `running` 标志、无需锁，极简且无竞态。

`LiveSession` 新增：

- `private pendingReload = false`
- `markReloadPending()`：设 `pendingReload = true`（由 `SessionManager` 调用）
- `sendMessage()` 开头插入 reload 前置检查：

```ts
async sendMessage(message, onEvent) {
  if (this.pendingReload) {
    this.pendingReload = false;
    await this.applyReload();
  }
  this.ensureModel();
  await this.ensureMcpTools();
  // ...原有 agent.prompt 逻辑
}
```

**`applyReload()`** —— 把 `buildAgent` 中"构建 system prompt + tools"的逻辑抽成共享的静态方法 `buildPromptAndTools(ctx, profile, sessionId, skillStore)`，`buildAgent`（初始）与 `applyReload`（重载）共用。`applyReload` 重建后写回 `agent.state`：

```ts
private async applyReload(): Promise<void> {
  const profile = this.ctx.projectStore.getAgent(this.agentId)?.getProfile();
  if (!profile) return; // agent 已删除，跳过
  const { systemPrompt, tools } = await LiveSession.buildPromptAndTools(
    this.ctx, profile, this.sessionId, this.agentSkillStore
  );
  this.agent.state.systemPrompt = systemPrompt;
  this.agent.state.tools = tools;
  this.agent.streamFn = composeStreamFn(this.ctx.sampling, profile.timePerception);
  this.mcpMerged = false; // 重置，让 ensureMcpTools 在本轮重新合并 MCP 工具到新基线
}
```

- `agent.state.systemPrompt` / `.tools` 本就可变（`ensureMcpTools`、`ensureModel` 已在改写），`buildPromptAndTools` 重建的是"基线"配置，重置 `mcpMerged=false` 后 `ensureMcpTools` 把 MCP 工具重新叠加到新基线——顺序天然正确。
- 需要把 `agentSkillStore` 保存为实例字段（当前仅在 `create`/`restore` 时局部使用）。

**无竞态保证**：reload 永远只在 `sendMessage` 内部、`agent.prompt()` 之前执行，单线程独占，不可能与进行中的 `prompt()` 交叉。

### 信号流：编辑如何触达 reload

两条编辑路径最终都调用 `projectStore.updateAgent()`，该方法已 emit `agent_updated` 事件。让 **`SessionManager` 订阅该事件**，统一覆盖两条路径：

```ts
// SessionManager 构造时
projectStore.on("agent_updated", ({ agentId, action }) => {
  if (action !== "updated") return;
  for (const session of this.sessions.values()) {
    if (session.getAgentId() === agentId) session.markReloadPending();
  }
});
```

- **HTTP 路由**（`PUT /agents/:id`）：改为走 `runtime.updateAgent()`（新增，内部委托 `projectManager.updateAgent`），与 `deleteAgent`/`updateAgentMcp` 保持架构一致。事件随后自动触发 reload。
- **manage-agent 工具**（agent 自我编辑）：无需改动——已调用 `projectStore.updateAgent`，事件自动触发 reload。

> 选择事件订阅而非 runtime 显式方法调用的原因：manage-agent 工具路径无法触达 SessionManager，事件订阅是唯一能统一覆盖两条路径的机制，且更解耦。`runtime.updateAgent` 仍保留作为 HTTP 层中介（一致性），但 reload 信号本身走事件。

### `ProjectRuntime.updateAgent`

```ts
async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentStore> {
  return this.projectManager.updateAgent(agentId, content, themeContent);
}
```

仅委托持久化，reload 由事件驱动完成。与 `deleteAgent`/`updateAgentMcp` 并列。

### 边界与错误处理

| 场景 | 处理 |
|------|------|
| session 正在 streaming 时收到 reload | `pendingReload=true`，当前轮用旧配置完成，下一轮自动应用新配置 |
| `applyReload` 读 context 文件失败 | try/catch，log warn，保留旧配置继续运行（graceful degradation） |
| 多次连续编辑 | `pendingReload` 幂等，下一轮 reload 始终读最新 profile |
| agent 被删除 | `action==="deleted"` 不触发 reload；`runtime.deleteAgent` 已 evict 所有 session |
| 改了 model | 仍由 `ensureModel()` 每轮实时解析（既有行为不变） |
| 改了 MCP 配置 | 既有 `invalidateMcpCache` + reload 后 `mcpMerged=false` 重合并，双重生效 |

### 前端

无需改动。`useAgentBusRefresh` 已在 `agent_updated` 时刷新 agent 列表 UI。热重载对用户透明——下次发消息自动用新配置。

## 数据流

```
用户在 UI 编辑 agent
  → PUT /api/projects/:p/agents/:id
  → runtime.updateAgent(id, content)
  → projectManager.updateAgent → projectStore.updateAgent
     ├─ agentStore.saveProfile(content)   // 持久化 + 刷新内存缓存
     └─ emit("agent_updated", { agentId, action: "updated" })
           │
           ▼
  SessionManager 订阅回调
  → 遍历 live sessions，匹配 agentId 的调用 markReloadPending()
  → pendingReload = true

用户在已连接 session 发送下一条消息
  → LiveSession.sendMessage()
  → 检测 pendingReload → applyReload()
     → buildPromptAndTools() 从最新 profile 重建 systemPrompt + tools
     → 写回 agent.state，mcpMerged=false
  → ensureModel() + ensureMcpTools()（重合并 MCP）
  → agent.prompt(message)   // 使用全新配置
```

agent 通过 manage-agent 工具自我编辑时，路径相同，只是从工具直接进入 `projectStore.updateAgent` → emit 事件。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/session/live-session.ts` | 抽出 `buildPromptAndTools`；新增 `pendingReload`/`markReloadPending`/`applyReload`；`sendMessage` 前置 reload；保存 `agentSkillStore` 实例字段 |
| `packages/core/src/session/session-manager.ts` | 构造时订阅 `agent_updated` 事件，对匹配 session 调 `markReloadPending()` |
| `packages/core/src/project-runtime.ts` | 新增 `updateAgent()` 方法 |
| `packages/server/src/routes/agent-write.ts` | `PUT /agents/:id` 改为调用 `runtime.updateAgent` |
| `packages/core/src/session/__tests__/` | 新增 LiveSession reload、SessionManager 事件订阅、defer、错误降级测试 |
