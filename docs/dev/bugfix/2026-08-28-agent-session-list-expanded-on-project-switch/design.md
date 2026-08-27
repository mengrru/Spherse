# Agent Panel Session List 切换项目后偶发全部展开

## 现象

切换项目时，agent panel 的 session list 中所有 agent group 有概率全部变为展开状态，且无法自愈（初始折叠态不再恢复）。

## 排查结论

折叠状态由 zustand store `useAgentSessionListUiStore` 按项目持久化（`collapsedAgentIdsByProject[projectId]`，语义为 **collapsed 集合，空集合 = 全展开**），设计上「切换项目不重置、关闭项目才清除」。`useCollapsedAgents` 内三个 effect 协作：

- 初始化：该项目无 entry 且 agents 非空时，写入 `computeInitialCollapsedAgentIds`（全部折叠、仅 active agent 展开）
- 剪枝：从 collapsed 集合中剔除当前 agents 里不存在的 id
- 边沿展开：activeAgentId 变化时展开其所属 agent

问题出在**剪枝 effect 与 react-query 缓存生命周期不对称**：

1. 用户访问过项目 B（collapsed 集合已初始化且非空）后切到项目 A，B 的 agents query 变为 inactive
2. `queries/client.ts` 只覆盖了 `staleTime: Infinity` / `retry: 1`，未设 `gcTime`（react-query 默认 5 分钟），inactive 超过 5 分钟后 B 的 agents 缓存被 GC
3. 切回 B 的第一帧 `agentsQuery.data === undefined` → `useProjectCatalog` 返回 `agents = EMPTY_AGENTS`
4. 剪枝 effect 以空 `validAgentIds` 运行，把「数据未就绪」误判为「agents 全部被删除」→ `setCollapsedAgentIds(B, [])`，折叠集合被清空
5. agents 重新加载完成后，空集合仍是合法的「已初始化」状态（`!== undefined`），初始化 effect 永不重跑 → 所有 AgentGroup（`Collapsible open={!collapsed}`）永久展开

「有概率」的来源：仅在离开项目超过 gcTime（或 `useApiClient` 瞬时返回 null 导致 query disabled）的窗口内触发；5 分钟内切回时缓存仍在，agents 立即非空，剪枝无害。

## 修复方案

把空 agents 快照视为「目录数据未就绪」而非「agents 全部被删除」，剪枝在此时跳过：

- `use-collapsed-agents-helpers.ts` 新增纯函数 `pruneCollapsedAgentIds(currentCollapsed, agents)`：agents 为空时返回 `null`（不剪枝）；否则返回剔除失效 id 后的集合，无变化时返回 `null`（filter 只删不增，size 不变即无变化）
- `use-collapsed-agents.ts` 剪枝 effect 改用该 helper

刻意不改的备选方案：

- 在 `useProjectCatalog` 暴露 agents 专属 `isPending` 以精确区分「未就绪」与「真空」：能覆盖同样的窗口，但需要扩展 hook 签名与数据链路；「空快照跳过」已覆盖所有 transient empty 场景（GC、refetch 中、client 为 null），代价仅为「项目 agents 真的被删光时 collapsed 集合残留 inert id」——无 UI 影响（无 agent 可渲染），新建 agent 默认展开反而符合直觉
- 给 `queries/client.ts` 设全局 `gcTime: Infinity`：能消除 GC 窗口，但治标不治本（client null / 其他 transient empty 路径仍会踩中），且改变全 app 的缓存语义，影响面过大

## 影响面

- app：`features/agent-session-list/hooks/use-collapsed-agents-helpers.ts`（新增 `pruneCollapsedAgentIds`）、`use-collapsed-agents.ts`（剪枝 effect 改造）、`use-collapsed-agents-helpers.test.ts`（含「空 agents 快照不清空 collapsed 集合」回归用例）
- 其余 package 无变更；store 结构、初始化/边沿展开语义不变
