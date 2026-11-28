# Design: capability 插件装载（用户侧扩展接入）

- 日期：2026-11-28
- 状态：implemented（2026-11-28；review 2C/1I/2M/4m 处理见文末，实现差异一则附后）
- 关联：`docs/dev/infra/2026-11-22-cordis-host/design.md`（P1 host 引入，`defineCapabilityPlugin` / registry 注册提前）；`docs/dev/decisions/0002-capability-kernel.md`（窄 port 依赖方向）；讨论结论：运行时动态需求确认为"只加不减"

## 1. 目标与非目标

**目标**：用户可在项目数据空间放置第三方 capability 插件，随项目组装自动接入系统——实现 Capability 协议（kernel 抽象），贡献点与内置 capability 平权生效。装载走 cordis host 既有机制。

**非目标**：
- 不做卸载/禁用/撤销语义（贡献点折叠在 runner 创建点，回撤是热插拔级难题，明确不做）
- 不做启停配置（目录存在 = 装载；disabled 配置等启停需求真实出现再设计）
- 不做插件市场/分发/安装生命周期（用户手动放置目录；`installPluginZip` 类工具另行评估）
- 不做沙箱/权限隔离（进程内直通，信任模型 = 用户自装，见 §6）
- 不做 browser 版外部插件（browser 装配路径不经 factory，天然不触发装载，见 §7）
- 不改 Capability 接口与 kernel 消费协议（14 成员零改动；装配数组/折叠时序零改动）

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| D-P1 | 语义档位 = **只加不减、重启生效** | 添加是单向操作，无撤销难题；折叠点天然在 runner 创建处（`agent-runner.ts:67-70`），重建 runtime 即全面生效 |
| D-P2 | 插件来源 = **per-project 目录扫描**（`<project>/.spherse/plugins/`） | 与 skills（`.spherse/skills`，`project.ts:68-69`）同构；Spherse 一切资产皆 per-project；项目导出/迁移自然携带插件 |
| D-P3 | manifest = 目录内 `manifest.json`，TypeBox schema 校验（core 本地，不进 contracts——无跨进程 wire 面） | 不复用 package.json 双语义；core 已有 TypeBox manifest 先例（`capabilities/data/manifest.ts`） |
| D-P4 | 装载 = 静态预检（发现/校验/import/形状/冲突）+ 经 `options.capabilities` 函数形态合并 + fiber 内 init | 复用 P1 机制；`AssembleCoreOptions.capabilities` 函数分支（assemble.ts:39）即为此设计的注入点，core 零改动 |
| D-P5 | 错误隔离两段分档：**静态预检失败 → warn 跳过**（manifest 坏/形状坏/import 失败/id 冲突）；**init 运行时失败 → 与内置同等 fail-fast**（装配即停、runtime 不产出） | 数组在 deps 构建时冻结且 `attachmentProcessors` 急切折叠（runtime.ts:85）——"init 失败剔除贡献"必须改 kernel 消费协议（违背零改动）；静默残留（warn 后贡献仍在但未 init）是更差语义；fail-fast + 诊断指向插件名 + 删目录即恢复，路径清晰（review C1） |
| D-P6 | 信任边界 = 进程内全权 + 窄 port + "用户自装"信任模型 | 与内置平权；ADR-0002 窄 port 自动成为插件 API 边界；个人本地运行时可接受 |
| D-P7 | kernel 协议零改动，Capability 接口从此是对外契约（semver 纪律起点） | breaking = 插件生态 breaking；本设计不引入任何接口/折叠/时序变更 |
| D-P8 | 生效范围 = 桌面/server 版（经 factory 装配路径）；browser 不支持 | browser worker 直连 `assembleProjectCore`（registry.ts:9,195），不经 factory（factory.ts:55）——loader 只被 factory import，browser 图零污染（review C2） |
| D-P9 | 插件形态 = ESM only，default export 一个 Capability 形状对象，**零宿主 import** | 仓库 Node16 全 ESM；插件目录不在 workspace 依赖图，值 import `@spherse/core` 不可解析；类型消费走 `import type`（编译期擦除） |

## 3. 模块设计（`packages/core/src/plugins/`，仅 Node 消费）

### 3.1 `loader.ts`——发现与静态预检

```
loadExternalCapabilities(
  projectRoot: string,        // 绝对 OS 路径（import()/isPathInside 用）
  pluginsRelDir: string,      // FsPort 根相对路径（".spherse/plugins"，readdir/readFile 用——FsPort 拒绝绝对路径，fs-port.ts:26-42）
  fs: FsPort, logger: Logger,
): Promise<ExternalPluginLoadResult>
// { capabilities: Capability[]; skipped: Array<{ dir, stage, err }> }
```

流程（每步失败 → `logger.warn({ plugin, stage, err })` + 记入 skipped + **继续下一个插件**）：
1. `fs.readdir(pluginsRelDir)`——**显式 catch 目录不存在/不可读**，返回空结果（NodeFsPort 对缺失目录抛错，node-fs-port.ts:68-71；先例 project.ts:114-120）
2. 子目录读 `manifest.json` → `manifestSchema` 校验（name/version/main 必填、engines.spherse 可选字符串）
3. `main` 解析为插件目录内路径：拼 `path.join(pluginsDir, manifest.main)` 后 **`isPathInside(pluginsDir, resolved)` 核验禁逃逸**（仓库路径红线）
4. `await import(pathToFileURL(resolved).href)`（node:url——本模块仅被 factory.ts import，不进 browser 图）
5. default export **全成员形状校验**（14 成员）：`id` 非空字符串；`init/tools/featureTools/contextBlocks/turnHooks/onAgentDeleted/onAgentConfigChanged/shutdown` 为函数或 undefined；`streamDecorators/contextProjectors/previewTransforms/attachmentProcessors/pathRules` 为数组或 undefined（review m7：部分校验会让 `turnHooks: 123` 存活到 session 创建时炸）
6. **id 冲突预检**：与已收集列表 id 重复 → warn 跳过（数组语义是 append 尾部、折叠 last-wins——外部会 shadow 内置工具，agent-assembly.ts:149；明确禁止，review M4）

### 3.2 `factory.ts` 接线（唯一挂点）

`assembleProject`（factory.ts:55）在调用 `assembleProjectCore` 前：

```
const external = await loadExternalCapabilities(projectRoot, ".spherse/plugins", fsPort, logger)
const userCaps = options?.capabilities
capabilities: userCaps
  ? (builtin) => [...resolve(userCaps, builtin), ...external.capabilities]   // 用户 override 先应用，外部恒 append 尾部
  : (builtin) => [...builtin, ...external.capabilities]
```

- 预检 id 冲突对"内置 + 用户 override 结果 + 已收集外部"全集检查（loader 无法看到内置——factory 侧把 `defaultCoreCapabilities()` 产物 id 传入做排除集；review M5 的三分支语义在此定死）
- 合并后的列表走 core 既有解析 → 6.5 registry 注册（`ConflictError` → warn，P1 既有兜底）→ deps → **串行 init 失败即停**（与内置完全同语义，含外部——D-P5）
- `skipped` 记入返回的 `ProjectRuntime.pluginLoadReport`（只读字段，装配成功时可见跳过诊断；装配失败时错误信息含插件 id）

### 3.3 与 cordis host / kernel 的关系

**零新机制、零协议改动**：外部 capability 与内置一样经 `defineCapabilityPlugin` 进 fiber；`ready` promise 承载 init 错误（P1 既有）；shutdown 循环对外部 `shutdown?.()` 同样生效（best-effort 5s，P1 既有）。cordis 只需要它已提供的装载语义。kernel 侧（数组/折叠/registry/ports）一行不动。

## 4. 装配时序（对比 P1）

```
factory.assembleProject（Node 侧，新增前置段）:
  0. external = loadExternalCapabilities(...)          // ← 静态预检，warn-skip 隔离
     capabilities = 用户override → builtin → external  // ← 函数形态合并
assembleProjectCore（零改动）:
  1-4. 不变
  5. host / 6. capabilities 解析（函数分支既有）/ 6.5 registry / 7. services
  8. deps（数组冻结、attachmentProcessors 急切折叠——照旧，外部已在数组内）
  9-10. 不变
  11. 串行 init 失败即停（外部同待遇——D-P5）
  13. ProjectRuntime { ..., pluginLoadReport }          // ← 新增只读字段
```

## 5. manifest 契约与插件形态

```jsonc
// <project>/.spherse/plugins/<dir>/manifest.json
{
  "name": "my-capability",
  "version": "1.0.0",
  "main": "index.js",             // 相对本目录，isPathInside 核验禁逃逸
  "engines": { "spherse": ">=1" } // 可选；v1 仅校验字符串形状，semver 求值留 v2
}
```

```js
// index.js——ESM，零宿主 import（D-P9）
export default {
  id: "my-capability",
  async init(ctx) { /* ctx = KernelServices，窄 port */ },
  tools(host) { return [myTool] },
}
```

类型消费：插件作者本地 `import type { Capability } from "@spherse/core"`（编译期擦除，运行时零依赖）。v1 不导出 identity helper（值 import 不可解析，导出无消费者——review m6）。

## 6. 信任边界（显式声明）

进程内全权执行：插件与内置同进程同访问权（窄 port 之外无拦截）。安全性 = "用户自己放置目录"信任链，与用户手动改项目数据文件同级。不做沙箱是决策（D-P6）；市场分发场景出现再评估签名/校验/隔离。

## 7. browser 边界（机制而非约定）

browser worker 图直连 `assembleProjectCore`（browser/src/worker/registry.ts:9,195），**不 import factory.ts**——loader（及其 node:url 依赖）不在 browser 模块图内，无需条件开关或 tree-shake 依赖。core 子路径导出面不变（loader 无独立导出）。桌面/server 均经 factory（server/src/registry.ts:3 `createProject`）自动获得。

## 8. 交付拆分

1. `plugins/loader.ts` + `manifestSchema` + 单测（缺失目录空返回/坏 manifest/路径逃拒/坏形状各成员/id 冲突跳过/好插件通过——插件 fixture 用临时目录真实 `import()`，不 mock 被测装载路径）
2. `factory.ts` 接线（合并函数、id 排除集、`pluginLoadReport`）+ 装配单测（外部 init 失败 → 装配 reject 且错误含插件 id；外部 tools 出现在 runtime 折叠结果——经 `runtime.capabilities` 的 `tools(host)` 或既有装配断言路径，`capabilities` 字段私有，review m9）
3. 文档：`docs/official/architecture/capabilities.md` 增"外部插件"节（信任模型 + 零宿主 import + semver 纪律）；`packages/core/README.md`；`docs/official/project-structure.md`（新目录 `core/src/plugins/`）；`docs/official/data-conventions.md`（新存储位置 `.spherse/plugins/`）（review m10）

## 9. 验收

- loader 单测全绿（上述 6 场景 + 14 成员形状表驱动用例）
- 装配单测：外部 init 失败 → 装配 reject（含插件 id）、预检失败 → 装配成功 + `pluginLoadReport.skipped` 记录、外部 tool 进折叠结果、内置失败语义零回归（既有测试零 diff）
- 全量 verify 零回归
- browser bundle 静态图零新增依赖（esbuild metafile 核查 factory 反证：`assembleProjectCore` 图不含 loader/node:url）
- 无新 RPC/UI 面，e2e 不新增

## 10. 风险表

| 风险 | 缓解 |
|---|---|
| dynamic import 用户目录 = 任意代码执行 | D-P6 信任模型显式声明，文档明示 |
| 坏插件 init 失败 → 整个项目起不来 | D-P5 显式选择：fail-fast + 错误信息含插件 id + 删目录即恢复；静态可检问题已在预检段隔离 |
| 插件 import 宿主包失败 | D-P9 零宿主 import 约定 + 文档声明 |
| 串行 init 中外部插件 hang | 与内置同待遇不加超时（避免语义分叉）；hang 用户可删目录重启 |
| manifest `main` 路径逃逸 | `isPathInside` 核验（仓库路径红线） |
| 外部 id 撞内置/用户 override | 预检排除集跳过（禁止 shadow 内置，M4）+ registry `ConflictError` warn 兜底（P1 既有） |
| ESM `import()` Windows 路径 | `pathToFileURL` 统一处理 |
| 插件目录内符号链接指向外部 | lexical `isPathInside` 不拦 symlink，`import()` 会跟随；与仓库路径安全实践一致，被 D-P6 全权信任模型吸收（用户自装任意代码本就全权） |
| `.spherse/plugins` 随项目导出携带第三方代码 | 定性为 feature（项目自带能力可分发），data-conventions 声明 |

## Review 处理记录（2026-11-28）

- **C1（init 失败贡献残留）**：成立——数组 deps 冻结 + `attachmentProcessors` 急切折叠（runtime.ts:85）+ registry 无 unregister。处置：D-P5 改为"静态预检 warn-skip + init fail-fast 同内置"，语义修正写明理由（静默残留更差、fail-fast 恢复路径清晰、kernel 零改动不被破坏）。✅
- **C2（browser 图污染）**：成立——共享 `assembleProjectCore` 直被 browser 引用，loader 静态 import node:url 会炸 worker。处置：挂点移至 factory.ts（browser 不经 factory），`options.capabilities` 函数形态注入；§7 从"import() 不进 bundle"的错误论证改为模块图隔离机制。✅
- **I3（FsPort 绝对路径拒绝）**：成立——loader 签名改双路径（rel 给 FsPort、projectRoot 给 import/isPathInside），学 SkillStore 先例。✅
- **M4（重复 id shadow 内置）**：成立——预检阶段 id 冲突跳过 + factory 传内置 id 排除集，明确禁止 shadow。✅
- **M5（三分支语义未定）**：成立——§3.2 定死：用户 override 先应用、外部恒 append 尾部、冲突检查对全集。✅
- **m6（§5 自相矛盾）**：示例改纯对象，删 `defineCapability` 导出。✅
- **m7（形状校验 6/14）**：全成员形状校验，表驱动用例。✅
- **m8（readdir 抛错）**：显式 catch 空返回。✅
- **m9（capabilities 私有不可断言）**：验收改经折叠路径断言。✅
- **m10（doc-sync 缺口）**：§8 补 project-structure.md + data-conventions.md。✅

## 实现差异记录（2026-11-28）

- factory 对 loader 采用**动态 `import()`**（design 原文静态 import）：vitest browser mode 从 core 源码加载 `@spherse/core` 根入口时，factory → loader → `node:url` 会被 vite externalize 报错（构建产物不受影响，仅测试源码路径触发）。动态 import 使 loader 不进 factory 静态图；类型经 `import type` 引用。browser 10/10 恢复、构建产物 grep 零 `node:url`/`loadExternalCapabilities`。
- `pluginLoadReport.loaded` 为共享数组引用、在合并函数执行时填充（design 未细化）：id 冲突剔除发生在 capabilities 解析（core 内）晚于 factory 构造 report，共享引用保证 report 反映剔除后结果。
- **排除机制实现为解析期全集检查**（design §3.2 原文是"factory 侧预构 builtin id 排除集"，未实现）：factory 无法预构 builtin 列表（ProjectStore 在 core 内），实际在 capabilities 解析时对 resolved 全集（builtin + 用户 override + 已接受外部）检查——覆盖面更强（函数分支的用户注入 id 也在检查内），被剔除者记入 `pluginLoadReport.skipped`（stage `id-conflict`）。
- code review 后追加：`checkCapabilityShape` 增加 plain-object 原型判定（类实例 default export 的原型成员会被 spread 丢失造成静默空 capability，直接在 shape 阶段拒绝）；补 13 成员表驱动、用户 array/function 分支、init cause 链断言测试。
