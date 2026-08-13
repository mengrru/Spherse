# Agent Yolo 模式

> 日期：2026-08-14
> 范围：为 Agent 提供一个 per-agent 的「Yolo」开关，启用后跳过工具调用的用户确认环节，使审批门控工具自动放行。

## 背景

当前有 3 个工具受审批门（`ApprovalGate`）保护，执行前必须由用户点击确认：

- `run_command`（执行命令）
- `manage_agent`（创建/更新 agent）
- `manage_trigger`（创建/更新 trigger）

其余文件类工具（`write_file` / `edit_file` / `move_file` / `copy_file` 等）本就无需确认，只受路径访问策略（`access-policy.ts`）硬性约束。

用户希望对某些信任的 Agent 跳过确认环节，让对话更流畅。借鉴 coding agent 圈通用的「yolo mode」语义：自动放行审批门控工具。

## 核心设计

### 行为定义

当 Agent profile 的 `yolo` 为 `true` 时：

- 3 个审批门控工具（`run_command` / `manage_agent` / `manage_trigger`）**跳过用户确认**，自动放行。
- 文件类工具行为不变（本就无确认）。
- 路径访问策略（`access-policy.ts`）**绝不**绕过——这是硬性安全底线。
- 热重载机制已存在（`applyReload` 在每个 turn 前重建 toolset），切换开关后下一条消息即生效。

### 单一改动点

现有架构天然支持此特性。`withApproval` 在 `gate` 为 `undefined` 时即为 no-op（`with-approval.ts:26`）。因此在 `LiveSession.buildPromptAndTools` 构造 `ToolContext` 时，根据 `profile.yolo` 决定是否传入审批门即可。

3 个调用点（`create` / `restore` / `applyReload`）全部经由 `buildPromptAndTools`，单点改动即全覆盖。`controlBus` 仍照常创建（供 abort 等使用），只是不把门传给工具。

## 配置

### AgentProfile 扩展

```ts
interface AgentProfile {
  // ...现有字段
  yolo?: boolean;
}
```

存储在 agent profile 的 YAML frontmatter 中（`yolo: true`），per-agent 独立。未设置或 `false` 时行为与当前完全一致。

### API contract

TypeBox `agentProfile` schema 添加 `yolo: Type.Optional(Type.Boolean())`。

## 实现

### 1. Core 行为（核心）

`packages/core/src/session/live-session.ts` — `buildPromptAndTools`：

```ts
const gate = profile.yolo ? undefined : approvalGate;
const toolContext = new ToolContext(
  ctx.projectStore,
  ctx.fileWriteMutex,
  profile.slug,
  agentSkillStore,
  ctx.triggerManager,
  gate,            // yolo 时为 undefined → withApproval 自动 no-op
  profile.id,
);
```

无需改动任何工具代码。

### 2. 数据模型与解析

- `packages/core/src/types.ts`：`AgentProfile` 添加 `yolo?: boolean`
- `packages/core/src/store/agent-profile.ts`：`parseFile` 添加 `yolo: data.yolo === true`
- `packages/server/src/contracts/agents.ts`：`agentProfile` 添加 `yolo` 可选字段

### 3. 前端序列化

`packages/app/src/features/agent-dialog/agent-markdown.ts`：

- `AgentFormData` 添加 `yolo: boolean`
- `parseAgentMarkdown`：从 frontmatter 解构 `yolo`，解析为布尔（`yolo === true`）
- `buildAgentMarkdown`：仅在 `true` 时写入 frontmatter（避免无意义噪音）

### 4. 前端 UI

`packages/app/src/features/agent-dialog/AgentDialogForm.tsx` — 在「基本」tab 的 `ToolPicker` 之后添加一个开关行：

```tsx
<div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
  <div className="space-y-0.5">
    <Label>{t("agent-dialog.yoloLabel")}</Label>
    <p className="text-xs text-muted-foreground">{t("agent-dialog.yoloHint")}</p>
  </div>
  <Switch
    checked={formData.yolo}
    onCheckedChange={(v) => setFormData((prev) => ({ ...prev, yolo: v }))}
  />
</div>
```

- 复用已有 `Switch` / `Label` 组件，风格与 `TimePerceptionField` 的开关行一致。
- 提示文案说明会跳过哪些工具的确认。不设阻断式确认弹窗——这是用户主动设置的配置项。

### 5. i18n

新增 3 个 locale（`zh-CN` 为基准并带上下文注释，per AGENTS.md）：

- `agent-dialog.yoloLabel`
- `agent-dialog.yoloHint`

## 数据流

```
用户在 AgentDialog 开启 yolo → buildAgentMarkdown 写入 frontmatter
  → 保存 profile.md → ProjectStore.updateAgent → emit agent_updated
  → SessionManager.markReloadPending → 下一条消息触发 applyReload
  → buildPromptAndTools 读到 profile.yolo → gate = undefined
  → ToolContext 无审批门 → createToolsForProject 中 withApproval no-op
  → run_command / manage_agent / manage_trigger 直接执行
```

## 测试

- **`agent-markdown.test.ts`**：`yolo` 经 parse/build 往返保持
- **Core profile 解析测试**：frontmatter `yolo: true` → `profile.yolo === true`；缺省 → `undefined`
- **Core 行为测试**：`profile.yolo` 为 true 时，`buildPromptAndTools` 产出的 `run_command` 工具不携带审批包装（直接执行无需门）

## 明确排除的范围

- 会话级快捷开关（聊天头部 toggle）——需让 `ApprovalGate` 可热切换 + 新增 WS 契约，工作量约翻倍，作为后续迭代
- 路径访问策略放宽——保持硬性安全底线
- LLM 工具描述文案改写（可选打磨，后续再加）
