# 项目目录索引

```
spherse/
├── packages/
│   ├── core/                         # @spherse/core — 纯 Node.js 核心逻辑
│   │   └── src/
│   │       ├── types.ts              # 共享类型与 provider catalog 类型定义
    │   │       ├── logger.ts            # pino Logger 类型与 createSilentLogger 内部兜底工厂
    │   │       ├── factory.ts            # createEngine() 工厂函数，封装 store、mutex 创建与新项目预置内容注入
│   │       ├── presets.ts            # initPresets()：新项目预置 skill 与 agent 注入
│   │       ├── engine.ts             # Engine：运行时 session 管理 + agent/profile 操作门面
│   │       ├── model-providers.ts    # pi-ai provider catalog adapter，ENABLED_PROVIDERS 过滤与 model resolution
    │   │       ├── engine/
    │   │       │   ├── read-context-files.ts # 读取 agent profile context 文件并注入 system prompt
    │   │       │   └── log-agent-event.ts    # agent event → pino 日志映射（级别、截断、生命周期事件）
│   │       ├── store/                # 存储层抽象（不持有运行时状态）
│   │       │   ├── project.ts        # 项目元数据读写（.spherse/project.yaml, AGENTS.md, CHANGELOG.md）
│   │       │   ├── session.ts        # SQLite session 持久化（每 agent 独立 sessions.db, lazy open 连接池）
│   │       │   ├── schedule.ts       # 定时任务配置读写（schedules.yml / schedule-logs.jsonl）
│   │       │   ├── agent-profile.ts  # .spherse/agents/{slug}-{shortId}/profile.md CRUD
│   │       │   ├── skill.ts          # .spherse/skills/*/SKILL.md 读取
│   │       │   └── index.ts
│   │       ├── tools/                # pi-agent-core AgentTool 实现（engine 内部使用）
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── edit-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   ├── move-file.ts
│   │       │   ├── copy-file.ts
│   │       │   ├── append-changelog.ts
│   │       │   ├── load-skill.ts
    │   │       │   ├── render-card.ts    # HTML card 渲染工具
    │   │       │   ├── tool-context.ts   # ToolContext：收窄 ProjectStore 接口，约束 tool 可用的读写方法
    │   │       │   └── index.ts          # createToolsForProject(ctx: ToolContext) 工厂
│   │       ├── scheduler.ts
│   │       ├── utils/
│   │       │   ├── file-write-mutex.ts # 文件写入互斥，避免并发写覆盖
│   │       │   └── path-safety.ts      # 项目内路径解析与边界校验
│   │       ├── access/
│   │       │   └── ai-file-access.ts  # AI 读取禁止列表路径规范化与访问策略
│   │       ├── __tests__/            # Vitest 单元测试
│   │       └── index.ts              # 公开导出：Engine, createEngine, types
│   ├── presets/                      # @spherse/presets — 内置模板与预置静态内容
│   │   ├── presets.json              # 预置 skill 与 agent 声明配置
│   │   ├── templates/
│   │   │   ├── agent-template.md     # 新 Agent 创建模板源文件
│   │   │   └── agent-theme-template.css # Agent 聊天窗口主题模板源文件
│   │   ├── skills/                   # 内置 skill（新项目注入 + 用户参考文档）
│   │   │   ├── create-ui-theme/      # 自定义 UI 主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   ├── create-agent-chat-theme/ # Agent 聊天窗口主题创建指南
│   │   │   │   └── SKILL.md
│   │   │   └── use-ui-sdk/             # iframe 与 App 交互 postMessage 协议指南（含 data key-value 持久化）
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
│   │       │   └── preset-skills.ts  # PRESET_SKILL_SOURCES 常量
│   │       └── index.ts              # 公开导出：模板内容 + 预置 skill/agent 配置
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
    │   │       │   ├── sessions.ts       # SessionInfo、SessionList/Messages Response、rename 请求
    │   │       │   ├── content.ts        # FileEntry、ContentResponse、create/save 请求
    │   │       │   ├── file-tree.ts      # FileTreeResponse
    │   │       │   ├── settings.ts       # ProviderCatalog、AiAccess/WelcomePage Request/Response
    │   │       │   ├── schedules.ts      # ScheduleEntry、ScheduleCreate/Update 请求、List/Log Response
    │   │       │   ├── skills.ts         # SkillDefinition、SkillList Response
    │   │       │   ├── debug.ts          # TurnContextSnapshot
    │   │       │   └── websocket.ts      # ChatClientMessage/ChatServerEvent/ScheduleServerEvent + parser
│   │       ├── routes/               # REST 路由，按业务域拆分
│   │       │   ├── index.ts          # registerAllRoutes 聚合
│   │       │   ├── agents.ts         # Agent 查询与 raw 内容读取
│   │       │   ├── agent-write.ts    # Agent 创建/更新/删除
│       │       │   ├── sessions.ts       # Session 创建/查询/重命名/删除与消息读取
│   │       │   ├── content.ts        # 内容浏览、读取、保存、删除、新建文件/目录
│   │       │   ├── file-tree.ts      # 面向 agent context 选择的项目文件列表
│   │       │   ├── preview.ts        # HTML 文件预览服务
│   │       │   ├── skills.ts         # Skill 列表与详情
│   │       │   ├── settings.ts       # Provider 列表（动态 catalog）+ 项目 settings API（AI 读取禁止列表、欢迎页）
│   │       │   ├── schedules.ts      # 定时任务 CRUD 与手动触发
│       │       │   └── debug.ts         # Debug turn context 导出（dev only）
│       │       ├── ws-chat.ts            # WebSocket 对话流
│       │       ├── ws-fs-watch.ts        # WebSocket 文件变更推送
│       │       ├── ws-debug.ts           # WebSocket 日志流推送（pino → /ws/debug）
│       │       └── ws-schedule.ts        # WebSocket 定时任务事件推送
│   └── app/                          # @spherse/app — Electron + React
│       ├── electron/
│       │   ├── bootstrap.ts          # Electron 入口引导：dev 环境重定向 userData 后加载 main
│       │   ├── main.ts               # Electron 主进程：组装窗口、IPC、项目 server 管理
│       │   ├── preload.ts            # contextBridge，IPC 白名单
│       │   ├── ipc/                  # IPC handler 注册，按业务域拆分
│       │   │   ├── index.ts          # registerAllIpc 聚合
│       │   │   ├── project.ts        # 项目选择、server 启停、打开项目/lastRoute 持久化
│       │   │   ├── settings.ts       # 设置读取/保存与 provider 列表
│       │   │   └── debug.ts          # 开发模式 debug 动作
│       │   ├── window.ts             # BrowserWindow 创建与管理
│       │   ├── server.ts             # 多 Fastify 实例管理（Map<projectPath, {server, engine}>）+ 运行时 defaultModel 更新
│       │   └── settings.ts           # electron-store 封装 + env 管理 + openProjects/lastRoute/locale 持久化
│       ├── playwright.config.ts      # Playwright E2E 测试配置
│       ├── vitest.config.ts          # Vitest 单元测试配置（排除 e2e 目录）
│       ├── electron-builder.yml      # electron-builder 打包配置（appId、DMG、NSIS 等）
│       ├── build/                    # electron-builder buildResources（icon 等资源）
│       ├── components.json           # shadcn/ui 配置（Base UI base + Tailwind v4 + alias）
│       ├── e2e/                      # Playwright E2E 测试
│       │   ├── helpers/
│       │   │   ├── electron.ts       # Electron 应用启动辅助（测试项目创建、app launch）
│       │   │   └── file-tree.ts      # 文件树 E2E 测试辅助（项目创建、app launch）
│       │   ├── agent-dialog.spec.ts  # Agent 对话框搜索文件 E2E 测试
│       │   ├── app-launch.spec.ts    # App 启动验证 smoke test
│       │   ├── chat-streaming-resilience.spec.ts # Chat streaming 切换 session/后台流式/E2E WebSocket mock
│       │   ├── file-tree.spec.ts     # 文件树 E2E 测试（展开折叠、创建删除、溢出截断）
│       │   ├── agent-list.spec.ts              # Agent 列表展开折叠与会话重命名 E2E 测试
│       │   ├── floating-chat.spec.ts            # 浮窗聊天 E2E 测试（浮窗/关闭/拖动/调整大小/项目切换）
│       │   ├── text-selection-session.spec.ts  # 划选会话 E2E 测试
│       │   ├── ui-sdk.spec.ts          # UI SDK postMessage action E2E 测试
│       │   └── ui-sdk-data-crud.spec.ts # UI SDK data CRUD key-value 持久化 E2E 测试
│       └── src/
│           ├── App.tsx               # App shell：Activity Bar、设置弹窗、全局初始化
│           ├── main.tsx              # renderer 入口，挂载 RouterProvider
│           ├── router.tsx            # React Router Hash Router 路由表
│           ├── styles.css            # Tailwind CSS v4 + shadcn 语义 token（单一 token 体系）
│           ├── lib/
│           │   ├── api.ts            # HTTP/WS 客户端封装
│           │   ├── agent-markdown.ts # Agent 定义 Markdown 生成/解析辅助
│           │   ├── avatar-color.ts   # 项目头像颜色生成（路径 hash → HSL）
│           │   ├── context.ts        # AppContext 定义
│           │   ├── events.ts         # renderer 内部自定义事件名常量
│           │   ├── project-key.ts    # project path → URL projectKey 生成
│           │   ├── tool-registry.ts  # 前端 tool call 展示元数据
│           │   ├── types.ts          # 前端类型
│           │   └── utils.ts          # shadcn/ui cn() 工具
│           ├── stores/
│           │   ├── app-store.ts          # 打开项目集合、当前项目、Electron IPC 动作、side panel 偏好
│           │   ├── project-data-store.ts # agents/sessions/初始消息等项目数据缓存，包含 resolveSessionViews 派生查询
│           │   └── project-ui-store.ts   # 折叠状态、浮窗会话等项目 UI 状态，localStorage 持久化
│           ├── layouts/
│           │   └── ProjectLayout.tsx     # 项目工作区布局，组合 ProjectPanel、Chat、ContentBrowser、WelcomePage、FloatingChatManager
│           ├── hooks/
│           │   ├── useFloatingChatRedirect.ts # 浮窗会话重定向：主窗口活动会话与浮窗冲突时导航回项目首页
│           │   ├── useCustomTheme.ts
│           │   ├── useSidePanelClickAway.ts
│           │   ├── useDismissable.ts
│           │   └── use-mobile.ts
│           ├── ui-sdk/
│           │   ├── types.ts              # ActionContext, ActionHandler 类型
│           │   ├── registry.ts           # registerAction / dispatchAction
│           │   ├── rate-limit.ts         # 外部调用频率限制
│           │   ├── use-spherse-message-listener.ts # postMessage → dispatchAction 桥梁
│           │   ├── index.ts              # barrel export + handler side-effect import
│           │   └── handlers/
│           │       ├── create-session.ts # 创建会话并导航，支持 float 参数直达浮窗
│           │       ├── float-session.ts  # 将指定会话移入浮窗
│           │       ├── open-file.ts      # 在 Content Browser 打开文件
│           │       ├── send-message.ts   # 向已有会话发送消息并导航，支持 float 参数；已浮窗会话不导航
│           │       ├── unfloat-session.ts # 取消浮窗
│           │       └── data.ts           # data.get/set/delete key-value 持久化
│           ├── features/
│           │   ├── activity-bar/         # 左侧项目 Activity Bar、ProjectAvatar 与 side panel 固定切换
│           │   ├── agent-schedule/       # Agent 定时任务弹窗、表单、列表与运行日志
│           │   ├── agent-session-list/   # Agent/session 分组列表
│           │   ├── chat/                 # 对话页面入口、streaming store、消息 reducer、输入框、工具调用展示
│           │   ├── content-browser/      # 文件浏览、预览、编辑、冲突提示
    │           │   ├── debug-tools/          # 开发模式调试菜单 + Streaming Log 悬浮面板
│           │   ├── file-tree/            # 文件树组件、树模型、controller hook、AI 读取限制 dialog
│           │   ├── floating-chat/         # 浮动聊天窗口（Portal overlay、拖拽/调整大小、主题隔离）
│           │   ├── project-panel/         # 项目侧栏，组合 Agent/session 列表与文件树，可随 Activity Bar 自动收起
│           │   ├── settings/             # 设置弹窗、设置 store、类型与测试
│           │   ├── welcome-page/         # 项目欢迎页渲染（HTML iframe / 图片）
│           │   ├── welcome-page-settings/ # 项目欢迎页路径设置弹窗
│           │   └── text-selection-session/ # 划选文本后发起会话
│           ├── pages/
│           │   ├── ProjectPage.tsx       # Project route adapter，校验 projectKey 后渲染 ProjectLayout
│           │   ├── ChatPage.tsx          # Chat route adapter
│           │   └── ContentBrowser.tsx    # ContentBrowser route adapter
│           └── components/
│               ├── ui/                   # shadcn/ui 本地基础组件（Base UI 底层原语）与 TreeRow 等通用 UI 样式组件
│               ├── AgentDialog.tsx       # 创建/编辑 Agent 对话框
│               ├── EmptyState.tsx        # 无项目时的空状态
│               ├── MarkdownContent.tsx   # 统一 Markdown 渲染组件
│               └── SearchFileField.tsx   # 文件搜索输入组件（模糊匹配 + Popover 建议列表）
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
├── .husky/
│   └── pre-commit                    # Husky pre-commit 钩子（执行 npm run lint）
├── eslint.config.js                  # ESLint 9 flat config（全仓库 lint 规则）
├── package.json                      # npm workspace root
└── tsconfig.base.json                # 共享 TypeScript 配置
```
