# 项目目录索引

```
spherse/
├── packages/
│   ├── core/                         # @spherse/core — 纯 Node.js 核心逻辑
│   │   └── src/
│   │       ├── types.ts              # 共享类型与 provider catalog 类型定义
    │   │       ├── logger.ts            # pino Logger 类型与默认工厂
    │   │       ├── factory.ts            # createEngine() 工厂函数，封装 store 与 mutex 创建
│   │       ├── engine.ts             # Engine：运行时 session 管理 + agent/profile 操作门面
│   │       ├── model-providers.ts    # pi-ai provider catalog adapter，ENABLED_PROVIDERS 过滤与 model resolution
    │   │       ├── engine/
    │   │       │   ├── read-context-files.ts # 读取 agent profile context 文件并注入 system prompt
    │   │       │   └── log-agent-event.ts    # agent event → pino 日志映射（级别、截断、生命周期事件）
│   │       ├── store/                # 存储层抽象（不持有运行时状态）
│   │       │   ├── project.ts        # 项目元数据读写（.spherse/project.yaml, AGENTS.md, CHANGELOG.md）
│   │       │   ├── session.ts        # SQLite session 持久化（agent_id 关联, schema version 管理）
│   │       │   ├── agent-profile.ts  # .spherse/agents/*.md CRUD（自动生成/补全 id）
│   │       │   ├── skill.ts          # .spherse/skills/*/SKILL.md 读取
│   │       │   └── index.ts
│   │       ├── tools/                # pi-agent-core AgentTool 实现（engine 内部使用）
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── edit-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   ├── append-changelog.ts
│   │       │   ├── load-skill.ts
│   │       │   ├── render-card.ts    # HTML card 渲染工具
│   │       │   └── index.ts          # createToolsForProject 工厂
│   │       ├── utils/
│   │       │   └── file-write-mutex.ts # 文件写入互斥，避免并发写覆盖
│   │       ├── access/
│   │       │   └── ai-file-access.ts  # AI 读取禁止列表路径规范化与访问策略
│   │       ├── __tests__/            # Vitest 单元测试
│   │       └── index.ts              # 公开导出：Engine, createEngine, types
│   ├── presets/                      # @spherse/presets — 内置模板与预置静态内容
│   │   ├── templates/
│   │   │   └── agent-template.md     # 新 Agent 创建模板源文件
│   │   ├── skills/                   # 内置 skill 模板（用户参考文档）
│   │   │   └── create-ui-theme/      # 自定义 UI 主题创建指南
│   │   │       └── SKILL.md
│   │   ├── scripts/
│   │   │   └── sync-templates.mjs    # 模板同步脚本（.md → .ts 常量）
│   │   └── src/
│   │       └── index.ts              # 公开导出模板内容
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
│   │       ├── index.ts              # createServer()，调用 createEngine 组装 AppContext
│   │       ├── routes/               # REST 路由，按业务域拆分
│   │       │   ├── index.ts          # registerAllRoutes 聚合
│   │       │   ├── agents.ts         # Agent 查询与 raw 内容读取
│   │       │   ├── agent-write.ts    # Agent 创建/更新/删除
│       │       │   ├── sessions.ts       # Session 创建/查询/重命名/删除与消息读取
│   │       │   ├── content.ts        # 内容浏览、读取、保存、删除、新建文件/目录
│   │       │   ├── file-tree.ts      # 面向 agent context 选择的项目文件列表
│   │       │   ├── preview.ts        # HTML 文件预览服务
│   │       │   ├── skills.ts         # Skill 列表与详情
│   │       │   └── settings.ts       # Provider 列表（动态 catalog）+ AI 读取禁止列表 API
    │   │       ├── ws-chat.ts            # WebSocket 对话流
    │   │       ├── ws-fs-watch.ts        # WebSocket 文件变更推送
    │   │       └── ws-debug.ts           # WebSocket 日志流推送（pino → /ws/debug）
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
│       │   ├── app-launch.spec.ts    # App 启动验证 smoke test
│       │   ├── file-tree.spec.ts     # 文件树 E2E 测试（展开折叠、创建删除、溢出截断）
│       │   ├── session-rename.spec.ts           # 会话重命名 E2E 测试
│       │   └── text-selection-session.spec.ts  # 划选会话 E2E 测试
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
│           │   ├── project-key.ts    # project path → URL projectKey 生成
│           │   ├── tool-registry.ts  # 前端 tool call 展示元数据
│           │   ├── types.ts          # 前端类型
│           │   └── utils.ts          # shadcn/ui cn() 工具
│           ├── stores/
│           │   ├── app-store.ts          # 打开项目集合、当前项目、Electron IPC 动作
│           │   ├── project-data-store.ts # agents/sessions/初始消息等项目数据缓存
│           │   └── project-ui-store.ts   # 折叠状态等项目 UI 状态
│           ├── layouts/
│           │   └── ProjectLayout.tsx     # 项目工作区布局
│           ├── features/
│           │   ├── activity-bar/         # 左侧项目 Activity Bar 与 ProjectAvatar
│           │   ├── agent-session-list/   # Agent/session 分组列表
│           │   ├── chat/                 # 对话页面入口、消息流、输入框、工具调用展示
│           │   ├── content-browser/      # 文件浏览、预览、编辑、冲突提示
    │           │   ├── debug-tools/          # 开发模式调试菜单 + Streaming Log 悬浮面板
│           │   ├── file-tree/            # 文件树组件、树模型、controller hook、AI 读取限制 dialog
│           │   ├── project-panel/        # 项目侧栏，组合 Agent/session 列表与文件树
│           │   ├── settings/             # 设置弹窗、设置 store、类型与测试
│           │   └── text-selection-session/ # 划选文本后发起会话
│           ├── pages/
│           │   ├── ProjectPage.tsx       # Project route adapter，校验 projectKey 后渲染 ProjectLayout
│           │   ├── ChatPage.tsx          # Chat route adapter
│           │   └── ContentBrowser.tsx    # ContentBrowser route adapter
│           └── components/
│               ├── ui/                   # shadcn/ui 本地基础组件（Base UI 底层原语）
│               ├── AgentDialog.tsx       # 创建/编辑 Agent 对话框
│               ├── EmptyState.tsx        # 无项目时的空状态
│               └── MarkdownContent.tsx   # 统一 Markdown 渲染组件
├── scripts/
│   ├── rebuild-native.mjs            # Electron native dependency rebuild
│   └── verify.mjs                    # 核心模块验证脚本
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
