# ADR-0013：feature 门控工具通道（featureTools）

## 状态

accepted

## 日期

2026-09-27

## 影响

`packages/core` kernel（`Capability.featureTools` 贡献点 + `session/agent-assembly.ts` 装配）、`manage_agent` 工具校验面、agent 工具勾选 UI。

## 背景

memory 需要一组自带开关（`profile.md` frontmatter `memory.enabled`）的工具。现有通道只有两个，都不合适：`tools(host)` 受 `profile.tools` 白名单过滤——开关会与白名单形成两个真相源，且白名单 UI 无法表达「feature 整体开/关」语义；MCP 的 `beforeTurn` 动态合并——为配置版本 memo 服务，且有 `retryLastTurn` 不走 beforeTurn 的已知缺口，memory 开关变化频率低（dialog 操作 → agent_updated → 会话重建）用不上动态性。

## 决策

新增 `featureTools(host)` 贡献点：白名单过滤**之后**追加；**不进** `toolCatalog.names`（`manage_agent` 与工具勾选 UI 不可见）；与已挂载工具同名时跳过并 warn。首个使用方为 memory capability（5 工具）。

## 后果

- 工具治理出现两条正交通道：白名单（用户按名授权）与 feature 门（capability 配置整体开关），语义互不可见、不重复授权
- feature 工具对 `manage_agent` 不可见是有意为之（memory 即如此），capability 设计者需自答「该工具是否应让其他 agent 经白名单分配」
- 只适用于低频配置变化（静态重装配即可）；per-turn 动态合并仍走 MCP beforeTurn 模式

## 原始记录

`docs/dev/features/2026-09-26-agent-memory/design.md`（含 design review 对 beforeTurn 缺口与 dedupe 冲突的分析）
