# DeepSeek 网页搜索工具（web_search）设计

- 日期：2026-09-24
- 状态：已实施

## 背景与目标

DeepSeek API 在其 Anthropic 兼容端点（`https://api.deepseek.com/anthropic`）原生支持 Claude Code 的 Web Search：请求 `tools` 中携带 server tool `{"type":"web_search_20250305","name":"web_search"}` 时，服务端自行执行搜索并由模型总结，额外产生模型 token 费用。

目标：让配置了 DeepSeek API Key 的 Spherse 用户，其 agent 可以调用网页搜索。

## 现状与约束

- Spherse 的 DeepSeek 是 pi-ai 内置 provider，走 `openai-completions`（`https://api.deepseek.com`）。DeepSeek 的 Chat Completions / Responses 端点**不支持** web search（Responses API 文档明确 `web_search` 工具被忽略），只有 Anthropic 端点支持
- pi-ai 0.85.1 Anthropic 适配器流式解析只认 `text / thinking / redacted_thinking / tool_use`（`anthropic-messages.js:419-469`），`server_tool_use` / `web_search_tool_result` 被静默丢弃；回放同理（`:976-1034`）；`pause_turn` 被映射为 `stop`（`:1150`）
- Spherse 目前没有任何网页搜索工具

### 真实请求验证（2026-09-24，`deepseek-v4-flash`）

- `tools: [{type:"web_search_20250305", name:"web_search", max_uses}]` 被接受，非流式响应 content 依次为 `thinking?` → `text?` → `server_tool_use{input.query}` → `web_search_tool_result{content: web_search_result[]}` → `thinking?` → `text`，`stop_reason: end_turn`
- `web_search_result` 字段：`title`、`url`、`encrypted_content`（不可读）、`page_age`（均为 null）
- `usage.server_tool_use.web_search_requests` 返回搜索次数
- `thinking: {type:"disabled"}` 可用，省思考 token
- `allowed_domains` 被**忽略**（限定 zh.wikipedia.org 仍返回其他域名）→ 不暴露域名过滤参数
- 最终 text 不带 `citations`；模型会在正文末尾自行附 Sources 列表

## 方案选型

| 方案 | 做法 | 结论 |
|---|---|---|
| A：DeepSeek 主对话切 Anthropic 端点透传 server tool | 覆盖 DeepSeek 模型为 `anthropic-messages` + onPayload 注入 server tool | 否决：全量 DeepSeek 用户换协议（thinking signature、历史回放、工具调用均需重新验证）；pi-ai 丢弃 server 块导致 UI 看不到搜索、回放丢结果；`pause_turn` 提前结束需 patch pi-ai |
| **B：Spherse 自有 client tool `web_search`（采纳）** | 工具 execute 内部单独调用一次 DeepSeek Anthropic 端点（带 server tool），把总结 + 来源作为 tool result 返回 | 与 Claude Code 的 WebSearch 实现同构；主对话链路零改动；tool card / 权限 / 历史回放全部沿用现有机制；任意模型的 agent 都可用 |

## 已确认的产品决策

1. 方案 B：独立 `web_search` 工具
2. 可用条件：**全局配置了 DeepSeek API Key 即可用**，与 agent 主模型无关（费用计入 DeepSeek 账户）
3. 预置「小助手」agent（`preset-agents/assistant.md`）默认勾选 `web_search`；新建 agent 模板（`agent-template.md`）不变，由用户按需勾选
4. 不需要审批（只读网络查询，费用可控：单次调用 `max_uses` 上限 5）

## 设计

### 位置与装配

- 新增 capability `packages/core/src/capabilities/web-search/index.ts`（id `web-search`），加入 `builtinToolCapabilities()`
- 工具实现 `packages/core/src/tools/web-search.ts`，导出 `createWebSearchTool(deps)`；`deps` 注入 `fetch`、`getApiKey`、`now`，便于单测
- 工具名 `web_search`，受 profile `tools` 白名单过滤（沿用 `buildPromptAndTools`）

### 可用性门控（key 是否配置）

- `tools(host)` **始终**返回 `web_search`：保证 `toolCatalog.names` 稳定（`manage_agent` 依赖它校验工具名），agent 配置不会因 key 缺失而失效；`agent.state.tools` 不做任何增删
- 同 capability 提供 `streamDecorators`：每次 LLM 调用时检查 key，**无 key 则从本次请求的 `context.tools` 中过滤掉 `web_search`**
  - 覆盖所有入口（prompt / retry continue / compaction summarize 均经 `agent.streamFunction`），不依赖 `beforeTurn`（`retryLastTurn` 不走 beforeTurn）
  - 不改 `state.tools`，与 MCP `beforeTurn` 的同名去重（`dedupeToolNames`）无交互：MCP 同名工具被重命名为 `web_search__2` 的结果与 key 无关、稳定
  - pi-agent-core 执行工具按 loop context（`state.tools` 快照）查找，过滤只影响模型可见性
  - 效果：设置里新增/删除 key 后下一次 LLM 调用即生效，无需重启或 reload
- key 来源：`process.env.DEEPSEEK_API_KEY`（desktop `applySettingsToEnv` 将设置中的 DeepSeek key 写入该 env，web 壳共享同一进程）。env 名经 `catalog.ts` 新增导出的 `providerEnvKey("deepseek")` 获取（`PROVIDER_ENV_KEYS` 目前是模块私有），不重复硬编码
- execute 时再次读取 key，缺失则抛错（兜底）

### 前置修复：删除 provider key 时清理 env

`applySettingsToEnv` 只在 `creds.apiKey` 存在时写 env，从不删除（`settings.ts:123-130`）——设置里删掉 DeepSeek key 后旧 key 仍在进程内直至重启，web_search 会继续以旧 key 计费（主对话同样受影响）。修复：模块级 `Map<envName, originalValue | undefined>` 记录首次由 settings 写入前的原值，每次 apply 时对 Map 中不再有 key 的 env 恢复原值（原值为 undefined 则 `delete`）并移出 Map。不影响用户启动前在 shell 里设置、且从未被 settings 覆盖的同名 env。补 desktop 单测。

### 请求

`POST https://api.deepseek.com/anthropic/v1/messages`

```jsonc
{
  "model": "deepseek-v4-flash",
  "max_tokens": 4096,
  "stream": false,
  "thinking": { "type": "disabled" },
  "system": "You are an assistant for performing a web search tool use. Today's date is <YYYY-MM-DD>.",
  "messages": [{ "role": "user", "content": "Perform a web search for the query: <query>" }],
  "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 5 }]
}
```

- headers：`x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`
- 信号：`AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])])`（Node 22.19+ / Electron 41 可用）；超时与用户中止给出不同错误信息
- system prompt 中的日期取本地日期（非 `toISOString()` 的 UTC 日期）
- 模型固定 `deepseek-v4-flash`（便宜、够用），v1 不做可配置
- 不走 pi-ai（其 Anthropic 适配器丢弃 server 块），直接 `fetch`；core 不新增依赖

### 工具参数

```ts
Type.Object({
  query: Type.String({ minLength: 2, description: "The search query" }),
})
```

description（LLM 可见，英文）：说明用于获取实时/最新信息、超出知识截止的内容；返回总结与来源 URL；回答时应引用来源；每次调用都产生费用，避免重复搜索同一问题。

### 结果解析与返回

纯函数 `parseWebSearchResponse(body)`：

- `summary`：所有 `text` 块按序拼接（trim 后非空）
- `queries`：`server_tool_use.input.query` 列表
- `sources`：所有 `web_search_tool_result.content` 中 `type === "web_search_result"` 的 `{title, url}`，按 url 去重
- `web_search_tool_result.content` 为错误对象（Anthropic 语义 `{type:"web_search_tool_result_error", error_code}`）时记入 `errors`
- `searchCount`：`usage.server_tool_use.web_search_requests`

tool result：

```
content: [{ type: "text", text: `${summary}\n\nSources:\n- [title](url)\n...` }]
details: { query, queries, sources, searchCount }
```

- sources 为空且 summary 为空 → 抛错 `Web search returned no results`
- **实施调整**：`searchCount === 0` 且无 sources（DeepSeek 未实际搜索、凭模型知识作答）时，结果文本前置 `Note: no web search was actually performed ...`，避免主模型把可能过时的内容当搜索结果引用
- 来源 markdown 链接对 title 中 `[]`/换行、url 中 `()`/空白转义；key 先擦除再截断；key 长度 < 8 不擦除（避免误填短值打碎错误信息）
- 只有 errors 无结果 → 抛错并带 error_code
- HTTP 非 2xx → 抛错，信息含 status 与响应中的 `error.message`（截断到 500 字符）
- 安全：所有错误信息落 session 日志，抛出前对 message 做 key 字符串擦除；不记录请求 headers / init；网络错误不透传 `err.cause`
- `stop_reason === "pause_turn"`：v1 不续跑，按已有内容返回（`max_uses: 5` 下实测未出现）
- 抛错由 pi-agent-core 转为 `isError: true` 的 tool result，UI 显示 ✗

### 前端

- `tool-registry.ts` `TOOL_GROUPS` 新增 `{ label: "tool.web_search", hint: "tool.web_search_hint", toolIds: ["web_search"] }`
- i18n：`tool.web_search` / `tool.web_search_hint`（hint 注明需要配置 DeepSeek API Key、搜索词会发送给 DeepSeek 并产生额外 token 费用——即使 agent 主模型不是 DeepSeek），三语同步
- chat 渲染沿用通用 `ToolItemView`（显示 `web_search → <query>`），v1 不做专用来源卡片

### presets

- `preset-agents/assistant.md` 的 `tools` 加入 `web_search`
- `spherse-guide` skill（`presets/skills/spherse-guide/SKILL.md`）工具表与相关说明补 `web_search`
- sample project（harry-potter）的主题 agent 不加
- 已有项目的 agent 不会自动获得该工具（presets 只在新建项目时初始化），需用户在 agent 工具选择器中手动勾选——已知限制，不做迁移

## 测试

- `packages/core/src/__tests__/tools/web-search.test.ts`（先写）：
  - `parseWebSearchResponse`：用本次真实响应裁剪出的 fixture 验证 summary / sources 去重 / queries / searchCount；错误结果块；空结果
  - execute：请求体形状（model、tools、thinking disabled、headers 含 key）；无 key 抛错；HTTP 4xx 抛错且信息不含 key（响应体回显 key 时被擦除）；超时 / abort 信息区分
- `web-search` capability：streamDecorator 在无 key 时从 `context.tools` 过滤 `web_search`、有 key 时保留且不影响其他工具；`toolCatalog` 含 `web_search`
- `builtin-assembly.test.ts:67-76` / `presets.test.ts` 更新工具列表断言
- desktop：`applySettingsToEnv` 删除 key 后恢复/清理 env
- 手动冒烟：真实 key 下调用一次 execute

## 文档同步

- `docs/official/project-structure.md`：新增 capability 目录与工具文件
- `docs/official/architecture/core.md`（capability 列表若有枚举）
- backlog：新增「web_search 来源专用卡片」「搜索模型可配置 / 其他 provider（Anthropic 原生、智谱等）接入」「`retryLastTurn` 走 `applyReload` 后不执行 `beforeTurn`，MCP 工具在该轮丢失」

## Design review 记录

| 等级 | 意见 | 处理 |
|---|---|---|
| important | 删除 key 后 env 不清理，旧 key 持续计费 | 已采纳：增加前置修复 |
| important | beforeTurn 增删 `state.tools` 与 MCP 同名去重冲突、retry 不走 beforeTurn | 已采纳：改为 streamDecorator 过滤 `context.tools` |
| medium | `PROVIDER_ENV_KEYS` 未导出 | 已采纳：新增 `providerEnvKey` 导出 |
| medium | hint 未提示搜索词发往 DeepSeek | 已采纳 |
| medium | 错误信息 key 擦除、超时/中止区分 | 已采纳 |
| medium | spherse-guide 工具表必须更新 | 已采纳 |
| minor | 本地日期、sample project、error 风格 | 已采纳（本地日期；sample 不加；统一 throw） |
