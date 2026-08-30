# 数据约定

> 覆盖：项目内数据文件的路径布局、格式与存储不变量——`.spherse/` 树、project.yaml、agent / trigger / skill 定义、sessions.db 与数据文件。
> 运行机制（事件投影、compaction、MCP 连接生命周期、触发器调度）见 `architecture/` 对应域文件；本文只记录「什么数据、放在哪、什么格式、什么不变量」。
> 预置模板与 presets.json 见 `packages/presets/README.md`；访问控制 category 语义见 `architecture/security.md`。

## 项目目录布局

项目是独立文件夹：`.spherse/`（系统数据）+ 用户自定义内容目录。

```text
project-root/
├── .agents/skills/                # 可选：兼容的 project-level skill 发现目录
│   └── <skill-name>/SKILL.md
├── .spherse/
│   ├── project.yaml
│   ├── theme.css                  # 可选：用户自定义全局主题时才存在
│   ├── agents/
│   │   └── {agent-slug}/
│   │       ├── profile.md
│   │       ├── theme.css          # 可选：agent 聊天窗口主题
│   │       ├── mcp.json           # 可选：MCP 连接器配置
│   │       ├── sessions.db        # 惰性：首次访问会话时创建
│   │       ├── triggers/          # 惰性：首次保存触发器时创建
│   │       │   ├── index.yml
│   │       │   └── logs.jsonl
│   │       ├── skills/            # 可选：agent-level 私有 skill
│   │       │   └── <skill-name>/SKILL.md
│   │       └── assets/            # 可选：agent 私有静态资源（theme 配图、字体等），LLM 读写、server 只读
│   ├── generated-images/          # generate_image 落盘（首次生图时创建）
│   ├── attachments/               # 聊天图片上传落盘
│   └── skills/                    # 新建项目时创建的空目录（用户自建 project skill）
│       └── <skill-name>/SKILL.md
├── AGENTS.md                      # 创建时写默认模板；缺失不影响任何功能
└── CHANGELOG.md                   # 创建时写空文件；append_changelog 工具追加
```

- `AGENTS.md` 缺失时 `readIndex()` 返回空串，agent system prompt 仅由 profile 与 skill / context 组成
- `theme.css`（项目级与 agent 级）均按需写入；不存在时读取为空串、UI 用默认样式
- `mcp.json`、`triggers/`、`sessions.db` 均为惰性创建：首次写入或首次访问才落盘
- `attachments/`：`POST /api/projects/:projectId/attachments` 上传，仅 png / jpg / webp、≤5MB，命名 `{epoch-ms}-{8hex}.{ext}`；多模态 base64 仅在本轮 LLM 调用瞬间存在，持久化前被 sanitizer 剥离
- `generated-images/`：`generate_image` 自动保存，命名 `{yyyyMMddHHmmss-UTC}-{4hex}.{ext}`，重名冲突时重试
- builtin skill 随 app 内置、`SkillStore` 内存合并，不写入磁盘（见「Skill 定义格式」）

## project.yaml

对应 `ProjectConfig`：

```yaml
id: aB3xK9mQ
name: My World
created: 1760000000000
welcomePage:
  path: welcome.html
aiAccess:
  deniedPaths:
    - drafts/private.md
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | nanoid(8)。创建时生成；legacy 项目读取缺失时自动补种回写；registry 检测 id 冲突时重新生成 |
| `name` | 是 | 展示名 |
| `created` | 是 | Unix epoch ms |
| `welcomePage.path` | 否 | 项目根路由的自定义欢迎页，校验见下 |
| `aiAccess.deniedPaths` | 否 | 同时禁止 AI 工具读写的项目相对路径数组，校验见下 |

- 解析为 YAML 后裸 cast，core 侧无 schema 校验；残留未知字段（如老项目的 `defaultModel`）静默忽略，随下次保存原样保留
- 模型选择不在项目配置：由用户级 `AppSettings.models.text.defaultModel` 决定
- 特殊文件路径归属由 `@spherse/core` 的 `access/path-category.ts` 中 `PATH_PATTERNS` 固定（18 类 + `userFiles` 兜底），不可配置；capability 可经 `pathRules` 声明优先裁决（memory capability 已在使用，见 `architecture/security.md`）
- `welcomePage.path` 校验：`/` 分隔、拒绝绝对路径与 `..`、扩展名白名单 html / htm / png / jpg / jpeg / gif / webp / svg、必须归类为 `userFiles`（即排除 `.spherse/**`、AGENTS.md、CHANGELOG.md）；保存时不要求文件存在；渲染时 settings 查询失败或资源加载失败回退占位态
- `deniedPaths` 校验：拒绝绝对路径、`..` 与尾部斜杠并去重；保留路径（一切非 `userFiles` 类别）不可加入——它们由 access policy 白名单另行控制

## Agent 定义（profile.md）

存放于 `.spherse/agents/{agent-slug}/profile.md`，Markdown + YAML frontmatter；gray-matter 手工解析、core 侧无 schema 校验，`name` 缺失时整个 profile 被跳过。

**slug（目录名）规则**：`slugBase` 与 `shortId` 拼接，形如 `world-builder-a1b2c3`。

- `slugBase`：由初始 name 派生——trim、小写、空白转连字符、仅保留 `[a-z0-9\u4e00-\u9fff-]`（兼容中文名）、折叠连续连字符、去首尾、截断 40 字符、为空回退 `agent`
- `shortId`：agent UUID 去连字符前 6 位；目录名冲突时依次加长到 8 / 10 / 12 位，仍冲突追加 `-2` / `-3`… 后缀
- `id` 恒由 `crypto.randomUUID()` 生成；目录名与 id 创建后不变，`manage_agent` 更新亦不改

frontmatter 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 展示名称 |
| `alias` | 否 | 设定后代替 `name` 显示在助手消息气泡；未设或留空回退 `name` |
| `id` | 自动 | UUID；读取缺失时自动生成并回写 |
| `createdAt` | 自动 | epoch ms；创建时生成后不变 |
| `model` | 否 | 覆盖全局默认模型 |
| `tools` | 否 | 允许的工具名列表；缺省不分配任何工具 |
| `context` | 否 | 项目根内相对路径列表，构建 system prompt 时预读注入；**仅允许纯文本文件（扩展名/知名文件名 allowlist，判定与 512kB 上限常量单一来源 `@spherse/presets` 的 `context-file-policy`）**，所有现存文件总大小 ≤ 512kB——agent 保存时校验（`ProjectStore` 漏斗，UI 与 `manage_agent` 共用），组装期按声明顺序贪心装填兜底跳过越界文件；access policy 不可读的路径静默跳过 |
| `yolo` | 否 | 自动放行：true 时危险工具跳过审批门，文件访问策略不受影响；仅 Agent Dialog 可改，`manage_agent` 不管理 |
| `timePerception` | 否 | 时间感知配置，见下 |
| `output` | 否 | 预留字段，当前无消费方 |

`timePerception`：`{ enabled, epochMs, startMs, flowRate, timeZone? }`。

- 感知时间由纯函数 `perceivedMs = startMs + (realMs - epochMs) × flowRate` 从消息真实时间戳推导；streamDecorator 对 wire 上带时间戳的 user 消息前插 `<time>` 标签（不持久化）；生效条件 `enabled && flowRate > 0`
- 启用标记是独立 context block（`<session-context>` 之后）
- `manage_agent` 只切换 `enabled`：首次开启固化 `epochMs = startMs = 写入时刻, flowRate = 1` 的默认配置（防锚点漂移），关闭即删除整个 key
- 锚点、起点、流速、时区仅 Agent Dialog 可调

`theme.css`（同目录，可选）：Agent Dialog「主题」页编辑，新建初始为空白，presets 模板仅作参考物料；缺失读取为空串、聊天窗口用全局默认样式。

### mcp.json

外层为对象 `{ "servers": [...] }`，每项一个 server：

```json
{ "id": "uuid", "name": "search", "enabled": true, "transport": "http", "url": "https://…" }
```

- base 字段：`id` / `name` / `enabled`（缺省 true）；stdio 型带 `command` 与可选 `args` / `env` / `cwd`，http 与 sse 型带 `url` 与可选 `headers`
- 由 agent 右键「连接器（MCP）」对话框管理；非法项与重复 id 静默丢弃，文件不存在视为无连接器
- 可能含 `headers` / `env` 敏感信息：`agentMcp` category 对 LLM 工具不可读写
- 连接生命周期、工具合并与命名见 `architecture/capabilities.md`「聚合与过滤」

## 触发器（triggers/）

`index.yml` 为 YAML 数组，元素 `TriggerEntry`：

| 字段 | 说明 |
|---|---|
| `id` | nanoid，server 路由生成 |
| `type` | `time`（配 `cron`）或 `event`（配 `eventName`） |
| `name` / `enabled` | 展示名与开关 |
| `mode` | `reusable_session`（UI 新建默认）/ `new_session` / `existing_session`（配 `targetSessionId`） |
| `message` | 触发时发送的消息，支持模板变量 |
| `notify` / `notificationMessage` | 完成后 renderer 通知与可选自定义内容 |
| `createdAt` / `updatedAt` | epoch ms |
| `boundSessionId` | 仅运行时写入：reusable 模式的绑定会话 |

- reusable 模式：首次触发新建会话并绑定；绑定会话归档后（按 `status: active` 判定）下次触发自动重绑；`POST .../triggers/:triggerId/reset-binding` 主动解绑
- 模板变量：`{{agent_name}}`（别名 `{{agentName}}`）、`{{payload}}`（仅 event 型）、`{{date}}` / `{{time}}` / `{{datetime}}` / `{{weekday}}`（本地时区）；未知变量原样保留；`sp:` 前缀为内部事件保留
- 同一 trigger 的并发触发被 executor 的 in-progress 集合挡掉

执行日志追加写入 `logs.jsonl`，每行一个 JSON，字段：`triggerId`、`triggerName?`、`agentName?`、`eventName?`、`sessionId`、`triggeredAt`、`completedAt?`、`status`（running / success / failed）、`error?`。

- 轮转：文件超过 2MB 且超过 5000 行时截断保留最近 5000 行

调度语义：`time` 型由 TimerService 每 10 分钟轮询 cron 命中（实际执行可延迟数分钟），`event` 型收到用户事件即时触发；磁盘是唯一真相源，每 tick / 事件都重新读取配置。机制见 `architecture/capabilities.md`。

## Session 数据（sessions.db）

每个 agent 一个 SQLite 文件（WAL 模式），位于 agent 目录下。

- `sessions` 表（列表元数据）：`id`、`agent_id`、`title`、`created_at`、`updated_at`、`status`（active / archived）、`source`、`parent_session_id` / `fork_seq`（会话分支预留）、`migrated_at`（legacy 迁移标记）
  - `title` 是可选用户可编辑标题——重命名只更新 title 不动 `updated_at`，列表按 `updated_at DESC, id DESC` 排序，保持「最近活动」语义
- `events` 表（append-only，主键 `(session_id, seq)`）：信封为 `{ type, seq, time, data, schema_version }`。当前事件词汇表：
  - `turn/start`、`turn/end`（reason: completed / aborted / error）
  - `user/message`（data 可选 `source: "triggered"` + `triggerName`，trigger 发送标记；absent = 手动发送）、`assistant/message`、`tool/result`
  - `compaction/applied`（anchorSeq、digestContent、digestSource、excludedSeqs）
  - `turn/retried`（abandonedSeqs）、`turn/withdrawn`（seq）

存储不变量（fold 投影与控制事件语义见 `architecture/core.md`「会话运行时」）：

- **append-only**：消息与控制事件只追加；compaction、retry、withdraw 均以重启点事件表达，不修改或删除历史
- **seq 连续**：session log 内从 0 连续，`open` 校验损坏即抛；`appendBatch` 落库失败回滚内存追加
- **可重建**：运行时消息数组是 fold 投影缓存，可随时丢弃重建
- **正向兼容**：未知事件类型被 fold 白名单过滤跳过；additive 事件不升 schema version
- **崩溃恢复幂等**：restore 为未闭合 turn 持久化补写合成 error toolResult 与 aborted `turn/end`，二次恢复不再追加

legacy 迁移：升级前的 `messages` / `compactions` 表保留只读，用于迁移前历史展示；首次 restore（打开聊天、静默发送、trigger 复用）在单个 SQLite 事务内把旧历史转换为 events 并标记 `migrated_at`。迁移幂等、完全属 core 内部实现，不暴露迁移 API 或状态字段。

删除 agent 时关闭该 agent 的 DB 连接并删除整个 agent 目录，`sessions.db` 随 profile、theme、mcp 配置一起移除。

## System Prompt XML 约定

所有 system-prompt section 用语义化 XML 标签包裹，不用 markdown 边界（`---` / `## H2`）。保留 tag 注册表（避免后续命名冲突）：

| XML tag | 用途 |
|---|---|
| `<project-instructions>` | AGENTS.md 内容 |
| `<agent-profile>` | agent profile 主体 |
| `<session-context>` | 当前会话上下文，key-value：`agent-name` / `agent-alias`（设置时）/ `agent-slug` / `session-id` |
| `<preloaded-context>` | 预载文件区（仅纯文本文件，总量 ≤ 512kB；越界/非文本文件组装期跳过并 warn log） |
| `<context-file path="…">` | 单个预载文件（嵌套在 preloaded-context 内） |
| `<skill-catalog>` | 可用技能目录（仅 name + description） |
| `<skill-item name="…" description="…"/>` | 单个技能条目（自闭合，嵌套在 skill-catalog 内，属性经 XML 转义） |
| `<memory>` | memory capability 注入的最近记忆（默认 20 条，每行 `- ` 前缀） |
| `<mcp-context>` | MCP server 说明与资源目录，嵌套 `<server>` / `<instructions>` / `<resources>`（内含自闭合 `<resource>` / `<resource-template>`）/ `<prompts>`；经 beforeTurn 追加，不走 contextBlocks 贡献点 |
| `<skill-content name="…">` | load_skill 工具返回的技能全文 |
| `<compaction-digest>` | 压缩历史摘要（fold 合成的 user 消息） |

- 固定段顺序：project-instructions → agent-profile → session-context → preloaded-context，之后按 capability 注册序追加 contextBlocks（skill-catalog → time-perception → memory），空块过滤、以空行连接
- **time-perception 块是裸文本、无 XML 标签**（`time-perception: enabled` 与指示语），渲染在 `<session-context>` 之后
- `<skill-catalog>` 仅列 name + description；project skill 带附加文件时，`load_skill` 输出末尾追加 `## Skill Files` 清单（附加文件的项目内完整相对路径，提示用 `read_file` 读取）
- compaction 摘要写入前经转义防注入（digest 标签破坏嵌套）；双路生成与阈值机制见 `architecture/core.md`「会话运行时」

## Skill 定义格式

Skill 分为 builtin、project-level 和 agent-level 三层：

- builtin 由 app 内置只读；project-level 从 `.spherse/skills/<skill-name>/SKILL.md` 与兼容目录 `.agents/skills/` 发现；agent-level 位于 `.spherse/agents/{agent-slug}/skills/`，仅对该 agent 生效（无 UI 管理，仅手动放置文件）
- 合并优先级 agent-level > `.spherse/skills` > `.agents/skills` > builtin，同名只取最高优先级一项
- 格式均为 YAML frontmatter + Markdown body；磁盘 skill 目录除 `SKILL.md` 外可携带附加文件（如 `references/*.md`、`scripts/*.js`、`assets/*`）

frontmatter 必需字段 `name`、`description`，可选 `version`。`SkillDefinition.source` 标识来源：`.spherse/skills`、`.agents/skills` 与 agent-level 均为 `project`；builtin 为 `builtin`。

- builtin 的 filePath 是合成路径 `builtin://<dir>/SKILL.md`，`files` 恒为 `[]`
- project skill 的 `files` 为附加文件 posix 相对路径数组，解析时递归枚举填充（跳过 hidden / `node_modules` / `.git`，排除 `SKILL.md`）
- Markdown body 作为完整 instructions 由 `load_skill` 按需加载

写入口径（三种均只以 `.spherse/skills` 为目标；`.agents/skills` 仅作兼容发现源，不在 SkillPanel 展示或管理；写逻辑在 `SkillStore`，`ProjectManager` 为纯委托）：

- **UI 创建**：`POST /api/projects/:projectId/skills`（body：name / description / instructions）；name 非空、不含 `/ \ :`、不以 `.` 开头
- **本地 zip 安装**：`POST .../skills/install`（body：zipPath 绝对路径）；zip 顶层有且仅有一个技能文件夹、内含合法 `SKILL.md`、frontmatter name 与文件夹名一致、含 zip-slip 防护；同名冲突返回 409、不覆盖
- **市场安装**：`GET .../marketplace/skills` 拉取远端 manifest（30s 缓存），`POST .../skills/marketplace-install`（body：name / version，版本不匹配 409）；强制 overwrite——备份后原子替换、失败回滚

```markdown
---
name: my-skill
description: A brief description of the skill
---

Full skill instructions in Markdown...
```

## 内容文件

- 创作内容使用项目根目录下的普通文件，优先 Markdown / YAML / HTML 等人类可读格式
- 可见性过滤：文件树路由恒过滤 dotfile / dotdir（含 `.spherse`，无开关）；`list_files` / `search_content` 默认过滤 `.spherse`（参数 `include_meta`，默认 false）与 `node_modules` / `.git`
- 读写权限语义（category 白名单、LLM 与 server 两套 policy、`pathRules` 优先裁决）见 `architecture/security.md`
- 可读性边界：`spherseOther`（`.spherse/**` 兜底）对 LLM 可读；`agentSessions`（`sessions.db*` 含 WAL / SHM）与 `agentMcp`（`mcp.json`）永不可读
- 路径安全：一切项目内路径解析必须 `path.resolve` 后做根目录边界校验（`resolveProjectPath` / `assertInsideProject`）
- 并发写：会写文件的 agent tools 与 DataStore 共享 `FileWriteMutex`
- **二进制处理**：`read_file` / `search_content` 以 null-byte 启发式（前 8KB 采样）检测二进制——`read_file` 拒绝读取并返回提示（图片引导 `render_card`），`search_content` 静默跳过；server content 路由同样嗅探，二进制返回 `binary: true` + 空 content
  - 白名单文本格式（md / html / 图片含 ico）走专属 viewer，其余二进制渲染 `UnsupportedFileCard` 占位卡（桌面端经 `HostCapabilities.openFileExternal` 提供「用默认应用打开」）

## 活网页数据文件（`*.data.json`）

「活网页」的数据载体：HTML 页面（UI SDK `data.*` action）与 agent（`read_data` / `query_data` / `mutate_data`）共同读写，两侧汇入 core `DataStore` 单例。SDK 侧 action 语义与限流见 `architecture/ui-sdk.md`。

- 命名约定 `{页面名}.data.json`、与 HTML 同级（约定，代码不强制）；不得位于 `.spherse/` 下——例外前缀 `.spherse/data/cards/` 仅对 agent 工具与 server 路由开放，SDK host 侧一律拒绝，当前无生产写入方
- 顶层 `$` 前缀键为平台保留（如 `$manifest`）：SDK 写入拒绝、`data.keys` / `data.entries` 不返回、dot-path 寻址不可达、core `writeRaw` 抛 `ForbiddenKeyError`
- 写入不变量：tmp + rename 原子落盘、`FileWriteMutex` 锁内读-改-写、sha256 内容哈希 version + `ifVersion` 乐观锁、`idempotencyKey` 幂等（LRU 1024）、单文件 20MB 上限、变更事件携带 `origin`（sdk / agent）
- **写入粒度约定**：集合的结构性增删改走 `data.mutate`（SDK）/ `mutate_data`（agent）同一套 manifest 入口（锁内 item 级原子，并发互不覆盖）；`data.set` 仅适合单值 / 低冲突数据，整值覆盖并发写入
- agent 首次接触文件用 `read_data`（不带 path）获取 outline：结构大纲 + `$manifest` 入口签名（`name!` / `name?` 标注必填 / 可选，超 4096 字符截断）
  - 无 manifest 的存量文件降级为 outline + dot-path 局部读（数组默认 20 条分页、上限 100）+ `edit_file` / `write_file` 整文件改
- `$manifest` 由页面生成时的 agent 同源产出（`spherse-build-data-app` / `spherse-write-html` skill 约束）：
  - `queries` 声明等值过滤 / sort / dir / identity 游标分页；`mutations` 声明 append / update / remove / set + fields 类型校验 + auto 补全 uuid / nowIso + match 定位
  - 执行时锁内现场校验 manifest 健康，失配报 `manifest_stale` / `unknown_entry`（附 valid names），不信任缓存健康度
- 损坏（撕裂 JSON）报 `file_corrupted`，不自动修复；server 路由错误映射——version_conflict 409、unknown_entry 404、manifest_stale 409、validation_failed 400、forbidden_key 400、file_corrupted 422

## HTML Card

`render_card` 的 result `details` 只存元数据（`cardType` / `title` / `file_path` / 尺寸），HTML 全文仅经 `onUpdate`（`tool_execution_update`）传给前端——不持久化到 DB、不占 context window。

| 来源 | 参数 | 行为 |
|---|---|---|
| 项目文件（推荐） | `file_path` | HTML 读全文注入；图片（png / jpg / jpeg / gif / webp / svg / ico）不做文本读取，前端直接 `<img>` 渲染 |
| inline | `content` | 自包含 HTML（无外部资源引用） |

- base 注入：file 模式为 `${apiBase}/preview/{dir}/`（文件所在目录），inline 模式为 `${apiBase}/preview/`（项目根）——相对资源按文件系统目录关系解析
- 尺寸参数默认 height 400 / max_width 800 / max_height 600
- 历史恢复：inline 来源从 tool call 的 `arguments.content` 重建；HTML 文件来源经 preview URL 重新加载；图片来源仅凭 `details.file_path` 按扩展名识别直接渲染
- inline 卡片提供「保存为项目文件」按钮

## Image Card

`generate_image` 接收 prompt（及可选 `size` / `quality`），经 pi-ai 图片生成 provider（OpenRouter / 智谱 / OpenAI；模型经 env `SPHERSE_IMAGE_MODEL` 与 `SPHERSE_IMAGE_API_KEY` 配置）生成图片。

- 保存到 `.spherse/generated-images/{yyyyMMddHHmmss-UTC}-{4hex}.{ext}`——UTC 时间戳 + 随机 hex 避免并发冲突、重名重试，不使用 `FileWriteMutex`；成功返回 content 含存储路径，自动以卡片展示（无需再调 `render_card`）
- 参数按 provider 透传：OpenAI 写入 size 与 quality；智谱仅写入 size；OpenRouter（pi-ai 内置）忽略未知字段；留空用模型默认值
- 卡片三态 generating / done / error：done 经 preview URL 加载，右上角导出按钮（`POST .../images/export` 复制到用户选择的项目内路径）；未配置模型或模型解析失败落 error 态
