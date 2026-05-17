# Agent 编辑 UI 增强 — 设计文档

## 概述

将 Agent 创建/编辑界面从 raw Markdown textarea 改为结构化表单，显式展示 name、工具权限、参考资料、提示词四个核心字段，并在前端做表单格式与标准 Markdown 定义格式的双向转换。

## 表单字段

| 字段 | UI 控件 | 默认值 | 隐藏/显示 |
|------|---------|--------|-----------|
| 名称 | 文本输入框 | `"新 Agent"` | 显示 |
| 工具权限 | Chip 多选（点击切换选中/取消） | 全部选中 | 显示 |
| 参考资料 | Tag 输入 + 模糊匹配自动补全 | 空 | 显示 |
| 提示词 | Textarea（可拖拽调整高度） | 模板内容 | 显示 |
| type | — | `creator` | 隐藏 |
| model | — | 空（使用项目/全局默认） | 隐藏 |

### 工具权限

工具以 chip 形式展示，点击切换选中/取消状态。选中为 accent 色，未选中为 muted 色。默认全部选中。

前端维护静态映射表（不依赖后端）：

| Tool ID | 显示名 |
|---------|--------|
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `edit_file` | 编辑文件 |
| `list_files` | 列出文件 |
| `search_content` | 搜索内容 |
| `append_changelog` | 追加日志 |
| `load_skill` | 加载技能 |
| `render_card` | 渲染卡片 |

### 参考资料

使用 Tag 输入 + 自动补全方式：

- 已选文件以 tag 形式显示，点击 ✕ 删除
- 输入时展开下拉补全列表，模糊匹配项目内文件路径
- 模糊匹配策略：对输入按 `/` 分割，每段做子串匹配（如输入 `wo/geo` 匹配 `world/geography.md`）
- 回车或点击下拉项添加
- 使用现有 `client.listContent()` API 获取目录内容，前端做匹配过滤

## 转换逻辑

### 解析（Markdown → 表单）

使用 `js-yaml` 解析 YAML frontmatter：

1. 提取 `name` → 名称字段
2. 提取 `tools` → 工具选中状态
3. 提取 `context` → 参考资料 tag 列表
4. 正文（`---` 之后）→ 提示词
5. 保留完整的 frontmatter 对象作为暗数据，用于回写时保留未知字段

### 构建（表单 → Markdown）

将表单字段合并回 frontmatter 对象：

1. 覆盖 `name`、`tools`、`context`
2. 保留暗数据中的其他字段（`id`、`output`、`schedule` 等）不变
3. `type` 在创建时写入 `creator`，编辑时保留暗数据中的原值
4. 正文追加到 `---` 之后

## 不改动的部分

- 后端 API 不变，仍接收 raw markdown string
- `AgentDialog` 的 props 接口不变（`mode`, `initialContent`, `onSubmit`, `onCancel`）
- `ProjectPage` 中调用 `AgentDialog` 的方式不变
- 文件名仍从 `name` 字段派生（`{name}.md`）

## 新增依赖

- `js-yaml` + `@types/js-yaml` — 添加到 `packages/app`

## 文件变更范围

- `packages/app/src/components/AgentDialog.tsx` — 重写为表单式 UI
- `packages/app/src/lib/agent-markdown.ts` — 新增，Markdown ↔ 表单转换函数
- `packages/app/src/lib/tool-registry.ts` — 新增，工具 ID ↔ 显示名映射
- `packages/app/package.json` — 新增 `js-yaml` 依赖
