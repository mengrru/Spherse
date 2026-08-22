# Spherse

一个本地运行、开箱即用的个人 Agent 运行时。多个拥有独立系统提示词、工具权限、Skill、MCP 与自动化能力的 Agent 围绕同一用户数据空间工作，并通过 HTML 与 UI SDK 构建可交互、可分发的 Agent Workspace。基于 Electron + React + Fastify，使用 pi-agent-core 作为 Agent 运行时，pi-ai 作为 LLM Provider。

设计文档：`docs/official/`
待办事项：`docs/dev/backlog.md`

## 项目目录索引

```
spherse/
├── packages/
│   ├── core/        # @spherse/core — 纯 Node.js 核心逻辑
│   ├── presets/     # @spherse/presets — 内置模板与预置静态内容
│   ├── i18n/        # @spherse/i18n — i18n 基础设施与翻译资源
│   ├── server/      # @spherse/server — Fastify API 层
│   ├── app/         # @spherse/app — 共享 React renderer（前端源码）
│   ├── desktop/     # @spherse/desktop — Electron 桌面壳（main/preload/electron 基础设施）
│   ├── web/         # @spherse/web — Web 版本壳（规划中）
│   └── landing/     # @spherse/landing — GitHub Pages 项目介绍页
├── docs/
│   ├── official/    # 正式项目文档（始终与代码同步）
│   └── dev/         # 开发过程文档（容易过时）
├── package.json     # npm workspace root
└── tsconfig.base.json
```

完整目录索引见 [`docs/official/project-structure.md`](docs/official/project-structure.md)。

## 启动和联调方式

```bash
# 安装依赖
npm install

# 编译所有 package
npm run build

# 监听编译（开发时使用）
npm run dev --workspace=packages/core    # core 监听
npm run dev --workspace=packages/presets # presets 监听
npm run dev --workspace=packages/i18n    # i18n 监听
npm run dev --workspace=packages/server  # server 监听

# 启动桌面应用（会先执行 native dependency rebuild）
npm run dev
```

**Lint 命令**：

```bash
npm run lint              # 全仓库 lint 检查
npm run lint:fix          # 全仓库 lint 自动修复
npm run lint --workspace=packages/app    # 单 workspace lint
```

提交前会通过 Husky pre-commit 钩子自动执行 `npm run lint`，lint 不通过则阻塞提交。钩子不会自动修改或暂存文件，需手动运行 `npm run lint:fix` 修复。

**测试命令**：

```bash
npm test --workspace=packages/core          # 运行测试
npm run test:watch --workspace=packages/core # 监听模式
npm run test:cov --workspace=packages/core   # 运行测试并生成覆盖率报告
npm test --workspace=packages/server        # 运行 server/API contract 测试
npm test --workspace=packages/i18n           # 运行 i18n 测试
npm test --workspace=packages/app           # 运行前端 store/组件相关测试
npm test --workspace=packages/desktop       # 运行 Electron 主进程 / IPC 相关测试
npm run verify                              # lint + build + unit tests + i18n check
npm run verify:e2e                          # verify + Electron E2E
```

**打包命令**：

```bash
npm run dist        # 构建安装包（当前平台）
npm run dist:mac    # 构建 macOS DMG
npm run dist:win    # 构建 Windows NSIS 安装包
```

**Landing page 命令**：

```bash
npm run dev:landing     # 启动 landing page 开发服务器
npm run build:landing   # 构建 landing page（含 @spherse/i18n 依赖构建）
```

**核心层调试**：`packages/core`、`packages/presets` 和 `packages/server` 不依赖 Electron，可以直接用 Node.js 编译或测试。

## 开发规范

- **文档规范**：
  - `docs/official/` — 正式项目文档，始终与代码保持同步
  - `docs/dev/features/{yyyy-MM-dd-feature-name}/` — **开发中的 feature spec 和 implementation plan，务必放此目录，不要放到其它位置**
  - `docs/dev/infra/{yyyy-MM-dd-name}/` — 基础设施相关的 design 和 plan
  - `docs/dev/bugfix/{yyyy-MM-dd-bugfix-name}/` — bugfix 分析与修复思路，包含 `design.md`（问题分析与方案）和 `plan.md`（实施计划）
  - `docs/dev/` 下的文档容易过时，开发新 feature 时应优先参考 `docs/official/`，开发完成后根据情况更新 `docs/official/`
- **`docs/official/` 维护**：完成 feature 后，检查 `docs/official/` 下是否有需要同步更新的文档（如新增文件/目录、新增工具、架构变更等），保持文档与代码一致
- **Backlog 维护**：每完成一个 feature 后，更新 `docs/dev/backlog.md` 中对应条目的状态（`[ ]` → `[x]`），并补充新增的 backlog 条目
- **预置内容维护**：修改 `packages/presets/templates/` 下模板后，应通过 `npm run build --workspace=packages/presets` 或 root `npm run build` 触发同步脚本，确保生成内容可用
- **用户主题 Skill 维护**：修改 design system、全局主题机制、聊天窗口 DOM 结构、聊天布局、CSS token 或可主题化选择器时，必须检查 `packages/presets/skills/create-ui-theme/` 和 `packages/presets/skills/create-agent-chat-theme/` 是否需要同步更新
- **E2E 验证选择**：feature 实现完成后，应根据当前变更影响面选择可能受影响的 E2E 覆盖场景运行测试；不要求每次都跑全量 E2E。可通过 `npm run test:e2e --workspace=packages/desktop -- e2e/file-tree.spec.ts` 跑单个 spec，或用 `-g` 按 case 名过滤。改动涉及 Electron 启动、项目恢复、路由、store、server API、文件树、content browser、chat/session、文本选择发起会话、native dependency 或 E2E helper 时，优先运行对应 E2E；合并/发布前再跑 `npm run verify:e2e`
- **手动 commit**：完成代码后不要自动 commit，等待用户明确要求时再提交
- **commit 前检查**：用户提示 commit 后，先确认 `docs/dev/backlog.md` 和 `docs/official/` 已根据本次变更得到应有的更新，再执行 commit

## 编码规范

- **语言**：TypeScript（ESM），strict mode
- **TypeScript 配置**：target ES2022, module Node16, moduleResolution Node16
- **依赖规范**：
  - pi-agent-core 的 `AgentTool` 接口使用 `@sinclair/typebox` 定义参数 schema
- **导出规范**：package 的 `index.ts`（barrel 入口）只导出外部实际使用的符号；外部仅作为类型使用的符号用 `export type` 导出，不导出未在外部消费的内容。定期检查导出清单，移除多余的导出
- **工具模式**：所有 AgentTool 使用工厂函数模式 `createXxxTool(projectRoot: string): AgentTool`
- **路径安全**：所有项目内路径解析必须使用 `@spherse/core` 的 `resolveProjectPath` / `assertInsideProject` / `isPathInside`，通过 `path.relative` 判断边界，避免 `startsWith` 前缀误判导致路径穿越
- **API contract**：HTTP request/response 与 WebSocket message/event 的运行时 schema 统一定义在 `@spherse/server/contracts`，server route、renderer API client 和 WebSocket 边界必须复用同一套 schema/parser，不新增裸 `JSON.parse` 或仅靠 TypeScript 泛型的边界校验
- **并发写入安全**：会写文件的工具应共享 `FileWriteMutex`，避免同一文件并发写导致内容丢失
- **不添加注释**：除非用户明确要求
- **Lint 规范**：ESLint 9 flat config 位于 root `eslint.config.js`，覆盖所有 package；`packages/app` 启用 React Hooks / React Refresh 规则；commit 前由 Husky pre-commit 钩子自动检查
- **Git 规范**：commit message 使用 `feat:` / `fix:` / `chore:` 前缀
- **前端规范**：`packages/app` 的架构、TanStack Query/Zustand 状态边界、组件、路由、依赖注入、effect、样式、i18n 与测试规则统一维护在 [`packages/app/README.md`](packages/app/README.md)，修改 renderer 时必须遵守；不要在本文件重复维护第二份规则。
- **i18n 文案规范**：`packages/i18n/src/locales/zh-CN.ts` 是翻译基准，每条文案必须结合实际 UI 场景写注释（说明出现位置、上下文、交互状态等），用于指导其它语言版本（`zh-TW`、`en`）的翻译
- **测试覆盖**：`packages/core` 的开发需保证单元测试覆盖，修改已有模块后应补充或更新对应测试
- **契约测试（跨层接缝）**：对 core 的 PM 写入门面（writeFile/writeBinaryFile/createEntry/deletePath/copyFileWithin）与 SessionPort 方法，消费方包（server/desktop）至少各有一条**不 mock 被测方法本身**的契约测试（真 ProjectManager / 真 runtime），钉住该包依赖的门面行为——层间解耦越彻底，双方 mock 拼接缝的盲区越大，契约测试是唯一的对冲
