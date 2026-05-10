# Worldbuilding Agent

一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。基于 Electron + React + Fastify，使用 pi-agent-core 作为 agent 运行时，pi-ai 作为 LLM provider。

设计文档：`docs/official/`
待办事项：`docs/dev/backlog.md`

## 项目目录索引

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
│   │       └── ws-chat.ts          # WebSocket 对话流
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

## 编码规范

- **语言**：TypeScript（ESM），strict mode
- **TypeScript 配置**：target ES2022, module Node16, moduleResolution Node16
- **依赖规范**：
  - pi-agent-core 的 `AgentTool` 接口使用 `@sinclair/typebox` 定义参数 schema
- **工具模式**：所有 AgentTool 使用工厂函数模式 `createXxxTool(projectRoot: string): AgentTool`
- **路径安全**：所有文件操作工具必须做 `path.resolve + startsWith` 校验，防止路径穿越
- **不添加注释**：除非用户明确要求
- **Git 规范**：commit message 使用 `feat:` / `fix:` / `chore:` 前缀
- **前端样式**：使用 Tailwind CSS v4 工具类 + CSS 变量色彩体系，不写原生 CSS class

## 架构约定

### Core 层
- **Engine 是唯一门面**：外部（server）只通过 `Engine` 或 `createEngine` 访问 core 功能，不直接操作 store
- **Store 只管存储**：store 是对存储层读写的抽象，不持有运行时状态（如活跃的 pi-agent-core Agent 实例）
- **AgentProfile**：业务层 agent 概念，从 `.pi/agents/*.md` 解析而来，包含不可变 `id`（UUID）
- **AgentProfileStore**：首次读取无 `id` 的 .md 文件时自动生成并回写 `id`
- **工具分配**：agent profile 未声明 `tools` 时默认获得全部工具
- **删除 agent**：由 Engine 协调 — 归档关联 sessions + 删除 profile 文件

### Server 层
- **AppContext** = `{ engine, projectStore }`，路由只通过 engine 访问 agent/session 操作，projectStore 仅用于内容浏览
- **路由按业务域拆分**到 `routes/` 目录，由 `index.ts` 聚合注册

### Electron 层
- **IPC handler** 集中在 `electron/ipc/` 目录，按业务域拆分
- **preload** 是安全桥梁，声明 Renderer 可用的 IPC 方法白名单

### 前端样式
- **色彩体系**：CSS 变量定义在 `styles.css` 的 `:root`，暗色模式通过 `@media (prefers-color-scheme: dark)` 覆盖
- **Tailwind @theme**：将常用颜色注册为 Tailwind 颜色（`bg-surface`, `bg-accent` 等），运行时通过 CSS 变量解析
- **自定义主题**：用户可通过 `.pi/theme.css` 覆盖 CSS 变量实现主题定制

## 启动和联调方式

```bash
# 安装依赖
npm install

# 编译所有 package
npm run build

# 监听编译（开发时使用）
npm run dev --workspace=packages/core    # core 监听
npm run dev --workspace=packages/server  # server 监听

# 启动桌面应用
npm run dev
```

**核心层调试**：`packages/core` 和 `packages/server` 不依赖 Electron，可以直接用 Node.js 测试。

## 其它注意事项
- **世界观项目结构**：用户的世界观项目是独立文件夹，结构为 `.pi/`（系统文件）+ 用户自定义目录。详见 `docs/official/`
- **Agent 定义格式**：Markdown 文件 + YAML frontmatter（必须包含 `id`、`name`、`type` 字段），详见 `docs/official/`
- **数据存储**：创作内容为纯文件（Markdown/YAML），session 数据为 SQLite（`.pi/sessions.db`）
- **Agent 唯一标识**：每个 AgentProfile 有不可变 UUID（`id` 字段），sessions 通过 `agent_id` 关联，删除 agent 后 sessions 进入归档状态
- **文档规范**：
  - `docs/official/` — 正式项目文档，始终与代码保持同步
  - `docs/dev/features/{yyyy-MM-dd-feature-name}/` — 开发中的 feature spec 和 implementation plan
  - `docs/dev/bugfix/` — bugfix 分析与修复思路
  - `docs/dev/` 下的文档容易过时，开发新 feature 时应优先参考 `docs/official/`，开发完成后根据情况更新 `docs/official/`
- **Backlog 维护**：每完成一个 feature 后，更新 `docs/dev/backlog.md` 中对应条目的状态（`[ ]` → `[x]`），并补充新增的 backlog 条目
