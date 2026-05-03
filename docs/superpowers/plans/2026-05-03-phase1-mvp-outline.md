# Phase 1 MVP — 架构概要（参考版）

> 这是 brainstorming 阶段产出的架构概要，用于指导实现方向。详细代码见 `2026-05-03-phase1-mvp-plan.md`。

**基于设计文档**：`docs/superpowers/specs/2026-05-03-worldbuilding-agent-design.md`
**目标**：项目创建/打开 + Agent 定义解析 + 单 session 对话 + 文件读写工具 + 基本内容浏览

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 包管理器 | npm + monorepo |  |
| 后端框架 | Fastify | 原生 WebSocket、性能好 |
| 前端框架 | React + Vite | Electron 社区主流 |
| Schema 验证 | @sinclair/typebox | pi-agent-core 的硬性要求（AgentTool.parameters 必须是 TypeBox schema） |
| SQLite | better-sqlite3 | 同步 API、性能好、Electron 兼容 |
| Electron 集成 | electron-vite | Vite 原生 Electron 支持 |

## Monorepo 结构

```
worldbuilding-agent/
├── package.json                    # workspace root
├── tsconfig.base.json
├── packages/
│   ├── core/                       # 纯 Node.js 核心逻辑（无 UI 依赖）
│   │   ├── package.json            # @worldbuilding-agent/core
│   │   └── src/
│   │       ├── types.ts            # 共享类型
│   │       ├── project-store.ts    # 项目元数据读写
│   │       ├── agent-parser.ts     # Agent MD 文件解析
│   │       ├── session-store.ts    # SQLite session 管理
│   │       ├── tools/              # AgentTool 实现
│   │       │   ├── index.ts        # Tool registry
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   └── append-changelog.ts
│   │       ├── agent-engine.ts     # Agent 实例管理
│   │       └── index.ts
│   ├── server/                     # Fastify HTTP/WS 服务
│   │   ├── package.json            # @worldbuilding-agent/server
│   │   └── src/
│   │       ├── index.ts            # Server factory
│   │       ├── routes.ts           # REST routes
│   │       └── ws-chat.ts          # WebSocket chat handler
│   └── app/                        # Electron + React 前端
│       ├── package.json            # @worldbuilding-agent/app
│       ├── electron/
│       │   └── main.ts             # Electron main process
│       └── src/                    # React 前端
│           ├── App.tsx
│           ├── main.tsx
│           └── index.html
```

## 实现步骤（按依赖顺序）

### Step 1：项目脚手架
**目标**：monorepo 骨架可编译运行

- 初始化 npm workspace
- 创建 `tsconfig.base.json`（ES2022, ESM, Node16 module resolution）
- 创建 3 个 package 的 package.json 和 tsconfig.json
- 安装依赖（pi-agent-core, pi-ai 通过 file: 引用）
- 验证：`npm install && npm run build` 成功

### Step 2：Project Store + Agent Parser
**目标**：项目创建/打开/管理 + Agent 定义解析

- 定义 `ProjectConfig`、`AgentDefinition` 类型（`types.ts`）
- `ProjectStore`：create、open、getConfig、readIndex、updateIndex、appendChangelog
- `AgentParser`：parseAgentFile（gray-matter 解析 frontmatter + body）、listAgents
- 验证：创建临时目录，检查文件结构和解析结果

### Step 3：Session Store
**目标**：SQLite session 持久化

- `SessionStore`：init、createSession、getSession、listSessions、appendMessage、getSessionMessages、close
- Migration：创建 sessions、messages 表（file_locks 留到 Phase 2）
- 验证：内存 SQLite CRUD

### Step 4：Agent Tools
**目标**：5 个基本 AgentTool 实现

所有工具遵循 pi-agent-core 的 `AgentTool` 接口，使用 TypeBox schema，工厂函数模式。

1. **`read_file`** — path, encoding? → 文件内容 + metadata
2. **`write_file`** — path, content, createDirs? → 写入确认
3. **`list_files`** — path, recursive? → 文件/目录列表
4. **`search_content`** — query, path?, includePatterns? → 匹配文件:行号
5. **`append_changelog`** — agent, action, target, description → 追加日志

Tool registry：`createToolsForProject(projectRoot)` 返回 `Record<string, AgentTool>`
默认权限：creator 全部、roleplay 只读、scheduler 全部

### Step 5：Agent Engine
**目标**：将 Agent 定义转化为可运行的 Agent 实例

**状态管理：**
- `Map<sessionId, Agent>` 管理活跃 Agent 实例（进程级）
- SQLite 管理持久数据（session 消息、元数据）
- 重启恢复：用户打开 session 时从 SQLite 加载消息，重建 Agent（`agent.state.messages = restoredMessages`）

**核心方法：**
- `listAgents()` → 从 .pi/agents/ 解析所有 agent 定义
- `createSession(agentName)` → 解析定义 → 创建 Agent 实例 + SQLite 记录
- `restoreSession(sessionId)` → 从 SQLite 恢复消息到新 Agent 实例
- `sendMessage(sessionId, message, onEvent)` → agent.prompt + subscribe 事件转发 + 持久化
- `destroySession(sessionId)` → 从 Map 移除 Agent（数据保留在 SQLite）
- `abortSession(sessionId)` → agent.abort()
- `getSessionHistory(sessionId)` → 从 SQLite 读取

**Agent 构建流程：**
1. 从 AgentParser 获取 AgentDefinition
2. 根据 type/tools 配置，从 Tool Registry 选取工具
3. 构造 systemPrompt = AGENTS.md 内容 + agent 正文
4. 使用 pi-ai 的 `getModel()` 解析模型，`streamSimple` 作为 streamFn
5. 创建 pi-agent-core `Agent` 实例

**事件处理：**
- `message_end` → 持久化到 SessionStore
- 事件通过回调转发给上层（WebSocket handler）

### Step 6：Local Server (Fastify)
**目标**：HTTP + WebSocket API 层

**REST 路由：**
- `GET /api/agents` — 列出所有 agent
- `GET /api/agents/:name` — agent 详情
- `POST /api/sessions` — 创建 session（body: { agentName }）
- `GET /api/sessions/:id` — session 信息
- `GET /api/sessions/:id/messages` — 历史消息
- `GET /api/content/*` — 浏览项目文件

**WebSocket：**
- `WS /ws/chat/:sessionId` — 对话流
  - 接收：`{ type: "message", content }` 或 `{ type: "abort" }`
  - 发送：AgentEvent JSON + `{ type: "agent_end_done" }`

**启动：** `createServer(projectRoot)` 工厂，监听 localhost 随机端口

### Step 7：Electron Shell
**目标**：桌面应用壳

- Main process：启动 Fastify 服务器 → 创建 BrowserWindow
- IPC：select-directory、start-server
- Preload：暴露 electronAPI
- electron-vite 配置

### Step 8：React Frontend
**目标**：基本可用的 UI

- 首页：项目选择（打开文件夹按钮）
- 项目页：Agent 列表 → 选择 → 开始对话
- 对话页：消息列表 + 流式渲染 + 输入框
- WebSocket 连接管理

## 依赖关系图

```
Step 1 (脚手架)
    ↓
Step 2 (Project Store + Agent Parser)  ←  Step 3 (Session Store)
    ↓                                          ↓
Step 4 (Agent Tools)  ←────────────────────────┘
    ↓
Step 5 (Agent Engine)
    ↓
Step 6 (Local Server)
    ↓
Step 7 (Electron Shell) + Step 8 (React Frontend)
```

Steps 2, 3, 4 可并行。Step 5 依赖 2+3+4。Step 6 依赖 5。Step 7-8 依赖 6。

## 验证标准

| Step | 验证方式 |
|------|----------|
| 1 | `npm install && npm run build` 成功 |
| 2 | 临时目录创建项目，验证文件结构和解析结果 |
| 3 | SQLite CRUD 操作正确 |
| 4 | 临时目录上执行工具，验证读写 |
| 5 | 加载 agent 定义，验证 Agent 实例创建 |
| 6 | HTTP 调用路由，WebSocket 发送消息 |
| 7 | Electron 启动，窗口加载 |
| 8 | 端到端：创建项目 → 选 agent → 对话 → 查看内容 |
