# contracts 拆独立包 @spherse/contracts

- 日期：2026-08-29
- 状态：Implemented（2026-08-29）
- 关联：`docs/dev/infra/2026-08-28-build-commands-package-boundaries/design.md`（问题 4 后续项，backlog「contracts 拆独立包」条目）、`docs/dev/decisions/0007-contracts-in-code.md`（现行 ADR）

## 背景

### 事实（2026-08-29 调研）

- `packages/server/src/contracts/` 共 15 文件 / 1069 行，是 server 内最大单一模块。运行时外部依赖仅 `@sinclair/typebox`；对 `@spherse/core` 仅 1 处 type-only import（`websocket.ts`，`Type.Unsafe<T>` 泛型标注）；对 server 包内其他模块**零反向依赖**（内部 import 只有 `./common.js`、`./trigger.js`）
- npm 层边界现成：已有 `./contracts` subpath export、独立 `dist/contracts/` 产物、独立测试目录（`src/__tests__/contracts/` 3 文件 1008 行，仅 import vitest / fastify / 相对路径 contracts，可整体随迁）
- 消费方分布：
  - **app：17 个文件 / 18 条 import**，全部只消费 `@spherse/server/contracts`，其中含**运行时值导入**（`parseApiResponse`、`schemas`、`parseBusServerMessage`、`CHAT_CLOSE_CODES`、`ErrorEventCode`）——不是仅类型消费
  - server 自身：源码 15 个文件 / 19 条 self-reference import + 2 个文件 3 条相对路径 import（`routes/marketplace.ts`、`classify-run-error.ts`）；另有 2 个测试文件相对路径 import（`__tests__/ws-chat.test.ts`、`__tests__/classify-run-error.test.ts`）
  - desktop 是 server 主入口唯一消费方（`electron/server.ts`），**不消费 contracts**；web 经 app 间接消费
- 隐患一（过度依赖）：app 为 contracts 的运行时 parser 声明整包 `@spherse/server` 依赖，fastify / pino / @fastify/* / nanoid 因此进入 app 及 web（PWA）的生产依赖闭包。vite 打包不会 bundle 后端代码（无 import 路径），但依赖树语义错误、安装体积被污染
- 隐患二（phantom dependency）：`packages/app/src/lib/api.ts` 直接 `import { Type } from "@sinclair/typebox"`，app 的 package.json 未声明，靠 workspace 提升侥幸工作

### 决策依据

契约是 server ↔ renderer 的**双侧共享协议**，放在 server 单侧使所有权与 blast radius 模糊。拆包后「改契约」只触碰一个纯叶子包，依赖图上把「谁是协议消费方」显式化。迁移成本极低（边界现成、改动机械），与 2026-08-28 包边界收敛工作同一方向。

## 方案

### 1. 新包骨架

`packages/contracts`，包名 `@spherse/contracts`：

- **位置**：workspaces 列表插在 `core` 之后、`server` 之前（唯一 type-only 依赖是 core）；root `build:desktop` / `build:web` 链同步插入 `-w @spherse/contracts`
- **exports**：仅 `"."`（单入口聚合门面，无需 subpath）
- **dependencies**：`@sinclair/typebox ^0.34.0`、`@spherse/core *`（产出的 `.d.ts` 引用 core 类型，公共类型引用的包按惯例进 dependencies）
- **devDependencies**：`fastify`（契约测试用 Fastify 实例验证 body coercion 兼容性，仅测试消费，不进任何 prod 闭包）、`typescript`、`vitest`
- **scripts**：`build`（tsc）/ `dev`（tsc --watch）/ `typecheck` / `test`（vitest run src）/ `lint` / `lint:fix`，与 server 对齐
- **tsconfig**：继承 `tsconfig.base.json`，`rootDir: src`、`outDir: dist`，排除 `src/__tests__`

### 2. 文件迁移

| 源 | 目标 | 方式 |
|---|---|---|
| `packages/server/src/contracts/`（15 文件） | `packages/contracts/src/` | `git mv`（保 blame） |
| `packages/server/src/__tests__/contracts/`（3 文件） | `packages/contracts/src/__tests__/` | `git mv`，相对 import 改 `../index.js`（新包 src 为扁平结构） |

契约测试归属 contracts 包的理由：Fastify coercion 兼容性是 schema 自身的性质（server 绑定 Fastify schema option 的前提），不是 server 装配的性质。

迁移时同步清理 `packages/server/dist/`（整目录删除重建）：tsc 不删孤儿产物，残留的 `dist/contracts/` 及仍引用已删 subpath 的 `dist/routes/*.js` 会污染 grep 验证与后续构建缓存。

### 3. Import 与依赖改写

| 对象 | 改动 |
|---|---|
| server 源码 15 文件 19 条 self-reference + 2 文件 3 条相对路径 + 2 个测试文件的相对路径 import | 统一改 `@spherse/contracts` |
| app 17 个文件的 `@spherse/server/contracts` | 改 `@spherse/contracts` |
| `packages/app/src/features/chat/ErrorMessageSection.structure.test.ts` | 字符串断言 `toContain('from "@spherse/server/contracts"')` 同步改为新 specifier（结构测试断言源码文本，import 改写不覆盖它） |
| server package.json | 加 `"@spherse/contracts": "*"`；**删除** `./contracts` subpath export（私有 monorepo、同 commit 全量迁移、无外部消费者，不留 re-export shim）；**移除 `@sinclair/typebox`**（contracts 迁出后 server 源码零处直接 import，成为死依赖；运行时 parser 经 `@spherse/contracts` 传递获得） |
| app package.json | `@spherse/server` → `@spherse/contracts`；**显式声明 `@sinclair/typebox`**（修 phantom dependency） |
| web / desktop package.json | 不动（web 经 app 传递；desktop 不消费 contracts） |

### 4. 范围外决策（显式记录，防范围蔓延）

- **HostBridge 接口不迁入**：它是 in-process API 接口而非 wire protocol，依赖 react（`renderConnectPage?: () => ReactNode`），演化节奏跟 app feature 强耦合；desktop/web → app 依赖边本就存在（ADR-0006 依赖倒置设计），无过度依赖问题。`@spherse/contracts` 定位收窄为「**跨进程边界的 wire 协议**（HTTP / WS / 未来 IPC 的可序列化数据契约 + 运行时校验）」
- **Electron IPC 数据形状（`MobileAccessState` / `UpdateEvent` 等）暂不迁入**：desktop 主进程为此 3 个类型 import `@spherse/app/host-bridge` 的依赖边无实际成本（type-only 且边本来存在）。条件触发：desktop IPC 边界校验立项（给这些类型补 typebox schema）时顺路迁入
- **发布 npm 暂不做**：条件触发——出现外部客户端 / 开放协议需求时再评估

### 5. 文档同步清单

| 文件 | 改动 |
|---|---|
| AGENTS.md | Package 一览表加 `packages/contracts` 行；「API contract」红线 `@spherse/server/contracts` → `@spherse/contracts` |
| `docs/official/project-structure.md` | 目录树加 `packages/contracts` |
| `docs/official/architecture/server.md` | 子入口描述（现 L69）改为独立包表述 |
| `docs/official/architecture/chat.md` | L4 wire 协议引用改 `@spherse/contracts` |
| `packages/app/README.md` | L142 边界校验规则引用改 `@spherse/contracts` |
| `.agents/skills/code-review/SKILL.md` | L41 Contracts 检查项引用改 `@spherse/contracts`（防后续 sub agent review 误导） |
| `docs/dev/decisions/0007-contracts-in-code.md` | 包名引用原地更新（核心决策「schema 进代码」不变，仅位置变化，沿用该 ADR 随时间修订的风格） |
| `packages/server/README.md` | 契约章节（L3 / L9 / L11 / L60 / L123 / L134）改写：schema 定义、聚合门面、契约测试规则迁移至新包 README，server README 留引用 |
| `packages/contracts/README.md` | 新建：包定位（wire protocol）、新增域 schema 的聚合门面规则、契约测试用例要求（正向通过 / 负向抛 `Invalid payload`） |
| `docs/dev/backlog.md` | 删除「contracts 拆独立包」条目（现 L62） |

## 验证

1. `npm run verify` 全绿（build 顺序实证 contracts 在 core 后 server 前；随迁的 3 个契约测试文件在新包通过、server 侧 2 个改 specifier 的测试通过）
2. 全仓 grep（排除 `dist/`、`node_modules/`）无残留 `server/contracts` 引用；`packages/server/dist/` 迁移时已清理重建
3. `npm ls fastify --workspace=@spherse/app` 为空（app 生产依赖闭包不再含 fastify）；`@sinclair/typebox` 在 app dependencies 中显式声明、已从 server dependencies 移除
4. E2E：改动运行时值消费集中在 chat WS 边界（`parseChatServerEvent` / `CHAT_CLOSE_CODES` / `ErrorEventCode`），跑 `e2e/chat-streaming-resilience.spec.ts` 覆盖该边界，附 `e2e/app-launch.spec.ts` 兜底启动链路

## 风险

| 风险 | 缓解 |
|---|---|
| 目录移动丢 git 历史 | 全程 `git mv`，`git log --follow` 抽查验证 |
| 遗漏非显式引用（字符串断言、相对路径、e2e helper、脚本） | 改动清单已含结构测试字符串断言与 server 侧相对路径 import；迁移后全仓 grep（含 `.agents/`、`docs/`）兜底 + verify / E2E |
| 新包 vitest 环境差异导致测试行为漂移 | 测试文件仅依赖 vitest + fastify(dev) + 相对路径 import，迁移后跑通即等价；fail-fast 在 verify 门禁暴露 |
| workspaces 顺序插错导致 CI 构建序混乱 | build:desktop / build:web 链与 `--workspaces` 列表同步修改，build 输出顺序实证 |

## Review 反馈处理（2026-08-29）

- **I-1（important，已修）**：迁移清单补上留在 server 的 2 个相对路径 import 测试文件（`ws-chat.test.ts`、`classify-run-error.test.ts`）。
- **I-2（important，已修）**：补 `ErrorMessageSection.structure.test.ts` 的字符串断言同步改动项。
- **I-3（important，已修）**：文档同步清单补 `chat.md` / `app README` / `code-review SKILL.md` 三处。
- **M-4（medium，已修）**：迁移步骤补 `packages/server/dist/` 清理；验证 grep 明确排除 dist。
- **M-5（medium，已修）**：E2E 选择改为 `chat-streaming-resilience.spec.ts`（覆盖受影响的 chat WS 边界）+ `app-launch.spec.ts`。
- **m-6 / m-7（minor，已修）**：消费口径修正为「app 17 文件 18 条 import」「server 源码 15 文件 19 条」。
- **m-8（minor，已修）**：新包测试相对路径改 `../index.js`。
- **m-9（minor，已修）**：server 移除迁移后死掉的 `@sinclair/typebox` 依赖，理由入改动表。
- **m-10（minor，不修）**：eslint node-globals 块按包枚举不会命中新包，但 TS 文件 `no-undef` 关闭无实际影响，不为此扩配置；新包 lint 覆盖由 `packages/*/src/**/*.ts` glob 自动获得。
