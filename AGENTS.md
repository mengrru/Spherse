# Spherse

一个本地运行、开箱即用的个人 Agent 运行时。多个拥有独立系统提示词、工具权限、Skill、MCP 与自动化能力的 Agent 围绕同一用户数据空间工作，并通过 HTML 与 UI SDK 构建可交互、可分发的 Agent Workspace。基于 Electron + React + Fastify，使用 pi-agent-core 作为 Agent 运行时，pi-ai 作为 LLM Provider。

设计文档：`docs/official/`
待办事项：`docs/dev/backlog.md`

## 文档地图

本文是 agent 与新成员的入口：只维护导航、命令和红线，细节一律单一权威来源 + 链接。完整目录索引见 [`docs/official/project-structure.md`](docs/official/project-structure.md)。

### Package 一览

| Package | 职责 | 包级守则 |
|---|---|---|
| `packages/core` | 纯 Node.js 核心逻辑（微内核 + Capability） | [README](packages/core/README.md) |
| `packages/presets` | 内置模板与预置静态内容 | [README](packages/presets/README.md) |
| `packages/i18n` | i18n 基础设施与翻译资源 | [README](packages/i18n/README.md) |
| `packages/server` | Fastify API 层 | [README](packages/server/README.md) |
| `packages/app` | 共享 React renderer | [README](packages/app/README.md)（必读） |
| `packages/desktop` | Electron 桌面壳（main/preload/基础设施） | 遵循 `docs/official/` |
| `packages/web` | Web 版本壳（移动端 PWA） | 遵循 `docs/official/` |
| `packages/landing` | GitHub Pages 项目介绍页 | 遵循 `docs/official/` |

### 读：按需加载

- 全局架构、package 边界、跨包契约 → [`docs/official/architecture/index.md`](docs/official/architecture/index.md)，按任务路由查 [`docs/official/README.md`](docs/official/README.md)
- 数据文件格式与存储约定 → [`docs/official/data-conventions.md`](docs/official/data-conventions.md)
- 术语对齐 / 查一个词指什么 → [`docs/official/glossary.md`](docs/official/glossary.md)
- 目录结构 → [`docs/official/project-structure.md`](docs/official/project-structure.md)
- 包内规范 → 对应 package 的 README
- 历史决策与实施记录（容易过时） → `docs/dev/`，开发新 feature 时优先参考 `docs/official/`

### 写：变更 → 必须同步的文档

| 本次变更 | 需同步 |
|---|---|
| 新增/移动/删除文件、目录、package | `docs/official/project-structure.md` |
| 架构决策、package 边界、capability/装配、API contract 方式 | `docs/official/architecture/` 对应域文件（索引见 `docs/official/README.md`） |
| 数据文件格式、存储位置约定 | `docs/official/data-conventions.md` |
| 包内编码/review 规范 | 对应 `packages/{pkg}/README.md` |
| 用户可见文案 | 加载 **i18n** skill |
| design system、主题机制、聊天 DOM/布局/CSS token | 检查 `packages/presets/skills/` 下两个 theme skill |
| feature spec/plan、infra design、bugfix 分析、调研 | `docs/dev/{features,infra,bugfix,investigation}/{yyyy-MM-dd-name}/` |
| 完成 backlog 条目 | `docs/dev/backlog.md` 勾选，并补充新增条目 |

完成 feature/infra/bugfix 后、或用户要求 commit 前，加载 **doc-sync** skill 按上表逐项检查同步。

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

**Typecheck 命令**：

```bash
npm run typecheck                             # 全仓库类型检查（所有 workspace）
npm run typecheck --workspace=packages/app    # 单 workspace 类型检查
```

renderer 侧（app/web/landing）的 vite/vitest 构建不做类型检查，类型错误只能通过 typecheck 发现。全包 typecheck 依赖 Node 侧包（i18n/presets/sdk/core/server）的 `dist` 类型产物，需在 `npm run build` 之后执行；`npm run verify` 已按 lint → build → typecheck → test 顺序串好。

**测试命令**：

```bash
npm test --workspace=packages/core          # 运行测试
npm run test:watch --workspace=packages/core # 监听模式
npm run test:cov --workspace=packages/core   # 运行测试并生成覆盖率报告
npm test --workspace=packages/server        # 运行 server/API contract 测试
npm test --workspace=packages/i18n           # 运行 i18n 测试
npm test --workspace=packages/app           # 运行前端 store/组件相关测试
npm test --workspace=packages/desktop       # 运行 Electron 主进程 / IPC 相关测试
npm run verify                              # lint + build + typecheck + unit tests + i18n check
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

## 一般开发流程

1. **需求分析**：需求下发后先对照代码现状分析可行性与影响面，与用户讨论澄清歧义，商定方案；不明确不动手
2. **design doc**：方案商定后写成 design doc，放 `docs/dev/{features,infra}/{yyyy-MM-dd-name}/`（结构参考同类目录的近期文档；放置规则见 **doc-sync** skill）；写完开 sub agent review，反馈按 critical / important / medium / minor 分级处理
3. **实现**：复杂需求按 design doc 拆分任务并落盘 `plan.md`，逐项实现勾选；相对简单的任务直接实现。测试不强制 TDD、按场景选：不变量密集的纯逻辑（fold、access policy、错误分类等）先写测试再实现，UI / 集成路径实现后补
4. **commit + 代码 review**：实现完毕先 commit，再开 sub agent review 对照 design doc 与代码现状审查实现
5. **反馈处理**：重点关注 critical / important 评论，逐条判断是否成立、是否值得修，有选择性地修（追加 commit）；不成立或暂不修的记录理由，留给步骤 6 回复
6. **收尾提 PR**：加载 **doc-sync** skill 自查文档同步并更新，然后提 PR；在 PR 中逐条回复 review 反馈——同样分等级，标明哪些已修、哪些未修及原因

## 规范演进

用户在交流中对 design / code 规范提出修正或建议，最终达成一致并执行了的，agent 必须从第一性原理出发分析并沉淀为日后执行规范：

1. **先分析再落笔**：这个修正解决什么问题？背后的原则是否可复用，还是一次性特例？与既有规范是合并、替换还是冲突关系？
2. **过普适性门槛才入表**：一次性事实修正（数值写错、链接失效等）直接改对应文档，不入规范
3. **按「写」路由表落到正确的层**（仓库红线 → 本文件；包内 → package README；跨包机制 → official 域文件；流程 → 本文件流程节 / skill），AGENTS.md 不做默认倾倒场
4. **写成规范语言**：「做 X，因为 Y」，不是会话纪要；优先合并进既有条目，不追加重复条目

## 开发规范

- **E2E 验证选择**：feature 实现完成后，按变更影响面选择可能受影响的 E2E 场景运行，不要求全量；单 spec：`npm run test:e2e --workspace=packages/desktop -- e2e/file-tree.spec.ts`，或 `-g` 按 case 名过滤
  - 改动涉及 Electron 启动、项目恢复、路由、store、server API、文件树、content browser、chat/session、文本选择发起会话、native dependency 或 E2E helper 时，优先运行对应 E2E；合并/发布前再跑 `npm run verify:e2e`

## 编码规范（仓库级红线）

包内细则在各 package README 与 `docs/official/` 对应域文件，此处只留跨包红线：

- **语言**：TypeScript（ESM，strict），target ES2022 / module Node16 / moduleResolution Node16
- **导出规范**：package 的 `index.ts` 只导出外部实际使用的符号，仅作类型用的用 `export type`；定期移除多余导出
- **路径安全**：项目内路径解析必须用 `@spherse/core` 的 `resolveProjectPath` / `assertInsideProject` / `isPathInside`，禁止 `startsWith` 前缀判断
- **API contract**：边界 schema 统一在 `@spherse/server/contracts` 并复用同一套 parser，规则见 [server README](packages/server/README.md)
- **契约测试（跨层接缝）**：对 core 的 PM 写入门面与 `SessionPort` 方法，消费方包（server/desktop）至少各有一条不 mock 被测方法本身的契约测试——层间解耦越彻底，mock 拼接缝的盲区越大
- **不添加注释**：除非用户明确要求
- **Lint**：ESLint 9 flat config 在 root `eslint.config.js`；pre-commit 钩子自动执行 `npm run lint`
- **Git**：commit message 用 `feat:` / `fix:` / `chore:` 前缀
- **前端**：renderer 规则统一在 [`packages/app/README.md`](packages/app/README.md)（必读），不在本文件重复维护
