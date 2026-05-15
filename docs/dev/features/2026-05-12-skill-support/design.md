# Skill 支持

## 概述

实现 [agentskills.io](https://agentskills.io/) 规范的 Skill 系统，允许 agent 在运行时自主发现和加载可复用的 skill（预设 prompt 指令）。

Skill 是一种**运行时动态加载**的能力模块，不改变 agent 的 tool 集合，仅通过注入 prompt 指令引导 agent 行为。多个 skill 可同时叠加。

## 规范

### 文件结构

Skill 存储在项目目录的 `.pi/skills/{skill-name}/SKILL.md` 中：

```
.pi/skills/
├── brainstorming/
│   └── SKILL.md
├── world-map-design/
│   ├── SKILL.md
│   └── references/
│       └── map-spec.md
└── character-sheet/
    └── SKILL.md
```

### SKILL.md 格式

遵循 agentskills.io 规范，使用 YAML frontmatter + Markdown body：

```markdown
---
name: skill-name
description: A description of what this skill does and when to use it.
---

Skill instructions in markdown...
```

**首轮仅支持 minimal frontmatter**（`name` + `description`），其余字段（`license`、`compatibility`、`metadata`、`allowed-tools`）忽略。

## 架构

### 数据层：SkillStore

新增 `packages/core/src/store/skill.ts`。

```typescript
interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
}
```

- `SkillStore.list()` → `SkillDefinition[]`：扫描 `.pi/skills/*/SKILL.md`
- `SkillStore.get(name: string)` → `SkillDefinition | null`：读取指定 skill
- 使用 `gray-matter` 解析 frontmatter（与 AgentProfileStore 一致）
- 以目录名为 skill 唯一标识，`get(name)` 按目录名查找。frontmatter 中的 `name` 仅作为元数据读取，不强求一致

### 运行时：Skill 发现与加载

#### System Prompt 注入

`Engine.buildAgent()` 时，在 system prompt 末尾追加所有可用 skill 的目录：

```
## Available Skills

- **brainstorming**: A skill for creative brainstorming sessions
- **world-map-design**: Generate and manage world maps

Use the load_skill tool to load a skill's full instructions when needed.
```

当没有可用 skill 时，不追加此段。

#### `load_skill` Tool

新增 `packages/core/src/tools/load-skill.ts`，工厂函数 `createLoadSkillTool(projectRoot)`：

- 参数 schema：`{ skill_name: string }`
- 行为：调用 `SkillStore.get(name)`，将完整 instructions 作为 `TextContent` 返回
- LLM 在后续轮次中遵循返回的指令
- 如果 skill 不存在，返回错误提示

### API 层

新增 `packages/server/src/routes/skills.ts`：

| 路由 | 说明 |
|------|------|
| `GET /api/skills` | 返回所有 skill 的 name + description 列表 |
| `GET /api/skills/:name` | 返回完整 SkillDefinition |

不提供激活/停用 API——激活完全通过 agent 的 `load_skill` tool 完成。

### 用户交互

用户通过对话消息触发 skill 加载（如"使用 brainstorming skill"），agent 自行判断是否调用 `load_skill`。未来可在 UI 中提供快捷入口。

## 变更范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/core/src/types.ts` | 修改 | 新增 `SkillDefinition` 类型 |
| `packages/core/src/store/skill.ts` | 新增 | SkillStore 实现 |
| `packages/core/src/store/index.ts` | 修改 | 导出 SkillStore |
| `packages/core/src/tools/load-skill.ts` | 新增 | `createLoadSkillTool` |
| `packages/core/src/tools/index.ts` | 修改 | 将 `load_skill` 加入工具集 |
| `packages/core/src/engine.ts` | 修改 | `buildAgent()` 注入 skill 目录到 system prompt |
| `packages/core/src/index.ts` | 修改 | 导出新类型 |
| `packages/server/src/routes/skills.ts` | 新增 | skill 查询路由 |
| `packages/server/src/routes/index.ts` | 修改 | 注册 skills 路由 |

本轮**不涉及前端**，仅实现核心层和 API 层。
