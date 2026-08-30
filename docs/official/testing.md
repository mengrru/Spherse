# 测试体系

> 覆盖范围：全仓测试分层、各层职责与选型规则、共享测试工具、验证链。
> 命令速查见根 `AGENTS.md`「启动和联调方式」；renderer 组件测试细则见 `packages/app/README.md`「测试与验证」；各域架构见 `architecture/`。
> 测试基建的设计过程与迁移归档见 `docs/dev/infra/2026-08-29-react-component-testing/`。

## 分层总览

| 层 | 运行环境 | 覆盖对象 | 归属 | 反馈 |
|---|---|---|---|---|
| 纯逻辑单测 | Node / jsdom | store、query、reducer、纯函数、hook 数据流 | core / server / app / contracts / sdk 等 | 秒级 |
| 组件测试 | jsdom + Testing Library | React 组件渲染、ARIA 状态、交互 | `packages/app` | 秒级 |
| 契约测试 | Node | 跨层接缝：PM 写入门面、`SessionPort`、HTTP/WS contract | core / server | 秒级 |
| 架构不变量 | Node（源码扫描） | 跨文件完整性、层边界负断言 | `packages/app`（`*.structure.test.ts`） | 秒级 |
| E2E | 真实 Electron + Playwright | 启动链、路由、多面板集成、UI SDK | `packages/desktop/e2e/` | 分钟级 |
| 打包 smoke | 打包产物（asar） | electron-builder 配置、native dependency、安装包可启动 | `packages/desktop/e2e/packaged-smoke.spec.ts` | 分钟级 |

## 各层职责

### 纯逻辑单测

- 覆盖 stores / queries / lib / hooks 的数据流与不变量：项目隔离、缓存失效、竞态、清理路径。
- 不变密集的纯逻辑（fold、access policy、错误分类、tree model）先写测试再实现；UI 与集成路径实现后补（不强求 TDD）。
- Query 相关测试每测试新建 `QueryClient`（app 用 `createTestQueryClient`），禁止跨测试泄漏缓存状态。

### 组件测试（packages/app）

- 工具链：Vitest + jsdom + `@testing-library/react` + `user-event` + `jest-dom`。
- 共享工具在 `src/test/`：`renderWithProviders` / `createTestQueryClient` / `createMockHostBridge` / bus MockWebSocket harness。
- 红线（查询优先级、fake timers、卸载副作用清理顺序、禁止 `createRoot` 样板）见 `packages/app/README.md`「测试与验证」，不在本文件重复。

### 契约测试（跨层接缝）

- 跨包红线（core 的 PM 写入门面与 `SessionPort` 方法，消费方包至少各有一条不 mock 被测方法本身的契约测试）见根 `AGENTS.md`。
- HTTP/WS 边界 schema 在 `@spherse/contracts`，server 侧 contract 测试驱动真实路由校验 wire 协议；renderer 复用同一套 parser，不另写第二份边界校验。

### 架构不变量（structure test）

- `*.structure.test.ts` 只允许：全 src 扫描的完整性清单（如所有定义 `clearProject` 的 store 必须进 `closeProjectCascade`）、层边界负断言（如 App shell 不向 feature 透传数据）。
- 禁止断言单文件实现细节（className 字符串、函数名、源码模式、调用顺序）——行为断言一律写组件/逻辑测试，样式约束交给 ESLint 规则。

### E2E（packages/desktop）

- 覆盖 Electron 启动、项目恢复、路由、store、server API、文件树、content browser、chat/session、文本选择发起会话、UI SDK bridge、浮窗等跨面板集成；改动涉及上述面或 native dependency、E2E helper 时优先运行对应 spec。
- **按变更影响面选择受影响的 spec 运行，不要求全量**；单 spec：`npm run test:e2e --workspace=packages/desktop -- e2e/file-tree.spec.ts`，或追加 `-g "<case 名>"` 过滤。合并/发布前跑 `npm run verify:e2e`。
- 涉及打包链（electron-builder 配置、asar/外置 node_modules、native dependency 重编、安装包产物）时，跑 `npm run pack -w @spherse/desktop && SPHERSE_SMOKE=1 npm run test:smoke -w @spherse/desktop` 验证产物本身；release CI 会在 arch 匹配的 job 上自动执行该 smoke。

### i18n 一致性

- `npm run check:i18n` 校验三 locale key 一致与插值变量匹配，纳入 `npm run verify` 链；新增用户可见文案必须同时过检（流程见 **i18n** skill）。

## 选型规则

新增测试时按以下顺序判断落点：

1. 纯逻辑或数据流（无 DOM）→ 纯逻辑单测
2. 组件渲染、ARIA 状态、用户交互（渲染一个 feature 内的组件可测）→ 组件测试
3. 跨进程/跨层接缝行为 → 契约测试（不 mock 被测方法本身）
4. 跨面板/需要真实 Electron 环境（窗口、IPC、启动链）→ E2E
5. 跨文件结构约束（无法用行为表达）→ structure test（先确认不是第 1–4 层能覆盖）
6. 布局、CSS、主题视觉效果 → 不写自动化断言，E2E 冒烟 + 人工验证；主题 hook 的存在性可归入组件渲染断言

不落的层：

- 组件测试不断言真实布局/CSS（jsdom 无样式）；此类回归由 E2E 与主题 skill 守卫。
- E2E 不测单组件内部行为——反馈慢且脆，下沉到组件测试。

## 验证链

```bash
npm run verify        # lint + build + typecheck + 全部单测 + i18n check
npm run verify:e2e    # verify + desktop 全量 E2E（合并/发布前）
```

- 单包快速回路：`npm test --workspace=packages/<pkg>`（app 组件测试依赖 i18n/presets 等 dist，跨包改动后先 `npm run build`）。
- pre-commit 钩子执行 `npm run lint`；PR（非 docs-only）上 CI 跑 `npm run verify` 与全量 E2E；tag push 发版跑 verify 与 arch 匹配 job 上的打包 smoke（发版不跑 E2E，拦截在 PR 阶段）。

## 维护规则

- 测试基建变更（新工具、新 harness、规则修订）同步本文件与受影响的 package README。
- structure test 与 ESLint 规则的边界：可 lint 表达的约束（import 边界、样式 token）优先 ESLint；需要跨文件图谱或运行时信息的才进 structure test。
