# [Bugfix] Agent list 展开最后一个未展开 session list 时所有 list 收回

## 问题描述

在 agent list 中，当用户逐个展开所有 agent 的 session list 后，展开最后一个折叠的 agent 时，所有 agent 的 session list 会立即自动收回（全部回到折叠状态）。用户无法让所有 agent 同时处于展开状态。

## 根因分析

**Bug 位置**：`packages/app/src/features/agent-session-list/index.tsx:66-77`

```typescript
useEffect(() => {
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const nextCollapsedAgentIds = collapsedAgentIds.size === 0  // ← 问题在这
    ? agents.map((agent) => agent.id)
    : [...collapsedAgentIds].filter((id) => validAgentIds.has(id));
  const changed =
    nextCollapsedAgentIds.length !== collapsedAgentIds.size ||
    nextCollapsedAgentIds.some((id) => !collapsedAgentIds.has(id));
  if (changed) {
    setCollapsedAgentIds(projectKey, nextCollapsedAgentIds);
  }
}, [agents, collapsedAgentIds, projectKey, setCollapsedAgentIds]);
```

**触发链路**：

1. 用户展开最后一个折叠的 agent → `toggleAgentCollapsed` 从 Set 中移除该 agent ID
2. `collapsedAgentIds` 变为空 Set（`size === 0`）
3. `useEffect` 因 `collapsedAgentIds` 依赖变化而重新执行
4. 第 68 行 `collapsedAgentIds.size === 0` 判断为 `true`，将 **所有** agent ID 写入 collapsed set
5. 所有 agent 回到折叠状态

**核心问题**：代码无法区分两种语义不同的 `collapsedAgentIds.size === 0` 场景：

| 场景 | 含义 | 期望行为 |
|------|------|----------|
| 首次加载 / 新项目 | 尚未初始化，需要设置默认折叠 | 全部折叠 |
| 用户手动展开所有 agent | 用户主动操作结果 | 保持全部展开 |

## 修复方案

使用 `useRef<Set<string>>` 跟踪已初始化过的 `projectKey`，将初始化与 stale ID 清理分离。

### 改动：拆分 `useEffect` 并添加 `useRef` 初始化标记

文件：`packages/app/src/features/agent-session-list/index.tsx`

```typescript
const initializedProjectKeys = useRef<Set<string>>(new Set());

// Effect 1: 初始化 — 仅在首次加载某 projectKey 时执行
useEffect(() => {
  if (initializedProjectKeys.current.has(projectKey)) return;
  initializedProjectKeys.current.add(projectKey);
  setCollapsedAgentIds(projectKey, agents.map((agent) => agent.id));
}, [agents, projectKey, setCollapsedAgentIds]);

// Effect 2: stale ID 清理 — agents 变化时移除已不存在的 agent ID
useEffect(() => {
  if (initializedProjectKeys.current.has(projectKey)) {
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const nextCollapsedAgentIds = [...collapsedAgentIds].filter((id) => validAgentIds.has(id));
    const changed =
      nextCollapsedAgentIds.length !== collapsedAgentIds.size ||
      nextCollapsedAgentIds.some((id) => !collapsedAgentIds.has(id));
    if (changed) {
      setCollapsedAgentIds(projectKey, nextCollapsedAgentIds);
    }
  }
}, [agents, collapsedAgentIds, projectKey, setCollapsedAgentIds]);
```

**为什么这样安全**：
- Effect 1 仅执行一次（per projectKey），标记在 `useRef` 中不会因重渲染丢失
- Effect 2 不会再将 `collapsedAgentIds.size === 0` 误判为"未初始化"
- 组件卸载后切换项目时，store 中的 `collapsedAgentIds` 保留；新 projectKey 会触发新的初始化
- stale ID 清理仅在已初始化后生效，不会与初始化竞争

## 行为变化

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 首次打开项目 | 全部折叠 | 不变 |
| 逐个展开所有 agent | 展开最后一个时全部收回 | 全部保持展开 |
| 删除一个 agent | stale ID 被清理 | 不变 |
| 切换项目再切回 | — | 不变（store 保留状态） |

## 影响范围

- `packages/app/src/features/agent-session-list/index.tsx` — 替换 `useEffect`，添加 `useRef`

## 验证方式

1. 创建 2+ agent → 确认默认全部折叠
2. 逐个展开所有 agent → 确认全部保持展开，不会自动收回
3. 展开最后一个后等待 2s → 确认仍保持展开
4. 删除一个 agent → 确认其余 agent 展开状态不变
5. 新建 E2E case 覆盖步骤 1-3

## E2E 测试

在 `packages/app/e2e/agent-list.spec.ts` 中新增以下 case，覆盖以下场景：

- **默认全部折叠**：创建多个 agent 后，确认 agent list 中所有 agent 的 session list 处于折叠状态
- **展开全部不收回**：逐个点击展开每个 agent，展开最后一个后确认所有 agent 仍保持展开
