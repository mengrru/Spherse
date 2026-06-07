# 数据约定

## 世界观项目结构

用户的世界观项目是独立文件夹，结构为 `.spherse/`（系统文件）+ 用户自定义内容目录。

默认系统文件：

```text
project-root/
├── .spherse/
│   ├── project.yaml
│   ├── sessions.db
│   ├── theme.css
│   ├── agents/
│   │   └── {slug}-{shortId}/
│   │       └── profile.md
│   └── skills/
│       └── <skill-name>/SKILL.md
├── AGENTS.md
└── CHANGELOG.md
```

`.spherse/theme.css` 是可选文件，只在用户自定义主题时存在。

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
```

`paths.agents` 相对 `.spherse/`，当前默认 agent 定义目录为 `.spherse/agents/`。`paths.index` 和 `paths.changelog` 相对项目根目录。

可选字段 `aiAccess.deniedPaths` 是项目相对路径数组，用于限制 AI 工具读取文件内容或暴露目录内容。路径使用 `/` 分隔，不允许路径穿越，不允许加入 `AGENTS.md`、`CHANGELOG.md`、`.spherse` 或 `.spherse/**`。

## Agent 定义格式

Agent 定义是 Markdown 文件 + YAML frontmatter，存放于 `.spherse/agents/{slug}-{shortId}/profile.md`。其中 `slug` 由初始 agent name 派生（小写、空格替换为连字符），`shortId` 为 agent UUID 前 6 位。目录名在创建时生成，之后不再变。

必需字段：

- `name`：展示名称
- `type`：业务类型

常用可选字段：

- `id`：UUID，首次读取缺失 id 的文件时自动生成并回写；设计意图为不可变
- `createdAt`：创建时间，Unix epoch milliseconds；创建时自动生成，之后保持不变
- `model`：覆盖项目默认模型
- `tools`：允许使用的 tool 名称列表；缺省时获得全部默认工具
- `context`：项目根目录内相对路径列表，Engine 构建 system prompt 时预读取并注入
- `schedule`：预留的定时执行表达式
- `output`：预留的输出路径、命名和 frontmatter 配置

示例：

```markdown
---
id: 550e8400-e29b-41d4-a716-446655440000
createdAt: 1760000000000
name: Historian
type: worldbuilding
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

## Session 数据

Session 数据存储在 `.spherse/sessions.db`。每个 session 通过 `agent_id` 关联 AgentProfile，状态为 `active` 或 `archived`。

`sessions.title` 是可选的用户可编辑展示标题。用户重命名 session 时只更新 `title`，不更新 `updated_at`，因此不会改变 session 列表按最近对话活动排序的行为。

删除 agent 时，Engine 会归档关联 sessions，再删除 agent 目录（包含 profile.md），避免历史对话失去可追溯状态。

## Skill 定义格式

Skill 定义存放于 `.spherse/skills/<skill-name>/SKILL.md`，格式为 YAML frontmatter + Markdown body。

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

## 预置模板

内置模板由 `packages/presets/templates/*.md` 维护。构建 `@spherse/presets` 前会执行 `scripts/sync-templates.mjs`，把模板源文件同步为 TypeScript 常量供 app 使用。
