# 架构约定

## Package 边界

- **@spherse/core**：纯 Node.js 核心逻辑，负责项目数据、agent profile、session、skill、tool 和运行时管理，不依赖 Electron 或 Fastify
- **@spherse/presets**：内置模板与预置静态内容，构建前通过 `scripts/sync-templates.mjs` 将 `templates/*.md` 同步为可导入常量，并从 `presets.json` 及 `skills/` 目录生成预置 skill 源码和 agent 配置（`PRESET_SKILLS`、`PRESET_AGENTS`、`PRESET_SKILL_SOURCES`），供 core 在新项目创建时注入
- **@spherse/server**：Fastify API 层，只负责把 HTTP/WebSocket 请求转发到 core 的三个运行时模块（ProjectManager、SessionRuntime、Scheduler）

## Core 层

- **三模块架构**：core 对外暴露三个职责清晰的模块，由 `createProject` factory 创建并组装为 `ProjectRuntime`——`ProjectManager`（项目数据操作门面，包装 ProjectStore）、`SessionRuntime`（活跃 Agent 实例管理）、`Scheduler`（cron 轮询）。`ProjectRuntime` 是轻量协调层，只在操作跨越模块边界时介入（deleteSession、deleteAgent、shutdown）
- **导出收紧**：store 层只导出 `ProjectStore`（供 core 内部使用），其余 store 类不对外暴露；core 的 `index.ts` 只导出外部实际消费的符号——value 导出仅 `createProject`、`resolveProjectPath`、`getSupportedProviders`，类型导出包括 `ProjectRuntime`、`ProjectManager`、`SessionRuntime`、`Scheduler`、`Logger` 等。Server 无法直接访问 store 实例
- **Store 树状结构**：store 按「聚合根 → per-agent 子 store」的树状结构组织——`ProjectStore` 作为聚合根持有 `ProjectConfigStore`、`SkillStore` 和 `Map<agentId, AgentStore>`；每个 `AgentStore` 聚合 per-agent 的 `AgentProfileStore`、`SessionStore`、`ScheduleStore`。store 在构造时就确定自己的文件路径，运行时不做 agentId → 目录的查找
- **Store 只管存储**：store 是对存储层读写的抽象，不持有运行时状态（如活跃的 pi-agent-core Agent 实例）
- **thin aggregator**：聚合根（`ProjectStore`、`AgentStore`）只持有子 store 并暴露 getter（`projectStore.config`、`agentStore.sessions`），不逐个 wrap 子 store 的方法
- **结构化日志**：core 使用 pino 记录结构化日志，采用共享单实例注入模型——core 作为 library 只定义 `Logger` 类型和内部兜底工厂 `createSilentLogger`，实际的生产 logger 由 server composition root（`createServerLogger`）创建并通过 `createProject` 注入。SessionRuntime 在 `sendMessage` 中通过 `logAgentEvent` 记录 agent loop 全生命周期事件（agent_start/turn_start/tool_execution 等），stores 在关键操作（init/create/persist）中输出日志
- **AgentProfile**：业务层 agent 概念，从 `.spherse/agents/{slug}-{shortId}/profile.md` 解析而来，包含不可变 `id`（UUID）、`createdAt`（创建时间）和 `slug`（目录名）
- **Agent context**：agent profile 的 `context` 字段声明项目内相对路径，SessionRuntime 构建 system prompt 时读取这些文件并注入 `Pre-loaded Context`
- **AgentProfileStore**：per-agent，首次读取无 `id` 的 profile.md 时自动生成并回写 `id`，创建 agent 时自动写入 `createdAt` 且更新时保持不变；支持 `getRawContent()` 获取原始 Markdown 内容用于编辑
- **工具分配**：agent profile 未声明 `tools` 时默认不分配任何工具（空列表）；前端新建 agent 时通过模板默认勾选全部工具
- **工具集合**：默认工具由 `createToolsForProject(ctx: ToolContext)` 组装，包括文件读写、字符串替换编辑、文件列表、内容搜索、文件移动与复制、changelog 追加、skill 加载和 HTML card 渲染。`ToolContext` 收窄了 ProjectStore 的可用接口（仅 `root`、`skill`、`appendChangelog`、`mutex`、`getAiFileAccessPolicy`），编译时阻止 tool 访问 store 的写方法；`append_changelog` 复用 `ProjectStore.appendChangelog()`，`load_skill` 复用 `ProjectStore.skill`（SkillStore），不重复实现存储逻辑
- **路径安全**：项目内路径统一通过 `utils/path-safety.ts` 的 `resolveProjectPath` / `isPathInside` / `assertInsideProject` 解析和校验，core tools、agent context 读取和 server 内容路由共享同一边界判断
- **写入互斥**：`write_file`、`edit_file`、`append_changelog`、`move_file`、`copy_file` 共享 `FileWriteMutex`，避免同一文件并发写导致内容丢失
- **删除 agent**：compound operation，由 `ProjectRuntime.deleteAgent` 协调——SessionRuntime.evictAgent 清理活跃 session、Scheduler.unregisterAgent 清理定时任务、ProjectManager.deleteAgent 删除数据
- **Skill 系统**：`SkillStore` 读取 `.spherse/skills/*/SKILL.md`（YAML frontmatter + Markdown body），SessionRuntime 在构建 system prompt 时自动注入 skill catalog 列表；`load_skill` 工具供 agent 按需加载完整 skill 指令
- **定时调度**：`Scheduler` 类使用 `cron-parser` 解析 cron 表达式，通过单个 `setTimeout` 链式轮询所有已启用任务。轮询间隔为 10 分钟，首次轮询对齐到最近的 10 分钟整数倍时间；`loadFromAgents` 在 `createProject` 时遍历 `ProjectStore.agents` 读取每个 agent 的 `schedules.yml` 并注册运行时状态
- **AI 文件读取限制**：项目配置可声明 `aiAccess.deniedPaths`；SessionRuntime 构建 agent 时通过动态 access policy 限制 `read_file`、`list_files`、`search_content`、`render_card file_path`、`edit_file`、`move_file`、`copy_file` 的内部读取和 profile context 注入
- **项目欢迎页设置**：项目配置可声明 `welcomePage.path`，保存项目根目录内 HTML 或图片相对路径；该设置仅供 renderer 欢迎页展示使用，不注入 agent prompt，也不影响 AI 工具访问策略
- **预置内容注入**：`createProject` 检测到新项目时调用 `initPresets()`，将 `@spherse/presets` 声明的预置 skill 完整目录复制到 `.spherse/skills/`，并根据 `PRESET_AGENTS` 配置自动创建预置 agent（如「世界观创作」）。预置配置来源为 `packages/presets/presets.json`。仅在首次创建时注入，已有项目不受影响；注入后的内容属于用户所有，app 升级不会覆盖

## Server 层

- **单 Fastify 实例**：整个应用只启动一个 Fastify 实例承载所有项目，由 `createMultiProjectServer()` 创建；不再为每个项目创建独立 server
- **ProjectRegistry**：`registry.ts` 维护 `Map<projectId, ProjectContext>`，项目打开时 `register()`、关闭时 `remove()`；`ProjectContext` = `{ runtime, projectManager, sessionRuntime, scheduler, projectId }`
- **projectId**：由 core 的 `ProjectConfigStore` 在 `.spherse/project.yaml` 中生成（8 位 nanoid），跨重启和路径变化稳定；复制目录导致 id 冲突时 registry 静默改写副本的 project.yaml
- **路由按业务域拆分**到 `routes/` 目录，由 `routes/index.ts` 聚合注册；所有项目级路由统一使用 `/api/projects/:projectId/...` 前缀，`preHandler` 钩子从 registry 解析 projectId 并注入 `req.projectCtx`；全局端点（如 `/api/settings/providers`）不带 projectId
- **API contract**：HTTP request/response 与 WebSocket message/event 的运行时 schema 定义在 `contracts/`，通过 `@spherse/server/contracts` 子入口导出给 server routes、WebSocket handler 和 renderer API client 复用；边界 JSON 进入业务逻辑前必须先通过 contract helper 解析；chat WebSocket 的 `ChatServerEvent` 是严格的 pi-agent lifecycle 事件 union（agent_start/turn_start/message_start/message_update/message_end/turn_end/agent_end/tool_execution/error 等），renderer 的 chat event 类型直接复用该 contract
- **运行时 schema**：有 body 的 HTTP route 通过 server contract 中的 TypeBox schema 绑定 Fastify `schema.body` / `schema.response`；所有 JSON route（GET 含）均绑定 `schema.response`，含 pi-agent 复杂嵌套对象（session messages、turn context）的端点改用 handler 内 `parseContract` 校验以避免 fast-json-stringify 误丢字段；contract 按业务域拆文件（`agents.ts`/`sessions.ts`/...），命名用资源+操作风格（`AgentCreateRequest`/`SessionListResponse`）；renderer 的 `api.ts` 对每个响应统一走 `parseApiResponse` 校验；WebSocket 收到的 JSON 必须通过 contract parser 校验，非法消息返回统一 error event
- **内容 API**：`content.ts` 负责目录列表、文件读取、保存、删除、新建文件和新建目录；所有文件路径都通过 core 共享路径安全工具限制在项目根目录内
- **文件树 API**：`file-tree.ts` 返回面向 UI 选择的项目文件列表，过滤 `.spherse`、`node_modules`、`.git` 和 dotfile/dotdir
- **预览 API**：`preview.ts` 为本地 HTML 与图片内容提供预览 URL，renderer 通过 iframe、图片或 HTML card 使用
- **WebSocket**：`ws-chat.ts` 推送 agent 对话事件；`ws-fs-watch.ts` 推送项目文件变更；`ws-schedule.ts` 推送定时任务事件——三者均使用 `/ws/projects/:projectId/...` 路径前缀按项目隔离；`ws-debug.ts` 推送全局 pino 结构化日志流（日志带 projectId 字段，可供前端过滤），供前端 Debug Streaming Log 面板消费
- **定时任务 API**：`schedules.ts` 提供定时任务 CRUD 和手动触发
- **项目 settings API**：`settings.ts` 暴露 `/api/projects/:projectId/settings/ai-access` 读写项目级 AI 读取禁止列表，暴露 `/api/projects/:projectId/settings/welcome-page` 读写项目级欢迎页路径；renderer 不直接通过 content API 编辑 `.spherse/project.yaml`

## Electron 层

- **环境隔离**：`electron/bootstrap.ts` 作为构建入口，dev 模式（`app.isPackaged === false`）下将 `userData` 重定向到 `Spherse-Dev/` 目录，使 dev 和 prod 的 electron-store、localStorage 等所有数据完全隔离，可同时运行；`NODE_ENV=test` 时保留测试启动参数指定的 `userData`，确保 E2E 用例隔离
- **IPC handler** 集中在 `electron/ipc/` 目录，按业务域拆分为 project、settings、debug
- **preload** 是安全桥梁，声明 Renderer 可用的 IPC 方法白名单
- **项目 server 管理**：单一 Fastify 实例在 `app.whenReady()` 时通过 `ensureServer()` 启动一次，项目打开/关闭只操作 `ProjectRegistry`（register/remove），不再 create/close Fastify；`electron/server.ts` 暴露 `ensureServer`、`registerProject`、`unregisterProject`、`getServerPort`、`stopServer`
- **设置持久化**：`electron/settings.ts` 使用 electron-store 保存打开项目、最后活跃项目、provider API key 和默认模型；保存 provider key 后同步到进程环境变量
- **Provider catalog**：`core/model-providers.ts` 从 `@earendil-works/pi-ai` 元数据动态生成 provider catalog，`ENABLED_PROVIDERS` 过滤 UI 可见 provider（11 个），`PROVIDER_ENV_KEYS` 映射 provider→env key；Engine model resolution 使用全部 pi-ai provider
- **默认模型切换**：Engine 暴露 `setDefaultModel()` 方法，IPC save-settings 后通过 `electron/server.ts` 的 `updateDefaultModel()` 同步更新所有运行中 engine 的 globalDefaultModel
- **开发调试**：debug IPC 仅暴露开发模式相关动作，如 DevTools、electron-store 查看、reload renderer、reset app data；Debug Tools 包含 Streaming Log 面板（可拖动悬浮窗口，通过 `/ws/debug` WebSocket 实时显示 server 日志）和 Turn Context 下载（通过 `GET /api/debug/sessions/:id/turn-context` 导出当前 session 的 system prompt + messages + tools 为 JSON 文件，便于排查 agent 行为）

## 前端路由与状态

- **Hash Router**：renderer 使用 React Router Hash Router，路由表达应用内导航状态，避免 Electron 本地页面刷新时依赖服务端 history fallback
- **项目路由**：项目、会话和内容页通过 URL 表达，当前路径形态为 `/project/:projectId`、`/project/:projectId/chat/:sessionId`、`/project/:projectId/content?path=...`
- **projectId**：URL 中使用 `.spherse/project.yaml` 中的稳定 id（nanoid 8 位 token）作为路由参数，替代旧的基于目录名生成的 projectKey；全链路（core → server → IPC → renderer 路由 → localStorage key）统一使用 projectId 作为唯一身份标识
- **项目内 lastRoute**：每个打开项目在 `openProjects` 条目中持久化相对于 `/project/:projectId` 的 `lastRoute`，如 `/chat/:sessionId` 或 `/content?path=...`；应用启动、项目切换和关闭当前项目后的下一个项目导航都会恢复该项目的 lastRoute
- **应用级 store**：`app-store.ts` 管理打开项目集合、当前项目、restore/open/close/reveal 等 Electron IPC 相关动作，并持久化左侧 side panel 固定/自动收起偏好
- **项目数据 store**：`project-data-store.ts` 按 projectId 缓存 agents、sessions、初始消息、定时任务、运行中定时任务和 loading/error 状态
- **项目 UI store**：`project-ui-store.ts` 按 projectId 管理折叠状态、浮窗会话状态等纯 UI 状态，通过 renderer localStorage 持久化
- **局部状态边界**：文件编辑 dirty/conflict、弹窗表单等短生命周期状态保留在对应组件或 feature hook 内；Chat 输入框草稿按 sessionId 缓存在 renderer `localStorage`，用于 session 切换和应用重启后的草稿恢复；欢迎页设置 dialog 的打开状态保留在 `ActivityBar` 内，欢迎页设置变更通过 `lib/events.ts` 中的 renderer 自定义事件通知当前欢迎页重新读取项目配置
- **Chat streaming store**：Chat 消息流和 WebSocket 连接由 `features/chat/streaming-store.ts` 统一管理，按 sessionId 缓存 messages、streaming、scrollPosition、WebSocket 和挂载计数；`useChatSession` 只负责 attach/detach 与选择状态，切换页面或关闭 chat 不会中断后台流式输出；WebSocket 事件按 animation frame 批量归约，避免高频 token update 触发过多 React render；`chat-session-reducer.ts` 负责纯数据归约，使用 `message_start` 创建 assistant 占位、`agent_end` 结束正常 streaming，并忽略 user lifecycle 事件以保留本地立即显示 user bubble 的体验
- **页面 / layout / feature 边界**：`pages/` 只做路由适配和参数校验；跨 feature 的页面编排放在 `layouts/`；业务域专属 UI、hooks 和局部动作放在 `features/{domain}/`
- **feature-based 组织**：`features/chat`、`features/content-browser`、`features/agent-session-list`、`features/agent-schedule`、`features/project-panel`、`features/file-tree`、`features/floating-chat`、`features/text-selection-session`、`features/settings`、`features/debug-tools`、`features/activity-bar`、`features/welcome-page`、`features/welcome-page-settings` 分别拥有自己的组件和 hooks
- **UI SDK**：`src/ui-sdk/` 提供 iframe 与 App 内代码统一 action 通信框架。iframe 通过 `postMessage` 发送 `type: "spherse:action"` 消息，由 `useSpherseMessageListener` hook 接收并分发到注册的 handler；App 内代码直接调用 `dispatchAction`。外部调用经 rate limiter 限流（每分钟最多 10 次），内部调用无限制。新增 action 只需在 `handlers/` 下新建文件并 `registerAction`，无需改动 listener 或 registry。导航类 action（createSession/openFile/sendMessage）为单向触发；data CRUD action（data.get/set/delete）支持 requestId 请求-响应模式，iframe 指定 `.data.json` 文件路径，handler 复用现有 Content API 进行 key-value 数据持久化
- **共享组件边界**：`components/` 保留 shadcn/ui、跨 feature 复用组件和少量通用组件；只被某个 feature 使用的组件不放在全局 components 根目录

## i18n

- **locale 是应用级设置**：持久化在 electron-store 的 `settings.locale`，默认 `zh-CN`
- **翻译资源**：集中管理在 `@spherse/i18n` package 的 `src/locales/{zh-CN,zh-TW,en}.ts`
- **前端消费**：renderer 通过 `@spherse/i18n/react` 的 `I18nProvider` + `useI18n()` 获取翻译
- **后端消费**：Electron/server/core 通过 `translate(locale, key, params)` 纯函数获取翻译
- **校验**：`npm run check:i18n` 检查 locale key 一致性和插值变量一致性
- **开发者 skill**：`.opencode/skills/i18n/SKILL.md` 指导 coding agent 迁移用户可见字符串

## 前端样式

- **基础组件层**：前端基础 UI 统一使用 shadcn/ui 本地源码组件，组件位于 `packages/app/src/components/ui/`，当前底层 base 为 Base UI
- **组件生成配置**：`packages/app/components.json` 记录 shadcn 样式 preset、Tailwind v4 CSS 入口和 `@/*` alias
- **单一 Token 体系**：CSS 变量定义在 `styles.css` 的 `:root`，暗色模式通过 `@media (prefers-color-scheme: dark)` 覆盖。当前使用 shadcn 语义 token（`--shadcn-*`），通过 Tailwind `@theme inline` 映射为 `bg-background`、`text-foreground` 等 Tailwind 颜色。不维护旧的自定义变量（`--surface`、`--base` 等已移除）。后续如需 Spherse 自有扩展 token，使用 `--agent-{name}` 前缀 + `--color-agent-{name}` Tailwind 映射
- **样式写法**：所有样式通过 Tailwind 工具类写在组件 className 中，不在 `styles.css` 中新增手写 CSS class。禁止硬编码颜色值（如 `text-[#333]`），需要新颜色时在 `styles.css` 中注册 CSS 变量 + Tailwind 颜色
- **语义 Token 使用**：使用 shadcn 语义 token（`bg-background`、`bg-card`、`bg-muted`、`bg-primary`、`bg-accent`、`text-foreground`、`text-muted-foreground`、`border-border`、`text-destructive` 等）。shadcn 未覆盖的业务语义按需新增 `--agent-*` token
- **间距与阴影**：使用 Tailwind 标准 scale（`p-2`、`rounded-md`、`shadow-sm` 等），不硬编码 magic number
- **暗色适配**：业务组件不写 `dark:` 修饰符，由 CSS 变量值切换自动适配。仅 shadcn/ui 组件源码中已有的 `dark:` 保留
- **Markdown 渲染**：动态 Markdown 统一通过 `MarkdownContent` 组件映射 `react-markdown` 节点样式，不在 `styles.css` 里维护 `.chat-markdown` 或 `.prose-content` 选择器
- **项目级自定义主题**：用户可通过项目根目录 `.spherse/theme.css` 覆盖 CSS 变量实现项目全局主题定制，只允许覆盖 `:root` 中已有的变量名
- **Agent 聊天主题**：每个 agent 可在 `.spherse/agents/{slug}-{shortId}/theme.css` 定义聊天窗口主题。前端进入聊天页时读取该文件并注入到聊天窗口内，优先级高于项目级主题；该样式只作用于当前 agent 的聊天窗口，不影响侧边栏等外部 UI
- **聊天主题选择器**：聊天窗口对用户主题暴露 `data-chat-root`、`data-chat-header`、`data-chat-messages`、`data-chat-message[data-role]`、`data-chat-composer` 等入口。变更这些 DOM 入口或聊天布局时，需要同步更新 `packages/presets/templates/agent-theme-template.css` 与 `packages/presets/skills/create-agent-chat-theme/SKILL.md`

- **浮窗聊天**：会话可脱离主窗口进入可拖拽/可调整大小的 CSS overlay（Portal 渲染到 `document.body`，`z-40`）。同一项目最多一个浮窗，新浮窗自动关闭已有浮窗。浮窗状态（sessionId、position、size）持久化在 `project-ui-store` 并写入 renderer localStorage。浮窗会话在侧边栏显示选中态，点击无响应；关闭浮窗后会话回到未选中状态。浮窗聊天主题复用 Agent 聊天主题，通过 `data-chat-float-root`、`data-chat-float-titlebar` 选择器限定作用域。`FloatingChatManager` 渲染在 `ProjectLayout` 内，项目切换时随 `key={projectKey}` 完整卸载重建。文本选中发起的发送至当前会话列表包含浮窗会话，浮窗会话的发送不触发导航。
