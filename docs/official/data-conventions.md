# 数据约定

## 世界观项目结构

用户的世界观项目是独立文件夹，结构为 `.spherse/`（系统文件）+ 用户自定义内容目录。

默认系统文件：

```text
project-root/
├── .spherse/
│   ├── project.yaml
│   ├── theme.css
│   ├── agents/
│   │   └── {agent-slug}/
│   │       ├── profile.md
│   │       ├── theme.css
│   │       ├── mcp.json               # 可选：MCP 连接器配置（agent 右键「连接器」对话框管理）
│   │       ├── sessions.db
   │   │       ├── triggers/
│   │       │   ├── index.yml
│   │       │   └── logs.jsonl
│   │       └── skills/              # 可选：agent-level 私有 skill（按需创建）
│   │           └── <skill-name>/SKILL.md
│   ├── generated-images/          # generate_image 工具自动保存的图片（按时间戳+hex 命名）
│   ├── attachments/               # chat 图片输入等用户上传附件落盘（POST /attachments 上传，base64 仅在本轮 LLM 调用瞬间存在）
│   └── skills/
│       └── <skill-name>/SKILL.md
├── AGENTS.md
└── CHANGELOG.md
```

`.spherse/theme.css` 是可选文件，只在用户自定义主题时存在。新项目创建时，系统会自动根据 `presets.json` 创建预置 agent（创建到 `.spherse/agents/`）并创建空的 `.spherse/skills/` 目录（供用户自建 skill）。builtin skill 随 app 内置，通过 `SkillStore` 内存合并，不写入磁盘。

`AGENTS.md` 是可选文件：新项目创建时会写入默认模板，但该文件缺失不影响任何功能（创建/恢复 session 等行为正常，`readIndex()` 返回空串，agent system prompt 仅由 profile 与 skill/context 组成）。

## Project 配置

`.spherse/project.yaml` 对应 `ProjectConfig`：

```yaml
name: My World
created: 1760000000000
welcomePage:
  path: welcome.html
```

模型选择不由项目配置持有，而是由用户级全局设置（`AppSettings.models.text.defaultModel`）决定；项目级不再有 `defaultModel` 字段（老项目 `project.yaml` 中残留的该字段会被忽略，不报错）。

特殊文件路径（`AGENTS.md`、`CHANGELOG.md`、`.spherse/agents/` 等）由 `@spherse/core` 的 `access/path-category.ts` 中 `PATH_PATTERNS` 常量固定，不可配置。

可选字段 `aiAccess.deniedPaths` 是项目相对路径数组，用于同时禁止 AI 工具读取和写入这些路径。路径使用 `/` 分隔，不允许路径穿越，不允许加入 `AGENTS.md`、`CHANGELOG.md` 或 `.spherse` 下任何路径（这些由 access policy 白名单控制）。

可选字段 `welcomePage.path` 是项目相对路径字符串，用于在项目根路由展示用户自定义欢迎页。路径使用 `/` 分隔，不允许路径穿越，不允许 `.spherse` 或 `.spherse/**`，支持扩展名 `html`、`htm`、`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`。保存配置时不要求文件已经存在；渲染时如果预览接口返回 403/404 或请求失败，前端回退到默认空状态。

## Agent 定义格式

Agent 定义是 Markdown 文件 + YAML frontmatter，存放于 `.spherse/agents/{agent-slug}/profile.md`。agent slug（目录名）由 `slugBase` 与 `shortId`（agent UUID 去连字符后的前 6 位）拼接而成，形如 `world-builder-a1b2c3`。`slugBase` 由 `deriveAgentSlugBase` 从初始 agent name 派生（trim、小写、空白替换为连字符、仅保留 `[a-z0-9\u4e00-\u9fff-]` 以兼容中文名、折叠连续连字符、去首尾连字符、截断 40 字符，为空时回退 `agent`）；`buildAgentDirName` 在目录名已存在时依次把 shortId 加长到 8/10/12 位，仍冲突则追加 `-2`/`-3`… 后缀。agent id 恒由 core `crypto.randomUUID()` 生成。目录名在创建时生成，之后不再变（`manage_agent` 的 `update` 也不会改动 id 与 slug）。

Agent 聊天窗口主题存放于同目录的 `theme.css`。该文件由 Agent Dialog 的“主题”标签页编辑，正常新建流程会从 `@spherse/presets` 的 `agent-theme-template.css` 初始化。文件不存在时读取结果为空字符串，聊天窗口使用全局默认样式。

Agent 的 MCP 连接器配置存放于同目录的 `mcp.json`（可选文件）。由 agent 右键菜单「连接器（MCP）」对话框管理，记录该 agent 启用的 MCP server 列表（stdio 子进程 / http streamable / sse 三种传输方式，每项含 `id`/`name`/`enabled`/`transport` 及对应的连接参数）。运行时按 agent 维度连接所有 `enabled` 的 server（连接按 agent 缓存、跨会话共享），将发现的工具以 `mcp__{server}_{shortid}__{tool}` 命名（`shortid` 为 server id 前 8 位）合并进该 agent 的工具集——合并发生在首次向会话发送消息时（懒加载），而非会话创建时。连接时还按 server capability 消费 instructions / resources / prompts：server `instructions` 连同 resources / prompts 目录序列化为 `<mcp-context>` block 注入 system prompt；声明 `resources` capability 的 server 创建 `read_resource` 工具，声明 `prompts` capability 的 server 创建 `get_prompt` 工具。单个 server 连接失败不影响其它 server（降级为告警，不阻断会话）。连接在 MCP 配置更新 / 删除 agent / 项目关闭时断开（由 `McpConnectionManager.invalidate` / `closeAll` 处理）。文件不存在时视为无连接器。该文件可能含 `headers`/`env` 等敏感信息，因此对 LLM 工具不可读写（`agentMcp` category，不在 LLM 读/写白名单内）。

必需字段：

- `name`：展示名称

常用可选字段：

- `alias`：别名，设定后显示在助手消息气泡上代替 `name`；未设置或留空时回退到 `name`
- `id`：UUID，首次读取缺失 id 的文件时自动生成并回写；设计意图为不可变
- `createdAt`：创建时间，Unix epoch milliseconds；创建时自动生成，之后保持不变
- `model`：覆盖项目默认模型
- `tools`：允许使用的 tool 名称列表；缺省时不分配任何工具（空列表）
- `context`：项目根目录内相对路径列表，SessionRuntime 构建 system prompt 时预读取并注入
- `output`：预留的输出路径、命名和 frontmatter 配置
- `timePerception`：时间感知配置（per-agent），启用后 Agent 在对话中看到的时间线可与真实世界不同步。含 `enabled`（布尔）、`epochMs`（锚定真实时刻）、`startMs`（感知时间起点）、`flowRate`（感知/真实时间比率，1 = 正常速度）、`timeZone`（可选 IANA 时区名）。感知时间由纯函数 `perceivedMs = startMs + (realMs - epochMs) × flowRate` 从每条消息的真实时间戳推导，通过模块级函数 `composeStreamFn` 在 streamFn 边界对每条 user 消息注入 `<time>感知时间</time>` XML 标签（不持久化），system prompt 的 `<session-context>` 标记是否启用并指示 Agent 不要在回复中输出 `<time>` 标签。

示例：

```markdown
---
id: 550e8400-e29b-41d4-a716-446655440000
createdAt: 1760000000000
name: Historian
model: glm-4.5-air
tools:
  - read_file
  - write_file
  - edit_file
context:
  - AGENTS.md
  - lore/timeline.md
---

Agent system prompt content...
```

## 触发器数据

触发器配置存储在 `.spherse/agents/{agent-slug}/triggers/index.yml`，YAML 数组格式，每个元素为 `TriggerEntry`：

```yaml
- id: uuid
  type: time
  name: 每日回顾
  enabled: true
  cron: "0 9 * * *"
  mode: reusable_session
  message: "回顾进展 {{date}}"
  notify: true
  notificationMessage: "每日回顾已发送"
  createdAt: 1749600000000
  updatedAt: 1749600000000
  boundSessionId: sess-abc123
```

`type` 区分两种触发方式：`time`（cron 定时触发，需配 `cron` 字段）和 `event`（用户事件触发，需配 `eventName` 字段）。`mode` 支持三种会话策略：`reusable_session`（新建 trigger 的默认值）首次触发时新建一个会话并绑定，之后每次触发复用该会话，绑定 ID 记录在 `boundSessionId` 字段（仅由运行时写入）；`new_session` 每次触发都新建会话执行；`existing_session` 在用户指定的已有会话中执行，需配合 `targetSessionId` 字段填写目标会话 ID。`reusable_session` 模式下若绑定会话已被删除，下次触发会自动新建并重新绑定；用户可通过 `POST .../triggers/:triggerId/reset-binding` 主动解除绑定。`notify` 为 `true` 时，renderer 会在任务完成后显示通知；`notificationMessage` 为可选自定义通知内容。event 类型触发时，`payload`（字符串）通过 `{{payload}}` 模板变量注入 `message`；`sp:` 前缀为内部事件保留（如 `sp:time-tick`）。

执行日志追加写入同目录下的 `logs.jsonl`，每行一个 JSON 对象。日志包含 `id`、`agentId`、`triggerId`、`status`、`triggeredAt`、`completedAt`、`error`、`sessionId`、`agentName`、`triggerName`、`eventName` 等字段，用于运行日志 UI 展示与问题排查。日志文件超过 2MB 时保留最近 5000 行。

触发器中 `type: time` 的条目由 TimerService 按 10 分钟轮询检查 cron 命中情况，实际执行时间可能比 cron 表达式指定时间延迟数分钟；`type: event` 的条目在收到对应用户事件时立即触发。TriggerManager 以磁盘为唯一真相源，每次 tick / 事件都从磁盘重新读取 trigger 配置。

## Session 数据

每个 agent 拥有独立的 SQLite 数据库文件，位于 `.spherse/agents/{agent-slug}/sessions.db`。`sessions` 表保存列表元数据：`id`、`agent_id`、`title`、`created_at`、`updated_at`、`status`、`source`，以及为会话分支预留的 `parent_session_id` / `fork_seq` 与 legacy 迁移标记 `migrated_at`。每个 session 的状态为 `active` 或 `archived`。

新会话历史写入 append-only `events` 表，主键为 `(session_id, seq)`；事件信封包含 `type`、会话内连续 `seq`、`time`、JSON `data` 与 `schema_version`。当前事件词汇表为 `turn/start`、`turn/end`、`user/message`、`assistant/message`、`tool/result`、`compaction/applied`、`turn/retried`。运行时消息由事件 fold 投影，内存消息数组只是可重建缓存：compaction 和 retry 均追加重启点事件，不修改或删除历史事件；崩溃恢复发现未闭合 turn 时会持久化合成错误 toolResult 与 aborted turn/end，保证二次恢复幂等。

升级前的 `messages` / `compactions` 表保留只读，用于迁移前的历史展示，不再作为新写入路径。首次 restore（包括打开聊天、静默发送和 trigger 复用）会在单个 SQLite 事务中把旧历史惰性转换为 events 并写入 `migrated_at`，然后继续恢复可写会话。旧表数据原样保留，迁移幂等且完全属于 core 内部实现，不暴露客户端迁移 API 或状态字段。

`sessions.title` 是可选的用户可编辑展示标题。用户重命名 session 时只更新 `title`，不更新 `updated_at`，因此不会改变 session 列表按最近对话活动排序的行为。

删除 agent 时，ProjectRuntime 关闭该 agent 的 DB 连接并删除整个 agent 目录，`sessions.db` 随 `profile.md`、`theme.css`、`mcp.json` 一起移除。

## System Prompt XML 约定

所有 system-prompt section 用语义化 XML 标签包裹，不用 markdown 边界（`---` / `## H2`）。保留 tag 注册表（避免后续命名冲突）：

| XML tag | 用途 |
|---|---|
| `<project-instructions>` | AGENTS.md 内容 |
| `<agent-profile>` | agent profile 主体 |
| `<session-context>` | 当前会话上下文（agent name/alias/slug, session id，key-value 格式；时间感知启用时含 `time-perception: enabled` 标记） |
| `<skill-catalog>` | 可用技能目录（仅 name+description） |
| `<skill-item name="…" description="…"/>` | 单个技能条目（自闭合，嵌套在 skill-catalog 内） |
| `<preloaded-context>` | 预载文件区 |
| `<context-file path="…">` | 单个预载文件（嵌套在 preloaded-context 内） |
| `<skill-content name="…">` | load_skill 工具返回的技能全文 |
| `<compaction-digest covers="…">` | 压缩历史摘要（合成消息） |

agent profile 的 `context` 字段指定的文件通过 `<preloaded-context>` / `<context-file>` 注入 system prompt；`<skill-catalog>` 仅列出技能的 name + description，agent 需要完整指令时调用 `load_skill` 工具获取被 `<skill-content>` 包裹的全文。会话历史超过上下文窗口阈值时触发 compaction，将早期消息压缩为 `<compaction-digest>` 包裹的扁平化文本摘要，作为合成 user 消息保留（详见 `docs/dev/features/2026-07-02-context-engineering/design.md`）。

## Skill 定义格式

Skill 有两个来源：builtin skill（app 内置只读，随 app 升级更新）和 project skill（`.spherse/skills/<skill-name>/SKILL.md`，用户自建可读写）。两者按 name 合并，project 同名覆盖 builtin。格式均为 YAML frontmatter + Markdown body。project skill 目录除 `SKILL.md` 外，还可携带附加文件（如 `references/*.md`、`scripts/*.js`、`assets/*`），与 `SKILL.md` 同目录放置。

`SkillDefinition` 的 `source` 字段标识来源（`builtin` 或 `project`）；builtin skill 的 `filePath` 为合成路径 `builtin://<dir>/SKILL.md`。`SkillDefinition` 的 `files` 字段为 `string[]`，列出 skill 目录下（不含 `SKILL.md`）附加文件的 posix 风格相对路径；无附加文件或 builtin skill 时为 `[]`。`SkillStore` 在解析 project skill 时递归枚举其目录（跳过 hidden/`node_modules`/`.git` 条目）填充该字段。

必需字段：

- `name`
- `description`

Markdown body 会作为完整 instructions 被 `load_skill` 工具按需加载。当 project skill 带有附加文件（`files` 非空）时，`load_skill` 输出会在指令末尾追加 `## Skill Files` 段，逐项列出附加文件在项目内的完整相对路径，并提示 agent 用 `read_file` 工具读取；builtin skill 因 `files` 恒为 `[]` 不输出该清单。

项目 skill（`source: project`）可通过 UI 创建与安装：前端 SkillPanel 调用 `POST /api/projects/:projectId/skills`（body：name/description/instructions）创建，或经原生文件选择器选 zip 后调用 `POST /api/projects/:projectId/skills/install`（body：zipPath 绝对路径）安装。zip 约定：顶层有且仅有一个技能文件夹，内含合法 `SKILL.md`，frontmatter `name` 须与文件夹名一致；同名冲突时返回 409，不覆盖。写逻辑实现在 `SkillStore.createSkill/installSkill`，`ProjectManager` 为纯委托。

```markdown
---
name: my-skill
description: A brief description of the skill
---

Full skill instructions in Markdown...
```

## 内容文件

- 创作内容使用项目根目录下的普通文件，优先使用 Markdown/YAML/HTML 等人类可读格式
- 内容浏览 API 会过滤 `.spherse`、`node_modules`、`.git` 和 dotfile/dotdir，避免系统文件进入常规创作视图
- 文件读取、写入、删除、新建文件、新建目录都必须做 `path.resolve` 后的项目根目录边界校验
- AI 工具（read_file/write_file/edit_file/list_files/search_content/move_file/copy_file/render_card）和 server 通用路由（content/preview/images）的读写权限由 `@spherse/core` 的 access policy 统一管理：`categorizePath` 将路径分类为语义 category，`llmAccessPolicy`/`serverAccessPolicy` 基于 category 白名单控制读写范围
- 会写文件的 agent tools 共享 `FileWriteMutex`，避免同一文件并发写覆盖
- **二进制文件处理**：`read_file` 和 `search_content` 通过 null-byte 启发式（前 8KB 采样）检测二进制文件。`read_file` 检测到二进制时拒绝读取并返回提示（图片文件引导使用 `render_card` 展示）；`search_content` 静默跳过二进制文件。server content 路由同样用 `isBinaryBuffer`（前 8KB 采样）嗅探，二进制文件返回 `binary:true` + 空 content（白名单文本格式 md/html/image 含 ico 走专属 viewer，其余二进制由前端 Content Browser 渲染占位卡 `UnsupportedFileCard`，桌面端经 `HostCapabilities.openFileExternal` 提供「用默认应用打开」按钮）
- **`.spherse` 元数据目录**：`list_files` 和 `search_content` 默认不列出/搜索 `.spherse` 目录及其子路径（参数 `include_meta`，默认 false）；设置 `include_meta=true` 可进入。`spherseOther` category（`.spherse/**` 兜底）对 LLM 可读；`agentSessions`（`sessions.db*`，含 WAL/SHM sidecar）与 `agentMcp`（`mcp.json`，可能含 headers/env 敏感信息）始终不可读

## 活网页数据文件（`*.data.json`）

「活网页」的数据载体：HTML 页面（UI SDK `data.*` action 或 `fetch`）与 agent（`read_data`/`query_data`/`mutate_data` 工具）共同读写。

- 命名约定 `{页面名}.data.json`，与 HTML 同级；不能放在 `.spherse/` 下（HtmlCard 场景的 `.spherse/data/cards/` 例外）
- 顶层 `$` 前缀键为平台保留（如 `$manifest`）：SDK 写入拒绝、`data.keys`/`data.entries` 不返回、dot-path 寻址不可达
- 所有写入（SDK 经 server `/data/read|raw-set|raw-delete|mutate` 路由、agent 经 data capability）汇入 core `DataStore` 单例：tmp+rename 原子落盘、`FileWriteMutex` 锁内完成读-改-写、内容哈希 version + `ifVersion` 乐观锁、`idempotencyKey` 幂等、`origin`（sdk/agent）变更事件
- **写入粒度约定**：集合的结构性增删改走 `data.mutate`（SDK）/`mutate_data`（agent）同一套 manifest 入口（锁内 item 级原子，并发互不覆盖）；`data.set` 仅适合单值/低冲突数据，对数组整体 set 会覆盖并发写入
- agent 首次接触文件用 `read_data`（不带 path）获取 outline：结构大纲 + `$manifest` 入口签名（`name!`/`name?` 标注必填/可选）；无 manifest 的存量文件自动降级为 outline + dot-path 局部读（数组默认 20 条分页）+ `edit_file`/`write_file` 整文件改
- `$manifest` 由页面生成时的 agent 同源产出（`spherse-build-data-app` / `spherse-write-html` skill 约束），声明业务命名的 `queries`（enum 过滤/sort/dir/identity 游标分页）与 `mutations`（append/update/remove/set + fields 类型校验 + auto 补全 uuid/nowIso + match 定位）；执行时锁内现场校验路径，失配报 `manifest_stale`/`unknown_entry`（附 valid names），不信任缓存健康度
- 数据文件损坏（撕裂 JSON）报 `file_corrupted`，不自动修复

## HTML Card

`render_card` tool 支持以下数据来源：

- `file_path`（推荐）：项目根目录内的文件相对路径。
  - HTML 文件：注入 `<base href="${apiBase}/preview/{dir}/">`（文件所在目录），使相对资源（图片/CSS/JS）按文件系统目录关系解析
  - 图片文件（png/jpg/jpeg/gif/webp/svg/ico）：**不**以文本读取，前端直接以 `<img src="${previewUrl}">` 渲染，避免二进制被当 UTF-8 读成乱码
- `content`：直接提供 inline 自包含 HTML（无外部资源引用）。注入 `<base href="${apiBase}/preview/">`，使相对路径相对于项目根解析

tool update 的 `details.type === "html"` 时，前端 chat 会按 HTML card 渲染。

HTML 全文仅通过 `onUpdate`（`tool_execution_update`）传给前端，**不**包含在 tool 返回值的 `details` 中（避免持久化到 DB 和浪费 context window）。历史恢复时：inline 来源从 tool call 的 `arguments.content` 重建；HTML 文件来源经 preview URL 重新加载；图片来源仅凭 `details.file_path` 重建（前端按扩展名识别为图片直接渲染，无需读取文件内容）。

## Image Card

`generate_image` tool 接收文本 prompt（及可选 `size` / `quality` 参数），调用 pi-ai 图片生成 provider（OpenRouter、智谱或 OpenAI）生成图片，自动保存到 `.spherse/generated-images/{yyyyMMddHHmmss-UTC}-{4hex}.{ext}`。文件名基于 UTC 时间戳 + 4 位随机 hex，避免并发写冲突，不使用 `FileWriteMutex`。成功返回时 content text 包含图片存储路径。图片生成成功后自动以卡片展示，无需额外调用 `render_card`。

`size` / `quality` 参数按 provider 能力透传：OpenAI 与智谱读取后写入各自请求体；OpenRouter（pi-ai 内置）忽略未知字段。各模型支持的具体取值不同（详见各 provider API 文档），留空则用模型默认值。

tool update 的 `details.type === "image"` 时，前端 chat 会按 image card 渲染（三态：generating / done / error）。`done` 态通过 `GET /api/projects/:projectId/preview/<relPath>` 加载图片，卡片右上角提供导出按钮（经 `POST /api/projects/:projectId/images/export` 复制到用户选择的项目内路径）。

## 预置模板

内置模板与预置内容由 `packages/presets/` 维护。构建前执行 `scripts/sync-templates.mjs` 完成以下同步：

1. 将 `templates/*.md` 和 `templates/*.css` 同步为 TypeScript 常量（`AGENT_TEMPLATE`、`AGENT_THEME_TEMPLATE`）
2. 读取 `presets.json` 生成 `PRESET_SKILLS`、`PRESET_AGENTS` 和 `PRESET_PROMPT_TEMPLATES` 常量（分别声明预置 skill 列表、预置 agent 列表和预置 prompt template 列表）
3. 递归读取 `skills/` 下声明的预置 skill 目录，生成 `PRESET_SKILL_SOURCES` 常量（包含每个 skill 的完整文件内容）
4. 读取 `templates/prompt-templates/<id>.md` 的正文，合并到 `PRESET_PROMPT_TEMPLATES` 每个条目的 `prompt` 字段

如果 `presets.json` 声明的 skill dir 在 `skills/` 下不存在，或 `presetPromptTemplates` 声明的 `id` 在 `templates/prompt-templates/` 下没有对应 `.md`，构建时报错退出。

### presets.json 格式

`packages/presets/presets.json` 声明预置内容，包含两类：新项目创建时注入的内容（`presetSkills`、`presetAgents`）和供 UI 直接消费的内容（`presetPromptTemplates`，由 Agent 创建对话框作为可复用 prompt 模板徽章展示，不参与项目创建注入）：

```json
{
  "presetSkills": [
    { "dir": "spherse-create-ui-theme" },
    { "dir": "spherse-create-agent-chat-theme" },
    { "dir": "spherse-use-ui-sdk" },
    { "dir": "spherse-build-data-app" },
    { "dir": "spherse-write-html" },
    { "dir": "spherse-create-skill" }
  ],
  "presetAgents": [],
  "presetPromptTemplates": [
    { "id": "worldview-assistant", "name": "世界观创作助手" },
    { "id": "roleplay", "name": "角色扮演" }
  ]
}
```

- `presetSkills[].dir`：对应 `packages/presets/skills/` 下的目录名，该目录内容会被打包为 builtin skill 源码（`PRESET_SKILL_SOURCES`），由 `SkillStore` 在运行时内存合并（source 为 `builtin`），不复制到项目的 `.spherse/skills/`
- `presetAgents[].name`：预置 agent 的展示名称，会通过 `AGENT_TEMPLATE` 模板生成 profile.md
- `presetAgents[].slugBase`：预置 agent 的目录 slug 前缀（与 shortId 拼接后形成 agent slug）
- `presetPromptTemplates[].id`：对应 `packages/presets/templates/prompt-templates/<id>.md` 文件名（不含扩展名），该文件正文作为 prompt 内容合并到 `PRESET_PROMPT_TEMPLATES` 的 `prompt` 字段；构建时缺失对应文件会报错
- `presetPromptTemplates[].name`：prompt template 在 Agent 创建对话框徽章上展示的名称

### 预置内容注入

新建项目时，`createProject` 检测到项目首次创建，调用 `initPresets()` 执行以下操作：

- 创建空的 `.spherse/skills/` 目录（供用户自建 project-local skill）
- 根据声明创建预置 agent profile（使用 `AGENT_TEMPLATE` 模板，替换默认名称）。当前 `presetAgents` 为空，不创建任何预置 agent；将来添加条目即可恢复注入

builtin skill 不再注入到磁盘，而是由 `SkillStore` 在运行时从 `PRESET_SKILL_SOURCES` 内存合并（source 为 `builtin`，随 app 升级更新）。用户在 `.spherse/skills/` 下自建的 project-local skill（source 为 `project`）按 name 覆盖同名 builtin。

非新建项目（已存在的项目重新打开）不会触发 agent 注入。注入后的预置 agent 属于用户所有，用户可自由修改或删除。
