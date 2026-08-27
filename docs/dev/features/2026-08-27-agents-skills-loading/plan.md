# `.agents/skills` 载入实施计划

1. 扩展 `SkillStore`，允许配置附加项目级 Skill 目录，并统一复用现有解析逻辑。
2. 在 `ProjectStore` 创建和打开项目时接入 `<project-root>/.agents/skills`。
3. 补充附加目录载入、companion files、优先级和 ProjectStore 接线测试。
4. 同步正式文档、内置 Skill 创建指南与 backlog。
5. 运行 core 测试、lint 和 build。
