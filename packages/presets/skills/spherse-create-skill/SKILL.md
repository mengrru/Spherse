---
name: spherse-create-skill
description: 当用户想要创建自定义 skill 时使用，涵盖 skill 的两个层级（project-level 与 agent-level）、标准目录结构与 SKILL.md 格式规范
---

# 创建自定义 Skill

Skill 是一段可被 agent 通过 `load_skill` 工具按需加载的指令（instructions）。你可以创建自己的 skill，将常用的写作规范、领域知识、工作流程封装成可复用的指令包。

## Skill 的两个层级

Skill 按作用范围分为两个层级：

| 层级 | 目录路径 | 作用范围 |
|------|----------|----------|
| **Project-level** | `.spherse/skills/{skill-name}/` | 项目内所有 agent 共享 |
| **Agent-level** | `.spherse/agents/{agent-slug}/skills/{skill-name}/` | 仅该 agent 私有 |

### 如何选择

- **Project-level**：适用于所有 agent 都应遵循的通用规范（如世界观术语表、项目写作风格、文件命名约定）。
- **Agent-level**：适用于某个 agent 专属的工作方式（如某个角色扮演 agent 的对话风格、某个助手 agent 的特定输出格式）。Agent-level skill 放在该 agent 自己的目录下，不污染其它 agent 的 skill 列表。

### 优先级

当 project-level 与 agent-level 存在同名 skill 时，agent-level 覆盖 project-level（agent-level > project > builtin）。

### 如何获取 agent slug

创建 agent-level skill 时，需要知道目标 agent 的 slug（即 agent 目录名，形如 `writer-a1b2c3`）：

- **当前 agent 自身**：在你的 system prompt 的 `<session-context>` 块中，`agent-slug: {slug}` 即为当前 agent 的目录名。用它构造路径 `.spherse/agents/{slug}/skills/{skill-name}/SKILL.md`。
- **其它 agent**：询问用户目标 agent 的 slug，或查看 `.spherse/agents/` 目录下的子目录名。

## 标准目录结构

```
{skill-name}/
├── SKILL.md              # 必需：YAML frontmatter + Markdown 指令正文
├── references/           # 可选：参考文档（如规范、模板说明）
│   └── style-guide.md
└── scripts/              # 可选：辅助模板或代码片段
    └── outline.md
```

- **`SKILL.md`（必需）**：skill 的唯一入口，包含 frontmatter 和指令正文。
- **companion files（可选）**：`SKILL.md` 之外的任意文件会被自动枚举为该 skill 的附加文件。agent 加载 skill 时会获得文件清单，可用 `read_file` 按需读取。建议用 `references/`、`scripts/` 等语义化子目录组织。

## SKILL.md 格式

SKILL.md 由两部分组成：

### 1. YAML Frontmatter

文件开头使用 `---` 分隔的 YAML 块，**必须**包含两个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | skill 名称，**必须与目录名完全一致**，不可含 `/`、`\`、`:`，不可以 `.` 开头 |
| `description` | string | 一句话描述 skill 的用途，agent 据此判断是否需要加载该 skill |

### 2. Markdown 指令正文

frontmatter 之后的 Markdown 内容即为 skill 的指令正文。这部分会在 agent 调用 `load_skill` 时被注入到上下文中，应写清：skill 的目标、具体规则、示例、注意事项。

### 完整示例

```markdown
---
name: fiction-style
description: 项目统一的小说写作风格规范，包括人称、时态、对话格式与章节结构约定
---

# 小说写作风格规范

## 人称与视角

- 全文使用第三人称限制视角
- 每章聚焦单一 POV 角色

## 对话格式

对话使用中文引号，人物语言与动作描写分行：

> 林晓转身看向窗外。
> 「这件事，我需要再想想。」

## 注意事项

- 避免大段心理独白，通过动作和环境暗示情绪
```

## 创建方式

使用 `write_file` 工具直接写入文件。`write_file` 会自动创建不存在的父目录。

### 创建 Project-level Skill

```text
路径：.spherse/skills/{skill-name}/SKILL.md
```

写入完整的 frontmatter + 指令正文即可。如需 companion files，用额外的 `write_file` 调用写入同目录下的文件。

### 创建 Agent-level Skill

```text
路径：.spherse/agents/{agent-slug}/skills/{skill-name}/SKILL.md
```

从你的 `<session-context>` 读取 `agent-slug`，替换 `{agent-slug}` 即可。

## 命名规范

- skill name 只用小写字母、数字和连字符（`-`），如 `fiction-style`、`world-bible`
- 不含 `/`、`\`、`:`，不以 `.` 开头
- 目录名必须与 frontmatter 的 `name` 一致——skill 系统按目录名定位 `SKILL.md`，若两者不一致，该 skill 虽出现在 catalog 中却无法被 `load_skill` 加载

## 生效时机

skill 目录在每次 session 启动时被扫描并合并进 skill catalog。因此：

- **新创建的 skill** 会在下一个 session 启动时出现在所有（对应层级）agent 的 skill catalog 中，届时可通过 `load_skill` 加载。
- **当前 session 内**，你可以直接用 `read_file` 读取刚写好的 SKILL.md 来确认内容，但 `load_skill` 尚未感知到它（catalog 在 session 开始时已固定）。
- **更新已有 skill**：直接编辑对应的 SKILL.md，下次 session 生效。

## 注意事项

- 只覆盖你需要封装的指令，skill 应聚焦单一主题，避免把无关内容塞进同一个 skill
- `description` 要写得让 agent 能判断何时该加载它——描述应点明 skill 解决什么问题、适用于什么场景
- companion files 不要放敏感信息（如密钥），skill 文件可被项目内有读权限的 agent 读取
