# 前端 Lint 基础设施

## 概述

为 Spherse 增加 ESLint lint 基础设施。虽然需求起点是 `packages/app` 前端 lint，但当前 `core`、`server`、`presets` 都是规模较小的 TypeScript package，一次性建立 repo-wide lint 不会显著扩大范围。因此本次设计选择以 root ESLint flat config 统一管理规则，并为所有 package 增加 `lint` 脚本；其中 `packages/app` 启用 React Hooks / React Refresh 等前端专属规则，Node packages 只启用 TypeScript/ESM 通用规则。

提交钩子采用非写入式检查：commit 前自动执行 lint，发现问题则阻塞 commit，由开发者手动运行 `npm run lint:fix` 或修改代码后重新提交。这样避免 hook 在 commit 过程中修改工作区或暂存区，减少“提交内容与开发者预期不一致”的风险。

## 背景

当前项目没有 ESLint、Prettier、Husky 或 lint-staged 配置。root `package.json` 只编排 build/dev，package 脚本中只有 build/dev/test/e2e。代码整体已经使用 TypeScript strict mode，但缺少静态代码风格与 React Hooks 规则检查。

这些工具的关系：

- ESLint：代码规则检查工具，负责发现未使用变量、React Hooks 依赖错误、潜在 bug、部分代码风格问题。本设计的核心工具是 ESLint。
- Prettier：代码格式化工具，负责统一空格、换行、缩进等格式，不主要负责发现 bug。本次不引入 Prettier，避免把 lint 基础设施和全量格式化混在一起。
- Husky：Git hooks 管理工具，负责在 `pre-commit` 等 Git 生命周期中执行命令。本设计用 Husky 在 commit 前运行 lint。
- lint-staged：只对已暂存文件执行 lint/format 的工具，常与 Husky 配合使用。本次不引入 lint-staged，因为 repo 当前规模较小，全量 lint 更简单一致。

关系可以理解为：ESLint/Prettier 是实际检查或格式化工具；Husky 决定在 Git 提交前什么时候运行命令；lint-staged 决定只把这些命令应用到 staged files。

现有代码特征：

- `packages/app/src` 为 TypeScript + React 19，没有 JS/JSX 源文件。
- `packages/app` 有 renderer tsconfig 和 Electron main/preload tsconfig，需要同时覆盖 `src`、`electron` 以及 app package 根目录下的配置文件。
- 前端使用 shadcn/Base UI 组件，部分组件保留 `React.ComponentProps`、`React.useState` 等命名空间写法。
- 当前代码存在较多 `any` 使用场景，包括 WebSocket/agent runtime payload、SQLite row casting、测试中对 tool context 的 `undefined as any`。长期方向应尽量禁止 `any`，但第一版 lint 先放过，避免把基础设施任务变成类型迁移任务；可优化方向已记入 backlog。
- 当前代码存在少量 `console.log`/`console.warn`/`console.error` 诊断输出，不能在第一版 lint 中直接一刀切禁止。后续日志系统完善后，可以再开启 `no-console` 或更细粒度的 console lint，已记入 backlog。

## 需求

1. 为 `packages/app` 增加 lint。
2. 评估是否同时为所有 package 增加 lint；若规模可控，本次一起增加。
3. 根据当前前端代码特征选择合适的 lint 规则，避免引入大规模无关修复。
4. 为 git commit 增加钩子，并明确钩子是否自动写入修复。
5. 补充 lint 相关实践，包括本地命令、本地 merge 验证路径、后续可逐步收紧的规则。

## 方案对比

### 方案 A：只为 `packages/app` 增加 ESLint

优点：范围最小，直接满足“前端 lint”。React 规则配置更简单。

缺点：root 没有统一质量入口，`core`/`server` 仍缺少基础规则；后续补齐时需要再次调整 root scripts、依赖和 hook。

### 方案 B：root ESLint flat config，覆盖所有 package（推荐）

优点：一次建立统一 lint 入口；Node packages 规模小，加入成本低；app 可以通过 override 启用 React 规则；commit hook 和后续本地验证流水线都只需调用 root `npm run lint`。

缺点：初次引入需要处理 Node/React 两类运行环境，规则需要谨慎避免触发大量历史问题。

### 方案 C：引入 Biome 统一 lint/format

优点：工具链快，lint + format 一体化，配置较少。

缺点：项目已有 TypeScript/React/Vite/Electron 生态，ESLint 对 React Hooks、React Refresh、TypeScript 规则的生态更成熟；Biome 规则迁移会更像格式化/风格切换，不适合作为第一版低风险 lint。

## 方案选择

选择方案 B：root ESLint flat config 覆盖所有 package。

本次不引入 Prettier 或 Biome 格式化，不把 lint 与全量格式化绑定。第一版 lint 目标是发现明显错误、React Hooks 违规、未使用变量等高信号问题，而不是重排代码风格。

## 技术方案

### 1. 依赖

在 root `devDependencies` 增加 ESLint 相关依赖，避免每个 workspace 重复安装：

```json
{
  "@eslint/js": "^9.x",
  "@typescript-eslint/eslint-plugin": "^8.x",
  "@typescript-eslint/parser": "^8.x",
  "eslint": "^9.x",
  "eslint-plugin-react-hooks": "^7.x",
  "eslint-plugin-react-refresh": "^0.4.x",
  "globals": "^16.x",
  "husky": "^9.x"
}
```

依赖版本以 `npm install` 解析到的当前兼容版本为准，写入 `package-lock.json`。

### 2. Root ESLint 配置

新增 `eslint.config.js`，使用 ESLint 9 flat config。

基础忽略：

- `node_modules/**`
- `dist/**`
- `coverage/**`
- `docs/**`
- `.superpowers/**`
- `packages/presets/templates/**`，因为这是预置静态内容，不应被 TypeScript lint 处理

通用 TypeScript 规则覆盖：

- `packages/*/src/**/*.{ts,tsx}`
- `packages/app/electron/**/*.ts`
- `packages/app/*.{ts,tsx}`
- `packages/*/scripts/**/*.mjs`
- root 脚本与 config 文件中实际存在的 JS/MJS 文件

通用规则：

- 启用 `@eslint/js` recommended。
- 使用 `@typescript-eslint/parser` 和 recommended 规则。
- `@typescript-eslint/no-unused-vars` 开启，并忽略 `_` 开头参数/变量。
- 不开启 `@typescript-eslint/no-explicit-any`。现有项目中 `any` 多用于外部 runtime、SQLite、测试 context，第一版禁止会把 lint 变成迁移任务。
- 不开启 `no-console`。当前 app 有 WebSocket 和主题加载诊断输出，后续可通过 logger feature 再收敛。

App React override：

- 覆盖 `packages/app/src/**/*.{ts,tsx}`。
- 启用 `eslint-plugin-react-hooks` recommended。
- 启用 `react-refresh/only-export-components`，但允许常量导出：`{ allowConstantExport: true }`。
- 浏览器全局使用 `globals.browser`。
- 不启用 `react/react-in-jsx-scope`，因为项目使用 React 17+ JSX transform。
- 不强制禁止 `React.` 命名空间写法，保留 shadcn/Base UI 组件当前风格。若本次强制禁止，主要代价是需要批量改写 shadcn/Base UI 组件和少量业务组件中的 `React.ComponentProps`、`React.CSSProperties`、`React.useState`、`React.useEffect`、`React.useMemo`、`React.useCallback` 等用法；这类改动多数只是风格统一，不提升第一版 lint 的质量门禁价值，还可能造成大量无关 diff。后续若要统一 import 风格，可单独作为代码风格整理处理。

Node/Electron override：

- 覆盖 `packages/core/src/**/*.ts`、`packages/server/src/**/*.ts`、`packages/presets/src/**/*.ts`、`packages/app/electron/**/*.ts`、`packages/app/*.{ts,tsx}`、脚本文件。
- 使用 `globals.node`。
- 保持 ESM/Node16 语义，不引入 CommonJS 风格规则。

### 3. Scripts

Root `package.json` 增加：

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

各 package 增加本地入口，便于按 workspace 执行：

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

若实现时发现某 package 目录下 `eslint .` 会因为 root flat config 匹配路径差异导致行为不一致，则 package 脚本改为从 workspace 调 root 命令的路径限定形式，例如 `eslint packages/app`。最终以能在 root 和 workspace 两种调用方式稳定执行为准。

### 4. Git Commit Hook

使用 Husky 管理 `.husky/pre-commit`：

```sh
npm run lint
```

钩子不执行 `lint:fix`，也不写入工作区或暂存区。理由：

- commit hook 自动修改文件会造成暂存区与工作区状态变化，开发者容易提交非预期内容。
- 如果 hook 修改已暂存文件但未重新 `git add`，提交内容和工作区内容会不一致。
- 如果 hook 自动 `git add`，会把开发者未明确确认的变更加入 commit。
- 非写入式失败更适合作为质量门禁；需要修复时开发者显式运行 `npm run lint:fix`。

本次不引入 lint-staged。原因是 repo 规模较小，`npm run lint` 的全量检查更简单、更一致，也能捕获跨文件配置问题。若未来 lint 时间明显影响提交体验，再考虑 lint-staged 只检查 staged 文件，并在本地验证流水线中保留全量 lint。

### 5. 本地验证实践

当前项目没有线上 CI，且暂时不使用 PR 模式。当前集成方式是 change 分支本地通过一系列验证后，本地 merge 到 `dev`；`dev` 累积一段时间后做整体测试，再手动本地 merge 到 `main`。

实现阶段至少保证以下本地验证命令通过：

```bash
npm run lint
npm run build
npm test --workspace=packages/core
npm test --workspace=packages/app
```

本次不新增线上 CI，也不改变本地 merge 流程。后续可以为 `feature -> dev`、`dev -> main` 增加本地可运行的流水线脚本，例如 `npm run verify:feature`、`npm run verify:release`，但这不在本次 scope 内，已记入 backlog。

### 6. 初始问题处理策略

实现 lint 后如果出现少量高信号问题，例如未使用 import、漏依赖的 hooks、明显不可达代码，应在本次修复。

如果出现大规模历史问题，应优先通过规则调整或局部 override 控制范围，而不是进行无关代码清理。第一版 lint 的完成标准是建立可持续运行的质量门禁，不是一次性重构所有历史代码。

允许的第一版宽松项：

- 保留 `any`。
- 保留 `console`。
- 对测试文件适当放宽未使用表达式或 `any` 相关规则。
- 对 shadcn/Base UI 组件保留现有导出和 React namespace 风格。

## 涉及文件

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `eslint.config.js` | root ESLint flat config |
| 修改 | `package.json` | root `lint`/`lint:fix`/`prepare` 或 Husky 初始化相关脚本、root devDependencies |
| 修改 | `package-lock.json` | 新增依赖锁定 |
| 修改 | `packages/app/package.json` | app `lint`/`lint:fix` scripts |
| 修改 | `packages/core/package.json` | core `lint`/`lint:fix` scripts |
| 修改 | `packages/server/package.json` | server `lint`/`lint:fix` scripts |
| 修改 | `packages/presets/package.json` | presets `lint`/`lint:fix` scripts |
| 新增 | `.husky/pre-commit` | commit 前执行非写入式 lint |

## 不涉及的改动

- 不引入 Prettier 或全量格式化。
- 不把 `no-explicit-any`、`no-console` 作为第一版强制规则。
- 不重构现有 React 组件结构。
- 不修改业务逻辑来迎合低信号风格规则。
- 不在 commit hook 中自动写入、自动暂存或自动提交修复。

## 测试策略

实现完成后运行：

```bash
npm run lint
npm run lint --workspace=packages/app
npm run lint --workspace=packages/core
npm run lint --workspace=packages/server
npm run lint --workspace=packages/presets
npm run build
npm test --workspace=packages/core
npm test --workspace=packages/app
```

手动验证 commit hook：

1. 构造一个明显 lint 错误，执行一次 commit，确认 pre-commit 阻塞。
2. 修复错误后重新 commit，确认 hook 放行。
3. 确认 hook 不修改工作区、不自动 `git add`。

## 后续可逐步收紧

1. 梳理 agent/runtime payload、SQLite row、测试 tool context 等 `any` 来源，逐步替换为明确类型，并考虑开启 `@typescript-eslint/no-explicit-any` 的 warning 或 error 模式。
2. 引入结构化日志后，再考虑收紧 `no-console`。
3. 为 `feature -> dev`、`dev -> main` 设计本地可运行的验证流水线脚本，分别覆盖 lint/build/test/e2e 或发布前整体检查。
4. 若提交耗时上升，引入 lint-staged 优化本地 pre-commit；全量 lint 保留在本地验证流水线中。
5. 若团队希望统一格式，再单独设计 Prettier 或 Biome format，不与本次 lint 门禁混在一起。
