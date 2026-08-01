# MCP：消费 instructions / resources / prompts

## 背景

当前 MCP 实现（`packages/core/src/mcp/`）只消费了 server 的 **tools**——`connectMcpServer` 调用 `client.listTools()` + `client.callTool()`，其余一律丢弃。MCP 协议在 `initialize` 握手及后续交互中提供的三类信息均未使用：

| 信息 | 来源 | 当前状态 |
|------|------|----------|
| `instructions` | initialize 握手返回的 server 级指导 | **未消费**（`client.getInstructions()` 可读，但无人调用） |
| `resources` / `listResources` / `readResource` | server 暴露的可读资源 | **未实现** |
| `prompts` / `listPrompts` / `getPrompt` | server 暴露的 prompt 模板 | **未实现** |
| `serverCapabilities` | server 声明的能力标志 | **未消费**（`client.getServerCapabilities()` 可读，但无人调用） |

本次需求：让 agent 能消费 MCP server 的 instructions、resources、prompts，使 MCP 连接器真正融入 agent 的上下文与工具集。

## 需求对齐结论（brainstorming）

- **消费模式（resources / prompts）**：采用 **Catalog + tools**——在 system prompt 中列出可用 resources / prompts 的目录（catalog），同时提供 `read_resource` / `get_prompt` 工具让 agent 按需拉取内容。镜像现有 `<skill-catalog>` + `load-skill` 工具的模式：catalog 告诉 agent 有什么，工具让 agent 取具体内容。不做 auto-attach（避免 prompt 膨胀），也不做 tools-only（避免 agent 不知道有什么可用）。
- **instructions 始终进 system prompt**：无论 resources / prompts 模式如何，server 的 instructions 作为 system prompt 的一部分注入。
- **serverCapabilities 用于能力门控**：只在 server 声明了 `resources` / `prompts` capability 时才拉取对应数据和创建工具，避免调用未声明能力导致 SDK 抛 `assertCapability` 错误。
- **范围**：仅消费 instructions / resources / prompts。不做 resource subscription（`resources.subscribe`）、不做 `listChanged` 变更通知、不做 `logging` 订阅。

## 现状调研结论

### 1. MCP 连接生命周期：per-agent、懒加载、跨 session 缓存

- `McpConnectionManager`（`mcp-connection-manager.ts:47`）per-project 单例，按 agentId 缓存 `AgentEntry { tools, connections }`。
- `getTools(agentId)`（line 64）：缓存命中直接返回；否则 `doConnect` → `loadServers(agentId).filter(enabled)` → `connect`。
- `LiveSession.ensureMcpTools()`（`live-session.ts:159`）：在 `sendMessage`（line 126）中**推理前**调用，`mcpMerged` 标志保证每个 session 只执行一次。MCP tools 此时合并进 `agent.state.tools`。
- config 变更 → `invalidateMcpCache(agentId)` 关闭连接、清缓存 → 下次新 session 重新连接。

### 2. system prompt 在 `buildAgent` 中一次性构建，之后不再重新推导

- `LiveSession.buildAgent`（`live-session.ts:279`）构建 `ContextBlock[]` → `serializeSystemPrompt(blocks)` → 写入 `agent.state.systemPrompt`。
- MCP tools 合并发生在 `buildAgent` **之后**（`ensureMcpTools`），只改 `agent.state.tools`，不动 system prompt。
- **关键时序**：`ensureMcpTools` 在首次 `sendMessage` 推理前执行，此时 agent 已存在但尚未做任何 LLM 推理。因此在此处追加 system prompt 内容，模型在首次推理时即可看到——无需改变懒加载生命周期。

### 3. ContextBlock 判别联合 + XML 序列化是自然扩展点

`context/blocks.ts` 定义 5 种 `ContextBlock` variant（`project-instructions` / `agent-profile` / `session-context` / `skill-catalog` / `preloaded-context`），`serialize.ts` 的 `renderBlock` 把每种渲染成 XML 风格标签。`serializeSystemPrompt` 过滤 null 后以 `\n\n` 拼接。

新增 MCP 相关 block 只需：加 variant + builder（空时返回 null）+ renderBlock case。风险低、模式一致。

### 4. MCP SDK Client 已暴露所需方法

`@modelcontextprotocol/sdk` `^1.29.0`，`Client` 类（`client/index.d.ts`）已提供：

| 方法 | 说明 | 额外 round-trip |
|------|------|----------------|
| `getInstructions()` | 读取 initialize 握手缓存的 instructions | 无 |
| `getServerCapabilities()` | 读取握手缓存的 `{ resources?, prompts?, tools? }` | 无 |
| `listResources(params?, options?)` | 列举资源，返回 `{ resources, nextCursor? }` | 有（需翻页） |
| `listResourceTemplates(params?, options?)` | 列举资源 URI 模板 | 有（需翻页） |
| `readResource(params, options?)` | 读取资源内容，返回 `{ contents: ({uri,text}|{uri,blob})[] }` | 有 |
| `listPrompts(params?, options?)` | 列举 prompt，返回 `{ prompts, nextCursor? }` | 有（需翻页） |
| `getPrompt(params, options?)` | 获取 prompt，返回 `{ messages: [{role,content}], description? }` | 有 |

`Client.assertCapability`（line 154）在未声明能力时调用对应方法会抛错——因此必须先用 `getServerCapabilities()` 门控。

### 5. `connectMcpServer` 当前丢弃 Client 实例

`connectMcpServer`（`mcp-client.ts:147`）创建 `Client`，连接后只在 `adaptMcpTool` 的闭包中捕获 `client.callTool`，Client 本身不对外暴露。`ConnectResult` 只有 `{ connection, tools }`。`McpConnection` 接口只有 `serverName` + `close()`。

要让 resources / prompts 工具调用 `client.readResource` / `client.getPrompt`，最一致的做法是在 `connectMcpServer` 内部（Client 已在作用域内）直接创建这些工具——与 `adaptMcpTool` 捕获 `client.callTool` 完全同构。

## 方案对比

### 方案 A（采用）：在 connectMcpServer 内创建一切，info 随连接结果返回

- `connectMcpServer` 连接后按 capability 拉取 instructions / resources / prompts 元数据，同时创建 `read_resource` / `get_prompt` 工具（闭包捕获 client，与 `adaptMcpTool` 同模式）。
- `ConnectResult` 扩展 `info: McpServerInfo`（instructions + resource/prompt catalog）。
- `McpConnectionManager` 的 `AgentEntry` 增加 `info`，`getTools` 改为 `load` 返回 `{ tools, info }`。
- `ensureMcpTools` 合并 tools 后，把 info 序列化为 `<mcp-context>` block 追加进 system prompt。
- **优点**：零新抽象，Client 生命周期不变（仍在闭包内），与现有 `adaptMcpTool` 模式高度一致。
- **代价**：`getTools` → `load` 返回类型变化，需更新唯一调用方和测试。

### 方案 B（否决）：在 McpConnection 上暴露 client / 方法

- `McpConnection` 增加 `readResource()` / `getPrompt()` / `getInstructions()` 方法。
- 工具在 `McpConnectionManager` 层创建（需访问所有 connection）。
- **否决理由**：多一层间接，割裂 Client 闭包模式，`McpConnection` 接口变胖。在当前只有一个消费者（`LiveSession.ensureMcpTools`）时属于过度设计。

## 详细设计

### 1. 新增类型（`packages/core/src/mcp/types.ts`）

```ts
export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgumentDescriptor {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: McpPromptArgumentDescriptor[];
}

// connectMcpServer 拉取后汇总的 per-server 元信息
export interface McpServerInfo {
  serverName: string;
  serverId: string;
  instructions?: string;
  capabilities?: { resources?: boolean; prompts?: boolean };
  resources: McpResourceDescriptor[];
  resourceTemplates: McpResourceTemplateDescriptor[];
  prompts: McpPromptDescriptor[];
}
```

### 2. `connectMcpServer` 改造（`packages/core/src/mcp/mcp-client.ts`）

`ConnectResult` 扩展：

```ts
export interface ConnectResult {
  connection: McpConnection;
  tools: AgentTool[];   // server tools + read_resource/get_prompt（如有 capability）
  info: McpServerInfo;  // ← 新增
}
```

连接成功后的流程：

1. `const instructions = client.getInstructions();`（握手缓存，无 round-trip）
2. `const serverCaps = client.getServerCapabilities();` → `caps = { resources: !!serverCaps?.resources, prompts: !!serverCaps?.prompts }`
3. 拉取 tools（现有逻辑抽成 `tryListTools`，best-effort）
4. 若 `caps.resources`：`tryListResources` 翻页拉取 resources + resourceTemplates；创建 `adaptMcpReadResourceTool`（闭包捕获 `client.readResource`）
5. 若 `caps.prompts`：`tryListPrompts` 翻页拉取 prompts；创建 `adaptMcpGetPromptTool`（闭包捕获 `client.getPrompt`）
6. 返回 `{ connection, tools, info }`

所有 `tryList*` 辅助函数均为 best-effort：失败只 `log.warn` 不中断连接（与现有 `listTools` 失败处理一致）。翻页循环上限 50 页防死循环。

### 3. 新增两个 tool adapter（`mcp/mcp-client.ts`）

**`adaptMcpReadResourceTool(serverName, serverId, readResource)`**

- name：`mcp__{sanitizedServer}_{shortid8}__read_resource`（复用 `makeMcpToolName`）
- label：`{serverName} / read_resource`
- parameters：`{ uri: string }`（typebox `Type.Object({ uri: Type.String() })`）
- execute → `readResource(uri, signal)` → `ReadResourceResult.contents` 映射：
  - `{ uri, text }` → `TextContent`
  - `{ uri, blob }`（base64 + mimeType）→ 若 mimeType 为图片 → `ImageContent`；否则 fallback → `TextContent`（内容为 `data:<mimeType>;base64,...`）
- 错误处理：与 `adaptMcpTool` 一致（返回 text + details.error）

**`adaptMcpGetPromptTool(serverName, serverId, getPrompt)`**

- name：`mcp__{sanitizedServer}_{shortid8}__get_prompt`
- label：`{serverName} / get_prompt`
- parameters：`{ name: Type.String(), arguments: Type.Optional(Type.Record(Type.String(), Type.String())) }`
- execute → `getPrompt({ name, arguments }, signal)` → `GetPromptResult.messages` 序列化为单个 `TextContent`：
  ```
  [prompt: {serverName}/{name}]
  <user> ... </user>
  <assistant> ... </assistant>
  ```
  message content 为 text 时直接取文本；非 text（image / embedded_resource / resource_link）→ `JSON.stringify`。
- 错误处理：与 `adaptMcpTool` 一致

### 4. Context block 扩展（`packages/core/src/context/blocks.ts` + `serialize.ts`）

新增一个 `ContextBlock` variant（合并成一个 `<mcp-context>` 块，内部按 server 分节）：

```ts
| { kind: "mcp-context"; servers: McpServerInfo[] }
```

**`buildMcpContext(servers: McpServerInfo[]): ContextBlock | null`**

- 至少有一个 server 贡献了 instructions / resources / resourceTemplates / prompts 才返回 block，否则返回 null（被 `serializeSystemPrompt` 丢弃）。
- 单个 server 若四项全空，整体省略不渲染 `<server>` 节。

**`renderBlock` 新增 case：**

```xml
<mcp-context>
<server name="Filesystem" capabilities="resources,prompts">
<instructions>
{instructions 文本}
</instructions>
<resources>
<resource uri="file:///foo" name="foo" description=".." mimeType="text/plain"/>
<resource-template uriTemplate="file:///{path}" name="files" description=".."/>
</resources>
<prompts>
<prompt name="summarize" description="Summarize a file">
<arg name="path" required="true" description="File path"/>
</prompt>
</prompts>
</server>
</mcp-context>
```

- 空 section（如某 server 没有 resources）省略对应标签，不渲染空标签。
- 属性值经 XML 转义（与 `skill-catalog` 的 `escapeAttr` 一致）。
- `capabilities` 属性：列出该 server 启用的能力（逗号分隔），便于 agent 理解哪些 MCP server 提供了资源/提示能力。

### 5. `McpConnectionManager` 改动（`mcp/mcp-connection-manager.ts`）

```ts
interface AgentEntry {
  tools: AgentTool[];
  connections: McpConnection[];
  info: McpServerInfo[];   // ← 新增
}
```

- `getTools(agentId)` 改名为 `load(agentId)`，返回 `Promise<{ tools: AgentTool[]; info: McpServerInfo[] }>`。
- `McpConnectFn` 签名同步扩展，`defaultConnect` 收集每个 `ConnectResult.info`。
- `doConnect` 把 `info` 存入 `AgentEntry`。
- 失败连接的 server 不贡献 info（与现有「失败的 server 不贡献 tools」一致）。
- `McpConnectFn` 返回类型从 `{ tools, connections }` 扩展为 `{ tools, connections, info }`。

### 6. `LiveSession.ensureMcpTools` 改动（`packages/core/src/session/live-session.ts`）

```ts
private async ensureMcpTools(): Promise<void> {
  if (this.mcpMerged) return;
  this.mcpMerged = true;
  try {
    const { tools, info } = await this.ctx.mcpConnectionManager.load(this.agentId);
    if (tools.length > 0) {
      const current = this.agent.state.tools;
      this.agent.state.tools = [...current, ...dedupeToolNames(current, tools)];
    }
    const block = buildMcpContext(info);
    if (block) {
      this.agent.state.systemPrompt += "\n\n" + serializeSystemPrompt([block]);
    }
  } catch (err) {
    this.ctx.logger.warn({ err, sessionId: this.sessionId }, "ensure mcp tools failed");
  }
}
```

因 `serializeSystemPrompt` 以 `\n\n` 拼接 blocks，追加 `"\n\n" + serializeSystemPrompt([block])` 与在原 blocks 数组末尾加入该 block 语义等价。

### 时序与边界行为

| 场景 | 行为 |
|------|------|
| 首次 `sendMessage` | `ensureMcpTools` 连接 → 合并 tools + 注入 system prompt → 推理（模型看到完整 MCP context） |
| 同 session 后续消息 | `mcpMerged` 跳过，tools/prompt 不变 |
| MCP config 变更 | `invalidateMcpCache` 关闭连接；**下次新 session** 才生效（与现有 tools 行为一致） |
| 某个 server 连接失败 | 该 server 不贡献 tools 也不贡献 info，其余 server 正常（`Promise.allSettled`） |
| server 无 resources capability | 不创建 `read_resource` 工具，catalog 不含 resources 节 |
| server 无 prompts capability | 不创建 `get_prompt` 工具，catalog 不含 prompts 节 |
| server 无 instructions | `<instructions>` 节省略 |
| 四项全空的 server | 整个省略 `<server>` 节；若所有 server 都省略 → `buildMcpContext` 返回 null，prompt 无变化 |

## 测试计划

| 文件 | 覆盖 |
|------|------|
| `__tests__/mcp/mcp-client.test.ts` | `adaptMcpReadResourceTool`（text / blob→image / blob→fallback / 错误处理）、`adaptMcpGetPromptTool`（message 序列化 / 非 text content / 错误处理）单测，用 mock 函数 |
| `__tests__/mcp/mcp-connection-manager.test.ts` | 更新：`load` 返回 `{ tools, info }`；info 收集、失败 server 不贡献 info、缓存命中返回 info |
| `__tests__/context/serialize.test.ts` | 新增 `mcp-context` block 序列化：有/无 instructions、空 section 省略、多 server、属性转义、全空返回 null |
| `__tests__/mcp/` 新增 connect-fetch 测试 | `tryListResources` / `tryListPrompts` 翻页 + 失败 best-effort（用 mock Client） |

`live-session.test.ts` 暂不改（它刻意不带 `mcpConnectionManager`）；MCP 注入逻辑在 manager 和 client 层已充分隔离测试。

## 文档同步

- `docs/official/architecture.md` MCP 段落：补充 instructions / resources / prompts 消费说明
- `docs/dev/backlog.md`：标记对应条目状态

## 改动清单

1. **`packages/core/src/mcp/types.ts`** — 新增 5 个 descriptor 类型 + `McpServerInfo`
2. **`packages/core/src/mcp/mcp-client.ts`** — `connectMcpServer` 扩展拉取 info + 创建 read_resource / get_prompt 工具；新增 `adaptMcpReadResourceTool`、`adaptMcpGetPromptTool` + `tryListTools`、`tryListResources`、`tryListPrompts` 辅助函数
3. **`packages/core/src/context/blocks.ts`** — 新增 `mcp-context` variant + `buildMcpContext` builder
4. **`packages/core/src/context/serialize.ts`** — `renderBlock` 新增 `mcp-context` case
5. **`packages/core/src/mcp/mcp-connection-manager.ts`** — `AgentEntry` 加 info，`getTools` → `load`，`McpConnectFn` 签名扩展
6. **`packages/core/src/session/live-session.ts`** — `ensureMcpTools` 注入 system prompt
7. **`packages/core/src/__tests__/`** — 更新 / 新增对应测试
8. **`docs/official/architecture.md`** + **`docs/dev/backlog.md`** — 文档同步
