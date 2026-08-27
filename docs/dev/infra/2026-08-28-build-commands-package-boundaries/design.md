# 根命令体系整理与包边界收敛

- 日期：2026-08-28
- 状态：Implemented（2026-08-28）
- 关联：`docs/dev/infra/2026-08-22-frontend-architecture-followup/followup.md`（app 前端架构 followup）、AGENTS.md「启动和联调方式」、`packages/app/README.md`

## 背景

对 root `package.json` 命令体系与 `packages/*` 依赖关系做了整体 review，结论：**内部依赖图无环、分层清晰（i18n/presets/sdk → core → server → app → desktop/web/landing），总体可控**；但命令体系和两处包边界存在结构性问题。

### 问题 1：手工拓扑链，已三次打补丁

`build` / `build:web` / `build:landing` / `verify` 都是手写 `A && B && C` 链，包依赖顺序知识被复制 4 份。历史上已发生三次补丁式修复（1e271b3「补齐 server/presets/core dist」、0cb1f25「补上 desktop」、39ca806「add build:desktop」）。根因：npm 的 `--workspaces` 按 glob 字母序展开执行（app 排在 core 前），不满足拓扑序，只能手写链。

### 问题 2：命令覆盖缺口与冗余

- `verify` 漏跑 presets 测试（`__tests__/sync-templates.test.ts` 存在且有 test script）；
- `verify` 不构建 web/landing，web 的 vite build 破坏无法被任何门禁发现；
- i18n 有完全重复的 `check` / `check:i18n` 脚本；i18n 缺 `lint`、landing 缺 `lint:fix`，各包 scripts 面不统一；
- `-w @spherse/i18n`（包名）与 `--workspace=packages/desktop`（路径）混用。

### 问题 3：desktop 依赖混装 renderer 库，安装包膨胀

electron-vite 将 renderer 全量 bundle 进 `dist/`；main/preload 虽经 `externalizeDepsPlugin` 外置、需随包分发，但实际只 import `electron-store`、`electron-updater`、`@spherse/{server,core,i18n}`。desktop `dependencies` 里的 react 全家桶（14 个纯 renderer 依赖）与 `@spherse/app`（连带其整棵 prod 依赖树）会被 electron-builder 打进 asar，白占体积。`diff` / `js-yaml` 在 desktop 内已无任何 import。

### 问题 4：app 无 `exports`，壳深度 import 内部路径

desktop/web 通过 `@spherse/app/src/...` 深度导入（web 甚至引用 `src/components/ui/button`、`src/stores/settings-store`），app 的 package.json 无 `exports` 字段，全部 src 事实上都是公共 API，包边界形同虚设。

## 方案

### 1. 命令体系：显式有序 workspaces（npm 原生，零新依赖）

- root `workspaces` 从 `["packages/*"]` 改为按拓扑序的显式列表：`i18n → presets → sdk → core → server → app → web → desktop → landing`。npm 按声明顺序执行 workspace scripts，顺序即构建顺序。
- `build` → `npm run build --workspaces --if-present`（顺带让 `verify` 覆盖 web/landing 构建，修复缺口 2）。
- `verify` 测试链 → `npm test --workspaces --if-present`（顺带补上 presets 测试）。
- `build:web` / `build:landing` 保留为多 `-w` 短链（deploy-pages CI 依赖这两个名字）；删除无人引用的 `build:desktop`（release CI 直接调 `npm run build --workspace=packages/desktop`）。
- 统一 `-w @spherse/<pkg>` 包名风格；i18n 删重复的 `check:i18n`、补 `lint`/`lint:fix`；landing 补 `lint:fix`。
- 否决 Turborepo：正确的长期方向（拓扑 + 缓存 + `--filter` 增量），但当前 9 包规模收益有限，入 backlog 条件触发。

### 2. desktop 依赖再分类

- prod `dependencies` 只保留 main/preload 实际外置引用的：`electron-store`、`electron-updater`、`@spherse/{server,core,i18n}`（presets 由 core 的 prod 依赖传递携带）。
- `@spherse/app` 与全部纯 renderer 依赖（react 系、markdown 系、UI 系）转 `devDependencies`。
- 删除无引用的 `diff`、`js-yaml`、`@types/diff`、`@types/js-yaml`。
- 以 `electron-builder --dir` 产物体积做前后对照实测。

### 3. app `exports` 白名单

app package.json 增加 `exports`，仅暴露壳实际消费的 10 个入口：

| 入口 | 目标 | 消费方 |
|---|---|---|
| `./main` | `src/main.tsx` | desktop、web |
| `./host-bridge` | `src/lib/host-bridge.ts` | desktop、web |
| `./host-bridge-context` | `src/context/host-bridge-context.tsx` | web |
| `./web-resume-probe` | `src/lib/web-resume-probe.ts` | web |
| `./version-compat` | `src/lib/version-compat.ts` | web |
| `./stores/app` | `src/stores/app-store.ts` | web |
| `./stores/settings` | `src/stores/settings-store.ts` | web |
| `./ui/button` | `src/components/ui/button.tsx` | web |
| `./ui/input` | `src/components/ui/input.tsx` | web |
| `./ui/field` | `src/components/ui/field.tsx` | web |

- desktop/web 全部 import 改写为上述入口；desktop `electron/preload.ts` 的跨包相对导入 `../../app/src/lib/host-bridge.js` 同步改为 `@spherse/app/host-bridge`。
- 移除 desktop `electron.vite.config.ts` 与 web `vite.config.ts` 中已无消费者的 `@spherse/app/src` alias（`@/*` alias 保留——app src 内部使用）。desktop/web tsconfig 的 bundler resolution 与 vite 均遵守 exports。
- 全仓 grep 确认除上述文件外无其他 `@spherse/app` 引用（e2e、测试、landing 均无）。

### 4. 后续项入 backlog（本次不实施）

- contracts 拆独立包 `@spherse/contracts`（app 现依赖整包 `@spherse/server` 只为 `/contracts`）；
- Turborepo 编排评估。

## 验证

1. `npm run verify` 全绿（新增 presets 测试、web/landing 构建进入门禁）；
2. `electron-builder --dir` 前后体积对比 + unpacked node_modules 清单核对（应只剩 server/core/i18n/sdk/presets/fastify/pi 系等 main 外置树）；
3. 桌面 smoke E2E（`app-launch.spec.ts`）验证 renderer 打包与启动链路；
4. CI 脚本名兼容性核对：`verify`（pr-build）、`build` + `build --workspace=packages/desktop`（build-and-release）、`build:landing` / `build:web`（deploy-pages）均不变名。

## Review 反馈处理（2026-08-28）

- **I-1（important，已修）**：root `npm run build` 全 workspace 化会使发版 CI（build-and-release.yml）在三平台 matrix 中构建无关的 web/landing，扩大失败面且产物丢弃。恢复 `build:desktop` 脚本（i18n→presets→sdk→core→server→desktop 链）供发版 CI 专用，顺带消除该 workflow 中 root build + 单独 desktop build 的历史冗余；root `build`（全量）语义服务于 `verify` 门禁与本地。
- **M-1（medium，已修）**：desktop/web 保留的 `@/*` alias（app src 内部在用）构成 exports 白名单旁路，一次性 grep 不防回归。为 `packages/{desktop,web}/src` 增加 ESLint `no-restricted-imports` 规则，禁止壳包经 `@/` 深度导入 app 内部模块。
- **M-2（medium，入 backlog）**：E2E 启动的是 electron-vite 产物 + workspace node_modules，非打包产物，依赖再分类缺运行时级验证；本次以产物 grep 补充闭环（`dist/main/chunks` 运行时外部依赖恰为 prod 树），packaged-app smoke 入 backlog「基础设施」节。
- **m-1（minor，已修）**：desktop `electron/server.ts` 的 `import type { FastifyInstance }` 属 phantom type 依赖，desktop devDeps 显式声明 fastify。
- **m-2 / m-3（minor，已修）**：AGENTS.md「Package 一览」补 `packages/sdk` 行；「监听编译」示例统一 `-w @spherse/<pkg>` 包名风格。

## 风险

| 风险 | 缓解 |
|---|---|
| npm `--workspaces` 顺序语义依赖声明顺序（文档行为，非显眼特性） | 改动后立即以 `typecheck --workspaces` 输出顺序实证；AGENTS.md 注明列表即拓扑序、新增包按层插入 |
| exports 阻断未知的深度导入 | 全仓 grep 已穷举（desktop 5 文件 + web 5 文件，含 electron 侧相对导入）；ESLint 禁 `@/` 旁路防回归；verify/typecheck/E2E 兜底 |
| electron-builder prod deps 收集行为与预期不符 | `--dir` 产物 A/B 实测核对（asar 129MB→85MB、485→328 包、react 链 73→0、main 外置树完整） |

