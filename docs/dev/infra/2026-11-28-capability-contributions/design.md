# Design: capability 贡献收集器（贡献通道激活 + 动态装载）

- 日期：2026-11-28
- 状态：implemented（2026-11-28；review 1C/3I/3M/4m 处理见文末，实现差异附后）
- 关联：`docs/dev/infra/2026-11-22-cordis-host/design.md`（P1：capability 已是 cordis 插件）；`docs/dev/infra/2026-11-28-capability-plugin-loading/design.md`（外部插件装载 v1，"重启生效"档）；讨论结论：不重构协议载体，激活贡献通道

## 1. 目标与非目标

**目标**：把贡献进入折叠管线的通道从装配期死快照改为运行时活通道——`CapabilityContributions` 收集器（host 服务）成为唯一真相；`RuntimeDeps.capabilities` 变 getter 每次求值；提供 `ProjectRuntime.loadCapability/unloadCapability` 动态装载 API（先验后发：init 成功才可见）。

**非目标**：
- 不改 `Capability` 接口与 14 成员协议（类型安全保持）
- 不做 RPC/UI 装载入口（`plugins.load` 方法组、外部插件运行时装载 = 独立 feature，本设计只交 runtime 面 API）
- 不做卸载回溯（既有 runner 的 middleware/turnHooks 不撤销——保守语义显式声明，见 §5）
- 不做沙箱/隔离（进程内全权，同 v1 信任模型）
- 不做启停配置持久化（动态装载是进程内状态，重启回装配态）

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| D-C1 | 通道形态 = **`RuntimeDeps.capabilities` getter 化**（属性访问语法不变）；`freezeRuntimeDeps` 免 spread 重做 | 全部 10 处消费点（runner 4 + assembly 6）的 `deps.capabilities` 语法零改动；**对象 spread 会 [[Get]] 求值 getter 并重建为数据属性**（runtime.ts:54），`freezeRuntimeDeps` 改为直接 `Object.freeze(对象)`（getter 属性冻描述符、调用行为保留），deps 字面量内定义 getter（review C1） |
| D-C2 | 唯一真相 = `CapabilityContributions` 收集器（host 服务，push/pull/snapshot） | 双轨真相（数组 + registry host 视图）合并；`CapabilityRegistry` 退役为收集器的兼容别名或直接删除（实现时定，倾向删除——外部插件与 server 均未消费其 byId/all） |
| D-C3 | **先验后发统一内外**：capability 贡献 push 发生在 `init` 成功之后（内置与外部一致） | 消灭"注册了但未 init"的可见性窗口；动态装载失败隔离天然成立（未 push = 贡献从未出现）；装配失败即停语义不变（runtime 不产出） |
| D-C4 | copy-on-write 快照：push/pull 重建数组，`snapshot()` 返回冻结新数组 | 消费方迭代中贡献变异不可能发生（并发 turn 安全）；顺序 = push 序 = init 序 = 装配序（外部恒尾部） |
| D-C5 | 动态 API 挂 `ProjectRuntime`：`loadCapability(cap)` / `unloadCapability(id)` | runtime 持 host 与 kernelServices（装载所需服务全程在）；入口平权——未来 RPC 方法组只是此 API 的薄封装 |
| D-C6 | 卸载保守语义：`unloadCapability` = fiber dispose → pull + `shutdown?.()`；拉取类贡献立即消失、折叠类新 runner 不再含、**既有 runner 不回溯** | 回溯需重建 runner 管线（热插拔级难题，上轮明确不做）；保守语义可测且不破坏运行中 turn 的稳定性 |
| D-C7 | `attachmentProcessors` 懒化：deps 字段同样 getter 化 | 唯一急切折叠特例（runtime.ts:85）；getter 化后与其他拉取类贡献对齐 |
| D-C8 | `createTurnHooks` 闭包改为每次调用重取快照 | 现闭包捕获数组引用（runtime.ts:63）；改调 snapshot 函数，runner 创建时刻的快照语义（折叠类贡献的正确档位） |

## 3. 收集器与插件包装

```ts
// host/contributions.ts
export interface CapabilityContributions {
  snapshot(): ReadonlyArray<Capability>;
  push(capability: Capability): void;
  pull(capability: Capability): void;
  has(id: string): boolean;
}
export function createCapabilityContributions(): CapabilityContributions
// 内部：数组 copy-on-write + 冻结返回
```

`defineCapabilityPlugin`（host/capability-plugin.ts）升级：
- plugin 内：`registry.register` 逻辑移除（registry 退役，D-C2）——改为 init 成功后 `contributions.push(capability)`
- plugin 返回清理函数（cordis fiber 收集为 dispose effect）：**仅 `contributions.pull(capability)`，不调 shutdown**——shutdown 保持 ProjectRuntime 显式循环（P1 语义：失败清理仅状态卫生、已 init 者不跑 shutdown；避免与显式循环双重调用，review I3）
- ready promise 语义不变（错误自管）

**HostServiceKey**：`capabilities` 键的值从 `CapabilityRegistry` 换为 `CapabilityContributions`（服务名不变，值类型换；生产代码无消费者——仅 cordis-host 单测断言需迁移，review m11）。

**defineCapabilityPlugin 公共导出处置**（review m9）：现从 core index 导出（index.ts:83）但无外部消费者——按"只导出外部实际使用的符号"规则直接 unexport，签名变更不构成公共 API break。

## 4. 装配时序（对比 P1）

```
1-5. 不变（host 创建）
6. capabilities 解析（数组，含外部插件经 factory 合并——v1 装载照旧；装配期不 dedupe，重复 id 两份都生效 = 现状保持）
6.5 【删除】registry 注册步骤
7. registerCoreServices（capabilities 服务 = 收集器实例）
8. deps = createRuntimeDeps({ ..., capabilities: contributions.snapshot })   // 传函数而非数组
9-10. sessionRuntime / kernelServices 不变
10.5 kernelServices 传入 ProjectRuntime（构造新增字段——动态装载 init 入参对齐，review I4）
11. 串行 init（失败即停不变）：成功一个 → contributions.push 一个   // ← D-C3
12. 失败清理：已 settle fiber dispose（pull 由 dispose 清理函数执行，不跑 shutdown）→ 重抛
13. ProjectRuntime（新增 loadCapability/unloadCapability + kernelServices 字段，见 §6）
```

**shutdown 语义保持**：`ProjectRuntime.shutdown` 现显式循环 `capability.shutdown?.()`（5s 超时）——保持不变（dispose 清理函数不含 shutdown，避免双重调用；dispose 只 pull）。既有顺序：sessionRuntime.closeAll → capability.shutdown 循环 → projectManager.close → fiber dispose（best-effort）。

## 5. 生效矩阵（验收核心）

| 贡献点 | 折叠时机 | 装载后 | 卸载后 |
|---|---|---|---|
| `tools`/`featureTools`/`pathRules`/`contextBlocks` | 每次装配（buildPromptAndTools） | 下次装配生效（新 session/agent 重装配） | 同左 |
| `streamDecorators` | buildAgent / applySampling / applyReload 时重组（配置事件驱动，非逐调用；agent-assembly.ts:231-235、agent-runner.ts:397-401/437-441） | 新 runner 立即；既有 runner 在下次 sampling/reload 变更时 | 同左 |
| `contextProjectors` | **runner 创建时折叠并闭包进 convertToLlm**（agent-assembly.ts:243,254-262；applyReload 不重建该闭包） | 新 session 生效；既有 runner 不含（review I2） | 同左 |
| `previewTransforms` | 每次调用重读（agent-runner.ts:352，getTurnContext 导出路径） | 下次调用生效 | 同左 |
| `attachmentProcessors` | deps getter 拉取 | 下次处理附件生效 | 同左 |
| `eventMiddlewares`/`turnHooks` | runner 创建时折叠 | 新 session 生效；既有 runner 不含 | 新 session 不再含；既有 runner 保留（不回溯，D-C6） |
| `onAgentDeleted`/`onAgentConfigChanged`/`shutdown` 广播 | 调用时遍历快照 | 立即生效 | 立即失效 |

## 6. 动态 API

```ts
// project-runtime.ts
async loadCapability(capability: Capability): Promise<void>
// 重复 id（已在该 map）→ reject；host.plugin(defineCapabilityPlugin(...)) → await ready → 失败：dispose + reject（贡献未 push）
async unloadCapability(id: string): Promise<boolean>
// map 中该 id 的全部 entry 逐个：fiber.dispose()（清理函数 pull）→ capability.shutdown?.()（try/catch）→ map.delete(id)
```

装载时 kernelServices 复用装配期实例——**装配步 10 的 kernelServices 构造后传入 ProjectRuntime 构造参数**（现为 assemble.ts 局部变量，review I4），服务全程存活，`init(ctx)` 入参与装配期完全一致。

id → entry 映射：`ProjectRuntime` 现持 `hostFibers` 数组——改为 `Map<capabilityId, Array<{fiber, capability}>>`（装配期重复 id 两份都生效的现状下，unload 按 id 处理全部 entry；进程 shutdown 的 dispose 循环遍历 map 全量，entry 移除仅发生在 unload 成功后）。

**unload 与进程 shutdown 的次序不对称（显式声明）**：unload = pull（广播立即不可见）→ shutdown；进程 shutdown = shutdown（期间广播仍可见）→ dispose/pull——前者"立即摘除"、后者"优雅排空"，刻意不同。

## 7. 折叠点改造表（完整消费点清单）

| 文件:行 | 现形态 | 改造 |
|---|---|---|
| runtime.ts:53-55 `freezeRuntimeDeps` | `Object.freeze({ ...deps })`（spread 压扁 getter） | 免 spread：deps 字面量直接定义 getter 后对原对象 `Object.freeze`（review C1） |
| runtime.ts:63-88 `createRuntimeDeps` | `const capabilities = input.capabilities`；闭包捕获；:85 急切 flatMap | input 改 `capabilities: () => ReadonlyArray<Capability>`；deps 字段与 `attachmentProcessors` 均 getter；`createTurnHooks` 闭包改调函数（D-C7/C8） |
| agent-runner.ts:70 | runner 创建 flatMap eventMiddlewares | 零改动（deps.capabilities getter 自动生效） |
| agent-runner.ts:352/400/440 | 每次调 `*For(this.deps.capabilities, ...)` | 零改动（同上） |
| agent-assembly.ts:129/147/159/197/234/243 | 每次装配 flatMap/遍历 | 零改动（同上） |
| project-runtime.ts | `private capabilities` 数组 + 广播遍历 | 改持 contributions + kernelServices（新增构造字段）；广播遍历 `snapshot()`；triggerCapability 等按 snapshot 查 |
| assemble.ts:131 | 传数组 | 传 `contributions.snapshot`（函数） |
| assemble.ts:100-111（6.5 registry 注册） | registry 注册 + ConflictError warn | 删除（装配数组**不做 dedupe**——重复 id 两份都生效 = 现状语义原样保持；重复 id 的外部侧剔除在 factory 合并层（v1 已交付）；动态 loadCapability 重复 id → reject） |

## 8. 交付拆分

1. `host/contributions.ts` 收集器 + 单测（push/pull/snapshot 冻结/序/has）
2. `defineCapabilityPlugin` 升级（init 成功 push、dispose pull）+ 单测
3. `createRuntimeDeps` getter 化（input 函数化、attachmentProcessors 懒化、createTurnHooks 重取）+ 单测（拉取类动态可见、折叠类 runner 快照语义）
4. 装配接线（registry 退役删除、CapabilityRegistry 及其测试处置、hostFibers → Map）+ 装配测试回归
5. `loadCapability/unloadCapability` + 生效矩阵契约测试（§5 全行）
6. 文档：`docs/official/architecture/capabilities.md`（贡献通道/生效矩阵节）、`core.md`（deps 形态）、core README、project-structure（host/ 条目更新）

## 9. 验收

- 收集器/包装/getter 化单测全绿
- **生效矩阵契约测试**：装载后 streamDecorators 下一次调用可见、middleware 新 runner 可见既有 runner 不回溯、卸载拉取类立即消失、广播立即失效——逐行落测
- `loadCapability` init 失败 → reject + 贡献从未可见 + 后续装载不受影响
- 受签名/类型影响的测试显式迁移（清单：`shared-write-mutex.test.ts:52`、`builtin-assembly.test.ts:45/107/155`（createRuntimeDeps 数组调用方）、`cordis-host.test.ts:79/98/121/142-146`（服务值断言 + defineCapabilityPlugin 签名）、CapabilityRegistry 自身单测（随退役删除））；其余测试零 diff
- 全量 verify + browser 测试（browser 走同一通道，行为零变化）+ browser bundle 静态图零新增
- 外部插件 v1 契约不变（重启生效档升级为"装载后即本进程生效"——语义增强，非 breaking）

## 10. 风险表

| 风险 | 缓解 |
|---|---|
| deps getter 在装配期被消费（部分可见窗口） | 已查证：init 循环前无消费者（SessionManager 构造只碰 projectStore/logger；trigger/mcp/memory 的 init 只存服务）；正确断言 = init 循环开始前 `deps.capabilities` 为空、循环期间无消费（review M5）。**语义变化显式声明**：若未来某 capability 在 init 内自触发会话（经 kernelServices.session），折叠到的是部分前缀（今天是全量数组）——现状 17 个内置均无此行为 |
| copy-on-write 数组分配频率（每 turn 多次 snapshot） | 快照仅 getter 求值时新建（浅拷贝 16 元素级），开销可忽略；如需可加缓存失效位（不做，先测） |
| wrapInit 后的引用相等性（pull 按 reference） | push/pull 存同一 wrapped 引用（包装器闭包内持有）；unload 按 id 查 Map 拿原引用 |
| 动态装载与正在运行的 turn 并发 | snapshot 冻结数组——运行中迭代安全（D-C4）；正在执行的 turn 管线不变 |
| registry 退役波及面 | 查证 `CapabilityRegistry` 消费方（预期仅定义+单测+6.5 注册）；server/browser/外部插件 v1 均未消费 byId/all |
| hostFibers → Map 改动破坏 P1 dispose 语义 | dispose 时机/顺序不变（shutdown 尾部 best-effort 循环）；P1 host 单测相应迁移 |
| 装配期重复 id 的 twin entry 卸载语义 | unload 按 id 处理全部 entry（pull 各自引用）；loadCapability 对已存在 id 一律 reject（不做 twin 追加） |
| 外部插件语义漂移预期 | v1 文档已写"重启生效"，本设计升级为进程内即时——capabilities.md 更新为矩阵表述 |

## Review 处理记录（2026-11-28）

- **C1（freezeRuntimeDeps spread 压扁 getter）**：成立——`Object.freeze({...deps})` 经 [[Get]] 求值 getter 重建为数据属性，D-C1 原方案静默失效。处置：freezeRuntimeDeps 免 spread、直接 freeze 定义 getter 的对象；D-C1 与 §7 补行。✅
- **I2（§5 矩阵第 2 行错误）**：成立——contextProjectors 在 runner 创建时闭包进 convertToLlm（applyReload 不重建）；streamDecorators 为配置事件驱动重组非逐调用；previewTransforms 走 getTurnContext 导出。矩阵按实际折叠时机重写为 7 行。✅
- **I3（§3/§4 dispose 清理矛盾）**：成立——若按 §3 实现 dispose 跑 shutdown 将与显式循环双重调用、且违反 P1"失败清理仅状态卫生"。处置：统一为 dispose 仅 pull，§3 文本修正。✅
- **I4（kernelServices 装配局部未接线）**：成立——D-C5 声称 runtime 持有但无构造步骤。处置：装配步 10.5 传入 ProjectRuntime 构造字段。✅
- **M5（风险行 1 缓解错述）**：修正断言（循环前空 + 循环期间无消费）；补 init 期部分前缀的语义变化声明。✅
- **M6（零回归宣称过头）**：§9 改为受影响测试文件显式清单。✅
- **M7（重复 id 折叠语义静变 + 自相矛盾措辞）**：装配期不 dedupe（现状保持）；Map 值改 entry[]、unload 按 id 处理全部。✅
- **m8-m11**：消费点计数修正（10 处）；defineCapabilityPlugin unexport（无外部消费者）；unload/shutdown 次序不对称显式声明 + Map entry 移除时机；HostServiceKey 波及面改口（生产零消费、仅单测断言）。✅

## 实现差异记录（2026-11-28）

- `ProjectRuntime.capabilities` 从私有字段升为公共 getter（`contributions.snapshot()`）：原经 private 访问的测试（assemble-default-tools / factory-external-plugins / p2-behaviors）零改动通过，语义更准确（活快照）。
- 构造函数保留 `capabilities` 参数作降级路径（`createFixedContributions` 固定快照、push/pull 空操作）——供不走 assemble 的直接构造场景；assemble 路径恒传 contributions + kernelServices + capabilityEntries。
- shutdown 的 fiber dispose 循环扩展为 hostFibers + capabilityEntries 双循环（unload 场景重复 dispose 由 cordis 容错，cordis-host 单测既有断言覆盖）。
- 外部插件 v1 的 `pluginLoadReport.loaded` 共享引用填充机制不变（合并函数执行时刻填充）。
- code review 后追加：**capabilityEntries Map 只存动态装载 entry**（原设计含装配期条目——导致 unload 可摘除结构性内置与 shutdown 双 dispose；改为装配期 fiber 走 hostFibers、Map 仅动态，M4/m6 自然消解）；`loadCapability` 加 in-flight id 互斥（并发同 id TOCTOU）；`unloadCapability` 补 `_shutdownDone` guard；矩阵契约测试改经真折叠路径（`buildPromptAndTools`/`streamDecoratorsFor`/`getRuntimeDeps()` 公共 API）；`CapabilityPlugin.fiber` 死字段删除。
- 装配期 capability（含外部插件 v1）不可运行时卸载——`unloadCapability` 仅对动态装载 id 生效（结构性能力移除走装配层），已在 capabilities.md 声明。
