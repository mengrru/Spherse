# 架构约定

## Package 边界

- **@spherse/core**：纯 Node.js 核心逻辑，负责项目数据、agent profile、session、skill、tool 和 engine 运行时，不依赖 Electron 或 Fastify
- **@spherse/presets**：内置模板与预置静态内容，构建前通过 `scripts/sync-templates.mjs` 将 `templates/*.md` 同步为可导入常量
- **@spherse/server**：Fastify API 层，只负责把 HTTP/WebSocket 请求转发到 core 的 Engine 和 ProjectStore
- **@spherse/app**：Electron + React 桌面应用，负责多项目窗口状态、IPC、renderer UI、每个项目的本地 server 生命周期

## Core 层

- **Engine 是唯一门面**：外部（server）只通过 `Engine` 或 `createEngine` 访问 core 功能，不直接操作 store
- **Store 只管存储**：store 是对存储层读写的抽象，不持有运行时状态（如活跃的 pi-agent-core Agent 实例）
- **AgentProfile**：业务层 agent 概念，从 `.spherse/agents/*.md` 解析而来，包含不可变 `id`（UUID）
- **Agent context**：agent profile 的 `context` 字段声明项目内相对路径，Engine 构建 system prompt 时读取这些文件并注入 `Pre-loaded Context`
- **AgentProfileStore**：首次读取无 `id` 的 .md 文件时自动生成并回写 `id`；支持 `getRawContent(id)` 获取原始 Markdown 内容用于编辑
- **工具分配**：agent profile 未声明 `tools` 时默认获得全部工具
- **工具集合**：默认工具由 `createToolsForProject` 组装，包括文件读写、字符串替换编辑、文件列表、内容搜索、changelog 追加、skill 加载和 HTML card 渲染
- **写入互斥**：`write_file`、`edit_file`、`append_changelog` 共享 `FileWriteMutex`，避免同一文件并发写导致内容丢失
- **删除 agent**：由 Engine 协调，归档关联 sessions 后删除 profile 文件
- **Skill 系统**：`SkillStore` 读取 `.spherse/skills/*/SKILL.md`（YAML frontmatter + Markdown body），Engine 在构建 system prompt 时自动注入 skill catalog 列表；`load_skill` 工具供 agent 按需加载完整 skill 指令
- **AI 文件读取限制**：项目配置可声明 `aiAccess.deniedPaths`；Engine 构建 agent 时通过动态 access policy 限制 `read_file`、`list_files`、`search_content`、`render_card file_path`、`edit_file` 的内部读取和 profile context 注入

## Server 层

- **AppContext** = `{ engine, projectStore }`，路由只通过 engine 访问 agent/session/skill 操作，projectStore 用于项目根目录和内容浏览
- **路由按业务域拆分**到 `routes/` 目录，由 `routes/index.ts` 聚合注册
- **内容 API**：`content.ts` 负责目录列表、文件读取、保存、删除、新建文件和新建目录；所有文件路径都必须限制在项目根目录内
- **文件树 API**：`file-tree.ts` 返回面向 UI 选择的项目文件列表，过滤 `.spherse`、`node_modules`、`.git` 和 dotfile/dotdir
- **预览 API**：`preview.ts` 为本地 HTML 内容提供预览 URL，renderer 通过 iframe/card 使用
- **WebSocket**：`ws-chat.ts` 推送 agent 对话事件；`ws-fs-watch.ts` 推送项目文件变更，用于前端刷新内容浏览状态
- **AI access settings API**：`settings.ts` 暴露 `/api/settings/ai-access`，读写项目级 AI 读取禁止列表；renderer 不直接通过 content API 编辑 `.spherse/project.yaml`

## Electron 层

- **IPC handler** 集中在 `electron/ipc/` 目录，按业务域拆分为 project、settings、debug
- **preload** 是安全桥梁，声明 Renderer 可用的 IPC 方法白名单
- **项目 server 管理**：当前每个打开项目对应一个本地 Fastify 实例，由 `electron/server.ts` 用 `Map<projectPath, server>` 管理
- **设置持久化**：`electron/settings.ts` 使用 electron-store 保存打开项目、最后活跃项目、provider API key 和默认模型；保存 provider key 后同步到进程环境变量
- **Provider catalog**：`core/model-providers.ts` 从 `@earendil-works/pi-ai` 元数据动态生成 provider catalog，`ENABLED_PROVIDERS` 过滤 UI 可见 provider（11 个），`PROVIDER_ENV_KEYS` 映射 provider→env key；Engine model resolution 使用全部 pi-ai provider
- **默认模型切换**：Engine 暴露 `setDefaultModel()` 方法，IPC save-settings 后通过 `electron/server.ts` 的 `updateDefaultModel()` 同步更新所有运行中 engine 的 globalDefaultModel
- **开发调试**：debug IPC 仅暴露开发模式相关动作，如 DevTools、electron-store 查看、reload renderer、reset app data

## 前端路由与状态

- **Hash Router**：renderer 使用 React Router Hash Router，路由表达应用内导航状态，避免 Electron 本地页面刷新时依赖服务端 history fallback
- **项目路由**：项目、会话和内容页通过 URL 表达，当前路径形态为 `/project/:projectKey`、`/project/:projectKey/chat/:sessionId`、`/project/:projectKey/content?path=...`
- **projectKey**：URL 中不暴露完整文件系统路径；`project-key.ts` 根据项目目录名生成当前打开项目集合内稳定的 URL key，真实身份仍以 project path 为准
- **项目内 lastRoute**：每个打开项目在 `openProjects` 条目中持久化相对于 `/project/:projectKey` 的 `lastRoute`，如 `/chat/:sessionId` 或 `/content?path=...`；应用启动、项目切换和关闭当前项目后的下一个项目导航都会恢复该项目的 lastRoute
- **应用级 store**：`app-store.ts` 管理打开项目集合、当前项目、restore/open/close/reveal 等 Electron IPC 相关动作
- **项目数据 store**：`project-data-store.ts` 按 projectKey 缓存 agents、sessions、初始消息和 loading/error 状态
- **项目 UI store**：`project-ui-store.ts` 按 projectKey 管理折叠状态等纯 UI 状态
- **局部状态边界**：Chat 消息流、WebSocket ref、文件编辑 dirty/conflict、弹窗表单等短生命周期状态保留在对应组件或 feature hook 内；Chat 输入框草稿按 sessionId 缓存在 renderer `localStorage`，用于 session 切换和应用重启后的草稿恢复
- **页面 / layout / feature 边界**：`pages/` 只做路由适配和参数校验；跨 feature 的页面编排放在 `layouts/`；业务域专属 UI、hooks 和局部动作放在 `features/{domain}/`
- **feature-based 组织**：`features/chat`、`features/content-browser`、`features/agent-session-list`、`features/project-panel`、`features/file-tree`、`features/text-selection-session`、`features/settings`、`features/debug-tools`、`features/activity-bar` 分别拥有自己的组件和 hooks
- **共享组件边界**：`components/` 保留 shadcn/ui、跨 feature 复用组件和少量通用组件；只被某个 feature 使用的组件不放在全局 components 根目录

## 前端样式

- **基础组件层**：前端基础 UI 统一使用 shadcn/ui 本地源码组件，组件位于 `packages/app/src/components/ui/`，当前底层 base 为 Base UI
- **组件生成配置**：`packages/app/components.json` 记录 shadcn 样式 preset、Tailwind v4 CSS 入口和 `@/*` alias
- **单一 Token 体系**：CSS 变量定义在 `styles.css` 的 `:root`，暗色模式通过 `@media (prefers-color-scheme: dark)` 覆盖。当前使用 shadcn 语义 token（`--shadcn-*`），通过 Tailwind `@theme inline` 映射为 `bg-background`、`text-foreground` 等 Tailwind 颜色。不维护旧的自定义变量（`--surface`、`--base` 等已移除）。后续如需 Spherse 自有扩展 token，使用 `--agent-{name}` 前缀 + `--color-agent-{name}` Tailwind 映射
- **样式写法**：所有样式通过 Tailwind 工具类写在组件 className 中，不在 `styles.css` 中新增手写 CSS class。禁止硬编码颜色值（如 `text-[#333]`），需要新颜色时在 `styles.css` 中注册 CSS 变量 + Tailwind 颜色
- **语义 Token 使用**：使用 shadcn 语义 token（`bg-background`、`bg-card`、`bg-muted`、`bg-primary`、`bg-accent`、`text-foreground`、`text-muted-foreground`、`border-border`、`text-destructive` 等）。shadcn 未覆盖的业务语义按需新增 `--agent-*` token
- **间距与阴影**：使用 Tailwind 标准 scale（`p-2`、`rounded-md`、`shadow-sm` 等），不硬编码 magic number
- **暗色适配**：业务组件不写 `dark:` 修饰符，由 CSS 变量值切换自动适配。仅 shadcn/ui 组件源码中已有的 `dark:` 保留
- **Markdown 渲染**：动态 Markdown 统一通过 `MarkdownContent` 组件映射 `react-markdown` 节点样式，不在 `styles.css` 里维护 `.chat-markdown` 或 `.prose-content` 选择器
- **自定义主题**：用户可通过项目根目录 `.spherse/theme.css` 覆盖 CSS 变量实现主题定制，只允许覆盖 `:root` 中已有的变量名
