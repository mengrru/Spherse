# 实现计划：MCP 消费 instructions / resources / prompts

详细设计见 `design.md`。

## Task 1：新增类型（`mcp/types.ts`）

- 新增 `McpResourceDescriptor`、`McpResourceTemplateDescriptor`、`McpPromptArgumentDescriptor`、`McpPromptDescriptor`、`McpServerInfo`
- 从 `types.ts` 导出

## Task 2：扩展 `connectMcpServer` + 新增 tool adapters（`mcp/mcp-client.ts`）

- `ConnectResult` 增加 `info: McpServerInfo`
- `connectMcpServer` 连接后按 capability 拉取 instructions / resources / prompts
- 抽出 `tryListTools`；新增 `tryListResources`、`tryListPrompts`（翻页，best-effort）
- 新增 `adaptMcpReadResourceTool`、`adaptMcpGetPromptTool`

## Task 3：新增 `mcp-context` block（`context/blocks.ts` + `serialize.ts`）

- `ContextBlock` 增加 `mcp-context` variant
- `buildMcpContext(servers): ContextBlock | null`
- `renderBlock` 新增 `mcp-context` case

## Task 4：更新 `McpConnectionManager`（`mcp/mcp-connection-manager.ts`）

- `AgentEntry` 增加 `info: McpServerInfo[]`
- `getTools` → `load`，返回 `{ tools, info }`
- `McpConnectFn` / `defaultConnect` 签名扩展 `info`

## Task 5：更新 `LiveSession.ensureMcpTools`（`session/live-session.ts`）

- 调用 `load` 获取 `{ tools, info }`
- `buildMcpContext(info)` → 追加进 `agent.state.systemPrompt`

## Task 6：测试

- 更新 `mcp-client.test.ts`：新增 read_resource / get_prompt adapter 测试
- 更新 `mcp-connection-manager.test.ts`：`load` 返回 `{ tools, info }`
- 更新 `serialize.test.ts`：`mcp-context` block 序列化

## Task 7：验证 + 文档

- `npm run lint`、`npm run build`、`npm test --workspace=packages/core`
- 更新 `docs/official/architecture.md`、`docs/dev/backlog.md`
