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
│   ├── i18n/        # @spherse/i18n — i18n 基础设施与翻译资源
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
npm run verify                              # lint + build + unit tests + i18n check
npm run verify:e2e                          # verify + Electron E2E
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
- **用户主题 Skill 维护**：修改 design system、全局主题机制、聊天窗口 DOM 结构、聊天布局、CSS token 或可主题化选择器时，必须检查 `packages/presets/skills/create-ui-theme/` 和 `packages/presets/skills/create-agent-chat-theme/` 是否需要同步更新
- **E2E 验证选择**：feature 实现完成后，应根据当前变更影响面选择可能受影响的 E2E 覆盖场景运行测试；不要求每次都跑全量 E2E。可通过 `npm run test:e2e --workspace=packages/app -- e2e/file-tree.spec.ts` 跑单个 spec，或用 `-g` 按 case 名过滤。改动涉及 Electron 启动、项目恢复、路由、store、server API、文件树、content browser、chat/session、文本选择发起会话、native dependency 或 E2E helper 时，优先运行对应 E2E；合并/发布前再跑 `npm run verify:e2e`
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
- **前端 store 使用原则**：
  - `app-store` 管理应用级状态（打开项目集合、当前项目、Electron IPC 动作），不持有项目内业务数据
  - `project-data-store` 按 projectKey 缓存项目内 agents、sessions 等业务数据，负责 API 调用与 loading/error 状态
  - `project-ui-store` 按 projectKey 管理纯 UI 状态（如 floating chat 位置），不涉及 API 调用
  - 跨页面、跨 feature 持久的状态放 store；组件内短生命周期状态（表单、弹窗、输入框、WebSocket ref、编辑 dirty/conflict）用 `useState`/`useRef` 保留在组件内
  - 只被单个 feature 使用的状态不提升到全局 store，可在 feature 目录下建立自己的 store（如 `features/settings/store.ts`、`features/chat/streaming-store.ts`、`features/agent-session-list/store.ts`）。feature-local store 不应被其它 feature 或全局 store import
  - 全局 store 不应依赖 feature-local store（如需要 locale 等跨层信息，应由调用方传入或由展示层翻译）
  - store 命名统一 `use{语义名}Store` 格式（PascalCase 语义名 + `Store` 后缀），如 `useAppStore`、`useProjectDataStore`、`useSettingsStore`、`useStreamingStore`。作用域（全局 vs feature-local）由文件位置表达（`stores/` vs `features/xxx/store.ts`），不在命名中编码
- **前端组件原则**：
  - feature root 组件自治：自己从 store/context 读取所需数据并构造行为，不通过 props 接收父组件直接转发的 store 数据或 action；纯展示型子组件仍通过 props 接收数据。App shell 只管「渲染哪些 feature + 应用级副作用」，不做 feature 的数据中转站
  - 组件行数软阈值 ~150 行：超过通常意味着混了多件不相关的事（抽子组件）、逻辑该抽 hook，应考虑拆分；阈值非硬上限，需结合认知复杂度判断
  - 关注 state 耦合度而非 state 个数：多个 `useState` 在同一 handler 被一起更新，或 state/effect 互相触发形成 effect 链，优先用 `useReducer` 或抽 hook 收敛，而不是拆组件；多个语义正交的 `open`/`setOpen` 可考虑合并为单个枚举 state（如 `useState<DialogKind | null>(null)`）
  - 关注认知复杂度信号：handler 互相调用、effect 链、条件渲染嵌套 > 3 层，优先拆分
- **前端样式**：
  - 使用 Tailwind CSS v4 工具类 + CSS 变量色彩体系，不写原生 CSS class
  - 只使用 shadcn 语义 token（`bg-background`、`bg-card`、`bg-muted`、`bg-primary`、`bg-accent`、`text-foreground`、`text-muted-foreground`、`border-border`、`text-destructive`）和 Spherse 自有 token（`bg-agent-creator`、`text-agent-success` 等），不硬编码颜色值（如 `text-[#333]`）
  - 间距、圆角、阴影使用 Tailwind 标准 scale（`p-2`、`rounded-md`、`shadow-sm`），不使用 magic number
  - 业务组件不写 `dark:` 修饰符，暗色适配通过 CSS 变量自动切换
  - 需要新颜色时在 `styles.css` 中注册 CSS 变量（`--agent-{name}`）+ Tailwind 颜色（`--color-agent-{name}`），不在组件中硬编码
  - 变更主题 token、聊天窗口 `data-chat-*` 属性或可自定义样式入口时，同步更新用户可见的主题模板和 skill 文档
- **i18n 文案规范**：`packages/i18n/src/locales/zh-CN.ts` 是翻译基准，每条文案必须结合实际 UI 场景写注释（说明出现位置、上下文、交互状态等），用于指导其它语言版本（`zh-TW`、`en`）的翻译
- **测试覆盖**：`packages/core` 的开发需保证单元测试覆盖，修改已有模块后应补充或更新对应测试
