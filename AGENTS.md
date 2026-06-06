# Spherse

一个全平台、本地运行、开箱即用的 AI 辅助世界观创作桌面工具。基于 Electron + React + Fastify，使用 pi-agent-core 作为 agent 运行时，pi-ai 作为 LLM provider。

设计文档：`docs/official/`
待办事项：`docs/dev/backlog.md`

## 项目目录索引

```
spherse/
├── packages/
│   ├── core/        # @spherse/core — 纯 Node.js 核心逻辑
│   ├── presets/     # @spherse/presets — 内置模板与预置静态内容
│   ├── server/      # @spherse/server — Fastify API 层
│   └── app/         # @spherse/app — Electron + React
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
npm test --workspace=packages/app           # 运行前端 store/组件相关测试
```

**打包命令**：

```bash
npm run dist        # 构建安装包（当前平台）
npm run dist:mac    # 构建 macOS DMG
npm run dist:win    # 构建 Windows NSIS 安装包
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
- **手动 commit**：完成代码后不要自动 commit，等待用户明确要求时再提交
- **commit 前检查**：用户提示 commit 后，先确认 `docs/dev/backlog.md` 和 `docs/official/` 已根据本次变更得到应有的更新，再执行 commit

## 编码规范

- **语言**：TypeScript（ESM），strict mode
- **TypeScript 配置**：target ES2022, module Node16, moduleResolution Node16
- **依赖规范**：
  - pi-agent-core 的 `AgentTool` 接口使用 `@sinclair/typebox` 定义参数 schema
- **工具模式**：所有 AgentTool 使用工厂函数模式 `createXxxTool(projectRoot: string): AgentTool`
- **路径安全**：所有文件操作工具必须做 `path.resolve + startsWith` 校验，防止路径穿越
- **并发写入安全**：会写文件的工具应共享 `FileWriteMutex`，避免同一文件并发写导致内容丢失
- **不添加注释**：除非用户明确要求
- **Lint 规范**：ESLint 9 flat config 位于 root `eslint.config.js`，覆盖所有 package；`packages/app` 启用 React Hooks / React Refresh 规则；commit 前由 Husky pre-commit 钩子自动检查
- **Git 规范**：commit message 使用 `feat:` / `fix:` / `chore:` 前缀
- **前端 store 使用原则**：
  - `app-store` 管理应用级状态（打开项目集合、当前项目、Electron IPC 动作），不持有项目内业务数据
  - `project-data-store` 按 projectKey 缓存项目内 agents、sessions 等业务数据，负责 API 调用与 loading/error 状态
  - `project-ui-store` 按 projectKey 管理纯 UI 状态（如折叠），不涉及 API 调用
  - 跨页面、跨 feature 持久的状态放 store；组件内短生命周期状态（表单、弹窗、输入框、WebSocket ref、编辑 dirty/conflict）用 `useState`/`useRef` 保留在组件内
  - 只被单个 feature 使用的状态不提升到全局 store，可在 feature 目录下建立自己的 store（如 `features/settings/store.ts`）
- **前端样式**：
  - 使用 Tailwind CSS v4 工具类 + CSS 变量色彩体系，不写原生 CSS class
  - 只使用 shadcn 语义 token（`bg-background`、`bg-card`、`bg-muted`、`bg-primary`、`bg-accent`、`text-foreground`、`text-muted-foreground`、`border-border`、`text-destructive`）和 Spherse 自有 token（`bg-agent-creator`、`text-agent-success` 等），不硬编码颜色值（如 `text-[#333]`）
  - 间距、圆角、阴影使用 Tailwind 标准 scale（`p-2`、`rounded-md`、`shadow-sm`），不使用 magic number
  - 业务组件不写 `dark:` 修饰符，暗色适配通过 CSS 变量自动切换
  - 需要新颜色时在 `styles.css` 中注册 CSS 变量（`--agent-{name}`）+ Tailwind 颜色（`--color-agent-{name}`），不在组件中硬编码
- **i18n 文案规范**：`packages/i18n/src/locales/zh-CN.ts` 是翻译基准，每条文案必须结合实际 UI 场景写注释（说明出现位置、上下文、交互状态等），用于指导其它语言版本（`zh-TW`、`en`）的翻译
- **测试覆盖**：`packages/core` 的开发需保证单元测试覆盖，修改已有模块后应补充或更新对应测试
