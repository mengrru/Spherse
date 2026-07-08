# Backlog

- [x] **单服务器多引擎重构**：将多 Fastify 实例合并为单实例多 engine，通过 URL 前缀 `/api/projects/:projectId/...` 区分项目，减少资源占用。参见 `docs/dev/infra/2026-06-13-single-server-refactor/design.md`

## 代码质量

- [x] **前端 store 边界整理（P1a）**：解耦 `project-data-store` 对 `settings` feature store 的反向依赖；引入 `ProjectContext` 消除 4+ 组件重复的 `ctx.client` 推导链；`collapsedAgentIds` 下沉到 `agent-session-list` feature store；合并 `sidePanel`/`floatingSessionId` 重复派生；修复 `FloatingChatManager` render 体 setState；移走错放 hooks/components；统一 `scopeCss`。参见 `docs/dev/features/2026-06-19-frontend-store-p1a/design.md`
- [x] **前端路由 / Page / Layout 重构（P0 + P1b）**：真嵌套路由（`project/:projectId` layout route + `chat/:sessionId`/`content`/index 子路由）；新建 `ProjectScope` 替代 `ProjectLayout`，消除 `key={projectId}` remount；URL 成为 active project 唯一真相源；schedule 状态下沉到 `agent-schedule` feature store + WS locale 依赖 bug 修复；`resolveSessionViews`/`getProjectData` 死代码删除；`streamingSessionIds` 镜像解耦 `SessionRow` 与 `chat/streaming-store`；手写 URL 解析全消除（`useMatch`/`useLocation`）。参见 `docs/dev/features/2026-06-19-frontend-routing-p0/design.md`
- [ ] **ActivityBar 自治化（D7，推迟）**：ActivityBar 改为 feature root 自治（自己读 store + navigate），App.tsx 精简为中转站。参见 `docs/dev/features/2026-06-19-frontend-routing-p0/design.md`（D7）
- [ ] **逐步禁止 `any`**：梳理 agent/runtime payload、SQLite row casting、测试 tool context 等现有 `any` 来源，优先通过明确事件/消息/数据库 row 类型替换；完成后开启 `@typescript-eslint/no-explicit-any` 的 warning 或 error 模式。参见 `docs/dev/features/2026-06-05-frontend-lint/design.md`
- [ ] **system-prompt XML 包裹对用户内容闭合标签不健壮**：`serializeSystemPrompt`（`packages/core/src/context/serialize.ts`）对 `<project-instructions>`/`<agent-profile>`/`<context-file>` 的 inner content 原样包裹、不转义。若用户的 AGENTS.md 或预载文件内含 `</project-instructions>` 等闭合标签，会破坏 system prompt 结构。需评估方案：对 inner content 转义、改用 CDATA、或在包裹时检测冲突标签；同时更新 `serialize.test.ts` 中「不转义 inner content」的现有断言。参见 `docs/dev/features/2026-07-02-context-engineering/design.md` §6.3
- [ ] **`parseHistoryMessages` tool call arguments 类型化**：`packages/app/src/features/chat/chat-session-reducer.ts` 中 `parseHistoryMessages` 遍历历史 `message.content` 的 toolCall block 时，`content` 为 `any`，访问 `content.arguments` 需 `as any` 兜底（如 render_card 历史恢复读 `arguments.content`）。应给 toolCall content block 引入精确类型（含 `id`/`name`/`arguments: Record<string, unknown>`），消除 `as any`，并让 render_card/generate_image 等历史恢复分支获得类型安全。与「逐步禁止 `any`」相关但可单独推进。
- [ ] **消除 server contract 中的 `Type.Unknown()`**：当前 `contracts/websocket.ts`（chat 事件的 `message`/`args`/`result`/`toolResults`/`assistantMessageEvent`、schedule 事件的 `schedule`）、`contracts/debug.ts`（`messages`、tool `parameters`）、`contracts/sessions.ts`（`sessionMessagesResponse`）用 `Type.Unknown()` 承接 pi-ai/pi-agent-core 的复杂嵌套对象，仅作结构校验。后续应引入 pi-ai `Message` 联合、tool call/result、`AgentMessage[]` 等精确 TypeBox schema 替换，消除所有 `unknown`。
- [ ] **日志系统完善后收紧 console lint**：引入结构化日志并替换临时 `console.log`/`console.warn`/`console.error` 诊断输出后，开启 `no-console` 或更细粒度 console lint。参见 `docs/dev/features/2026-06-05-frontend-lint/design.md`
- [ ] **`data-chat-root` 伪元素偏移防御**：`[data-chat-root]`（`features/chat/index.tsx`）同样是 `flex flex-col` 容器，用户在 agent theme 写 `::before/::after` 漏 `position` 时会同样挤压聊天列导致偏移。但 chat-root 默认非定位上下文，不能直接照搬 `data-app-root` 的 `position: absolute` 默认值（否则伪元素会逃逸到最近的定位祖先 `data-app-root`）。需先把 chat-root 设为定位上下文（如加 `position: relative`），再在 base styles 给 `[data-chat-root]::before/::after` 加同款 `position: absolute; pointer-events: none` 默认值，并同步 `create-agent-chat-theme` skill 文档。
- [ ] **恢复 React StrictMode 并修复 chat WebSocket effect cleanup**：`src/main.tsx` 当前移除了 StrictMode 以避免开发模式下双重 mount 导致 WebSocket 错误事件。bus WS（schedule/fs-watch/debug）已由全局 `bus-store` 单常开连接 + `useBusSubscription` hook 自动管理订阅，不再受 StrictMode 双挂载影响；剩余 chat WS（`streaming-store.ts`）仍需在 effect 中用 ref 追踪活跃的 WebSocket 实例，忽略已关闭 socket 的事件。涉及文件：`packages/app/src/features/chat/streaming-store.ts`、`packages/app/src/main.tsx`。
- [x] **统一 UI 基础组件**：引入 shadcn/ui（Base UI base），统一 Button、Dialog、Dropdown、Context Menu、Field、Badge 等基础组件，替代当前散落的内联样式实现。参见 `docs/dev/features/2026-05-30-frontend-refactor-shadcn/design.md`
- [x] **前端路由与全局状态管理**：引入 React Router Hash Router 和 Zustand，支持项目、会话、内容页 URL，并收拢多项目与项目工作区状态。参见 `docs/dev/features/2026-05-31-frontend-routing-state/design.md`
- [x] **Chat feature 组织重构**：将 Chat 页面专属组件和 hooks 收敛到 `features/chat/`，`pages/ChatPage.tsx` 仅保留 route adapter。
- [x] **Windows 路径保护修复**：HtmlCard 保存 / ImageCard 导出在 Windows 下因渲染进程硬编码 `/` 分隔符做 `startsWith(projectRoot + "/")` 判定，导致 Electron `showSaveDialog` 返回的反斜杠路径（`C:\…\card.html`）被全部误拒为「文件必须在项目目录内」。新增浏览器安全纯 JS 路径工具 `packages/app/src/lib/project-path.ts`（`isPathInsideProject`/`toProjectRelative`/`joinProjectPath`，统一 `\→/`、Windows 盘符大小写无关、解析 `..` 穿越段、UNC 支持），复刻 core `isPathInside` 语义（renderer 沙箱无法 import `node:path`）；HtmlCard/ImageCard 改用新工具替换手写校验与 `slice` 切片。参见 `docs/dev/bugfix/2026-07-08-windows-path-protection/design.md`
- [x] **ContentBrowser feature 组织重构**：将内容浏览与编辑相关组件和 hooks 收敛到 `features/content-browser/`，将可复用的文本划选发起会话能力收敛到 `features/text-selection-session/`，`pages/ContentBrowser.tsx` 仅保留 route adapter。
- [x] **Agent/session list feature 组织重构**：将项目侧边栏中的 Agent/session 列表展示组件收敛到 `features/agent-session-list/`。
- [x] **Project layout/sidebar 组织重构**：将 `ProjectPage` 收敛为 route adapter，新增 `layouts/ProjectLayout.tsx` 与 `features/project-panel`，并将设置入口提升到 app level。

## 功能增强

- [x] **Content Browser front matter 显示优化**：markdown 文件顶部的 YAML front matter 原本被 remark-gfm 当作 `<hr>` 渲染破损，现新增 `parseFrontmatter`（safeLoad + 容错）在读视图层预解析，单独渲染轻量元信息面板（`dl` 网格 + 语义 token），正文剥离后交给 `MarkdownContent`；编辑态保留原始 front matter
- [x] **Content Browser markdown 内部链接跳转**：支持 markdown 文件中的项目内链接（`[text](./other.md)` / `[text](/assets/x.png)`）点击后在应用内导航到对应 Content Browser 页面，而非浏览器原生打开/下载。路径解析复用 `image-path.ts`（抽公共函数 `markdown-link.ts`），链接 `<a>` 自定义拦截 onClick：`http(s)`/`mailto`/`tel` 走外部打开（`shell.openExternal`，含协议白名单），`#anchor` 走 `preventDefault` + `scrollIntoView`（配合 `rehype-slug` 给 heading 加 id，避免 hash router 冲突），其余项目内路径 `preventDefault` + `navigate` 到 `/project/:id/content?path=`。支持 `.md#section` 跨文件锚点拆分、不存在文件 toast 兜底、percent-编码中文路径解码。另新增全局 ErrorBoundary（router errorElement）防止全屏报错。
- [x] **Agent 编辑**：支持编辑已有 agent 定义文件（当前只能创建）
- [x] **Agent 删除**：从 UI 删除 agent 定义文件
- [x] **Session 删除**：从 UI 删除 session
- [x] **Session 重命名**：支持从侧边栏原地编辑 session 标题，标题持久化到 `.spherse/sessions.db`。
- [x] **多 Session**：同一 agent 开启多个对话，侧边栏按 agent 分组展示 session 列表
- [x] **Session 聊天记录导出**：会话右键菜单新增「导出聊天记录」，拉取完整消息后仅保留 user/assistant 文本（排除 tool call、tool result），格式化为纯文本并下载为 `.txt` 文件。
- [x] **Session 状态信息 dialog**：会话右键菜单新增「会话状态」，弹窗展示当前 turn 的上下文 token 用量与上下文窗口上限（live session 取内存实时值，非 live 从持久化消息历史最近 assistant usage + 解析模型 contextWindow 计算）。
- [ ] **项目创建向导**：HomePage 区分"新建项目"和"打开项目"，支持设置项目名和默认模型（引导页 + 打开或创建/示例入口已完成 @2026-06-28，名称/模型向导待续，参见 docs/dev/features/2026-06-28-new-user-onboarding/）
- [x] **用户自定义主题**：支持从 `.spherse/theme.css` 加载用户自定义 CSS 覆盖默认主题
- [x] **多 Project 支持**：支持已导入项目的持久化，无需每次打开 app 重新手动导入
- [x] **持久化上次访问的 route**：每个打开项目记住最后访问的项目内 route，应用启动、项目切换和关闭当前项目后恢复目标项目的上次位置。参见 `docs/dev/features/2026-06-02-persist-last-route/design.md`
- [x] **Skill 支持**：允许 agent 定义可复用的 skill（预设 prompt + tool 组合）
- [x] **HTML Viewer Card**：在对话流中支持渲染 HTML 内容卡片
- [x] **图片生成支持**：通过 generate_image AgentTool 接入图片生成（OpenRouter + 智谱），生成图片以 image card 展示，可一键导出到项目文件。参见 `docs/dev/features/2026-06-20-image-generation-support/design.md`
- [x] **Viewer Card（write_file / edit_file 预览）**：agent run 结束时按文件聚合展示 write_file（全量内容）与 edit_file（左右分栏行级 diff）的只读预览 card，card 头部路径可点击跳转 ContentBrowser。参见 `docs/dev/features/2026-06-20-viewer-card/design.md`
- [x] **文件/文件夹新建**：从文件浏览器新建文件或目录
- [x] **文件删除**：从文件浏览器删除文件/目录
- [x] **文件编辑**：在应用内编辑文件内容
- [x] **折叠工具调用过程**：将 agent 的 tool call 过程默认折叠，点击展开查看详情
- [x] **流式输出响应**：agent 回复逐字流式显示
- [x] **渲染响应 Markdown**：将 agent 回复渲染为格式化的 Markdown
- [x] **Chat 体验优化**：输入框草稿按 session 缓存并跨应用重启恢复，消息支持一键复制，空对话展示引导，流式输出时支持用户上滚锁定并提供回到底部按钮
- [x] **Chat 历史懒加载**：聊天历史按 turn 分页加载（最新 10 turn + 顶部「加载更多」），API 层 cursor 分页（`getRecentTurns` + `?turns=&before=`），agent 运行时上下文恢复保持全量不受影响。参见 `docs/dev/features/2026-06-25-experience-optimization-round2/design.md`
- [x] **体验优化 Round 2**：创建 agent 按钮改为下拉菜单；全量改名「搭档」→「对话对象」；agent dialog 权限分组（读取文件/写入文件）+ 文案调整；lastRoute 迁移至 localStorage；content browser 返回键按项目隔离。参见 `docs/dev/features/2026-06-25-experience-optimization-round2/design.md`
- [x] **体验优化 Round 3**：chat 消息时间显示（user 每条 + assistant 仅 turn 末条）+ 发送响应等待动画（thinking 指示器）+ 手动打断「已停止生成」提示（替代空气泡）+ 自动滚动重写（1s 节流 + 半窗阈值）；session list 分页加载（每 agent 10 条 + 加载更多）；右键项目 avatar 改为打开项目文件夹；floating chat 层级 z-50；关闭项目清除自定义主题；content browser 返回键回到上一页（记录完整 location）。参见 `docs/dev/features/2026-06-29-experience-optimization-round3/design.md`
- [x] **Chat streaming 跨页面韧性**：Chat WebSocket 连接与 streaming 状态按 session 缓存在 Zustand store 中，支持切换 session/关闭 chat 后后台继续流式输出、侧边栏显示后台 streaming 指示、滚动位置恢复，并复用 server `ChatServerEvent` contract 处理完整 pi-agent lifecycle。
- [x] **支持本地 HTML 文件页面渲染**：在应用内直接渲染本地 HTML 文件
- [x] **用户自定义欢迎页**：项目头像右键菜单支持设置项目级 HTML/图片欢迎页，项目根路由展示欢迎页，Chat 页面提供显式关闭按钮返回欢迎页。参见 `docs/dev/features/2026-06-07-user-custom-welcome-page/design.md`
- [x] **项目设置子菜单 + 主题编辑器**：项目头像右键菜单的「设置欢迎页」改为二级菜单「设置」（含「欢迎页」「主题」），新增主题 CSS 编辑器弹窗直接读写 `.spherse/theme.css`，保存后热更新。参见 `docs/dev/features/2026-06-19-project-settings-dialog/design.md`
- [x] **自定义主题体验优化**：token 重命名为 `--sp-*` 命名空间（废弃 `--shadcn-*`/`--agent-*`）、废弃 `scopeCss` 改用原生 CSS nesting、聊天主题 dark mode 支持、聊天主题自动重载、补齐 data-* 钩子（`data-chat-bubble`/`data-chat-composer-input`/`data-chat-float-close`/`data-md-code`/`data-md-code-inline`/`data-md-quote`/`data-content-doc`）与文档视图 markdown 自定义。参见 `docs/dev/features/2026-06-26-theme-customization-experience/design.md`
- [x] **全局 toast 样式钩子**：全局 toast（sonner）暴露 `data-toast-root` 语义锚点（`<div data-toast-root className="contents">` 包裹 `<Sonner>`，因 sonner `ToasterProps` 封闭不透传 `data-*`），供项目级主题用 `[data-toast-root]` 前缀 + sonner 原生 `[data-sonner-toast]`/`[data-type]`/`[data-title]`/`[data-description]` 等后代选择器定制 toast 外观；同步更新 `create-ui-theme` skill、`architecture.md` 与 `AGENTS.md` 维护契约，新增 `sonner.structure.test.ts` 守卫。
- [x] **支持 Agent 定时执行**：按 cron 表达式定时触发 agent 运行
- [x] **定时任务（scheduler）体验优化**：cron 输入由 Select 下拉改为常驻 Input + 模板按钮；统一术语 定时消息→定时任务（三语）；发送后通知→完成后通知（文案，逻辑本就基于 agent_end 触发）；新增绑定已有会话模式（填写 session ID 在指定 session 内执行）
- [x] **定时任务完成后刷新对应 session 的历史**：定时任务后台触发 session 时 chat 流事件仅走 scheduler 私有回调、不广播到前端，导致 streaming-store 缓存的 session 历史过期。修复：在 `schedule_completed` 事件中对受影响的 sessionId 调用 `streaming-store.refreshHistory` 重新拉取最新历史（守卫：session 未缓存或正在流式时跳过）
- [ ] **支持文件版本控制**：集成 git 进行文件版本管理，增加 git tool 供 LLM 调用
- [x] **划取文本发起会话**：通过在文件内容上划取文本直接向指定 agent 发起会话
- [x] **UI SDK**：iframe 与 App 内统一 action 通信框架，支持 postMessage 触发和 App 内 dispatchAction 调用。参见 `docs/dev/features/2026-06-11-ui-sdk/design.md`
- [x] **UI SDK 增强（HtmlCard 运行时上下文 + sendMessage 可观测）**：聊天 HtmlCard 渲染时向 iframe 注入运行时上下文（`window.__SPHERSE__` + `spherse:runtime` postMessage，含 sessionId/agentId/projectId），卡片无需硬编码 ID 即可向「当前会话」调用 action；sendMessage 改为 request-response，目标会话仍在生成时返回 `{ ok:false, error:"session_busy" }` 而非静默丢弃。新增 `ui-sdk/respond.ts` 共享回复工具与 `features/chat/runtime-context.tsx`
- [x] **HtmlCard file_path 模式运行时上下文注入修复**：`file_path` 渲染的卡片原先走跨源 `src` iframe，`win.__SPHERSE__` 直写被 SecurityError 吞掉导致注入失效。改为统一经 `buildFileSrcDoc` 注入 `<base>` + 同源 `srcDoc` 渲染（流式期间复用 tool 回传的 `html`，历史恢复时前端 `fetch` 拉取），使 `content` 与 `file_path` 两种模式均注入运行时上下文且相对资源正确解析；fetch 失败时降级为原跨源 `src`
- [x] **UI SDK createSession 支持 agent slug**：`createSession` action 新增可选 `agentSlug` 参数，作为 `agentId`（UUID）的人类可读替代（HTML 作者通常只知道 slug）。在 renderer handler 层解析 slug→id（优先读 project-data-store 缓存，未命中回退 `client.listAgents()`），不改 server/API contract；同时传 `agentId` 与 `agentSlug` 时以 `agentId` 为准
- [x] **增加 edit file tool**：为 agent 提供编辑文件的工具（字符串替换模式：old_string + new_string）
- [x] **Agent context 预注入**：agent profile 的 `context` 字段指定文件列表，buildAgent 时读取这些文件内容注入 systemPrompt，使 agent 从第一轮对话起就了解相关上下文
- [ ] **Agent 编辑 UI 增强**：改善 agent 编辑界面的用户体验和功能
- [x] **内置 Agent 模板**：提供多个内置 agent profile 模板（世界观构建者、角色设计、历史记录员等），创建 Agent 时可选择模板快速开始（一期实现 prompt 模板徽章载入：世界观创作助手、角色扮演）
- [ ] **内置 Skill：Card 生成 Skill 的 Skill**：提供内置 skill，用于制作 card 生成类 skill
- [x] **内置 Skill：主题制作 Skill**：提供内置 skill，用于制作自定义主题。`create-ui-theme` 与 `create-agent-chat-theme` 两个 builtin skill 已存在，并在 `docs/dev/features/2026-06-26-theme-customization-experience/design.md` 中进一步增强（token 重命名、原生 CSS nesting、dark mode、自动重载、data-* 钩子补齐）
- [x] **内置 skill 真内置化**：将 preset skill 从 per-project 注入改为 app 内置只读（builtin skill 通过 SkillStore 内存合并；启用 use-ui-sdk）
- [x] **Skill 附加文件发现**：project skill 目录可携带 SKILL.md 之外的附加文件（references/*、scripts/* 等），SkillStore 递归枚举填入 SkillDefinition.files，load_skill 输出文件清单供 agent 用 read_file 读取。参见 docs/dev/bugfix/2026-06-28-skill-companion-files-discovery/design.md
- [x] **文本模型全局 temperature**：settings 文本模型 tab 新增「高级设置」折叠区，支持全局 temperature 调节（可选，默认不传=provider 默认），对活跃会话即时热替换（`setTemperature`/`setDefaultModel` 遍历 activeSessions 热替换 streamFn/model，下一轮生效）。参见 `docs/dev/features/2026-06-28-model-temperature/design.md`
- [ ] **文本模型 top_p 支持**：高级设置支持 top_p 采样参数（需先确认 pi-ai 各 provider top_p 覆盖与注入方式）

## 基础设施

- [x] **本地验证流水线**：新增 root `npm run verify` 覆盖 lint/build/core+i18n+app unit tests/i18n check，新增 `npm run verify:e2e` 在此基础上运行 app E2E。
- [ ] **app 包类型检查纳入 verify**：`packages/app` 的 build 走 `electron-vite build`，只做转译不做类型检查；`tsconfig.node.json`（electron 目录）与 `tsconfig.json`（renderer）的类型错误会被静默放过（如 schema 变更后遗留的 `settings.defaultModel` 读取）。应新增 `npm run typecheck`（`tsc --noEmit` 双 project）并纳入 root `npm run verify`，防止类型错误漏到运行时。
- [ ] **React DOM 组件测试工具链**：为 `packages/app` 引入组件级测试基础设施（如 Testing Library + user-event + jsdom/happy-dom），用于测试 React 组件渲染、ARIA 状态、用户交互和菜单/折叠等局部 UI 行为，补足当前 Vitest 单测与 Playwright E2E 之间的测试层级。
- [x] **electron-builder 打包**：配置生产构建和跨平台打包
- [x] **dev/prod 环境隔离**：通过 bootstrap 入口引导文件将 dev 模式的 userData 重定向到独立目录，实现 dev 和 prod 数据完全隔离、可同时运行
- [x] **better-sqlite3 rebuild 自动化**：在启动开发桌面应用前自动为 Electron 重新编译 native 模块
- [x] **E2E 测试**：已建立 Playwright Electron E2E 测试，并纳入 root `npm run verify:e2e` 验证链路。
- [x] **重新考虑 dot 文件夹名字和内部组织结构**：`.pi/` → `.spherse/`
- [ ] **Chat Debug 模式**：在对话界面提供 debug 模式，展示 agent 的 tool call 请求、响应、system prompt 等原始数据，方便开发和调试
- [x] **i18n**：应用界面多语言支持
- [ ] **Presets i18n**：为 `@spherse/presets` 内置模板和预置内容增加多语言支持，作为 i18n 基础设施完成后的独立任务
- [x] **Core & Server 日志**：为 core 和 server 层添加结构化日志系统，便于调试和问题排查。参见 `docs/dev/infra/2026-06-06-server-core-logging/design.md`
- [ ] **日志 level 区分 dev/prod**：当前 server logger level 硬编码 `debug`（`packages/server/src/logger.ts:18`），dev/prod 配置完全一致。prod 中 pino-pretty 输出到 stdout 但打包后 Electron 应用的 stdout 未挂终端/文件、日志直接丢弃，debug bus stream 无订阅者时也不留存——无内存占用问题，但 `logAgentEvent` 对每个 agent 事件（thinking/text chunk/toolCall/toolResult）都打 debug 日志，每轮 turn 几十上百条，pino 仍会完整序列化→worker 线程 pino-pretty 格式化→写 fd 1→遍历订阅者，全是无意义开销。应支持 `SPHERSE_LOG_LEVEL` env override（或 `app.isPackaged` 时降为 `info`/`warn`），在 `electron/server.ts` 调 `createMultiProjectServer` 时传 `logLevel` 选项下去；进一步可考虑 prod 默认 `silent` + 仅保留 debug bus stream（订阅时实时升 level）。参见 `docs/dev/infra/2026-06-06-server-core-logging/design.md`
- [x] **Debug Turn Context 下载**：在 debug menu 增加下载当前 session 完整 turn 上下文（system prompt + messages + tools）的功能，便于排查 agent 行为。参见 `docs/dev/infra/2026-06-07-debug-download-turn-context/design.md`
- [x] **app 更新机制**：通过 electron-updater + GitHub Releases 实现「检查更新 → 用户确认下载 → 下载完成确认重启」全流程；启动静默检查 + 设置界面手动按钮；Windows 完整自动更新，macOS 未签名阶段通知模式（GitHub Releases API 检查 + 跳转下载）；Git tag + semver 发版，CI 自动构建发布。参见 `docs/dev/infra/2026-07-03-app-update-mechanism/design.md`
