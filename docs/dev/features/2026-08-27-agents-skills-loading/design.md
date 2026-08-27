# `.agents/skills` 载入支持

## 背景

Spherse 目前只从 `.spherse/skills` 发现项目级 Skill。部分遵循 Agent Skills 目录约定的项目已经在项目根目录的 `.agents/skills` 中维护 Skill，打开这类项目后需要直接复用已有内容，而不要求复制或迁移。

## 设计

- `ProjectStore` 将项目根目录下的 `.agents/skills` 注册为 `SkillStore` 的附加项目级发现目录。
- `.agents/skills/<name>/SKILL.md` 使用现有解析规则，支持 YAML frontmatter、Markdown instructions 和 companion files。
- Skill 合并优先级为 agent-level > `.spherse/skills` > `.agents/skills` > builtin，同名 Skill 只暴露优先级最高的一项。
- `.agents/skills` 中的 Skill 继续使用现有 `source: project`，不扩展 API contract。
- 创建、zip 安装和市场更新仍只写入 `.spherse/skills`；`.agents/skills` 是兼容发现源，不是 Skill Panel 的管理目标。
- 不自动创建 `.agents/skills`，不存在时静默视为空目录。

## 验证

- `SkillStore` 覆盖附加目录发现、companion files 和冲突优先级。
- `ProjectStore` 覆盖 `.agents/skills` 的实际接线。
- 运行 core 单元测试、lint 和 TypeScript build。
