# 项目目录索引

```
spherse/
├── packages/
│   ├── core/                         # @spherse/core — 纯 Node.js 核心逻辑
│   │   └── src/
│   │       ├── types.ts              # 共享类型与 provider catalog 类型定义
    │   │       ├── logger.ts            # pino Logger 类型与 createSilentLogger 内部兜底工厂
    │   │       ├── factory.ts            # createProject() 工厂函数，封装 store、mutex 创建与新项目预置内容注入
│   │       ├── presets.ts            # initPresets()：新项目预置 agent 注入 + 创建空 .spherse/skills/ 目录
│   │       ├── project-runtime.ts    # ProjectRuntime：运行时 session 管理 + agent/profile 操作门面
│   │       ├── model-providers/     # pi-ai provider catalog adapter（文本 + 图片 provider）
│   │       │   ├── index.ts        # ENABLED_PROVIDERS 过滤、getSupportedProviders / getImageSupportedProviders、model resolution、syncCustomProviders（运行时注入自定义 OpenAI 兼容供应商）
│   │       │   └── zhipu-images.ts # 智谱图片 provider 元数据 + createZhipuImagesProvider()（createImagesProvider 工厂，模块加载时注入 imagesModels 单例）
    │   │       ├── engine/
    │   │       │   ├── read-context-files.ts # 读取 agent profile context 文件并注入 system prompt
    │   │       │   └── log-agent-event.ts    # agent event → pino 日志映射（级别、截断、生命周期事件）
│   │       ├── store/                # 存储层抽象（不持有运行时状态）
│   │       │   ├── project.ts        # 项目元数据读写（.spherse/project.yaml, AGENTS.md, CHANGELOG.md）
│   │       │   ├── session.ts        # SQLite session 持久化（每 agent 独立 sessions.db, lazy open 连接池）
    │   │       │   ├── trigger.ts        # 触发器配置读写（triggers/index.yml / triggers/logs.jsonl）
│   │       │   ├── agent-profile.ts  # .spherse/agents/{agent-slug}/profile.md CRUD
    │   │       │   ├── skill.ts          # SkillStore：合并 builtin（PRESET_SKILL_SOURCES 内存）与 project（.spherse/skills/*/SKILL.md）skill；createSkill/installSkill 写逻辑（含 zip 校验、zip-slip 防护、原子安装）
│   │       │   └── index.ts
│   │       ├── tools/                # pi-agent-core AgentTool 实现（engine 内部使用）
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── edit-file.ts
│   │       │   ├── json-check.ts   # .json 写入前 JSON 合法性校验（write_file/edit_file 共享）
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   ├── move-file.ts
│   │       │   ├── copy-file.ts
│   │       │   ├── append-changelog.ts
│   │       │   ├── load-skill.ts
    │   │       │   ├── render-card.ts    # HTML card 渲染工具
    │   │       │   ├── generate-image.ts # 图片生成工具（经 getImagesModels() 解析模型并生成，结果落盘 .spherse/generated-images/）
    │   │       │   ├── tool-context.ts   # ToolContext：收窄 ProjectStore 接口，约束 tool 可用的读写方法
    │   │       │   └── index.ts          # createToolsForProject(ctx: ToolContext) 工厂
│   │       ├── trigger/
│   │       │   ├── trigger-manager.ts # TriggerManager：trigger 配置读取与触发执行（磁盘为唯一真相源）
│   │       │   ├── timer-service.ts   # TimerService：10 分钟轮询，每次 tick 调用 triggerManager.onTimeTick()
│   │       │   └── template.ts        # trigger 消息模板变量注入（{{payload}} 等）
│   │       ├── utils/
│   │       │   ├── file-write-mutex.ts # 文件写入互斥，避免并发写覆盖
│   │       │   ├── fs-walk.ts         # 目录遍历过滤（shouldSkipDirEntry）
│   │       │   └── path-safety.ts      # 项目内路径解析与边界校验
│   │       ├── access/
│   │       │   ├── path-category.ts   # PathCategory 分类真相（PATH_PATTERNS + categorizePath）
│   │       │   ├── access-policy.ts   # AccessPolicy 接口 + llmAccessPolicy / serverAccessPolicy 工厂
│   │       │   └── denied-paths.ts    # deniedPaths 路径规范化与保留路径校验
│   │       ├── __tests__/            # Vitest 单元测试
│   │       └── index.ts              # 公开导出：ProjectRuntime, createProject, types
│   ├── presets/                      # @spherse/presets — 内置模板与预置静态内容
│   │   ├── presets.json              # 预置 skill、agent 与 prompt template 声明配置
│   │   ├── templates/
│   │   │   ├── agent-template.md     # 新 Agent 创建模板源文件
│   │   │   ├── agent-theme-template.css # Agent 聊天窗口主题模板源文件
│   │   │   └── prompt-templates/     # 预置 prompt template 源文件（<id>.md，由 presets.json 的 presetPromptTemplates 声明）
│   │   ├── sample-projects/          # 内置示例项目源（新用户引导页「打开示例项目」拷贝到用户选定位置；manifest.json + 各示例完整项目树）
│   │   │   ├── manifest.json         # 示例清单（[{ id, displayName, dirName }]）
│   │   │   └── harry-potter/         # Harry Potter 示例项目（完整项目树，含 .spherse/project.yaml、agents、文档）
│   │   ├── skills/                   # 内置 skill 源（app 内置只读，通过 SkillStore 内存合并；新项目不再注入到 .spherse/skills/）
│   │   │   ├── create-ui-theme/      # 自定义 UI 主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   ├── create-agent-chat-theme/ # Agent 聊天窗口主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   ├── use-ui-sdk/             # iframe 与 App 交互 postMessage 协议指南（含 data key-value 持久化）
│   │   │   │   └── SKILL.md
│   │   │   ├── write-html/             # HTML 页面数据读写与 App 能力调用指南（charset、数据外置、postMessage 交互）
│   │   │   │   └── SKILL.md
│   │   │   └── create-skill/           # 自定义 skill 创建指南（两层 skill 体系与 SKILL.md 格式）
│   │   │       └── SKILL.md
│   │   ├── scripts/
│   │   │   └── sync-templates.mjs    # 模板与预置内容同步脚本（.md → .ts 常量 + presets.json → 预置常量 + skills/ → skill 源码常量）
│   │   ├── __tests__/
│   │   │   └── sync-templates.test.ts # sync-templates 输出验证测试
│   │   └── src/
│   │       ├── generated/            # 构建时由 sync-templates.mjs 自动生成（不入版本库）
│   │       │   ├── agent-template.ts
│   │       │   ├── agent-theme-template.ts
│   │       │   ├── presets.ts        # PRESET_SKILLS, PRESET_AGENTS 常量
│   │       │   ├── preset-skills.ts  # PRESET_SKILL_SOURCES 常量
│   │       │   └── prompt-templates.ts # PRESET_PROMPT_TEMPLATES 常量（{ id, name, prompt }）
│   │       └── index.ts              # 公开导出：模板内容 + 预置 skill/agent/prompt template 配置
│   ├── i18n/                         # @spherse/i18n — 纯 TS i18n 基础设施
│   │   ├── scripts/
│   │   │   └── check-i18n.mjs        # locale key 一致性校验脚本
│   │   └── src/
│   │       ├── types.ts              # Locale, SUPPORTED_LOCALES, DEFAULT_LOCALE
│   │       ├── catalog.ts            # 聚合 locale 文件，导出 TranslationKey
│   │       ├── translate.ts          # normalizeLocale, translate, createTranslator
│   │       ├── format.ts             # {var} 插值
│   │       ├── react.tsx             # I18nProvider, useI18n（React 子入口）
│   │       ├── locales/
│   │       │   ├── zh-CN.ts          # 简体中文（canonical catalog）
│   │       │   ├── zh-TW.ts          # 繁體中文
│   │       │   └── en.ts             # English
│   │       ├── __tests__/            # Vitest 单元测试
│   │       └── index.ts              # 主入口：纯函数 API
│   ├── server/                       # @spherse/server — Fastify API 层
│   │   └── src/
    │   │       ├── index.ts              # createMultiProjectServer()，创建 logger、Fastify 实例并注册 ProjectRegistry
    │   │       ├── logger.ts             # createServerLogger()：pino multistream（pretty + debug WS），composition root
    │   │       ├── registry.ts           # ProjectRegistry：Map<projectId, ProjectContext>，项目 register/remove
    │   │       ├── contracts/            # HTTP/WebSocket runtime schema 与解析 helper（@spherse/server/contracts）
    │   │       │   ├── index.ts          # 聚合 schemas 与类型 re-export，对外稳定入口
    │   │       │   ├── common.ts         # okResponse/errorResponse、parseContract/parseApiResponse
    │   │       │   ├── agents.ts         # AgentProfile、AgentCreate/Update Request/Response
    │   │       │   ├── sessions.ts       # SessionInfo、SessionList/Messages Response、SessionMessagesPage（分页信封）、rename 请求
    │   │       │   ├── content.ts        # FileEntry、ContentResponse、create/save 请求
    │   │       │   ├── file-tree.ts      # FileTreeResponse
    │   │       │   ├── settings.ts       # ProviderCatalog、AiAccess/WelcomePage/Theme Request/Response
    │   │       │   ├── trigger.ts        # TriggerEntry、TriggerCreate/Update 请求、List/Log Response
    │   │       │   ├── skills.ts         # SkillDefinition、SkillList/Create/Install Request 响应与请求 schema
    │   │       │   ├── debug.ts          # TurnContextSnapshot
    │   │       │   └── websocket.ts      # ChatClientMessage/ChatServerEvent/TriggerServerEvent + parser
│   │       ├── routes/               # REST 路由，按业务域拆分
│   │       │   ├── index.ts          # registerAllRoutes 聚合
│   │       │   ├── agents.ts         # Agent 查询与 raw 内容读取
│   │       │   ├── agent-write.ts    # Agent 创建/更新/删除
│       │       │   ├── sessions.ts       # Session 创建/查询/重命名/删除与消息读取
│   │       │   ├── content.ts        # 内容浏览、读取、保存、删除、新建文件/目录
│   │       │   ├── file-tree.ts      # 面向 agent context 选择的项目文件列表
│   │       │   ├── preview.ts        # HTML 文件预览服务
│   │       │   ├── skills.ts         # Skill 列表、详情与创建/安装路由
│   │       │   ├── settings.ts       # 文本/图片 Provider 列表（GET /api/settings/providers、/image-providers）+ 项目 settings API（AI 读取禁止列表、欢迎页、主题 CSS）
│   │       │   ├── images.ts         # 图片导出 API（POST /api/projects/:projectId/images/export，将生成的图片复制到项目目标路径）
│       │       │   ├── trigger.ts         # 触发器 CRUD 与手动触发（/triggers、/trigger-logs、/run）
│       │       │   └── debug.ts         # Debug turn context 导出（dev only）
│       │       ├── ws-chat.ts            # WebSocket 对话流（/ws/projects/:projectId/chat/...，双向 session-scoped）
│       │       ├── ws-bus.ts             # 全局多路复用 bus WebSocket（/ws/bus，trigger/fs-watch/debug 按 projectId×channel 订阅）
│       │       └── lib/
│       │           └── fs-watcher.ts     # 按项目引用计数的共享 fs.watch（多订阅者共享 1 个 OS watcher）；过滤决策基于 core categorizePath 的 watched-category 集合 + node_modules/.git 段级降噪
│   ├── app/                          # @spherse/app — 共享 React renderer（前端源码，被 desktop/web 消费）
│   │   ├── index.html                # renderer 入口 HTML（vite 入口）
│   │   ├── vitest.config.ts          # Vitest 单元测试配置（排除 e2e 目录）
│   │   ├── components.json           # shadcn/ui 配置（Base UI base + Tailwind v4 + alias）
│   │   └── src/
│   │       ├── App.tsx               # App shell：Activity Bar、设置弹窗、全局初始化
│   │       ├── main.tsx              # renderer 入口，挂载 RouterProvider
│   │       ├── router.tsx            # React Router Hash Router 路由表
│   │       ├── styles.css            # Tailwind CSS v4 + shadcn 语义 token（单一 token 体系）
│   │       ├── lib/
│   │       │   ├── api.ts            # HTTP/WS 客户端封装
│   │       │   ├── agent-markdown.ts # Agent 定义 Markdown 生成/解析辅助
│   │       │   ├── events.ts         # renderer 内部自定义事件名常量
│   │       │   ├── project-key.ts    # project path → URL projectKey 生成
│   │       │   ├── tool-registry.ts  # 前端权限分组元数据（TOOL_GROUPS：读取文件/写入文件/独立工具）
│   │       │   ├── types.ts          # 前端类型
│   │       │   ├── electron-api.ts   # 全局 Window.electronAPI 类型声明（类型来自 @shared/electron-api）
│   │       │   ├── use-project-navigation.ts # 项目级导航 hook（back 不跨项目边界，模块级 per-project 历史栈）
│   │       │   ├── use-connection.ts  # useApiClient(projectId) / useConnection() — 基于 app-store connection 派生 ApiClient
│   │       │   ├── utils.ts          # shadcn/ui cn() 工具
│   │       │   └── localstorage/
│   │       │       └── last-route.ts # per-project lastRoute localStorage helper（spherse:last-route:<projectId>）
│   │       ├── context/
│   │       │   └── project-context.tsx # ProjectProvider / useProjectCtx — project scope 的 ctx 注入（projectId/projectRoot）
│   │       ├── stores/
│   │       │   ├── app-store.ts          # 打开项目集合、当前项目（含 lastOpened 排序）、Electron IPC 动作
│   │       │   ├── project-data-store.ts # agents/sessions/初始消息/streaming/hasEnabledTriggersByAgent 等项目数据缓存
│   │       │   ├── app-ui-store.ts       # 应用级临时 UI 状态（settings 弹窗 open 状态等）
│   │       │   ├── settings-store.ts     # 应用级 locale/theme/debugTools 等持久化设置（与设置文件同步）
│   │       │   ├── side-panel-store.ts   # side panel pinned/hover 折叠机制（全局 UI 状态，localStorage 持久化）+ 移动端 mobileOpen 滑出态（与桌面解耦）
│   │       │   └── bus-store.ts          # 全局多路复用 WebSocket 连接 store
│   │       ├── layouts/
│   │       │   └── ProjectScope.tsx      # 项目工作区 layout route（真嵌套路由），挂 ProjectProvider + Outlet，承载项目级生命周期 effect（主题/postMessage 桥/trigger WS/数据刷新/各 agent trigger 启用态预加载）
│   │       ├── hooks/
│   │       │   ├── useSidePanel.ts       # side panel pinned/hover/mobileOpen 状态合并派生 + clickAway props
│   │       │   ├── useCustomTheme.ts
│   │       │   ├── useDismissable.ts
│   │       │   └── use-mobile.ts
│   │       ├── ui-sdk/
│   │       │   ├── types.ts              # ActionContext, ActionHandler 类型
│   │       │   ├── registry.ts           # registerAction / dispatchAction
│   │       │   ├── rate-limit.ts         # 外部调用频率限制（含白名单豁免）
│   │       │   ├── respond.ts            # request-response 回复工具（requestId → spherse:response postMessage）
│   │       │   ├── use-spherse-message-listener.ts # postMessage → dispatchAction 桥梁
│   │       │   ├── index.ts              # barrel export + handler side-effect import
│   │       │   └── handlers/
│   │       │       ├── create-session.ts # 创建会话并导航，支持 float 参数直达浮窗（web 端降级为跳转 chat page）
│   │       │       ├── float-session.ts  # 将指定会话移入浮窗（web 端降级为跳转 chat page）
│   │       │       ├── open-chat.ts      # openChat 工具：按 hostKind 决定 setFloatingChat 或 navigate 到 chat page
│   │       │       ├── open-file.ts      # 在 Content Browser 打开文件
│   │       │       ├── send-message.ts   # 向已有会话发送消息并导航，支持 float 参数与 request-response（session_busy 反馈）；已浮窗会话不导航；web 端 float 降级为跳转
│   │       │       ├── unfloat-session.ts # 取消浮窗
│   │       │       └── data.ts           # data.get/set/delete key-value 持久化
│   │       ├── features/
│   │       │   ├── activity-bar/         # 自治型 Activity Bar（项目头像轨、设置/添加按钮），内部读 app-store/app-ui-store 与 useProjectActions；pin 按钮通过 pinToggle prop 可选注入
│   │       │   ├── agent-trigger/        # Agent 触发器弹窗、表单、列表与运行日志，含 trigger feature store
│   │       │   ├── agent-session-list/   # Agent/session 分组列表，含 AgentDialog/SearchFileField 与折叠状态 feature store
│   │       │   ├── chat/                 # 对话页面入口、streaming store、消息 reducer、输入框、工具调用展示、viewer card（FileViewerCard/DiffViewer）、HtmlCard（含 UI SDK 运行时上下文注入）、chat 运行时 context（runtime-context.tsx）、chat 专属类型（types.ts）、thinking 指示器（ThinkingIndicator）、聚合/diff 纯函数（lib/，含 format-time）
│   │       │   ├── content-browser/      # 文件浏览、预览（HTML/markdown/image）、编辑、复制路径/刷新、冲突提示、只读自动刷新（hooks/ 含 useContentFile/useContentEditor/useContentAutoRefresh）
│   │       │   ├── debug-tools/          # 调试菜单（开发模式或设置开启 debugToolsEnabled 时显示）+ Streaming Log 悬浮面板
│   │       │   ├── floating-chat/         # 浮动聊天窗口（Portal overlay、拖拽/调整大小、主题隔离），含 useFloatingSessionId / useFloatingChatRedirect
│   │       │   ├── onboarding/           # 新用户引导页（无项目时 `/` 路由）：打开或创建项目 / 打开示例项目
│   │       │   ├── project-panel/         # 项目侧栏内容（AgentSessionList/UserFilePanel/SkillPanel 薄组合层），作为 SidePanel 的静态 flex child
│   │       │   ├── side-panel/           # 项目工作区左侧滑动单元：桌面端物理合并 ActivityBar + ProjectPanel 为同一 transform 容器（pinned/hover 滑入滑出）；移动端（useIsMobile 768px 断点）改为左下角浮动按钮 + Sheet（side=left，自带遮罩）滑出，由解耦的 mobileOpen 状态控制
│   │       │   ├── user-file-panel/      # Files section（SidebarGroup + AI 读取限制 dialog），复用 base components/file-tree
│   │       │   ├── skill-panel/          # Skills section（三点菜单：创建/安装技能 + CreateSkillDialog），复用 base components/file-tree（rootPath=".spherse/skills"）
│   │       │   ├── settings/             # 设置弹窗（文本/图片/通用/关于 tab，文本 tab 支持自定义 OpenAI 兼容供应商：CustomProviderDialog 创建/编辑、ModelProviderItem 行渲染、custom-provider-id id 生成）、更新检查 hook（useUpdateChecker reducer）与 UpdateChecker 组件、设置 store、类型与测试
│   │       │   ├── welcome-page/         # 项目欢迎页渲染（HTML iframe / 图片）
│   │       │   ├── project-settings/     # 项目设置弹窗集合
│   │       │   │   ├── welcome-page-settings/ # 项目欢迎页路径设置弹窗
│   │       │   │   └── theme-settings/        # 项目主题 CSS 编辑弹窗
│   │       │   └── text-selection-session/ # 划选文本后发起会话
│   │       ├── pages/
│   │       │   ├── ChatPage.tsx          # Chat 路由 page，从 URL :sessionId 解析 session/agent 后渲染 Chat
│   │       │   ├── ContentBrowserPage.tsx # Content 路由 page，从 ?path= 查询参数渲染 ContentBrowser
│   │       │   ├── OnboardingPage.tsx    # App index 路由 page，re-export onboarding 引导页（无项目时显示）
│   │       │   └── WelcomePagePage.tsx   # Project index 路由 page，渲染 WelcomePage 空状态
│   │       └── components/
│   │           ├── ui/                   # shadcn/ui 本地基础组件（Base UI 底层原语）与 TreeRow 等通用 UI 样式组件
│   │           ├── file-tree/            # 可复用文件树基础组件（FileTree + 树模型 + controller hook + 通用 dialog），支持可选 rootPath/emptyLabel，被 user-file-panel 与 skill-panel 共用
│   │           └── MarkdownContent.tsx   # 统一 Markdown 渲染组件
│   ├── desktop/                      # @spherse/desktop — Electron 桌面壳（main/preload/electron 基础设施）
│   │   ├── electron.vite.config.ts   # electron-vite 配置（main + preload + renderer，renderer root 指向 ../app）
│   │   ├── electron-builder.yml      # electron-builder 打包配置（appId、DMG、NSIS、extraResources、publish GitHub Releases）
│   │   ├── playwright.config.ts      # Playwright E2E 测试配置
│   │   ├── vitest.config.ts          # Vitest 单元测试配置（排除 e2e 目录）
│   │   ├── shared/
│   │   │   └── electron-api.ts       # Electron IPC 类型契约（renderer 与 main 共享，renderer 经 tsconfig @shared 别名引用）
│   │   ├── electron/
│   │   │   ├── bootstrap.ts          # Electron 入口引导：dev 环境重定向 userData 后加载 main
│   │   │   ├── main.ts               # Electron 主进程：组装窗口、IPC、项目 server 管理、启动延迟静默更新检查
│   │   │   ├── preload.ts            # contextBridge，IPC 白名单（含更新检查 main→renderer 事件订阅）
│   │   │   ├── updater.ts            # electron-updater 封装：autoDownload/autoInstall 关闭、Windows 完整流程、macOS 通知模式（GitHub Releases API）、CancellationToken 取消、compareVersions、silent 抑制
│   │   │   ├── sample-projects.ts    # 内置示例项目资源路径解析（dev/packaged）+ manifest 读取（供 onboarding「打开示例项目」）
│   │   │   ├── ipc/                  # IPC handler 注册，按业务域拆分
│   │   │   │   ├── index.ts          # registerAllIpc 聚合
│   │   │   │   ├── project.ts        # 项目选择、server 启停、打开项目持久化、打开示例项目、打开项目文件夹（shell.openPath）
│   │   │   │   ├── settings.ts       # 设置读取/保存与 provider 列表
│   │   │   │   ├── updater.ts        # 更新检查 IPC（check/download/install/cancel/get-state/get-app-version/open-external）
│   │   │   │   ├── skill.ts          # 技能 zip 安装原生文件选择器（select-skill-zip）
│   │   │   │   ├── context-menu.ts   # 文本框原生右键菜单：webContents 'context-menu' 事件（isEditable 门控，editFlags 控制 enable，i18n 本地化 undo/redo/cut/copy/paste/selectAll）
│   │   │   │   ├── debug.ts          # 开发模式 debug 动作
│   │   │   │   └── mobile.ts         # 移动端访问 IPC（get/enable/disable/regenerate-token/restart-tunnel）+ tunnel 状态推送
│   │   │   ├── tunnel/                # Cloudflare Quick Tunnel 集成（移动端远程访问中继）
│   │   │   │   ├── provider.ts        # TunnelProvider / TunnelSession 抽象接口（预留未来扩展）
│   │   │   │   ├── cloudflare-provider.ts # Cloudflare Quick Tunnel 实现：spawn cloudflared tunnel --url、stdout 抓取 *.trycloudflare.com URL、packaged 二进制路径解析
│   │   │   │   └── manager.ts         # TunnelManager 单例：start/stop/restart 状态机 + onStateChange 事件订阅
│   │   │   ├── window.ts             # BrowserWindow 创建与管理
│   │   │   ├── server.ts             # 多 Fastify 实例管理（Map<projectPath, {server, engine}>）+ 运行时 defaultModel 更新 + restartServerWithAuth（启用/停用 mobile access 时带 token 重启）
│   │   │   └── settings.ts           # electron-store 封装 + env 管理（含自定义供应商 syncCustomProviders 注册）+ openProjects/locale 持久化 + mobileAccess（token/enabled）持久化 + generateAccessToken
│   │   └── e2e/                      # Playwright E2E 测试
│   │       ├── helpers/
│   │       │   ├── electron.ts       # Electron 应用启动辅助（测试项目创建、app launch）
│   │       │   └── file-tree.ts      # 文件树 E2E 测试辅助（项目创建、app launch）
│   │       ├── agent-dialog.spec.ts  # Agent 对话框搜索文件 E2E 测试
│   │       ├── app-launch.spec.ts    # App 启动验证 smoke test
│   │       ├── chat-streaming-resilience.spec.ts # Chat streaming 切换 session/后台流式/E2E WebSocket mock
│   │       ├── file-tree.spec.ts     # 文件树 E2E 测试（展开折叠、创建删除、溢出截断）
│   │       ├── agent-list.spec.ts              # Agent 列表展开折叠与会话重命名 E2E 测试
│   │       ├── floating-chat.spec.ts            # 浮窗聊天 E2E 测试（浮窗/关闭/拖动/调整大小/项目切换）
│   │       ├── text-selection-session.spec.ts  # 划选会话 E2E 测试
│   │       ├── ui-sdk.spec.ts          # UI SDK postMessage action E2E 测试
│   │       └── ui-sdk-data-crud.spec.ts # UI SDK data CRUD key-value 持久化 E2E 测试
│   ├── web/                          # @spherse/web — Web 版本壳 / 移动端 PWA（GitHub Pages 部署到 /web/）
│   │   ├── vite.config.ts            # Vite + vite-plugin-pwa（manifest + generateSW app shell precache）+ manualChunks（vendor-react/vendor-markdown）
│   │   ├── index.html                # 入口 HTML（theme-color / apple-mobile-web-app / viewport-fit=cover 元数据）
│   │   ├── public/                   # PWA 静态资源
│   │   │   ├── favicon.svg
│   │   │   └── icons/                # PWA 图标（pwa-192/512、maskable-512、apple-touch-icon，从 desktop/build 派生）
│   │   ├── pages-assets/404.html     # GitHub Pages SPA fallback（/web → /web/，其余 → /）
│   │   └── src/                      # Web 版本专属源码
│   │       ├── main.tsx              # 注入 WebHostBridge 调 createAppRoot
│   │       ├── host-bridge-web.tsx   # HostBridge 的 Web 实现（HTTP+localStorage 子集、token 探活、disconnect）
│   │       └── pages/MobileConnectPage.tsx # 扫码/手动输入连接页
│   ├── landing/                      # @spherse/landing — GitHub Pages 项目介绍页（自定义域名 spherse.mengru.work）
│   │   ├── vite.config.ts            # 标准 Vite 构建配置（base: "/"，自定义域名根路径部署）
│   │   ├── index.html                # 入口 HTML
│   │   ├── public/                   # 静态资源（截图、主题 CSS）
│   │   │   ├── CNAME                # GitHub Pages 自定义域名声明（内容 spherse.mengru.work）
│   │   │   ├── screenshots/          # 轮播截图 + feature 浮层截图
│   │   │   └── themes/              # 轮播切换时动态加载的主题 CSS（覆盖 --sp-* 变量）
│   │   └── src/
│   │       ├── styles.css            # Tailwind v4 + --sp-* token 体系（从 app 精简复制）
│   │       ├── i18n/                 # landing 专属 i18n（复用 @spherse/i18n 类型，自建 locale catalog）
│   │       │   ├── index.ts          # useLandingI18n hook + localStorage 持久化
│   │       │   └── locales/          # zh-CN / zh-TW / en 三语
│   │       ├── components/           # 页面组件（Hero、Carousel、FeatureCards、FeatureModal、LanguageSwitcher 等）
│   │       │   └── ui/              # 从 app 复制的 shadcn 组件（button、dialog）
│   │       └── data/                # 轮播与 feature 配置数据
├── scripts/
│   └── rebuild-native.mjs            # Electron native dependency rebuild
├── docs/
│   ├── official/                     # 正式项目文档（始终与代码同步）
│   └── dev/                          # 开发过程文档（容易过时）
│       ├── features/                 # {yyyy-MM-dd-feature-name}/ 下放 spec + plan
│       ├── infra/                    # {yyyy-MM-dd-name}/ 下放基础设施 design + plan
│       ├── bugfix/                   # bugfix 分析与修复思路
│       └── backlog.md                # 待办事项
├── .opencode/
│   └── skills/                      # opencode coding-agent skill 定义
│       └── i18n/
│           └── SKILL.md             # i18n 字符串迁移指导
├── .github/
│   └── workflows/
│       ├── build-and-release.yml     # Git tag 触发的 CI：mac/win 并行构建 + GitHub Releases 发布（win --publish always，mac --publish never + gh upload dmg）
│       └── deploy-landing.yml        # main 分支 landing 变更触发的 CI：构建并部署到 GitHub Pages
├── .husky/
│   └── pre-commit                    # Husky pre-commit 钩子（执行 npm run lint）
├── eslint.config.js                  # ESLint 9 flat config（全仓库 lint 规则）
├── package.json                      # npm workspace root
└── tsconfig.base.json                # 共享 TypeScript 配置
```
