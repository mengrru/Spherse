# @spherse/presets

预置模板与静态内容包：builtin skill 源码、预置 agent、prompt 模板与新项目初始化物料。全局定位与 package 边界见 `docs/official/architecture/index.md`；数据文件的格式与存储约定见 `docs/official/data-conventions.md`。

## 构建期同步（scripts/sync-templates.mjs）

构建前执行 sync 脚本，将磁盘模板生成为 `src/generated/` 下可导入的 TypeScript 常量（产物 gitignore，构建时再生）：

| 产物 | 来源 | 消费方 |
|---|---|---|
| `AGENT_TEMPLATE` | `templates/agent-template.md` | app AgentDialog 新建 agent 的默认模板 |
| `AGENT_THEME_TEMPLATE` | `templates/agent-theme-template.css` | 无代码消费，仅参考物料 |
| `AGENTS_INDEX_TEMPLATE` | `templates/agents-index-template.md` | core 写新项目 AGENTS.md |
| `PRESET_SKILLS` | `presets.json` 的 `presetSkills` | 无运行时代码消费，仅为声明列表（驱动 builtin 合并的是 `PRESET_SKILL_SOURCES`） |
| `PRESET_AGENTS` | `presets.json` 的 `presetAgents` + `templates/preset-agents/<dir>.md` 完整内容（含 frontmatter `name`） | `initPresets()` |
| `PRESET_PROMPT_TEMPLATES` | `presets.json` 的 `presetPromptTemplates` + `templates/prompt-templates/<id>.md` 正文 | Agent 创建对话框徽章 |
| `PRESET_SKILL_SOURCES` | 递归读取 `skills/` 下声明的 skill 目录 | `SkillStore` 内存合并为 builtin skill |

声明缺失（skill dir 在 `skills/` 下不存在、agent `.md` 缺失或缺 frontmatter `name`、prompt template `.md` 缺失）时构建报错退出。

修改 `templates/` 或 `skills/` 下的源文件后，通过 `npm run build --workspace=packages/presets` 或 root `npm run build` 触发同步，确保生成内容可用。

## 共享策略常量（src/context-file-policy.ts）

agent 参考资料限制的单一来源（core 校验/组装与 app UI 共用，browser-safe 纯函数）：

- `CONTEXT_TOTAL_SIZE_LIMIT_BYTES`：参考资料总大小上限（512 × 1024 字节）
- `isTextContextPath(relPath)`：纯文本判定（扩展名 allowlist + 知名无扩展名文件名 + `.env` 前缀家族，大小写不敏感）

扩展名/文件名集合是模块内部常量，调整只在 `src/context-file-policy.ts` 一处；约束语义与消费层见 `docs/official/data-conventions.md` 的 agent frontmatter `context` 字段。

## presets.json 格式

声明两类预置内容：新项目创建时注入的（`presetSkills`、`presetAgents`）与供 UI 直接消费的（`presetPromptTemplates`，不参与项目创建注入）：

```json
{
  "presetSkills": [
    { "dir": "spherse-guide" },
    { "dir": "spherse-create-ui-theme" },
    { "dir": "spherse-create-agent-chat-theme" },
    { "dir": "spherse-use-ui-sdk" },
    { "dir": "spherse-build-data-app" },
    { "dir": "spherse-write-html" },
    { "dir": "spherse-create-skill" }
  ],
  "presetAgents": [
    { "dir": "assistant", "slugBase": "assistant" }
  ],
  "presetPromptTemplates": [
    { "id": "worldview-assistant", "name": "世界观创作助手" },
    { "id": "roleplay", "name": "角色扮演" }
  ]
}
```

- `presetSkills[].dir`：`skills/` 下的目录名，内容打包为 builtin skill 源码，运行时内存合并（source `builtin`），不复制到项目磁盘
- `presetAgents[].dir`：`templates/preset-agents/<dir>.md` 文件名（不含扩展名），完整 agent profile（frontmatter 声明 `name`、`tools` 等，正文为 system prompt）；展示 `name` 从 frontmatter 提取，不在 presets.json 重复声明
- `presetAgents[].slugBase`：agent 目录 slug 前缀（与 shortId 拼接成 agent slug）
- `presetPromptTemplates[].id` / `.name`：`templates/prompt-templates/<id>.md` 文件名与徽章展示名

## 运行时注入（initPresets）

新建项目时 `assembleProject` 检测首次创建，调用 core 的 `initPresets()`：

- 创建空的 `.spherse/skills/` 目录（供用户自建 project-local skill）
- 按 `PRESET_AGENTS` 创建预置 agent（id / createdAt 由 `ProjectStore.createAgent` 生成；单项失败仅告警不中断）
  - 当前内置「小助手」（slugBase `assistant`）：开启除 `run_command` 外的全部工具（含 `manage_agent`、`manage_trigger`、`memory_save` / `memory_recall` 与 `manage_project_config`），写操作仍受审批门控

非新建项目（已存在项目重新打开）不触发注入；注入后的预置 agent 属用户所有，可自由修改或删除。builtin skill 不落盘，由 `SkillStore` 从 `PRESET_SKILL_SOURCES` 内存合并，随 app 升级更新；用户在 `.spherse/skills/` 下自建的同名 project skill 按 name 覆盖 builtin。

## 维护守则

- `skills/` 下的 SKILL.md 是 LLM-facing 内容（会进入 agent 的 skill catalog 与 `load_skill` 全文），修改措辞等同于修改产品行为，需谨慎评审
- 主题类 skill（`spherse-create-ui-theme` / `spherse-create-agent-chat-theme`）与 design system、聊天 DOM / CSS token 强耦合——改 `packages/app` 相关实现时必须检查两者是否需要同步
- presets.json 声明与磁盘内容的一致性由构建期校验兜底，新增条目直接改 json + 放文件即可
