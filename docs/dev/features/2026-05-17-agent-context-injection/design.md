# Agent Context 预注入

## 目标

在 `buildAgent()` 时读取 agent profile `context` 字段指定的文件列表，将文件内容注入 systemPrompt，使 agent 从第一轮对话起就了解相关上下文。

## 现状

- `AgentProfile.context?: string[]` 已在类型定义中存在（`packages/core/src/types.ts:21`），YAML frontmatter 解析也已实现（`packages/core/src/store/agent-profile.ts:87`）
- 但 `buildAgent()`（`packages/core/src/engine.ts:149`）未使用该字段

## 设计

### 行为

1. `buildAgent()` 在构建 systemPrompt 后、返回 Agent 前，检查 `profile.context`
2. 若 `context` 存在且非空，逐个读取文件（路径相对于 `projectRoot` 解析）
3. 每个文件内容用 XML 标签包裹：`<context-file path="relative/path.md">...</context-file>`
4. 所有 context 文件汇总为 `## Pre-loaded Context` section 追加到 systemPrompt 末尾
5. 文件不存在时 log warning 并跳过（不阻断 agent 创建）
6. 路径安全校验：`path.resolve` + `startsWith(projectRoot)` 检查，防止路径穿越

### 示例

Agent frontmatter：

```yaml
---
name: 设定顾问
type: chat
context:
  - world/magic-system.md
  - world/factions.md
---
```

注入后 systemPrompt 末尾：

```
## Pre-loaded Context

<context-file path="world/magic-system.md">
...文件内容...
</context-file>

<context-file path="world/factions.md">
...文件内容...
</context-file>
```

## 修改范围

- `packages/core/src/engine.ts` — `buildAgent()` 方法增加 context 文件读取和注入逻辑
- `packages/core/src/__tests__/engine.test.ts` — 新增测试覆盖

### 测试用例

1. profile 无 context 字段 → systemPrompt 不变
2. profile 有 context 且文件存在 → context 内容正确注入 systemPrompt
3. context 文件不存在 → warning logged，跳过该文件，其余正常注入
4. context 包含路径穿越（`../etc/passwd`）→ 跳过该文件
5. context 为空数组 → systemPrompt 不变

## 不涉及

- 前端变更（context 字段已在 UI 类型定义中存在）
- agent profile 解析逻辑（已实现）
