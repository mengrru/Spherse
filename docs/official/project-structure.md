# 项目目录索引

```
worldbuilding-agent/
├── packages/
│   ├── core/                       # @worldbuilding-agent/core — 纯 Node.js 核心逻辑
│   │   └── src/
│   │       ├── types.ts            # 共享类型（ProjectConfig, AgentProfile, SessionInfo）
│   │       ├── factory.ts          # createEngine() 工厂函数，封装所有 store 创建
│   │       ├── engine.ts           # Engine：运行时 session 管理 + profile 操作的门面
│   │       ├── store/              # 存储层抽象（不涉及运行时状态）
│   │       │   ├── project.ts      # 项目元数据读写（.pi/project.yaml, AGENTS.md, CHANGELOG.md）
│   │       │   ├── session.ts      # SQLite session 持久化（agent_id 关联, schema version 管理）
│   │       │   ├── agent-profile.ts # .pi/agents/*.md CRUD（自动生成/补全 id）
│   │       │   └── index.ts
│   │       ├── tools/              # pi-agent-core AgentTool 实现（engine 内部使用，不对外导出）
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── edit-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   ├── append-changelog.ts
│   │       │   └── index.ts        # createToolsForProject 工厂
│   │       └── index.ts            # 公开导出：Engine, createEngine, types
│   ├── server/                     # @worldbuilding-agent/server — Fastify API 层
│   │   └── src/
│   │       ├── index.ts            # createServer()，调用 createEngine 组装 AppContext
│   │       ├── routes/             # REST 路由，按业务域拆分
│   │       │   ├── index.ts        # registerAllRoutes 聚合
│   │       │   ├── agents.ts       # GET /api/agents, GET /api/agents/:id
│   │       │   ├── agent-write.ts  # POST /api/agents/create, DELETE /api/agents/:id
│   │       │   ├── sessions.ts     # POST /api/sessions, GET /api/sessions/:id, GET /api/sessions/:id/messages
│   │       │   ├── content.ts      # GET /api/content/*
│   │       │   └── settings.ts     # GET /api/settings/providers
│   │       ├── ws-chat.ts          # WebSocket 对话流
│   │       └── ws-fs-watch.ts      # WebSocket 文件变更推送
│   └── app/                        # @worldbuilding-agent/app — Electron + React
│       ├── electron/
│       │   ├── main.ts             # Electron 入口：组装各模块
│       │   ├── preload.ts          # contextBridge，IPC 白名单
│       │   ├── ipc/                # IPC handler 注册，按业务域拆分
│       │   │   ├── index.ts        # registerAllIpc 聚合
│       │   │   ├── project.ts      # select-directory, start-server, restore-projects, close-project
│       │   │   └── settings.ts     # get-settings, save-settings, get-supported-providers
│       │   ├── window.ts           # BrowserWindow 创建与管理
│       │   ├── server.ts           # 多 Fastify 实例管理（Map<projectPath, server>）
│       │   └── settings.ts         # electron-store 封装 + env 管理 + openProjects 持久化
│       └── src/
│           ├── App.tsx             # 多项目状态管理 + Activity Bar + 工作区
│           ├── main.tsx
│           ├── styles.css          # Tailwind CSS v4 + CSS 变量色彩体系 + 暗色模式
│           ├── lib/
│           │   ├── api.ts          # HTTP/WS 客户端封装
│           │   ├── avatar-color.ts # 项目头像颜色生成（路径 hash → HSL）
│           │   ├── context.ts      # AppContext 定义
│           │   └── types.ts        # 前端类型（AgentProfile, SessionInfo 等）
│           ├── pages/
│           │   ├── ProjectPage.tsx
│           │   ├── ChatPage.tsx
│           │   └── ContentBrowser.tsx
│           └── components/
│               ├── ProjectBar.tsx      # 左侧 Activity Bar（项目头像列表 + 添加按钮）
│               ├── ProjectAvatar.tsx   # 项目头像（颜色生成、右键菜单）
│               ├── EmptyState.tsx      # 无项目时的空状态
│               ├── AgentList.tsx
│               ├── CreateAgentDialog.tsx
│               ├── FileTree.tsx
│               └── SettingsModal.tsx
├── scripts/
│   └── verify.mjs                  # 核心模块验证脚本
├── docs/
│   ├── official/                   # 正式项目文档（始终与代码同步）
│   └── dev/                        # 开发过程文档（容易过时）
│       ├── features/               # {yyyy-MM-dd-feature-name}/ 下放 spec + plan
│       ├── bugfix/                 # bugfix 分析与修复思路
│       └── backlog.md              # 待办事项
├── package.json                    # npm workspace root
└── tsconfig.base.json              # 共享 TypeScript 配置
```
