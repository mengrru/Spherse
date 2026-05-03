# Worldbuilding Agent

一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。基于 Electron + React + Fastify，使用 pi-agent-core 作为 agent 运行时，pi-ai 作为 LLM provider。

设计文档：`docs/superpowers/specs/2026-05-03-worldbuilding-agent-design.md`
实现计划：`docs/superpowers/plans/2026-05-03-phase1-mvp-outline.md`

## 项目目录索引

```
worldbuilding-agent/
├── packages/
│   ├── core/                       # @worldbuilding-agent/core — 纯 Node.js 核心逻辑
│   │   └── src/
│   │       ├── types.ts            # 共享类型定义（ProjectConfig, AgentDefinition, SessionInfo）
│   │       ├── project-store.ts    # 项目创建/打开、AGENTS.md 管理、CHANGELOG 追加
│   │       ├── agent-parser.ts     # 解析 .pi/agents/*.md 的 frontmatter + 正文
│   │       ├── session-store.ts    # SQLite session 持久化（对话历史、元数据）
│   │       ├── agent-engine.ts     # Agent 生命周期管理（创建/恢复/销毁 session）
│   │       ├── tools/              # pi-agent-core AgentTool 实现
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── list-files.ts
│   │       │   ├── search-content.ts
│   │       │   ├── append-changelog.ts
│   │       │   └── index.ts        # 工具注册表 + 默认权限映射
│   │       └── index.ts            # 统一导出
│   ├── server/                     # @worldbuilding-agent/server — Fastify API 层
│   │   └── src/
│   │       ├── index.ts            # createServer() 工厂函数
│   │       ├── routes.ts           # REST 路由（agents, sessions, content）
│   │       └── ws-chat.ts          # WebSocket 对话流
│   └── app/                        # @worldbuilding-agent/app — Electron + React
│       ├── electron/
│       │   └── main.ts             # Electron main process
│       └── src/
│           ├── App.tsx
│           ├── pages/
│           │   ├── HomePage.tsx
│           │   ├── ProjectPage.tsx
│           │   ├── ChatPage.tsx
│           │   └── ContentBrowser.tsx
│           └── components/
│               ├── ChatMessage.tsx
│               ├── AgentList.tsx
│               └── FileTree.tsx
├── scripts/
│   └── verify.mjs                  # 核心模块验证脚本（48 项测试）
├── docs/
│   └── superpowers/
│       ├── specs/                  # 设计文档
│       └── plans/                  # 实现计划
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

## 启动和联调方式

```bash
# 安装依赖
npm install

# 编译所有 package
npm run build

# 运行核心模块验证
node scripts/verify.mjs

# 监听编译（开发时使用）
npm run dev --workspace=packages/core    # core 监听
npm run dev --workspace=packages/server  # server 监听

# 启动桌面应用（Task 9 完成后可用）
npm run dev
```

**核心层调试**：`packages/core` 和 `packages/server` 不依赖 Electron，可以直接用 Node.js 测试。

**环境变量**：LLM API Key 通过环境变量配置（`GEMINI_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`），取决于 agent 定义中指定的模型。

## 其它注意事项

- **当前进度**：Task 1-8 已完成（core + server），Task 9（Electron + React）待实现
- **世界观项目结构**：用户的世界观项目是独立文件夹，结构为 `.pi/`（系统文件）+ 用户自定义目录。详见设计文档第 3 节
- **Agent 定义格式**：Markdown 文件 + YAML frontmatter，详见设计文档第 4 节
- **数据存储**：创作内容为纯文件（Markdown/YAML），session 数据为 SQLite（`.pi/sessions.db`）
