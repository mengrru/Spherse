# 实施计划

依据：`design.md`（同目录）。每项完成后勾选。

## Commit 1：SDK v2 迁移（纯机械）

- [ ] `packages/core/package.json`：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/client@^2.1.0`，`npm install` 更新 lock
- [ ] `mcp/mcp-client.ts`：imports 换 v2（`Client`/`StreamableHTTPClientTransport` 主入口、`StdioClientTransport` 子入口）；Client options 加 `versionNegotiation: { mode: "auto" }`
- [ ] `mcp/mcp-client.ts`：删自研 `paginate`/`MAX_PAGES`，list 调用依赖 SDK 自动聚合，异常捕获转空列表 + warn（含 `ListPaginationExceeded`）
- [ ] 既有测试适配（mcp-client / connect-stdio / mcp-connection-manager 不动逻辑只适配受影响断言）
- [ ] `npm run lint --workspace=packages/core` + `npm run typecheck --workspace=packages/core` + `npm test --workspace=packages/core`（mcp 相关）

## Commit 2：manager 重构 + mcp-client 生命周期（P1/P3/P4/P5/P6）

- [ ] `mcp-client.ts`：`connectMcpServer(config, logger, opts?: { signal?; onDisconnect? })`——signal 贯穿 connect 与 list；连接成功挂 `client.onclose`，`closedByUs` 在 close 前置位不复位；`close()` 5s 超时兜底；stderr 封顶 8KB（保尾部）+ 成功后解绑；修 stale 注释
- [ ] `mcp-connection-manager.ts` 重构：per-server `ServerEntry`、退避（30s 起 ×2 封顶 10min）、per-agent revision / epoch、inflight 覆盖整次 load pass（同 agent 串行化）、每次尝试 20s `AbortSignal.timeout` 预算、epoch 不符关闭不缓存返回空集
- [ ] `capabilities/mcp/index.ts`：memo 基准 `configVersion` → `revision`
- [ ] `mcp-connection-manager.test.ts` 重写（design 测试节全清单）
- [ ] `mcp-client.test.ts`：onDisconnect / closedByUs / signal 超时（fake timers）
- [ ] `connect-stdio.test.ts`：stderr 封顶用例
- [ ] lint + typecheck + core tests

## Commit 3：beforeTurn 自愈 + emit + retry（P2 + backlog:34）

- [ ] `capabilities/mcp/block.ts`：sentinel 包裹
- [ ] `capabilities/mcp/index.ts`：beforeTurn 重合并前剥离 `mcp__` 工具与 sentinel block
- [ ] `store/project.ts`：`updateAgentMcp`（save + emit "updated"）；`project-manager.ts` 委托
- [ ] `session/agent-runner.ts`：`retryLastTurn` applyReload 后补调 `turnHooks.beforeTurn`
- [ ] 测试：p2-behaviors 更新（剥离/重合并/sentinel/retry 带 MCP 工具）；store 层 emit 测试
- [ ] `docs/dev/backlog.md`：删 retry 丢工具条目（backlog:34 附近）
- [ ] lint + typecheck + core tests

## Commit 4：sse 移除

- [ ] `mcp/types.ts` 删 `McpSseServerConfig`、`McpTransportType` 收窄；`mcp/config.ts` normalize 丢弃 sse + `onWarn` 参数；`mcp/index.ts` 导出面清理
- [ ] `store/mcp-config.ts`：可选 logger（AgentStore 传入）转 onWarn
- [ ] `contracts/agents.ts`：删 sse variant + 相关测试
- [ ] `app/agent-mcp`：`TRANSPORT_OPTIONS` 删 sse、类型收窄、表单选项
- [ ] i18n 三 locale 删 `agent-mcp.transport-sse`、注释措辞修正
- [ ] `config.test.ts`：sse 丢弃 + onWarn 用例
- [ ] lint + typecheck + core/app/contracts/i18n tests

## 收尾：verify + doc-sync

- [x] `npm run verify`（全绿）
- [x] doc-sync（capabilities.md / data-conventions.md / ADR-0014 / backlog）
- [x] code review sub agent + 反馈处理（见 design「Code review 处理」）
- [ ] PR

## 实现过程的关键偏差记录（供 review 参考）

1. **v2 `connect` 的 signal 不覆盖 era probe**：`auto` 模式对 stdio 先 spawn 探测进程，probe 只吃 `timeout` 选项不吃 signal（实测挂死）。最终方案：connect 传 `{ timeout: 15s, signal }` + 自建 abortGuard race 整个 connect+list 阶段，manager 侧 20s AbortSignal 兜底。
2. **capability 自愈合并并入 commit 2**：review 后发现 revision 语义与 append-only 合并不兼容（bump 会造成重复追加），提前实现 strip+re-merge。
3. **`node -e script --flag` 会被 node 解析为自身选项**：测试 fixture 改用环境变量传模式。
4. **连接即死竞态**：server 在 connect 成功与缓存之间断开时 onclose 已消费，补 `closed` getter 在缓存与聚合两层校验。
