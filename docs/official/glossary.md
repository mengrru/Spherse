# 术语表

> 覆盖：全仓通用的领域术语与重载词——一张表对齐「这个词在 Spherse 里指什么」。
> 每条只给一句定义与权威文档指针，机制细节一律看链接目标。
> 引入新概念时同步本表（doc-sync 检查项）；定义与链接目标冲突时以链接目标为准并修本表。

## Agent 与会话

| 术语 | 定义 | 详见 |
|---|---|---|
| Agent | 拥有独立 system prompt、工具权限、skill、MCP 与触发器的运行实体，目录 `.spherse/agents/{slug}/` | [data-conventions.md](data-conventions.md) |
| agent slug | agent 目录名 = `slugBase`（name 派生）+ `shortId`（UUID 前缀），创建后不变 | [data-conventions.md](data-conventions.md) |
| profile.md | agent 定义文件：YAML frontmatter（name / tools / context / yolo 等）+ system prompt 正文 | [data-conventions.md](data-conventions.md) |
| yolo | agent frontmatter 的自动放行开关：true 时危险工具跳过审批门，文件访问策略不受影响 | [architecture/security.md](architecture/security.md) |
| Session（会话） | agent 的对话单元，存于该 agent 的 `sessions.db`；status 为 active / archived | [data-conventions.md](data-conventions.md) |
| restore | 会话恢复：事件日志校验 + 未闭合 turn 修复 + legacy 迁移 + fold 重建 | [architecture/core.md](architecture/core.md) |
| ChatSessionHub | server 侧 channel 注册表：`Map<projectId:sessionId, ChatChannel>` + 身份守卫删除 | [architecture/chat.md](architecture/chat.md) |
| ChatChannel | 单 session 生命周期对象：restore、run 序列化、快照压缩、握手重放、fanout、空闲销毁；多 WS 连接共享 | [architecture/chat.md](architecture/chat.md) |
| ChatWireProjector | persist→wire 翻译纯状态机：echo、seq 引用配对、run 级 messageId | [architecture/chat.md](architecture/chat.md) |
| 游标重放 | connect 带 `?since=` 时服务端重放 `seq > since` 的原始持久事件，取代 HTTP 对账的增量恢复机制 | [architecture/chat.md](architecture/chat.md) |

## 事件与投影

| 术语 | 定义 | 详见 |
|---|---|---|
| Event Log（events 表） | 消息唯一真相：per-session append-only 事件日志，主键 `(session_id, seq)` | [data-conventions.md](data-conventions.md) |
| fold（投影） | 从事件日志推导内存消息数组的纯函数过程；内存只是可重建缓存 | [architecture/core.md](architecture/core.md) |
| 控制事件（重启点） | `turn/retried` / `turn/withdrawn` / `compaction/applied` 三类事件，restore 时按语义重建 | [architecture/core.md](architecture/core.md) |
| compaction（上下文压缩） | 历史超阈值时生成摘要、以 `compaction/applied` 重启点表达；LLM 双路与机械回退 | [architecture/core.md](architecture/core.md) |
| withdraw（撤回） | 以 `turn/withdrawn {seq}` 锚定被撤回 user message，fold 推导废弃区间 | [architecture/core.md](architecture/core.md) |
| 历史对账 | renderer 重连后拉取历史、按 `_messageId` 去重合并的过程 | [architecture/chat.md](architecture/chat.md) |

## Capability 架构

| 术语 | 定义 | 详见 |
|---|---|---|
| kernel（内核） | core 中零 I/O 的类型与纯组合子层（`kernel/`） | [architecture/core.md](architecture/core.md) |
| Capability（能力模块） | 实现 kernel 贡献点的模块（fs / skill / mcp / trigger / memory 等 14 个） | [architecture/capabilities.md](architecture/capabilities.md) |
| 贡献点 | `Capability` 接口的扩展槽：tools / contextBlocks / turnHooks / eventMiddlewares 等 | [architecture/capabilities.md](architecture/capabilities.md) |
| SessionPort | 能力反向触达会话的窄入口（createSession / sendMessage 等） | [architecture/capabilities.md](architecture/capabilities.md) |
| ToolHost | 工具可见的全部环境：项目、store、mutex、审批/问答门、toolCatalog | [architecture/capabilities.md](architecture/capabilities.md) |
| StoreRegistry | 全局 / per-agent store 注册表，能力在自己 `onAgentDeleted` 里清理作用域 | [architecture/capabilities.md](architecture/capabilities.md) |
| pathRules | capability 声明私有路径的 `PathRule`，裁决优先于内置 category | [architecture/security.md](architecture/security.md) |
| 组合根（composition root） | 依赖装配的唯一起点：desktop main（全局），`assembleProject`（core 内） | [architecture/index.md](architecture/index.md) |
| onAgentConfigChanged | 运行时配置变更统一信号（kind：`mcp` / `tools` / `profile`） | [architecture/core.md](architecture/core.md) |

## 工具与访问控制

| 术语 | 定义 | 详见 |
|---|---|---|
| Tool（AgentTool） | agent 可调用的操作，工厂函数模式 `createXxxTool(projectRoot)` | [architecture/capabilities.md](architecture/capabilities.md) |
| 审批门（ApprovalGate） | 危险工具 execute 前的人工确认（`withApproval` 包装） | [architecture/security.md](architecture/security.md) |
| 问答门（askGate） | `ask_user` 工具向用户提问的同步等待机制 | [architecture/capabilities.md](architecture/capabilities.md) |
| category（PATH_PATTERNS） | 路径语义分类（18 类 + `userFiles` 兜底），access policy 的裁决基础 | [architecture/security.md](architecture/security.md) |
| llmAccessPolicy / serverAccessPolicy | LLM 工具与 server 路由各自的白名单裁决器，基于 category | [architecture/security.md](architecture/security.md) |
| FileWriteMutex | 装配点创建、全链路注入的共享文件写互斥（防并发写撕裂） | [architecture/core.md](architecture/core.md) |
| ModelCatalog | 模型目录；所有权在 desktop main 组合根，注入链上不自建 | [architecture/desktop.md](architecture/desktop.md) |

## Skill 体系

| 术语 | 定义 | 详见 |
|---|---|---|
| Skill | LLM-facing 指令包：`SKILL.md`（frontmatter + 正文）+ 可选附加文件 | [data-conventions.md](data-conventions.md) |
| 三层 skill | builtin / project（`.spherse/skills` 与 `.agents/skills`）/ agent-level，同名取最高优先级 | [data-conventions.md](data-conventions.md) |
| builtin skill | app 内置 skill，从 `PRESET_SKILL_SOURCES` 内存合并、不落盘，随 app 升级 | [packages/presets/README.md](../../packages/presets/README.md) |
| preset skill | `packages/presets/skills/` 下的 builtin skill 源文件，LLM-facing 内容 | [packages/presets/README.md](../../packages/presets/README.md) |
| load_skill | 按需加载 skill 全文的工具，输出经 `<skill-content>` 包裹 | [data-conventions.md](data-conventions.md) |
| skill catalog | system prompt 的 `<skill-catalog>` 块，仅列 name + description | [data-conventions.md](data-conventions.md) |

## 触发器与 MCP

| 术语 | 定义 | 详见 |
|---|---|---|
| Trigger | 自动化触发器：time 型（cron）/ event 型（用户事件），存 `triggers/index.yml` | [data-conventions.md](data-conventions.md) |
| TimerService | time 型触发的调度器：10 分钟墙钟对齐轮询，磁盘为唯一真相源 | [data-conventions.md](data-conventions.md) |
| MCP 连接器（mcp.json） | per-agent 的 MCP server 列表（stdio / http / sse），对 LLM 不可读写 | [data-conventions.md](data-conventions.md) |
| MCP 工具命名 | `mcp__{server}_{shortid}__{tool}`，首 turn 懒合并进 agent 工具集 | [architecture/capabilities.md](architecture/capabilities.md) |

## 数据文件与卡片

| 术语 | 定义 | 详见 |
|---|---|---|
| DataStore | `*.data.json` 的读写单例：原子落盘 + 乐观锁 + 幂等，SDK 与 agent 共用 | [data-conventions.md](data-conventions.md) |
| `$manifest` | data.json 内的业务命名入口声明（queries / mutations），agent 同源产出 | [data-conventions.md](data-conventions.md) |
| outline | `read_data` 无 path 时输出的结构大纲 + manifest 入口签名 | [data-conventions.md](data-conventions.md) |
| HTML Card | `render_card` 渲染的 HTML 卡片；全文仅经 onUpdate 传输、不落库 | [data-conventions.md](data-conventions.md) |
| Image Card | `generate_image` 渲染的图片卡片，三态 generating / done / error | [data-conventions.md](data-conventions.md) |
| preview URL | `/api/projects/:id/preview/` 静态资源代理，HTML 卡 base 注入的基准 | [architecture/server.md](architecture/server.md) |

## UI SDK 与前端

| 术语 | 定义 | 详见 |
|---|---|---|
| UI SDK（`@spherse/sdk`） | 注入 iframe 的浏览器运行时，暴露 `window.spherse` API | [architecture/ui-sdk.md](architecture/ui-sdk.md) |
| HostBridge | renderer 对宿主能力的抽象接口，desktop / web 各有实现 | [architecture/frontend.md](architecture/frontend.md) |
| HostCapabilities | 宿主能力开关声明，renderer 据此条件渲染宿主专属 UI | [architecture/frontend.md](architecture/frontend.md) |
| streaming-store | chat 的 Zustand store，只持 UI 可观察状态与 actions | [architecture/chat.md](architecture/chat.md) |
| timePerception | agent 时间感知配置：感知时间 = 真实时间经锚点 / 流速变换 | [data-conventions.md](data-conventions.md) |
| memory（memory.jsonl） | per-agent 记忆持久化，`memory_save` / `memory_recall` 读写，`<memory>` block 注入 | [architecture/capabilities.md](architecture/capabilities.md) |
