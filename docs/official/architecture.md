# 架构约定

## Core 层

- **Engine 是唯一门面**：外部（server）只通过 `Engine` 或 `createEngine` 访问 core 功能，不直接操作 store
- **Store 只管存储**：store 是对存储层读写的抽象，不持有运行时状态（如活跃的 pi-agent-core Agent 实例）
- **AgentProfile**：业务层 agent 概念，从 `.spherse/agents/*.md` 解析而来，包含不可变 `id`（UUID）
- **AgentProfileStore**：首次读取无 `id` 的 .md 文件时自动生成并回写 `id`；支持 `getRawContent(id)` 获取原始 Markdown 内容用于编辑
- **工具分配**：agent profile 未声明 `tools` 时默认获得全部工具
- **删除 agent**：由 Engine 协调 — 归档关联 sessions + 删除 profile 文件
- **Skill 系统**：`SkillStore` 读取 `.spherse/skills/*/SKILL.md`（YAML frontmatter + Markdown body），Engine 在构建 systemPrompt 时自动注入 skill catalog 列表；`load_skill` 工具供 agent 按需加载完整 skill 指令

## Server 层

- **AppContext** = `{ engine, projectStore }`，路由只通过 engine 访问 agent/session 操作，projectStore 仅用于内容浏览
- **路由按业务域拆分**到 `routes/` 目录，由 `index.ts` 聚合注册

## Electron 层

- **IPC handler** 集中在 `electron/ipc/` 目录，按业务域拆分
- **preload** 是安全桥梁，声明 Renderer 可用的 IPC 方法白名单

## 前端样式

- **基础组件层**：前端基础 UI 统一使用 shadcn/ui 本地源码组件，组件位于 `packages/app/src/components/ui/`，当前底层 base 为 Base UI
- **组件生成配置**：`packages/app/components.json` 记录 shadcn 样式 preset、Tailwind v4 CSS 入口和 `@/*` alias
- **色彩体系**：CSS 变量定义在 `styles.css` 的 `:root`，暗色模式通过 `@media (prefers-color-scheme: dark)` 覆盖；shadcn 语义 token 使用 `--shadcn-*` 变量并通过 Tailwind `@theme inline` 暴露
- **Tailwind @theme**：将常用颜色注册为 Tailwind 颜色（如 `bg-background`, `bg-card`, `bg-muted` 以及过渡期保留的 `bg-surface` 等），运行时通过 CSS 变量解析
- **Markdown 渲染**：动态 Markdown 统一通过 `MarkdownContent` 组件映射 `react-markdown` 节点样式，不在 `styles.css` 里维护 `.chat-markdown` 或 `.prose-content` 选择器
- **自定义主题**：用户可通过 `.spherse/theme.css` 覆盖 CSS 变量实现主题定制
