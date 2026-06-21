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
│   │   └── {slug}-{shortId}/
│   │       ├── profile.md
│   │       ├── theme.css
│   │       ├── sessions.db
│   │       ├── schedules.yml
│   │       └── schedule-logs.jsonl
│   ├── generated-images/          # generate_image 工具自动保存的图片（按时间戳+hex 命名）
│   └── skills/
│       └── <skill-name>/SKILL.md
├── AGENTS.md
└── CHANGELOG.md
```

`.spherse/theme.css` 是可选文件，只在用户自定义主题时存在。新项目创建时，系统会自动根据 `presets.json` 创建预置 agent（创建到 `.spherse/agents/`）并创建空的 `.spherse/skills/` 目录（供用户自建 skill）。builtin skill 随 app 内置，通过 `SkillStore` 内存合并，不写入磁盘。

## Project 配置

`.spherse/project.yaml` 对应 `ProjectConfig`：

```yaml
name: My World
created: 1760000000000
defaultModel: glm-4.5-air
paths:
  agents: agents
  index: AGENTS.md
  changelog: CHANGELOG.md
welcomePage:
  path: welcome.html
```

`paths.agents` 相对 `.spherse/`，当前默认 agent 定义目录为 `.spherse/agents/`。`paths.index` 和 `paths.changelog` 相对项目根目录。

可选字段 `aiAccess.deniedPaths` 是项目相对路径数组，用于限制 AI 工具读取文件内容或暴露目录内容。路径使用 `/` 分隔，不允许路径穿越，不允许加入 `AGENTS.md`、`CHANGELOG.md`、`.spherse` 或 `.spherse/**`。

可选字段 `welcomePage.path` 是项目相对路径字符串，用于在项目根路由展示用户自定义欢迎页。路径使用 `/` 分隔，不允许路径穿越，不允许 `.spherse` 或 `.spherse/**`，支持扩展名 `html`、`htm`、`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`。保存配置时不要求文件已经存在；渲染时如果预览接口返回 403/404 或请求失败，前端回退到默认空状态。

## Agent 定义格式

Agent 定义是 Markdown 文件 + YAML frontmatter，存放于 `.spherse/agents/{slug}-{shortId}/profile.md`。其中 `slug` 由初始 agent name 派生（小写、空格替换为连字符），`shortId` 为 agent UUID 前 6 位。目录名在创建时生成，之后不再变。

Agent 聊天窗口主题存放于同目录的 `theme.css`。该文件由 Agent Dialog 的“主题”标签页编辑，正常新建流程会从 `@spherse/presets` 的 `agent-theme-template.css` 初始化。文件不存在时读取结果为空字符串，聊天窗口使用全局默认样式。

必需字段：

- `name`：展示名称

常用可选字段：

- `id`：UUID，首次读取缺失 id 的文件时自动生成并回写；设计意图为不可变
- `createdAt`：创建时间，Unix epoch milliseconds；创建时自动生成，之后保持不变
- `model`：覆盖项目默认模型
- `tools`：允许使用的 tool 名称列表；缺省时不分配任何工具（空列表）
- `context`：项目根目录内相对路径列表，SessionRuntime 构建 system prompt 时预读取并注入
- `schedule`：可选布尔值，静态 frontmatter 标记，仅从 `profile.md` 读取、应用不自动回写。UI（AgentRow 定时任务指示）不依赖此字段，而是由 `schedules.yml` 中是否存在 `enabled: true` 的条目实时派生（见下方「定时任务数据」）
- `output`：预留的输出路径、命名和 frontmatter 配置

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

## 定时任务数据

定时任务配置存储在 `.spherse/agents/{slug}-{shortId}/schedules.yml`，YAML 数组格式，每个元素为 `ScheduleEntry`：

```yaml
- id: uuid
  name: 每日回顾
  enabled: true
  cron: "0 9 * * *"
  mode: new_session
  message: "回顾进展 {{date}}"
  notify: true
  notificationMessage: "每日回顾已发送"
  createdAt: 1749600000000
  updatedAt: 1749600000000
```

`mode` 当前支持 `new_session` 与 `existing_session`；UI 目前只开放 `new_session`。`notify` 为 `true` 时，renderer 会在任务完成后显示通知；`notificationMessage` 为可选自定义通知内容。

执行日志追加写入同目录下的 `schedule-logs.jsonl`，每行一个 JSON 对象。日志包含 `id`、`agentId`、`scheduleId`、`status`、`triggeredAt`、`completedAt`、`error`、`sessionId`、`agentName`、`scheduleName` 等字段，用于运行日志 UI 展示与问题排查。日志文件超过 2MB 时保留最近 5000 行。

定时任务由运行时调度器按 10 分钟轮询检查 cron 命中情况，实际执行时间可能比 cron 表达式指定时间延迟数分钟。

## Session 数据

每个 agent 拥有独立的 SQLite 数据库文件，位于 `.spherse/agents/{slug}-{shortId}/sessions.db`。表结构为 `sessions(id TEXT PK, agent_id TEXT, title TEXT, created_at INT, updated_at INT, status TEXT DEFAULT 'active', source TEXT DEFAULT 'manual')`。每个 session 的状态为 `active` 或 `archived`。

`sessions.title` 是可选的用户可编辑展示标题。用户重命名 session 时只更新 `title`，不更新 `updated_at`，因此不会改变 session 列表按最近对话活动排序的行为。

删除 agent 时，ProjectRuntime 关闭该 agent 的 DB 连接并删除整个 agent 目录，`sessions.db` 随 `profile.md`、`theme.css` 一起移除。

## Skill 定义格式

Skill 有两个来源：builtin skill（app 内置只读，随 app 升级更新）和 project skill（`.spherse/skills/<skill-name>/SKILL.md`，用户自建可读写）。两者按 name 合并，project 同名覆盖 builtin。格式均为 YAML frontmatter + Markdown body。

`SkillDefinition` 的 `source` 字段标识来源（`builtin` 或 `project`）；builtin skill 的 `filePath` 为合成路径 `builtin://<dir>/SKILL.md`。

必需字段：

- `name`
- `description`

Markdown body 会作为完整 instructions 被 `load_skill` 工具按需加载。

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
- 会写文件的 agent tools 共享 `FileWriteMutex`，避免同一文件并发写覆盖

## HTML Card

`render_card` tool 支持两种数据来源：

- `content`：直接提供 inline HTML
- `file_path`：提供项目根目录内的 HTML 文件相对路径

tool update 的 `details.type === "html"` 时，前端 chat 会按 HTML card 渲染。

## Image Card

`generate_image` tool 接收文本 prompt，调用 pi-ai 图片生成 provider（OpenRouter 或智谱）生成图片，自动保存到 `.spherse/generated-images/{yyyyMMddHHmmss-UTC}-{4hex}.{ext}`。文件名基于 UTC 时间戳 + 4 位随机 hex，避免并发写冲突，不使用 `FileWriteMutex`。

tool update 的 `details.type === "image"` 时，前端 chat 会按 image card 渲染（三态：generating / done / error）。`done` 态通过 `GET /api/projects/:projectId/preview/<relPath>` 加载图片，卡片右上角提供导出按钮（经 `POST /api/projects/:projectId/images/export` 复制到用户选择的项目内路径）。

## 预置模板

内置模板与预置内容由 `packages/presets/` 维护。构建前执行 `scripts/sync-templates.mjs` 完成以下同步：

1. 将 `templates/*.md` 和 `templates/*.css` 同步为 TypeScript 常量（`AGENT_TEMPLATE`、`AGENT_THEME_TEMPLATE`）
2. 读取 `presets.json` 生成 `PRESET_SKILLS` 和 `PRESET_AGENTS` 常量（声明预置 skill 列表和预置 agent 列表）
3. 递归读取 `skills/` 下声明的预置 skill 目录，生成 `PRESET_SKILL_SOURCES` 常量（包含每个 skill 的完整文件内容）

如果 `presets.json` 声明的 skill dir 在 `skills/` 下不存在，构建时报错退出。

### presets.json 格式

`packages/presets/presets.json` 声明新项目创建时注入的预置内容：

```json
{
  "presetSkills": [
    { "dir": "create-ui-theme" },
    { "dir": "create-agent-chat-theme" },
    { "dir": "use-ui-sdk" }
  ],
  "presetAgents": [
    { "name": "世界观创作", "slug": "world-building" }
  ]
}
```

- `presetSkills[].dir`：对应 `packages/presets/skills/` 下的目录名，该目录内容会被打包为 builtin skill 源码（`PRESET_SKILL_SOURCES`），由 `SkillStore` 在运行时内存合并（source 为 `builtin`），不复制到项目的 `.spherse/skills/`
- `presetAgents[].name`：预置 agent 的展示名称，会通过 `AGENT_TEMPLATE` 模板生成 profile.md
- `presetAgents[].slug`：预置 agent 的目录 slug 前缀

### 预置内容注入

新建项目时，`createProject` 检测到项目首次创建，调用 `initPresets()` 执行以下操作：

- 创建空的 `.spherse/skills/` 目录（供用户自建 project-local skill）
- 根据声明创建预置 agent profile（使用 `AGENT_TEMPLATE` 模板，替换默认名称）

builtin skill 不再注入到磁盘，而是由 `SkillStore` 在运行时从 `PRESET_SKILL_SOURCES` 内存合并（source 为 `builtin`，随 app 升级更新）。用户在 `.spherse/skills/` 下自建的 project-local skill（source 为 `project`）按 name 覆盖同名 builtin。

非新建项目（已存在的项目重新打开）不会触发 agent 注入。注入后的预置 agent 属于用户所有，用户可自由修改或删除。
