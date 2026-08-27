# ADR-0002：core 采用微内核 + Capability 贡献点模式

- 状态：accepted
- 日期：2026-08-19
- 影响：`packages/core/src/kernel/`、`packages/core/src/capabilities/`、全部能力模块

## 背景

core 曾以单一 Engine 集中数据委托、session 管理、调度、模型配置、工具管理五重职责；新增横切能力（MCP、memory、trigger……）都要改中心文件，边界靠自觉。

## 决策

- `kernel/` 只含类型与纯组合子、零 I/O；`Capability` 接口定义全部贡献点（tools / contextBlocks / turnHooks / eventMiddlewares / pathRules…）
- 能力模块不 import SessionManager / AgentRunner 实例，依赖一律经注入（SessionPort / ToolHost / StoreRegistry）
- 新增能力 = 新 capability 目录 + 装配点一行注册，不改中心文件；侵入面以 git diff 为验收红线

## 后果

- 正：能力边界结构化，注册顺序即全局载荷语义；删除能力是局部操作
- 负：单接口已达 14 个成员（god interface，拆分调研在 backlog）；分层靠约定维持、ESLint 边界规则未落地

## 原始记录

- `docs/dev/features/2026-08-19-core-kernel-refactor/`
