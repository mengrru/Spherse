# 数据约定

## 世界观项目结构

用户的世界观项目是独立文件夹，结构为 `.spherse/`（系统文件）+ 用户自定义目录。

## Agent 定义格式

Markdown 文件 + YAML frontmatter（必须包含 `name`、`type` 字段，`id` 在首次读取时自动生成）。

## 数据存储

- 创作内容为纯文件（Markdown/YAML）
- Session 数据为 SQLite（`.spherse/sessions.db`）

## Agent 唯一标识

每个 AgentProfile 有 UUID（`id` 字段），首次创建时自动生成，设计意图为不可变。Sessions 通过 `agent_id` 关联，删除 agent 后 sessions 进入归档状态。

## Skill 定义格式

存放于 `.spherse/skills/<skill-name>/SKILL.md`，YAML frontmatter（必须包含 `name`、`description` 字段）+ Markdown body（`instructions`）。

```markdown
---
name: my-skill
description: A brief description of the skill
---

Full skill instructions in Markdown...
```
