# ADR-0014：MCP 升级 SDK v2（2026-07-28 协议）并移除 sse transport

- 状态：accepted
- 日期：2026-09-29
- 影响：`packages/core`（mcp/、capabilities/mcp/、store/）、`packages/contracts`（mcpServerConfig union）、`packages/app`（agent-mcp 表单）、i18n

## 背景

MCP `2026-07-28` 规范无状态化（删除 `initialize` 握手与协议级 session，新增 `server/discover`），并正式 deprecated Roots/Sampling/Logging 与 HTTP+SSE transport。TS SDK v1.x（`@modelcontextprotocol/sdk`）进入纯维护线、不支持新协议；新协议支持在 v2 模块包 `@modelcontextprotocol/client@2.x`（era 自动协商，legacy server 兼容）。同时 review 发现既有实现六处生命周期缺陷（P1-P6：失败永久缓存、配置变更残留、无断线检测、invalidate 竞态泄漏、connect 无超时、stderr 无界）。

## 决策

- **依赖迁移**：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/client`（era 协商 `auto`：stdio 每 server 多一次探测进程 spawn，接受；异常时降级 `legacy` 只改一处配置）
- **sse transport 直接移除、不留兼容**（用户决策）：normalize 丢弃 sse 条目并 warn，contracts schema 拒绝，UI 下架选项；存量用户 mcp.json 中 sse server 失效，下次整表保存后消失
- 生命周期重构（P1-P6 修复方案）见 design doc；核心语义：per-server 缓存 + 退避重试、per-agent revision/epoch、beforeTurn 自愈合并（`mcp__` 保留前缀 + sentinel block 剥离）、20s 连接总预算
- **超时不依赖 SDK 单点**：实测 v2 connect 的 signal 不覆盖 era probe（probe 只吃 `timeout` 选项），最终用 connect `{ timeout, signal }` + 自建 abortGuard race 双保险

## 后果

- 正：瞬时故障自愈（退避重连 + 断线检测 + 下一 turn 重合并）、单 turn 阻塞上界 ~20s、retry 不再丢 MCP 工具、生态只说 2026-07-28 新协议的 server 可接入
- 负：`auto` 协商对 stdio server 每次连接多一次探测进程（低频操作，开销可接受，见 backlog 跟踪）；sse 存量配置 breaking

## 原始记录

- `docs/dev/infra/2026-09-29-mcp-lifecycle-sdk-v2/design.md`（问题清单、协议调研、决策表与 review 处理）
